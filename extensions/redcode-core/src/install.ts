// Installing a packed project into the game when REDdeck is not there to do it. See
// docs/design/ship.md. REDdeck owns the game folder when it is installed; this is the fallback.
// Safe by default: the files REDcode copies are recorded in the project's .redcode/installed.json,
// Uninstall removes only those, and a file that was already there is backed up first and put back
// on Uninstall. No VS Code imports, so the smoke script can run it.

import * as fs from "node:fs";
import * as path from "node:path";
import { walk } from "./pack";
import { ProjectFolders, type ProjectInfo } from "./project";

export interface InstallRecord {
  version: 1;
  gamePath: string;
  time: string;
  /** Game-relative paths REDcode copied, with forward slashes. */
  files: string[];
  /** Game-relative paths that existed before and were backed up under .redcode/backup. */
  backedUp: string[];
}

export interface InstallPlan {
  /** Game-relative paths to copy. */
  files: string[];
  /** Of those, the ones that exist in the game and were not put there by REDcode's last install. */
  foreign: string[];
}

const recordFile = (project: ProjectInfo) => path.join(project.dir, ".redcode", "installed.json");
const backupDir = (project: ProjectInfo) => path.join(project.dir, ".redcode", "backup");
const toGame = (gamePath: string, rel: string) => path.join(gamePath, ...rel.split("/"));

export function readRecord(project: ProjectInfo): InstallRecord | undefined {
  try {
    return JSON.parse(fs.readFileSync(recordFile(project), "utf8")) as InstallRecord;
  } catch {
    return undefined;
  }
}

/** What an install would copy, and which of those paths hold files REDcode did not put there. */
export function planInstall(project: ProjectInfo, gamePath: string): InstallPlan {
  const packed = path.join(project.dir, ProjectFolders.packed);
  const files = walk(packed).map((f) => path.relative(packed, f).split(path.sep).join("/"));
  const previous = readRecord(project);
  const ours = new Set(previous && samePath(previous.gamePath, gamePath) ? previous.files.map((f) => f.toLowerCase()) : []);
  const foreign = files.filter((f) => !ours.has(f.toLowerCase()) && fs.existsSync(toGame(gamePath, f)));
  return { files, foreign };
}

/**
 * Copies packed onto the game. The previous install is removed first, so a file the project no
 * longer makes does not stay in the game. Files in plan.foreign are backed up before they are replaced.
 */
export function installDirect(project: ProjectInfo, gamePath: string, log: (line: string) => void): InstallRecord {
  const packed = path.join(project.dir, ProjectFolders.packed);
  const previous = readRecord(project);
  if (previous) uninstallDirect(project, log, true);
  const { files, foreign } = planInstall(project, gamePath);
  if (files.length === 0) throw new Error(`Nothing to install: ${packed} is empty. Pack the project first.`);
  for (const rel of foreign) {
    const backup = path.join(backupDir(project), ...rel.split("/"));
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(toGame(gamePath, rel), backup);
    log(`Backed up ${rel}, which was already in the game`);
  }
  for (const rel of files) {
    const to = toGame(gamePath, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(packed, ...rel.split("/")), to);
  }
  const record: InstallRecord = { version: 1, gamePath, time: new Date().toISOString(), files, backedUp: foreign };
  fs.mkdirSync(path.dirname(recordFile(project)), { recursive: true });
  fs.writeFileSync(recordFile(project), JSON.stringify(record, null, 2));
  log(`Installed ${files.length} file(s) into ${gamePath}${foreign.length ? `, ${foreign.length} backed up first` : ""}`);
  return record;
}

/** Removes what the last install copied and puts backed-up files back. keepBackups: a reinstall is about to reuse them. */
export function uninstallDirect(project: ProjectInfo, log: (line: string) => void, reinstalling = false): number {
  const record = readRecord(project);
  if (!record) return 0;
  let removed = 0;
  for (const rel of record.files) {
    const target = toGame(record.gamePath, rel);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
      removed++;
    }
  }
  for (const rel of record.backedUp ?? []) {
    const backup = path.join(backupDir(project), ...rel.split("/"));
    if (fs.existsSync(backup)) {
      fs.mkdirSync(path.dirname(toGame(record.gamePath, rel)), { recursive: true });
      fs.copyFileSync(backup, toGame(record.gamePath, rel));
      fs.rmSync(backup, { force: true });
    }
  }
  // Folders the install created and left empty go too; folders with anything else in them stay.
  const dirs = new Set<string>();
  for (const rel of record.files) {
    let d = path.dirname(toGame(record.gamePath, rel));
    while (d.length > record.gamePath.length && !samePath(d, record.gamePath)) {
      dirs.add(d);
      d = path.dirname(d);
    }
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      fs.rmdirSync(d);
    } catch {
      // Not empty, or in use: left in place.
    }
  }
  fs.rmSync(recordFile(project), { force: true });
  if (!reinstalling) log(`Uninstalled ${removed} file(s) from ${record.gamePath}${record.backedUp?.length ? `, ${record.backedUp.length} put back` : ""}`);
  return removed;
}

// ---- hot install and launching --------------------------------------------------------------------

/**
 * Red Hot Tools reloads archives from archive/pc/hot while the game runs. Unverified on the owner's
 * machine, which does not have it: the plugin is looked for under red4ext/plugins by its folder name.
 */
export function hasRedHotTools(gamePath: string): boolean {
  const plugins = path.join(gamePath, "red4ext", "plugins");
  try {
    return fs.readdirSync(plugins).some((n) => n.toLowerCase() === "redhottools");
  } catch {
    return false;
  }
}

/** Copies the packed archives into archive/pc/hot for Red Hot Tools to reload. Returns the files copied. */
export function installHot(project: ProjectInfo, gamePath: string): string[] {
  const packed = path.join(project.dir, ProjectFolders.packed);
  const hot = path.join(gamePath, "archive", "pc", "hot");
  const archives = walk(packed).filter((f) => f.toLowerCase().endsWith(".archive"));
  if (archives.length === 0) throw new Error("The packed project has no archive. Pack it first.");
  fs.mkdirSync(hot, { recursive: true });
  for (const a of archives) fs.copyFileSync(a, path.join(hot, path.basename(a)));
  return archives.map((a) => path.basename(a));
}

/** How Run game starts the game: through Steam when the game sits in a Steam library, else the exe. */
export function launchTarget(gamePath: string, how: "auto" | "steam" | "exe", modded: boolean): { kind: "steam"; url: string } | { kind: "exe"; exe: string; args: string[] } {
  const exe = path.join(gamePath, "bin", "x64", "Cyberpunk2077.exe");
  const steam = how === "steam" || (how === "auto" && /[\\/]steamapps[\\/]common[\\/]/i.test(gamePath));
  if (steam) return { kind: "steam", url: modded ? "steam://run/1091500//-modded/" : "steam://rungameid/1091500" };
  return { kind: "exe", exe, args: modded ? ["-modded"] : [] };
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}
