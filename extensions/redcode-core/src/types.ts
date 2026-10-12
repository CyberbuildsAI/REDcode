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
