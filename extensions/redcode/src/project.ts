// A WolvenKit project: a folder with a .cpmodproj file and WolvenKit's source layout.
// The file is the XML WolvenKit's ProjectManager writes (its CP77Mod class), kept byte-compatible
// so projects move between REDcode and WolvenKit freely.

import * as fs from "node:fs";
import * as path from "node:path";

export interface ProjectInfo {
  /** Full path of the .cpmodproj file. */
  file: string;
  /** The folder containing it. */
  dir: string;
  name: string;
  modName: string;
  author: string;
  email: string;
  description: string;
  version: string;
}

/** WolvenKit's source folders, relative to the project folder. */
export const ProjectFolders = {
  archive: path.join("source", "archive"),
  raw: path.join("source", "raw"),
  resources: path.join("source", "resources"),
  /** REDmod custom sounds, named in source/resources/info.json. Made by the tool that writes the first one, not by a new project. */
  customSounds: path.join("source", "customSounds"),
  packed: "packed",
} as const;

export type ProjectFolderKey = keyof typeof ProjectFolders;

/** Folders only some projects have; the Project view shows them when they exist. */
export const OptionalFolders: readonly ProjectFolderKey[] = ["customSounds"];

/** Finds the first .cpmodproj directly inside the folder, or undefined. */
export function findProject(dir: string): ProjectInfo | undefined {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return undefined;
  }
  const file = entries.find((e) => e.toLowerCase().endsWith(".cpmodproj"));
  return file ? readProject(path.join(dir, file)) : undefined;
}

export function readProject(file: string): ProjectInfo {
  const xml = fs.readFileSync(file, "utf8");
  const get = (tag: string) => {
    const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    return m ? unescapeXml(m[1].trim()) : "";
  };
  const name = get("Name") || path.basename(file, path.extname(file));
  return {
    file,
    dir: path.dirname(file),
    name,
    modName: get("ModName") || name,
    author: get("Author"),
    email: get("Email"),
    description: get("Description"),
    version: get("Version") || "1.0.0",
  };
}

/** Creates the project file and WolvenKit's folder layout. The folder may already exist. */
export function createProject(dir: string, name: string, author: string): ProjectInfo {
  const modName = name.replace(/[^A-Za-z0-9_\-]/g, "");
  for (const [key, folder] of Object.entries(ProjectFolders)) {
    if (!OptionalFolders.includes(key as ProjectFolderKey)) fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }
  const file = path.join(dir, `${name}.cpmodproj`);
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<CP77Mod xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Name>${escapeXml(name)}</Name>
  <ModName>${escapeXml(modName || name)}</ModName>
  <Author>${escapeXml(author)}</Author>
  <Email />
  <Description />
  <Version>1.0.0</Version>
</CP77Mod>
`;
  fs.writeFileSync(file, xml, "utf8");
  return readProject(file);
}

/** Where a game file lands when added to the project: source/archive/<game path>. */
export function projectPathFor(project: ProjectInfo, gamePath: string): string {
  return path.join(project.dir, ProjectFolders.archive, ...gamePath.split("\\"));
}

/** Game path (base\...) of a file under source/archive, or undefined for anything else. */
export function gamePathOf(project: ProjectInfo, file: string): string | undefined {
  const root = path.join(project.dir, ProjectFolders.archive) + path.sep;
  return file.startsWith(root) ? file.slice(root.length).split(path.sep).join("\\") : undefined;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function unescapeXml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}
