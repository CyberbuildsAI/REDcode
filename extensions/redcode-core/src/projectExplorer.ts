// The Project view: WolvenKit's source folders and their files, read from disk.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { folderIcon, iconFor } from "./assetBrowser";
import { ProjectFolders, type ProjectFolderKey, type ProjectInfo } from "./project";

export type ProjectNode =
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
    if (node.kind === "root") {
      const item = new vscode.TreeItem(RootLabels[node.key], vscode.TreeItemCollapsibleState.Expanded);
      item.description = `${countFiles(node.dir).toLocaleString()} files`;
      item.tooltip = `${RootHints[node.key]}\n${node.dir}`;
      item.iconPath = folderIcon(node.key === "packed" ? "package" : "folder-library");
      item.contextValue = "projectRoot";
      return item;
    }
    if (node.kind === "folder") {
      const item = new vscode.TreeItem(path.basename(node.dir), vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = folderIcon();
      item.contextValue = "projectFolder";
      item.resourceUri = vscode.Uri.file(node.dir);
      return item;
    }
    const item = new vscode.TreeItem(path.basename(node.file), vscode.TreeItemCollapsibleState.None);
    item.iconPath = iconFor(node.file);
    item.contextValue = "projectFile";
    item.resourceUri = vscode.Uri.file(node.file);
    item.tooltip = node.file;
    item.command = { command: "redcode.openProjectFile", title: "Open", arguments: [node] };
    return item;
  }

  getChildren(node?: ProjectNode): ProjectNode[] {
    const project = this.getProject();
    if (!project) {
      return [];
    }
    if (!node) {
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
