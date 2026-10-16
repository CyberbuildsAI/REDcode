// Which project files Export and Import apply to, from WolvenKit's ECookedFileFormat and
// ERawFileFormat at the pinned commit (REDbridge 0.7.0 refuses the rest). No VS Code imports.

import * as fs from "node:fs";
import * as path from "node:path";
import { walk } from "./pack";
import { ProjectFolders, type ProjectInfo } from "./project";

/** Game file types WolvenKit exports to an editable format. Everything else is JSON's job. */
// .opusinfo is left out: WolvenKit exports nothing from it unless given sound hashes; the sound list
// (Browse Game Sounds) plays and saves its sounds instead.
export const ExportableExtensions = new Set([
  ".wem", ".mesh", ".w2mesh", ".xbm", ".csv", ".mlmask", ".cubemap", ".xcube", ".envprobe", ".texarray",
  ".morphtarget", ".fnt", ".anims", ".inkatlas", ".physicalscene",
]);

/**
 * Raw file types WolvenKit imports back into a game file. Not .wav: WolvenKit.Modkit's ImportWav is a
 * stub ("Use WolvenKit to import opus.") that writes nothing (REDcode issue #5). A sound effect WAV,
 * named after its hash, goes through REDbridge 0.9.0's sound.importWavs instead (isSoundWav).
 */
export const ImportableExtensions = new Set([".bmp", ".jpg", ".png", ".tga", ".tiff", ".dds", ".fbx", ".gltf", ".glb", ".ttf", ".masklist", ".csv", ".re", ".cube"]);

export const isExportable = (file: string) => ExportableExtensions.has(path.extname(file).toLowerCase());
/** A sound effect override: a WAV named after the sound's hash in sfx_container.opusinfo, such as 832549876.wav. */
export const isSoundWav = (file: string) => /^\d+\.wav$/i.test(path.basename(file));
export const isImportable = (file: string) => ImportableExtensions.has(path.extname(file).toLowerCase()) || isSoundWav(file);

/** Which source folder a path is in: archive, raw, or neither. */
export function sourceFolderOf(project: ProjectInfo, p: string): "archive" | "raw" | undefined {
  const full = path.resolve(p).toLowerCase();
  const archive = path.resolve(project.dir, ProjectFolders.archive).toLowerCase();
  const raw = path.resolve(project.dir, ProjectFolders.raw).toLowerCase();
  if (full === archive || full.startsWith(archive + path.sep)) return "archive";
  if (full === raw || full.startsWith(raw + path.sep)) return "raw";
  return undefined;
}

/**
 * The files Export (under source/archive) or Import (under source/raw) takes from a file or a folder.
 * A single file is taken as asked. A folder import takes only re-imports: raw files whose game file
 * already exists in source/archive, and of several raw files for one game file (a .png and a .tga)
 * the newest. Otherwise the material textures a mesh export writes into raw would become new game
 * textures in the mod and override the game's own.
 */
export function targetsUnder(project: ProjectInfo, p: string, action: "export" | "import"): string[] {
  if (sourceFolderOf(project, p) !== (action === "export" ? "archive" : "raw")) return [];
  let isDir = false;
  try {
    isDir = fs.statSync(p).isDirectory();
  } catch {
    return [];
  }
  if (!isDir) return (action === "export" ? isExportable : isImportable)(p) ? [p] : [];
  if (action === "export") return walk(p).filter(isExportable);
  const raw = path.join(project.dir, ProjectFolders.raw);
  const archive = path.join(project.dir, ProjectFolders.archive);
  const stem = (f: string) => path.basename(f, path.extname(f)).toLowerCase();
  const listings = new Map<string, string[]>();
  const newest = new Map<string, { file: string; mtime: number }>();
  // Sound effect WAVs replace sounds by hash, not a file at the same path, so a folder takes them all.
  const sounds = walk(p).filter(isSoundWav);
  for (const f of walk(p).filter((x) => isImportable(x) && !isSoundWav(x))) {
    const rel = path.relative(raw, f);
    const dir = path.join(archive, path.dirname(rel));
    if (!listings.has(dir)) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        // No such folder in source/archive: nothing to re-import into.
      }
      listings.set(dir, names);
    }
    if (!listings.get(dir)!.some((n) => stem(n) === stem(f) && isExportable(n))) continue;
    const key = path.join(dir, stem(f));
    const mtime = fs.statSync(f).mtimeMs;
    const seen = newest.get(key);
    if (!seen || mtime > seen.mtime) newest.set(key, { file: f, mtime });
  }
  return [...newest.values()].map((v) => v.file).concat(sounds).sort();
}
