// Exports for the viewers: a game file or a file on disk exported through REDbridge's project.export
// (0.7.0) into REDcode's cache, again only when the source is newer than the export. The 3D view
// gets a .glb this way, the audio player an .ogg. No VS Code imports. See docs/design/view.md.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BridgeClient } from "./bridgeClient";
import type { ExportOptions } from "./types";

/** A file on disk (a project's source/archive, or anywhere), or a game path. */
export interface ExportSource {
  file?: string;
  gamePath?: string;
}

export interface CachedExport {
  file: string;
  /** True when the cached export was still newer than the source. */
  cached: boolean;
}

export const mtime = (f: string): number => {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return -1;
  }
};

/** Where a source sits for the exporter: a game path is extracted into cacheRoot/game/archive first. */
export async function sourceFile(bridge: BridgeClient, cacheRoot: string, source: ExportSource): Promise<{ file: string; archiveDir: string }> {
  if (source.gamePath) {
    const archiveDir = path.join(cacheRoot, "game", "archive");
    const file = path.join(archiveDir, ...source.gamePath.split("\\"));
    if (!fs.existsSync(file)) await bridge.extract(source.gamePath, file);
    return { file, archiveDir };
  }
  if (!source.file) throw new Error("An export needs a file or a game path");
  const file = path.resolve(source.file);
  // Inside a project, the archive root keeps the game path; elsewhere the file's own folder does.
  const marker = `${path.sep}source${path.sep}archive${path.sep}`;
  const at = file.toLowerCase().indexOf(marker);
  return { file, archiveDir: at >= 0 ? file.slice(0, at + marker.length - 1) : path.dirname(file) };
}

/**
 * The export of a source with the extension ext (".glb", ".ogg"), from the cache when it is newer
 * than the source. what names the format in the error, for a file WolvenKit could not convert.
 */
export async function cachedExport(bridge: BridgeClient, cacheRoot: string, source: ExportSource, ext: string, options: ExportOptions, what: string): Promise<CachedExport> {
  const { file, archiveDir } = await sourceFile(bridge, cacheRoot, source);
  const key = crypto.createHash("sha1").update(archiveDir.toLowerCase()).digest("hex").slice(0, 12);
  const rawDir = path.join(cacheRoot, "raw", key);
  const rel = path.relative(archiveDir, file);
  const out = path.join(rawDir, rel.slice(0, rel.length - path.extname(rel).length) + ext);
  if (mtime(out) > mtime(file)) return { file: out, cached: true };
  const r = await bridge.exportFile(file, archiveDir, rawDir, options);
  if (!r.ok || !fs.existsSync(out)) {
    throw new Error(`WolvenKit could not export ${path.basename(file)} to ${what}${r.written.length ? `; it wrote ${r.written.join(", ")}` : ""}`);
  }
  return { file: out, cached: false };
}
