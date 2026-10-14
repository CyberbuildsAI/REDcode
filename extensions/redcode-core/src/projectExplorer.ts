// The Project view: WolvenKit's source folders and their files, read from disk.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { folderIcon, iconFor } from "./assetBrowser";
import { isExportable, isImportable, sourceFolderOf } from "./modkit";
import { ProjectFolders, type ProjectFolderKey, type ProjectInfo } from "./project";

export type ProjectNode =
  | { kind: "project"; dir: string }
  | { kind: "root"; key: ProjectFolderKey; dir: string }
  | { kind: "folder"; dir: string }
  | { kind: "file"; file: string };

const RootLabels: Record<ProjectFolderKey, string> = {
  archive: "Archive",
  raw: "Raw",
  resources: "Resources",
  packed: "Packed",
};

const RootHints: Record<ProjectFolderKey, string> = {
  archive: "Game files added to the project. Packed into the mod archive.",
  raw: "Exported files (glTF, PNG, JSON) and imports waiting to go back in.",
  resources: "Scripts, tweaks and other files copied into the game folder as they are.",
  packed: "Build output: the mod as the game loads it.",
};

export class ProjectExplorer implements vscode.TreeDataProvider<ProjectNode> {
  private readonly changed = new vscode.EventEmitter<ProjectNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly getProject: () => ProjectInfo | undefined) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(node: ProjectNode): vscode.TreeItem {
    // Stable ids, so reveal() can find a node built fresh from a path.
    if (node.kind === "project") {
      const project = this.getProject();
      const item = new vscode.TreeItem(project?.name ?? path.basename(node.dir), vscode.TreeItemCollapsibleState.Expanded);
      item.id = "project";
      item.description = project ? `${project.modName}${project.version ? ` ${project.version}` : ""}` : undefined;
      item.tooltip = project ? `${project.file}${project.author ? `\n${project.author}` : ""}` : node.dir;
      item.iconPath = folderIcon("package");
      item.contextValue = "project";
      item.resourceUri = vscode.Uri.file(node.dir);
      return item;
    }
    if (node.kind === "root") {
      const item = new vscode.TreeItem(RootLabels[node.key], vscode.TreeItemCollapsibleState.Expanded);
      item.id = `root:${node.key}`;
      item.description = `${countFiles(node.dir).toLocaleString()} files`;
      item.tooltip = `${RootHints[node.key]}\n${node.dir}`;
      item.iconPath = folderIcon(node.key === "packed" ? "package" : "folder-library");
      item.contextValue = "projectRoot" + this.tags(node.dir, true);
      return item;
    }
    if (node.kind === "folder") {
      const item = new vscode.TreeItem(path.basename(node.dir), vscode.TreeItemCollapsibleState.Collapsed);
      item.id = `dir:${node.dir.toLowerCase()}`;
      item.iconPath = folderIcon();
      item.contextValue = "projectFolder" + this.tags(node.dir, true);
      item.resourceUri = vscode.Uri.file(node.dir);
      return item;
    }
    const item = new vscode.TreeItem(path.basename(node.file), vscode.TreeItemCollapsibleState.None);
    item.id = `file:${node.file.toLowerCase()}`;
    item.iconPath = iconFor(node.file);
    // Textures open in the viewer on click, so they alone get the "Open in CR2W Editor" entry.
    item.contextValue = (node.file.toLowerCase().endsWith(".xbm") ? "projectFile.texture" : "projectFile") + this.tags(node.file, false);
    item.resourceUri = vscode.Uri.file(node.file);
    item.tooltip = node.file;
    item.command = { command: "redcode.openProjectFile", title: "Open", arguments: [node] };
    return item;
  }

  /** ".export" for what Export takes (under source/archive), ".import" for what Import takes (under source/raw). Menus match on these. */
  private tags(p: string, folder: boolean): string {
    const project = this.getProject();
    const where = project ? sourceFolderOf(project, p) : undefined;
    if (where === "archive" && (folder || isExportable(p))) return ".export";
    if (where === "raw" && (folder || isImportable(p))) return ".import";
    return "";
  }

  getChildren(node?: ProjectNode): ProjectNode[] {
    const project = this.getProject();
    if (!project) {
      return [];
    }
    if (!node) {
      return [{ kind: "project", dir: project.dir }];
    }
    if (node.kind === "project") {
      return (Object.keys(ProjectFolders) as ProjectFolderKey[]).map((key) => ({ kind: "root", key, dir: path.join(project.dir, ProjectFolders[key]) }));
    }
    if (node.kind === "file") {
      return [];
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(node.dir, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    return entries.map((e): ProjectNode => (e.isDirectory() ? { kind: "folder", dir: path.join(node.dir, e.name) } : { kind: "file", file: path.join(node.dir, e.name) }));
  }

  /** The parent of a node, which TreeView.reveal needs to expand the way down to it. */
  getParent(node: ProjectNode): ProjectNode | undefined {
    if (node.kind === "project") {
      return undefined;
    }
    if (node.kind === "root") {
      const project = this.getProject();
      return project ? { kind: "project", dir: project.dir } : undefined;
    }
    return this.nodeFor(path.dirname(node.kind === "file" ? node.file : node.dir));
  }

  /** The node for a path inside the project: the project itself, a root, a folder or a file. */
  nodeFor(p: string): ProjectNode | undefined {
    const project = this.getProject();
    if (!project) {
      return undefined;
    }
    const full = path.resolve(p);
    if (full.toLowerCase() === path.resolve(project.dir).toLowerCase()) {
      return { kind: "project", dir: project.dir };
    }
    for (const key of Object.keys(ProjectFolders) as ProjectFolderKey[]) {
      const dir = path.resolve(project.dir, ProjectFolders[key]);
      if (full.toLowerCase() === dir.toLowerCase()) {
        return { kind: "root", key, dir };
      }
      if (full.toLowerCase().startsWith(dir.toLowerCase() + path.sep)) {
        return isDirectory(full) ? { kind: "folder", dir: full } : { kind: "file", file: full };
      }
    }
    return undefined;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function countFiles(dir: string): number {
  let n = 0;
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
      if (e.isDirectory()) {
        pending.push(path.join(current, e.name));
      } else {
        n++;
      }
    }
  }
  return n;
}
