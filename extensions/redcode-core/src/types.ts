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

export interface ExtractResult {
  file: string;
  bytes: number;
}

export interface JsonResult {
  path: string;
  hash: string;
  file: string | null;
  bytes: number;
  json: string | null;
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
