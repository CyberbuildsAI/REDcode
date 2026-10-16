// Shapes returned by REDbridge. They mirror the records in REDbridge's BridgeApi.cs.
// Hashes are decimal strings, because JavaScript numbers cannot hold 64 bits.

export interface BridgeInfo {
  version: string;
  wolvenKit: string;
  gameDir: string | null;
  gameLoaded: boolean;
  archives: number;
  files: number;
}

export interface ArchiveInfo {
  name: string;
  source: string;
  files: number;
  path: string;
}

export interface GameFileInfo {
  hash: string;
  name: string;
  size: number;
  archive: string;
}

export interface FileList {
  total: number;
  items: GameFileInfo[];
}

export interface FolderInfo {
  name: string;
  path: string;
  /** Files in this folder and every folder below it. */
  files: number;
}

export interface TreeResult {
  path: string;
  folders: FolderInfo[];
  files: GameFileInfo[];
}

export interface ExtractResult {
  file: string;
  bytes: number;
}

export interface ExtractManyResult {
  extracted: number;
  bytes: number;
  failed: string[];
}

export interface JsonResult {
  path: string;
  hash: string;
  file: string | null;
  bytes: number;
  json: string | null;
}

// ---- cr2w document sessions (bridge 0.5.0): see docs/design/cr2w-editor.md ------------------

export interface DocumentInfo {
  /** The session id to pass to the other cr2w.* calls. */
  doc: string;
  /** The root chunk's RED type name, for example entEntityTemplate. */
  type: string;
  /** The file on disk, or null when opened from the archives. */
  file: string | null;
  gamePath: string | null;
  readOnly: boolean;
  bytes: number;
  embeddedFiles: number;
}

/** What a node is: a class with properties, an array, a handle (child "Data"), a buffer (child "Data"), a package (child "Chunks"), or a leaf value. */
export type NodeKind = "class" | "array" | "handle" | "buffer" | "package" | "value" | "null";

export interface NodeChild {
  /** Property name, or the index as a string. */
  name: string;
  kind: NodeKind;
  /** RED type name, for example CName, array:handle:entIComponent. */
  type: string;
  /** One line: the value for leaves, "N items" for arrays, the type and name for classes. */
  preview: string;
  /** Item count, for arrays. */
  count: number | null;
  /** The value in WolvenKit JSON form, for leaves and small structs such as a table row; null otherwise. */
  value: unknown;
}

export interface SearchHit {
  path: string;
  type: string;
  preview: string;
}

export interface SearchResult {
  /** Every match, counted; hits holds the first limit of them. */
  total: number;
  truncated: boolean;
  hits: SearchHit[];
}

export interface NodeInfo {
  path: string;
  kind: NodeKind;
  type: string;
  /** The value in WolvenKit JSON form: for leaves, and for small structs whose properties are all leaves. */
  value: unknown;
  children: NodeChild[] | null;
  /** Array length, when the node is an array; children hold the window from offset. */
  total: number | null;
  offset: number | null;
}

/** JSON Patch (RFC 6902) subset. Values are in WolvenKit JSON form. */
export interface PatchOp {
  op: "replace" | "add" | "remove" | "move";
  path: string;
  value?: unknown;
  from?: string;
}

export interface PropertyDescription {
  name: string;
  type: string;
  kind: NodeKind | "enum" | "flags";
  /** The default value in WolvenKit JSON form, or null when the type has none to offer. */
  default: unknown;
  enumValues: string[] | null;
  /** For arrays and handles: the element or inner type. */
  elementType: string | null;
}

export interface TypeDescription {
  type: string;
  kind: NodeKind | "enum" | "flags";
  baseType: string | null;
  properties: PropertyDescription[] | null;
  enumValues: string[] | null;
  elementType: string | null;
}

export interface PatchResult {
  applied: number;
  /** The operations that undo the patch, in the order to apply them. */
  inverse: PatchOp[];
}

export interface HashResult {
  value: string;
  hash: string;
  hex: string;
}

export interface ResolveResult {
  hash: string;
  path: string | null;
  known: boolean;
}

/** project.pack: the archive written and what went into it. */
export interface PackResult {
  archive: string;
  bytes: number;
  files: number;
  /** Paths under the folder with capital letters or spaces, which the game may not resolve. */
  warnings: string[];
}

/** archive.openMod: the resources inside a mod archive on disk. */
export interface ModArchiveInfo {
  path: string;
  name: string;
  files: number;
  items: GameFileInfo[];
}

/** project.export options; anything left out keeps WolvenKit's default. */
export interface ExportOptions {
  /** Texture format for .xbm: png (default), tga, dds, bmp, jpg, tiff. */
  textureFormat?: string;
  /** Mesh as .glb (true, default) or .gltf. */
  meshBinary?: boolean;
  /** Export the mesh's materials and their textures too (default true). */
  meshMaterials?: boolean;
  materialTextureFormat?: string;
  meshLodFilter?: boolean;
}

// ---- tweakdb (bridge 0.8.0): TweakDB as the game ships it, read from r6/cache/tweakdb_ep1.bin ----

/** A flat's value: plain JSON. Record links are paths (or a 0x id when unknown), LocKeys { key, text }, references paths, structs WolvenKit's JSON. */
export type TweakValue = string | number | boolean | null | TweakLocKey | TweakValue[] | { [key: string]: unknown };

export interface TweakLocKey {
  key: string;
  text: string | null;
}

export interface TweakTypes {
  file: string;
  records: number;
  loadSeconds: number;
  types: { type: string; count: number }[];
}

export interface TweakRecord {
  id: string;
  /** null when WolvenKit's names list does not know the id. */
  path: string | null;
  type: string;
  flats: Record<string, TweakValue> | null;
}

export interface TweakRecords {
  total: number;
  offset: number;
  items: TweakRecord[];
}

export interface TweakRecordsQuery {
  /** A RED class (gamedataClothing_Record) or its short form (Clothing); subtypes are included. */
  type?: string;
  prefix?: string;
  /** Flat names to include with each record; ["*"] for all. */
  flats?: string[];
  offset?: number;
  limit?: number;
  resolveLocKeys?: boolean;
  language?: string;
}

export interface TweakRecordFull {
  id: string;
  path: string | null;
  type: string;
  flats: { name: string; type: string; value: TweakValue }[];
}

export interface TweakFlatValue {
  id: string;
  path: string | null;
  type: string;
  value: TweakValue;
}

/** sound.events (bridge 0.7.2): event names with their Wwise hashes (FNV-1 of the lower-case name). */
export interface SoundEvents {
  gameVersion: string | null;
  count: number;
  events: { name: string; hash: number; tags: string[] }[];
}

/** sound.importWavs (bridge 0.9.0): the sound hashes replaced, the files written under archiveDir, and the WAVs skipped with why. */
export interface SoundImportResult {
  ok: boolean;
  imported: number[];
  written: string[];
  skipped: { file: string; reason: string }[];
}

/** project.export and project.import: whether WolvenKit reported success, and the files written, relative to the target folder. */
export interface ModkitResult {
  ok: boolean;
  written: string[];
}
