// A client for REDbridge that depends on Node only, so it can be used from tools and tests
// as well as from the extension. Spawns the bridge, speaks JSON-RPC 2.0 over its stdio
// (Content-Length framed, like a language server) and forwards its stderr log.

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import * as readline from "node:readline";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter, type MessageConnection } from "vscode-jsonrpc/node";
import type { ArchiveInfo, BridgeInfo, ExtractManyResult, ExtractResult, FileList, HashResult, JsonResult, ResolveResult, TreeResult } from "./types";

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

  fnv1a64(value: string): Promise<HashResult> {
    return this.call("hash.fnv1a64", { value });
  }

  resolve(hash: string): Promise<ResolveResult> {
    return this.call("hash.resolve", { hash });
  }
}
