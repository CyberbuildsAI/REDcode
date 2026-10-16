// A client for REDbridge that depends on Node only, so it can be used from tools and tests
// as well as from the extension. Spawns the bridge, speaks JSON-RPC 2.0 over its stdio
// (Content-Length framed, like a language server) and forwards its stderr log.

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as readline from "node:readline";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from "vscode-jsonrpc/node";
import type { ArchiveInfo, BridgeInfo, DocumentInfo, ExtractManyResult, ExtractResult, FileList, HashResult, ExportOptions, JsonResult, ModArchiveInfo, ModkitResult, SoundEvents, SoundImportResult, TweakFlatValue, TweakRecordFull, TweakRecords, TweakRecordsQuery, TweakTypes, PackResult, NodeInfo, PatchOp, PatchResult, ResolveResult, SearchResult, TreeResult, TypeDescription } from "./types";

export interface BridgeOptions {
  /** Path to REDbridge.exe. */
  exe: string;
  /** The Cyberpunk 2077 folder. Passed as --game so the bridge loads it at start. */
  gamePath?: string;
  /** DOTNET_ROOT for a per-user .NET runtime. Inherits the environment when empty. */
  dotnetRoot?: string;
}

export interface BridgeEvents {
  log: [line: string];
  /** The process ended on its own. Not emitted after stop(). */
  exit: [code: number | null, signal: NodeJS.Signals | null];
  /** The process could not be started, for example because the path is wrong. */
  error: [error: Error];
}

/**
 * One bridge process and its connection. `start()` spawns it; every method returns a promise
 * that rejects with the bridge's error message when a call fails.
 */
export class BridgeClient extends EventEmitter<BridgeEvents> {
  private process: ChildProcess | undefined;
  private connection: MessageConnection | undefined;
  private stopping = false;

  constructor(readonly options: BridgeOptions) {
    super();
  }

  get running(): boolean {
    return this.process !== undefined && this.process.exitCode === null;
  }

  start(): void {
    if (this.running) {
      return;
    }
    const args = this.options.gamePath ? ["--game", this.options.gamePath] : [];
    const env = { ...process.env };
    if (this.options.dotnetRoot) {
      env.DOTNET_ROOT = this.options.dotnetRoot;
    }
    this.stopping = false;
    const child = spawn(this.options.exe, args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.process = child;

    readline.createInterface({ input: child.stderr! }).on("line", (line) => this.emit("log", line));
    child.on("error", (error) => {
      this.connection?.dispose();
      this.connection = undefined;
      this.emit("error", error);
    });
    child.on("exit", (code, signal) => {
      this.connection?.dispose();
      this.connection = undefined;
      if (!this.stopping) {
        this.emit("exit", code, signal);
      }
    });

    const connection = createMessageConnection(new StreamMessageReader(child.stdout!), new StreamMessageWriter(child.stdin!));
    connection.listen();
    this.connection = connection;
  }

  stop(): void {
    this.stopping = true;
    this.connection?.dispose();
    this.connection = undefined;
    this.process?.kill();
    this.process = undefined;
  }

  /** Stops the process and resolves once it has exited, so the files it held (its own exe) can be replaced. */
  stopAndWait(timeoutMs = 5000): Promise<void> {
    const child = this.process;
    this.stop();
    if (!child || child.exitCode !== null) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.connection) {
      return Promise.reject(new Error("The bridge is not running."));
    }
    return this.connection.sendRequest<T>(method, params ?? {});
  }

  // ---- the bridge's methods, one wrapper each ---------------------------------------------

  info(): Promise<BridgeInfo> {
    return this.call("bridge.info");
  }

  load(gameDir: string): Promise<BridgeInfo> {
    return this.call("archive.load", { gameDir });
  }

  archives(): Promise<ArchiveInfo[]> {
    return this.call("archive.archives");
  }

  list(params: { archive?: string; prefix?: string; offset?: number; limit?: number } = {}): Promise<FileList> {
    return this.call("archive.list", params);
  }

  search(query: string, limit = 200): Promise<FileList> {
    return this.call("archive.search", { query, limit });
  }

  /** One level of the archive folder tree. An empty path is the root. */
  tree(path = ""): Promise<TreeResult> {
    return this.call("archive.tree", { path });
  }

  extract(path: string, outFile: string): Promise<ExtractResult> {
    return this.call("archive.extract", { path, outFile });
  }

  extractMany(items: { path: string; outFile: string }[]): Promise<ExtractManyResult> {
    return this.call("archive.extractMany", { items });
  }

  toJson(path: string, outFile?: string): Promise<JsonResult> {
    return this.call("cr2w.toJson", outFile ? { path, outFile } : { path });
  }

  /** Converts a CR2W file on disk, for example one in a project, to JSON. */
  fileToJson(file: string, outFile?: string): Promise<JsonResult> {
    return this.call("cr2w.fileToJson", outFile ? { file, outFile } : { file });
  }

  fromJson(outFile: string, source: { json: string } | { jsonFile: string }): Promise<ExtractResult> {
    return this.call("cr2w.fromJson", { outFile, ...source });
  }

  toPng(path: string, outFile: string): Promise<ExtractResult> {
    return this.call("texture.toPng", { path, outFile });
  }

  /** Converts a texture file on disk, for example one in a project, to PNG. Needs REDbridge 0.3.0. */
  fileToPng(file: string, outFile: string): Promise<ExtractResult> {
    return this.call("texture.fileToPng", { file, outFile });
  }

  /** Packs a folder (a project's source/archive) into outDir/modName.archive through WolvenKit's packer. Bridge 0.6.0. */
  pack(dir: string, outDir: string, modName: string): Promise<PackResult> {
    return this.call("project.pack", { dir, outDir, modName });
  }

