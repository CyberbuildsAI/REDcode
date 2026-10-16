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
  /** Tweak files (.tweak, .yaml, .yml) outside r6/tweaks, which TweakXL does not read; .tweak ones are also left out. */
  misplacedTweaks: string[];
  /** REDmod custom sound files copied into packed/mods/<name>/customSounds (REDcode issue #8). */
  customSounds: string[];
  /** Custom sound files the manifest lists but source/customSounds does not have; REDmod's deploy fails on them. */
  missingSounds: string[];
  /** Custom sounds are listed, but the pack is not a REDmod, so the game will not play them. */
  soundsNeedRedmod: boolean;
  packedDir: string;
  /** Where the archive and the ArchiveXL files went. */
  archiveDir: string;
}

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
  const summary: PackSummary = { archiveBytes: 0, archiveFiles: 0, warnings: [], archiveXl: [], resources: [], misplacedTweaks: [], customSounds: [], missingSounds: [], soundsNeedRedmod: false, packedDir: packed, archiveDir };

  if (options.clean && fs.existsSync(packed)) {
    emptyFolder(packed);
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

  // Resources, by WolvenKit's rules (RED4Controller at the pinned commit), with one deviation marked.
  const redmodDir = path.join(packed, "mods", project.modName);
  const skippedTweaks: string[] = [];
  for (const file of walk(resources)) {
    const rel = path.relative(resources, file);
    const name = path.basename(file);
    const ext = path.extname(name).toLowerCase();
    const take = (to: string) => {
      copy(file, to);
      summary.resources.push(rel);
    };
    if (ext === ".xl") {
      // ArchiveXL files go beside the archive.
      copy(file, path.join(archiveDir, name));
      summary.archiveXl.push(rel);
    } else if (name.toLowerCase() === "info.json") {
      // The REDmod manifest, written below.
    } else if (ext === ".script" || ext === ".ws") {
      // CDPR script sources: only a REDmod carries them, from resources/scripts.
      if (options.redmod && isUnder(rel, "scripts")) take(path.join(redmodDir, rel));
    } else if (ext === ".tweak") {
      if (isUnder(rel, "r6", "tweaks")) {
        // Deviation: WolvenKit leaves every .tweak out of a plain pack, which drops TweakXL's RED tweaks.
        take(path.join(packed, rel));
      } else if (options.redmod && isUnder(rel, "tweaks")) {
        take(path.join(redmodDir, rel));
      } else {
        skippedTweaks.push(rel);
        summary.misplacedTweaks.push(rel);
      }
    } else {
      // Everything else keeps its relative path under packed.
      take(path.join(packed, rel));
      if (TweakExtensions.has(ext) && !isUnder(rel, "r6", "tweaks")) summary.misplacedTweaks.push(rel);
    }
  }
  if (summary.archiveXl.length) log(`Copied ${summary.archiveXl.length} ArchiveXL file(s) to ${archiveDir}`);
  if (summary.resources.length) log(`Copied ${summary.resources.length} resource file(s) under ${packed}`);
  for (const t of summary.misplacedTweaks) {
    log(
      skippedTweaks.includes(t)
        ? `  warning: ${t} is left out, as WolvenKit does: a .tweak file is packed only from r6\\tweaks${options.redmod ? " or, for a REDmod, tweaks" : ""}`
        : `  warning: ${t} is not under r6\\tweaks, so TweakXL will not load it; move it to source\\resources\\r6\\tweaks`,
    );
  }

  // REDmod custom sounds (REDcode issue #8): WolvenKit's Sound Modding tool, and EDGEwave, keep their
  // entries under customSounds in source/resources/info.json and the WAVs in source/customSounds. As
  // WolvenKit's pack does, each entry's file goes to packed/mods/<name>/customSounds; an entry with no
  // file (mod_skip, a silence) needs none.
  const sounds = customSoundsOf(project);
  if (options.redmod) {
    for (const s of sounds) {
      if (typeof s.file !== "string" || !s.file) continue;
      const from = path.join(project.dir, CustomSoundsFolder, s.file);
      if (!fs.existsSync(from)) {
        summary.missingSounds.push(s.file);
        log(`  warning: custom sound ${s.file} (${String(s.name ?? "")}) is listed in info.json but not in ${CustomSoundsFolder}; REDmod's deploy fails on it`);
        continue;
      }
      copy(from, path.join(redmodDir, "customSounds", s.file));
      summary.customSounds.push(s.file);
    }
    if (summary.customSounds.length) log(`Copied ${summary.customSounds.length} custom sound(s) to ${path.join(redmodDir, "customSounds")}`);
  } else if (sounds.length) {
    summary.soundsNeedRedmod = true;
    log(`  warning: info.json lists ${sounds.length} custom sound(s), which only a REDmod carries; turn on redcode.pack.redmod`);
  }

  // A REDmod needs its manifest, written from the project file every time as WolvenKit does. Same
  // fields in the same order as WolvenKit's ModInfo; customSounds from source/resources/info.json.
  if (options.redmod) {
    const dest = path.join(redmodDir, "info.json");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify({ name: project.modName, version: project.version || "1.0", description: project.description, customSounds: sounds }, null, 2));
    log(`Wrote ${dest}`);
  }
  return summary;
}

/** Where WolvenKit keeps a project's REDmod custom sound WAVs (Cp77Project.SoundDirectory). */
export const CustomSoundsFolder = path.join("source", "customSounds");

/** The customSounds entries of source/resources/info.json, as written there; [] when there are none. */
export function customSoundsOf(project: ProjectInfo): Record<string, unknown>[] {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(project.dir, "source", "resources", "info.json"), "utf8")) as { customSounds?: unknown };
    return Array.isArray(info.customSounds) ? info.customSounds.filter((s): s is Record<string, unknown> => !!s && typeof s === "object") : [];
  } catch {
    return [];
  }
}

/** Tweak sources TweakXL reads from r6/tweaks. */
const TweakExtensions = new Set([".tweak", ".yaml", ".yml"]);

/** True when rel starts with the given folders, compared without case. */
function isUnder(rel: string, ...folders: string[]): boolean {
  const parts = rel.split(/[\\/]/).map((p) => p.toLowerCase());
  return parts.length > folders.length && folders.every((f, i) => parts[i] === f);
}

/**
 * Deletes every file under dir and then the empty folders, keeping dir itself. A folder that
 * something has open (a File Explorer window, a terminal) cannot be removed on Windows, but its
 * files can, and an empty folder left behind does no harm. A file that is in use is an error.
 */
function emptyFolder(dir: string): void {
  for (const file of walk(dir)) {
    try {
      fs.rmSync(file, { force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      throw new Error(`Could not empty ${dir}: ${file} is in use (${code}). Close what has it open, such as the game or another tool, then pack again, or turn off redcode.pack.clean.`);
    }
  }
  for (const sub of folders(dir).reverse()) {
    try {
      fs.rmdirSync(sub);
    } catch {
      // Held open by something, or not empty: left in place.
    }
  }
}

/** Every folder under dir, parents before children. */
function folders(dir: string): string[] {
  const out: string[] = [];
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        const full = path.join(current, e.name);
        out.push(full);
        pending.push(full);
      }
    }
  }
  return out;
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
