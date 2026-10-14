// REDbridge as an MCP server. Spawns the bridge and exposes its JSON-RPC methods as tools over stdio,
// so an assistant can browse the archives, convert files, and edit CR2W files through document sessions.
//
//   redcode-mcp [--bridge <REDbridge.exe or its folder>] [--game <Cyberpunk 2077 folder>] [--dotnet-root <dir>]
//
// Each option also reads an environment variable (REDBRIDGE_EXE, REDCODE_GAME_PATH, DOTNET_ROOT) and,
// failing both, the VS Code settings redcode.bridgePath and redcode.gamePath, so on a machine where
// REDcode is set up the server needs no configuration. stdout is the MCP channel; logs go to stderr.

import * as fs from "node:fs";
import * as path from "node:path";
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import { BridgeClient } from "../../../extensions/redcode/src/bridgeClient";
import type { PatchOp } from "../../../extensions/redcode/src/types";

const Version = "0.1.0";

// ---- configuration ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** A value from VS Code's user settings, read tolerantly (the file may hold comments and trailing commas). */
function vscodeSetting(key: string): string | undefined {
  const base = process.platform === "win32" ? process.env.APPDATA : process.platform === "darwin" ? path.join(process.env.HOME ?? "", "Library/Application Support") : path.join(process.env.HOME ?? "", ".config");
  if (!base) return undefined;
  const file = path.join(base, "Code", "User", "settings.json");
  try {
    const text = fs.readFileSync(file, "utf8");
    const match = text.match(new RegExp(`"${key.replace(/\./g, "\\.")}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    return match ? JSON.parse(`"${match[1]}"`) : undefined;
  } catch {
    return undefined;
  }
}

function resolveBridgeExe(): string {
  let exe = arg("--bridge") ?? process.env.REDBRIDGE_EXE ?? vscodeSetting("redcode.bridgePath") ?? "REDbridge.exe";
  if (exe && fs.existsSync(exe) && fs.statSync(exe).isDirectory()) {
    exe = path.join(exe, "REDbridge.exe");
  }
  return exe;
}

const config = {
  exe: resolveBridgeExe(),
  gamePath: arg("--game") ?? process.env.REDCODE_GAME_PATH ?? vscodeSetting("redcode.gamePath"),
  dotnetRoot: arg("--dotnet-root") ?? process.env.DOTNET_ROOT ?? vscodeSetting("redcode.dotnetRoot") ?? undefined,
};

const log = (line: string) => process.stderr.write(`[redcode-mcp] ${line}\n`);

// ---- the bridge, started on first use ----------------------------------------------------------

let bridge: BridgeClient | undefined;
let starting: Promise<BridgeClient> | undefined;

async function getBridge(): Promise<BridgeClient> {
  if (bridge?.running) return bridge;
  if (starting) return starting;
  starting = (async () => {
    const b = new BridgeClient({ exe: config.exe, gamePath: config.gamePath, dotnetRoot: config.dotnetRoot });
    b.on("log", (line) => log(`bridge | ${line}`));
    b.on("exit", (code) => {
      log(`bridge exited with ${code}; it restarts on the next call, and open document sessions are gone`);
      bridge = undefined;
    });
    b.on("error", (e) => log(`bridge error: ${e.message}`));
    log(`starting ${config.exe}${config.gamePath ? ` with game ${config.gamePath}` : ""}`);
    b.start();
    const info = await b.info();
    if (!info.gameLoaded) {
      log("no game loaded: set --game, REDCODE_GAME_PATH or the VS Code setting redcode.gamePath");
    }
    bridge = b;
    return b;
  })().finally(() => {
    starting = undefined;
  });
  return starting;
}

// ---- tools -------------------------------------------------------------------------------------

const server = new McpServer({ name: "redcode", version: Version });

/** Registers a tool whose handler returns JSON; errors come back as isError results with the bridge's message. */
function tool<T extends ZodRawShape>(name: string, description: string, shape: T, run: (args: z.infer<z.ZodObject<T>>, b: BridgeClient) => Promise<unknown>): void {
  const callback = async (args: z.infer<z.ZodObject<T>>): Promise<CallToolResult> => {
    try {
      const b = await getBridge();
      const result = await run(args, b);
      return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(`${name}: ${message}`);
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  };
  // The SDK types the callback through a conditional on the shape, which stays unresolved for a
  // generic T; the runtime contract is the same, so the cast only settles the types.
  server.registerTool(name, { description, inputSchema: shape }, callback as unknown as ToolCallback<T>);
}

const PathRules = `Paths are dotted from the root chunk and match WolvenKit's JSON: property names, array indices, "Data" under a handle or a buffer, "Chunks" under a package (for example components.3.name, compiledData.Data.Chunks.1.radius, root.Data.entries.41023.femaleVariant).`;
const FormatRules = `Three rules of the file format: numbers are 32-bit floats (0.22 is stored as 0.219999999); in .ent and .app files compiledData is rebuilt from components when the file is saved, so edit components, never compiledData; properties at their default value are not stored. Values are in WolvenKit JSON form, the same as cr2w_to_json shows; a CName may be given as a plain string.`;

const PatchOpSchema = z.object({
  op: z.enum(["replace", "add", "remove", "move"]),
  path: z.string().describe("Dotted path. For add on an array, end with .- to append or .N to insert at N."),
  value: z.unknown().optional().describe("For replace and add: the value in WolvenKit JSON form."),
  from: z.string().optional().describe("For move: the path of the array item to move."),
});

// archives
tool("bridge_info", "Bridge and game status: versions, game folder, archive and file counts.", {}, (_a, b) => b.info());

tool("archive_search", "Search the game archives by file name or path substring. Returns matching game paths with sizes and the archive they live in.", {
  query: z.string().describe("A substring of the game path, for example 'nokota' or 'base\\\\characters\\\\garment'."),
  limit: z.number().int().min(1).max(2000).default(200),
}, (a, b) => b.search(a.query, a.limit));

tool("archive_list", "List game files, optionally under a path prefix or inside one archive, with paging.", {
  archive: z.string().optional().describe("Archive name, for example basegame_4_gamedata.archive."),
  prefix: z.string().optional().describe("Game path prefix, for example base\\\\localization."),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(5000).default(500),
}, (a, b) => b.list(a));

tool("archive_tree", "One level of the archive folder tree: the folders and files directly under a game path. Empty path is the root (base, dlc, engine, ep1).", {
  path: z.string().default("").describe("A folder game path such as base\\\\characters, or empty for the root."),
}, (a, b) => b.tree(a.path));

tool("archive_extract", "Extract one game file to disk as-is (the raw CR2W or other format).", {
  path: z.string().describe("The game path."),
  outFile: z.string().describe("Where to write it on disk, for example a project's source/archive/<game path>."),
}, (a, b) => b.extract(a.path, a.outFile));

tool("archive_extract_many", "Extract many game files to disk in one call.", {
  items: z.array(z.object({ path: z.string(), outFile: z.string() })).min(1).max(5000),
}, (a, b) => b.extractMany(a.items));

// conversion
tool("cr2w_to_json", "Convert a game file (by game path) to WolvenKit JSON. Large files (a localization file is 21 MB) should go to outFile; without outFile the JSON comes back inline, cut at maxChars.", {
  path: z.string().describe("The game path."),
  outFile: z.string().optional().describe("Write the JSON here instead of returning it."),
  maxChars: z.number().int().min(1000).max(5_000_000).default(200_000),
}, async (a, b) => {
  const r = await b.toJson(a.path, a.outFile);
  if (r.json && r.json.length > a.maxChars) {
    return { path: r.path, hash: r.hash, bytes: r.bytes, truncated: true, note: `JSON is ${r.json.length.toLocaleString()} chars; pass outFile or raise maxChars. First ${a.maxChars.toLocaleString()} chars follow.`, json: r.json.slice(0, a.maxChars) };
  }
  return r;
});

tool("cr2w_file_to_json", "Convert a CR2W file on disk (for example one in a mod project) to WolvenKit JSON.", {
  file: z.string().describe("The file on disk."),
  outFile: z.string().optional().describe("Write the JSON here instead of returning it."),
  maxChars: z.number().int().min(1000).max(5_000_000).default(200_000),
}, async (a, b) => {
  const r = await b.fileToJson(a.file, a.outFile);
  if (r.json && r.json.length > a.maxChars) {
    return { path: r.path, bytes: r.bytes, truncated: true, note: `JSON is ${r.json.length.toLocaleString()} chars; pass outFile or raise maxChars. First ${a.maxChars.toLocaleString()} chars follow.`, json: r.json.slice(0, a.maxChars) };
  }
  return r;
});

tool("cr2w_from_json", `Write a CR2W file from WolvenKit JSON, given inline or as a file. ${FormatRules}`, {
  outFile: z.string().describe("The CR2W file to write."),
  json: z.string().optional().describe("The JSON text."),
  jsonFile: z.string().optional().describe("Or a file holding the JSON."),
}, (a, b) => {
  if (!a.json && !a.jsonFile) throw new Error("json or jsonFile is required");
  return b.fromJson(a.outFile, a.json ? { json: a.json } : { jsonFile: a.jsonFile! });
});

tool("texture_to_png", "Decode a texture (.xbm) from the archives to a PNG on disk.", {
  path: z.string().describe("The game path of the .xbm."),
  outFile: z.string().describe("The PNG to write."),
}, (a, b) => b.toPng(a.path, a.outFile));

tool("texture_file_to_png", "Decode a texture file on disk to a PNG.", {
  file: z.string(),
  outFile: z.string(),
}, (a, b) => b.fileToPng(a.file, a.outFile));

tool("project_export", "Export a game file under a project's source/archive to the same relative path under source/raw through WolvenKit's exporter: glTF for meshes (with material textures), an image for textures, WAV for sounds, and so on. Returns ok and the files written, relative to rawDir. Types WolvenKit cannot export are refused; use cr2w_to_json for those. Bridge 0.7.0.", {
  file: z.string().describe("The game file, under archiveDir."),
  archiveDir: z.string().describe("The project's source/archive folder."),
  rawDir: z.string().describe("The project's source/raw folder."),
  textureFormat: z.enum(["png", "tga", "dds", "bmp", "jpg", "tiff"]).optional().describe("Image format for textures; default png."),
  meshBinary: z.boolean().optional().describe("Meshes as .glb (true, default) or .gltf."),
  meshMaterials: z.boolean().optional().describe("Export a mesh's materials and textures too; default true."),
}, (a, b) => b.exportFile(a.file, a.archiveDir, a.rawDir, { textureFormat: a.textureFormat, meshBinary: a.meshBinary, meshMaterials: a.meshMaterials }));

tool("project_import", "Import a raw file under a project's source/raw back into source/archive through WolvenKit's importer (images to .xbm, glTF or GLB to .mesh, WAV, CSV and so on). With keep (default), the file it replaces keeps its settings: a texture its group, format, compression and flags. Returns ok and the files written, relative to archiveDir. Bridge 0.7.0.", {
  file: z.string().describe("The raw file, under rawDir."),
  rawDir: z.string().describe("The project's source/raw folder."),
  archiveDir: z.string().describe("The project's source/archive folder."),
  keep: z.boolean().optional().describe("Keep the replaced file's settings; default true."),
}, (a, b) => b.importFile(a.file, a.rawDir, a.archiveDir, a.keep ?? true));

tool("project_pack", "Pack a folder (a project's source/archive) into <modName>.archive in outDir through WolvenKit's packer. Returns the archive path, size, file count and warnings for paths with capital letters or spaces. Bridge 0.6.1.", {
  dir: z.string().describe("The folder to pack, laid out as game paths (base/..., ep1/...)."),
  outDir: z.string().describe("Where the archive goes, usually packed/archive/pc/mod."),
  modName: z.string().describe("The archive name without extension."),
}, (a, b) => b.pack(a.dir, a.outDir, a.modName));

tool("archive_open_mod", "List the resources inside a mod .archive on disk. No game needed.", {
  path: z.string().describe("The .archive file."),
}, (a, b) => b.openMod(a.path));

tool("hash_fnv1a64", "The FNV1a64 hash of a string, as the game uses for paths and names.", { value: z.string() }, (a, b) => b.fnv1a64(a.value));
tool("hash_resolve", "The game path for a known hash, if the hash list knows it.", { hash: z.string().describe("Decimal hash string.") }, (a, b) => b.resolve(a.hash));

// document sessions
tool("cr2w_open", `Open a CR2W file as a document session for node-by-node reading and patching. A file on disk is editable; a game path opens read-only (save it with cr2w_save and outFile to get an editable copy). Returns the session id to pass to the other cr2w_* tools. ${PathRules}`, {
  file: z.string().optional().describe("A CR2W file on disk."),
  path: z.string().optional().describe("Or a game path in the archives."),
}, (a, b) => {
  if (!a.file && !a.path) throw new Error("file or path is required");
  return b.openDocument(a.file ? { file: a.file } : { path: a.path! });
});

tool("cr2w_get_node", `Read one node of an open document: its kind (class, array, handle, buffer, package, value), type, value for leaves and small structs, and one line per child. Arrays page from offset, limit items at a time. ${PathRules}`, {
  doc: z.string().describe("The session id from cr2w_open."),
  path: z.string().default("").describe("Dotted path; empty for the root chunk."),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(5000).default(200),
}, (a, b) => b.getNode(a.doc, a.path, a.offset, a.limit));

tool("cr2w_patch", `Apply JSON Patch operations (replace, add, remove, move) to an open document, all or none. Returns the inverse operations for undo. Nothing is written until cr2w_save. ${PathRules} ${FormatRules}`, {
  doc: z.string(),
  ops: z.array(PatchOpSchema).min(1),
}, (a, b) => b.patch(a.doc, a.ops as PatchOp[]));

tool("cr2w_get_nodes", "Several nodes of an open document in one call. A path that fails gives a node of kind 'error' with the message as its type, instead of failing the call.", {
  doc: z.string(),
  paths: z.array(z.string()).min(1).max(500),
  limit: z.number().int().min(1).max(5000).default(200).describe("Array window size for array nodes."),
}, (a, b) => b.getNodes(a.doc, a.paths, a.limit));

tool("cr2w_search", `Find leaves in an open document whose text or property name contains the query (case-insensitive), below a path. Returns paths with previews; total counts every match. Use it to locate a value before patching, or to filter rows of a localization file (path root.Data.entries). ${PathRules}`, {
  doc: z.string(),
  query: z.string().min(1),
  path: z.string().default("").describe("Start path; empty for the whole file."),
  limit: z.number().int().min(1).max(5000).default(200),
}, (a, b) => b.searchDocument(a.doc, a.query, a.path, a.limit));

tool("cr2w_save", "Write an open document through WolvenKit's writer, to its own file or to outFile. compiledData is rebuilt from components during the write.", {
  doc: z.string(),
  outFile: z.string().optional(),
}, (a, b) => b.saveDocument(a.doc, a.outFile));

tool("cr2w_close", "Close a document session.", { doc: z.string() }, (a, b) => b.closeDocument(a.doc).then(() => ({ closed: a.doc })));
tool("cr2w_documents", "List the open document sessions.", {}, (_a, b) => b.documents());

tool("cr2w_describe_type", "What a RED type is made of: a class's properties with types, kinds and defaults; an enum's values; an array's or handle's element type. Use it to know which properties exist and what values they take before patching.", {
  type: z.string().describe("A RED type name such as entMeshComponent, ELightType or array:CName."),
}, (a, b) => b.describeType(a.type));

tool("cr2w_create_instance", "A default instance of a RED type in WolvenKit JSON form, to use as the value of an add operation or to fill a handle.", {
  type: z.string(),
}, (a, b) => b.createInstance(a.type));

// one-call editing
tool("cr2w_edit_file", `Edit a CR2W file in one call: open it, apply the operations, save, close. Give file for a file on disk (saved in place unless outFile is set) or path for a game file (outFile is then required, and the result is a modified copy; the archives are never changed). Returns what was written and the inverse operations. ${PathRules} ${FormatRules}`, {
  file: z.string().optional().describe("A CR2W file on disk to modify."),
  path: z.string().optional().describe("Or a game path to copy and modify."),
  outFile: z.string().optional().describe("Where to write the result. Required with path."),
  ops: z.array(PatchOpSchema).min(1),
}, async (a, b) => {
  if (!a.file && !a.path) throw new Error("file or path is required");
  if (a.path && !a.outFile) throw new Error("outFile is required when editing a game file, so the archives stay untouched");
  const d = await b.openDocument(a.file ? { file: a.file } : { path: a.path! });
  try {
    if (a.path) {
      await b.saveDocument(d.doc, a.outFile);
    }
    const r = await b.patch(d.doc, a.ops as PatchOp[]);
    const w = await b.saveDocument(d.doc, a.outFile);
    return { file: w.file, bytes: w.bytes, applied: r.applied, inverse: r.inverse, type: d.type };
  } finally {
    await b.closeDocument(d.doc).catch(() => undefined);
  }
});

tool("cr2w_read", `Read values from a CR2W file in one call, without keeping a session: opens the file, reads each path, closes. Use it to look before editing. ${PathRules}`, {
  file: z.string().optional().describe("A CR2W file on disk."),
  path: z.string().optional().describe("Or a game path."),
  paths: z.array(z.string()).min(1).max(100).describe("Node paths to read; empty string is the root."),
}, async (a, b) => {
  if (!a.file && !a.path) throw new Error("file or path is required");
  const d = await b.openDocument(a.file ? { file: a.file } : { path: a.path! });
  try {
    const out: Record<string, unknown> = {};
    for (const p of a.paths) {
      out[p] = await b.getNode(d.doc, p).catch((e: Error) => ({ error: e.message }));
    }
    return { type: d.type, nodes: out };
  } finally {
    await b.closeDocument(d.doc).catch(() => undefined);
  }
});

// ---- start ------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`redcode-mcp ${Version} ready (bridge ${config.exe})`);
  const stop = () => {
    bridge?.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.stdin.on("close", stop);
}

main().catch((e) => {
  log(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
