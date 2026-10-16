// Finds Cyberpunk 2077 installs on this machine, for a first run with redcode.gamePath empty: Steam
// (every library in libraryfolders.vdf), GOG (its registry key) and the Epic launcher's manifests,
// then the usual default folders. No VS Code imports. REDdeck's game path, when REDdeck is there, is
// asked for by the caller first.

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** A folder is the game when it has bin\x64\Cyberpunk2077.exe. */
export function isGameFolder(dir: string | undefined): dir is string {
  return !!dir && fs.existsSync(path.join(dir, "bin", "x64", "Cyberpunk2077.exe"));
}

export interface FoundGame {
  path: string;
  /** Where it was found: Steam, GOG, Epic or a default folder. */
  source: string;
}

/** Every install found, without duplicates, in the order Steam, GOG, Epic, default folders. */
export async function findGames(): Promise<FoundGame[]> {
  const found: FoundGame[] = [];
  const add = (dir: string | undefined, source: string) => {
    if (!isGameFolder(dir)) return;
    const full = path.resolve(dir);
    if (!found.some((f) => f.path.toLowerCase() === full.toLowerCase())) found.push({ path: full, source });
  };
  if (process.platform !== "win32") return found;

  // Steam: the install from the registry, then each library it lists.
  const steam = (await regValue("HKCU\\Software\\Valve\\Steam", "SteamPath")) ?? (await regValue("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"));
  for (const library of steamLibraries(steam)) add(path.join(library, "steamapps", "common", "Cyberpunk 2077"), "Steam");

  // GOG: the game's id is 1423049311.
  add(await regValue("HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1423049311", "path"), "GOG");

  // Epic: one .item JSON manifest per installed game.
  const manifests = path.join(process.env.ProgramData ?? "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");
  for (const name of safeList(manifests).filter((n) => n.toLowerCase().endsWith(".item"))) {
    try {
      const item = JSON.parse(fs.readFileSync(path.join(manifests, name), "utf8")) as { DisplayName?: string; InstallLocation?: string };
      if (/cyberpunk 2077/i.test(item.DisplayName ?? "")) add(item.InstallLocation, "Epic");
    } catch {
      // not a manifest we can read
    }
  }

  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  add(path.join(pf86, "Steam", "steamapps", "common", "Cyberpunk 2077"), "the default Steam folder");
  add(path.join(pf86, "GOG Galaxy", "Games", "Cyberpunk 2077"), "the default GOG folder");
  add(path.join(pf, "Epic Games", "Cyberpunk2077"), "the default Epic folder");
  return found;
}

/** Steam's install folder, from the registry, or undefined. */
export function steamPath(): Promise<string | undefined> {
  return process.platform !== "win32" ? Promise.resolve(undefined) : regValue("HKCU\\Software\\Valve\\Steam", "SteamPath").then((s) => s ?? regValue("HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", "InstallPath"));
}

/** The library folders of a Steam install: the install itself and every "path" in libraryfolders.vdf. */
export function steamLibraries(steam: string | undefined): string[] {
  if (!steam) return [];
  const libraries = [path.resolve(steam)];
  try {
    const vdf = fs.readFileSync(path.join(steam, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const m of vdf.matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/g)) {
      libraries.push(path.resolve(m[1].replace(/\\\\/g, "\\")));
    }
  } catch {
    // no library list; the install folder alone
  }
  return [...new Set(libraries.map((l) => l.toLowerCase()))].map((l) => libraries.find((x) => x.toLowerCase() === l)!);
}

function safeList(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** One registry value through reg.exe, or undefined. */
function regValue(key: string, name: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("reg", ["query", key, "/v", name], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(undefined);
      const m = stdout.match(new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, "im"));
      resolve(m ? m[1] : undefined);
    });
  });
}
