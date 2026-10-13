// Packing a project the way WolvenKit does, so the packed folder installs the same way. See
// docs/design/ship.md. The bridge writes the archive; everything else here is file copying.
// No VS Code imports, so the smoke script can run it.

import * as fs from "node:fs";
import * as path from "node:path";
import type { BridgeClient } from "./bridgeClient";
import { ProjectFolders, type ProjectInfo } from "./project";

export interface PackOptions {
  /** Empty the packed folder first, so a file removed from the project does not linger in the mod. */
  clean: boolean;
  /** Lay the mod out as a REDmod under packed/mods/<name> instead of a plain archive. */
  redmod: boolean;
}

export interface PackSummary {
  /** The archive written, or undefined when source/archive had no files. */
  archive?: string;
  archiveBytes: number;
  archiveFiles: number;
  /** Paths under source/archive with capital letters or spaces, which the game may not resolve. */
  warnings: string[];
  /** ArchiveXL files copied beside the archive, relative to source/resources. */
  archiveXl: string[];
  /** Other resource files copied into packed, relative to source/resources. */
  resources: string[];
  packedDir: string;
  /** Where the archive and the ArchiveXL files went. */
  archiveDir: string;
}

/** Resource files WolvenKit leaves out of a plain pack: CDPR script sources. */
const SkippedExtensions = new Set([".script", ".ws"]);

/** Where the archive goes: packed/archive/pc/mod, or packed/mods/<name>/archives for a REDmod. */
export function packedArchiveDir(project: ProjectInfo, redmod: boolean): string {
  const packed = path.join(project.dir, ProjectFolders.packed);
  return redmod ? path.join(packed, "mods", project.modName, "archives") : path.join(packed, "archive", "pc", "mod");
}

export async function packProject(bridge: BridgeClient, project: ProjectInfo, options: PackOptions, log: (line: string) => void): Promise<PackSummary> {
  const packed = path.join(project.dir, ProjectFolders.packed);
  const source = path.join(project.dir, ProjectFolders.archive);
  const resources = path.join(project.dir, ProjectFolders.resources);
  const archiveDir = packedArchiveDir(project, options.redmod);
  const summary: PackSummary = { archiveBytes: 0, archiveFiles: 0, warnings: [], archiveXl: [], resources: [], packedDir: packed, archiveDir };

  if (options.clean && fs.existsSync(packed)) {
    fs.rmSync(packed, { recursive: true, force: true });
    log(`Cleaned ${packed}`);
  }
  fs.mkdirSync(packed, { recursive: true });

  // The archive, through WolvenKit's packer on the bridge.
  if (walk(source).length > 0) {
    const r = await bridge.pack(source, archiveDir, project.modName);
    summary.archive = r.archive;
    summary.archiveBytes = r.bytes;
    summary.archiveFiles = r.files;
    summary.warnings = r.warnings;
    log(`Packed ${r.files.toLocaleString()} file(s) into ${r.archive} (${r.bytes.toLocaleString()} bytes)`);
    for (const w of r.warnings) {
      log(`  warning: capital letters or spaces in ${w}`);
    }
  } else {
    log(`No files under ${source}; no archive written`);
  }

  // Resources: ArchiveXL files go beside the archive, the rest keep their relative path under packed.
  for (const file of walk(resources)) {
    const rel = path.relative(resources, file);
    const name = path.basename(file);
    const ext = path.extname(name).toLowerCase();
    if (ext === ".xl") {
      copy(file, path.join(archiveDir, name));
      summary.archiveXl.push(rel);
    } else if (SkippedExtensions.has(ext) || name.toLowerCase() === "info.json") {
      continue;
    } else if (options.redmod && isUnder(rel, "scripts")) {
      copy(file, path.join(packed, "mods", project.modName, rel));
      summary.resources.push(rel);
    } else if (options.redmod && isUnder(rel, "tweaks")) {
      copy(file, path.join(packed, "mods", project.modName, rel));
      summary.resources.push(rel);
    } else {
      copy(file, path.join(packed, rel));
      summary.resources.push(rel);
    }
  }
  if (summary.archiveXl.length) log(`Copied ${summary.archiveXl.length} ArchiveXL file(s) to ${archiveDir}`);
  if (summary.resources.length) log(`Copied ${summary.resources.length} resource file(s) under ${packed}`);

  // A REDmod needs its manifest; the project's own info.json under resources wins when it exists.
  if (options.redmod) {
    const own = path.join(resources, "info.json");
    const dest = path.join(packed, "mods", project.modName, "info.json");
    if (fs.existsSync(own)) {
      copy(own, dest);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, JSON.stringify({ name: project.modName, version: project.version, description: project.description, customSounds: [] }, null, 2));
    }
    log(`Wrote ${dest}`);
  }
  return summary;
}

function isUnder(rel: string, folder: string): boolean {
  const first = rel.split(/[\\/]/)[0]?.toLowerCase();
  return first === folder;
}

function copy(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

/** Every file under dir, depth first, or nothing when the folder is missing. */
export function walk(dir: string): string[] {
  const out: string[] = [];
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) pending.push(full);
      else out.push(full);
    }
  }
  return out.sort();
}