  /** Converts a plain image (TGA, DDS, TIFF, BMP, JPG, PNG) to PNG for viewing. Bridge 0.7.0. */
  imageToPng(file: string, outFile: string): Promise<ExtractResult> {
    return this.call("texture.imageToPng", { file, outFile });
  }

  /** Extracts resources (by path or hash) from a mod archive on disk. No game needed. Bridge 0.7.1. */
  extractFromMod(archivePath: string, items: { path: string; outFile: string }[]): Promise<ExtractManyResult> {
    return this.call("archive.extractFromMod", { archivePath, items });
  }

  /** Lists the resources inside a mod archive on disk. No game needed. Bridge 0.4.0. */
  openMod(path: string): Promise<ModArchiveInfo> {
    return this.call("archive.openMod", { path });
  }

  /** Exports a file under archiveDir into rawDir at the same relative path, through WolvenKit's exporter. Bridge 0.7.0. */
  exportFile(file: string, archiveDir: string, rawDir: string, options?: ExportOptions): Promise<ModkitResult> {
    return this.call("project.export", { file, archiveDir, rawDir, options: options ?? null });
  }

  /** Imports a raw file under rawDir back into archiveDir, through WolvenKit's importer. keep: an existing file keeps its settings. Bridge 0.7.0. */
  importFile(file: string, rawDir: string, archiveDir: string, keep = true, template?: string): Promise<ModkitResult> {
    // template (bridge 0.9.0): a game path or .mesh to start a new mesh from, for a GLB with no mesh to go over.
    return this.call("project.import", { file, rawDir, archiveDir, keep, template: template ?? null });
  }

  /** The sound event names WolvenKit knows, with their Wwise hashes, which name the groups in an .opusinfo. Bridge 0.7.2. */
  soundEvents(): Promise<SoundEvents> {
    return this.call("sound.events", {});
  }

  /** Overrides game sound effects in a project from <hash>.wav files: the changed packs and index go under archiveDir. Bridge 0.9.0. */
  importWavs(wavFiles: string[], archiveDir: string): Promise<SoundImportResult> {
    return this.call("sound.importWavs", { wavFiles, archiveDir });
  }

  // ---- tweakdb (bridge 0.8.0): read offline from the game's tweakdb.bin, loaded on the first call (about 12 s) ----

  tweakTypes(): Promise<TweakTypes> {
    return this.call("tweakdb.types", {});
  }

  tweakRecords(query: TweakRecordsQuery): Promise<TweakRecords> {
    return this.call("tweakdb.records", { ...query });
  }

  tweakRecord(path: string, resolveLocKeys = false, language = "en-us"): Promise<TweakRecordFull> {
    return this.call("tweakdb.record", { path, resolveLocKeys, language });
  }

  tweakFlat(path: string, resolveLocKeys = false, language = "en-us"): Promise<TweakFlatValue> {
    return this.call("tweakdb.flat", { path, resolveLocKeys, language });
  }

  tweakSearch(text: string, type?: string, limit = 200): Promise<TweakRecords> {
    return this.call("tweakdb.search", { text, type: type ?? null, limit });
  }

  /** Paths for TweakDB ids (0x hex or decimal); only the low 40 bits count. Needs no TweakDB load. */
  tweakNames(ids: string[]): Promise<Record<string, string | null>> {
    return this.call("tweakdb.names", { ids });
  }

  // ---- cr2w document sessions (bridge 0.5.0) -------------------------------------------

  /** Parses a file once and keeps it open in the bridge. A game path opens read-only. */
  openDocument(source: { file: string } | { path: string }): Promise<DocumentInfo> {
    return this.call("cr2w.open", source);
  }

  closeDocument(doc: string): Promise<void> {
    return this.call("cr2w.close", { doc });
  }

  documents(): Promise<DocumentInfo[]> {
    return this.call("cr2w.documents");
  }

  /** One node by dotted path from the root chunk; an empty path is the root. Arrays page from offset. */
  getNode(doc: string, path = "", offset = 0, limit = 200): Promise<NodeInfo> {
    return this.call("cr2w.getNode", { doc, path, offset, limit });
  }

  /** Several nodes in one call; a path that fails gives a node of kind "error" whose type holds the message. */
  getNodes(doc: string, paths: string[], limit = 200): Promise<NodeInfo[]> {
    return this.call("cr2w.getNodes", { doc, paths, limit });
  }

  /** Leaves whose text or property name contains the query, below a path. Total counts all; hits holds the first limit. */
  searchDocument(doc: string, query: string, path = "", limit = 200): Promise<SearchResult> {
    return this.call("cr2w.search", { doc, query, path, limit });
  }

  /** Applies the operations atomically and returns the inverse, for undo. */
  patch(doc: string, ops: PatchOp[]): Promise<PatchResult> {
    return this.call("cr2w.patch", { doc, ops });
  }

  /** What a RED type is made of: properties with types and defaults, enum values, element types. Cached by the bridge. */
  describeType(type: string): Promise<TypeDescription> {
    return this.call("cr2w.describeType", { type });
  }

  /** A default instance of a RED type in WolvenKit JSON form, for adding array items and filling handles. */
  createInstance(type: string): Promise<unknown> {
    return this.call("cr2w.createInstance", { type });
  }

  /** Writes the document through WolvenKit's writer, to its own file or outFile. */
  saveDocument(doc: string, outFile?: string): Promise<ExtractResult> {
    return this.call("cr2w.save", outFile ? { doc, outFile } : { doc });
  }

  fnv1a64(value: string): Promise<HashResult> {
    return this.call("hash.fnv1a64", { value });
  }

  resolve(hash: string): Promise<ResolveResult> {
    return this.call("hash.resolve", { hash });
  }
}
