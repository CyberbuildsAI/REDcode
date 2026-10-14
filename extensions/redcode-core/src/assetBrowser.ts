// The Game Assets view: the archive folder tree, one level per request to the bridge.

import * as path from "node:path";
import * as vscode from "vscode";
import type { BridgeClient } from "./bridgeClient";
import { isGameTexture } from "./textureViewer";
import type { GameFileInfo } from "./types";

export type AssetNode =
  | { kind: "folder"; path: string; name: string; files: number }
  | { kind: "file"; file: GameFileInfo };

export class AssetBrowser implements vscode.TreeDataProvider<AssetNode> {
  private readonly changed = new vscode.EventEmitter<AssetNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly getBridge: () => BridgeClient | undefined) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(node: AssetNode): vscode.TreeItem {
    if (node.kind === "folder") {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = node.files.toLocaleString();
      item.tooltip = `${node.path}\n${node.files.toLocaleString()} files`;
      item.iconPath = folderIcon();
      item.contextValue = "assetFolder";
      return item;
    }
    const f = node.file;
    const item = new vscode.TreeItem(path.basename(f.name), vscode.TreeItemCollapsibleState.None);
    item.description = `${f.size.toLocaleString()} B`;
    item.tooltip = `${f.name}\n${f.archive}\n${f.size.toLocaleString()} bytes, hash ${f.hash}`;
    item.iconPath = iconFor(f.name);
    if (isGameTexture(f.name)) {
      item.contextValue = "assetFile.texture";
      item.command = { command: "redcode.openTexture", title: "Open Texture", arguments: [node] };
    } else {
      item.contextValue = "assetFile";
      item.command = { command: "redcode.openAssetInEditor", title: "Open in Editor", arguments: [node] };
    }
    return item;
  }

  async getChildren(node?: AssetNode): Promise<AssetNode[]> {
    const bridge = this.getBridge();
    if (!bridge?.running || node?.kind === "file") {
      return [];
    }
    const result = await bridge.tree(node?.path ?? "");
    return [
      ...result.folders.map((f): AssetNode => ({ kind: "folder", path: f.path, name: f.name, files: f.files })),
      ...result.files.map((file): AssetNode => ({ kind: "file", file })),
    ];
  }

  /** Every file under a folder, walking the tree through the bridge. */
  async collect(bridge: BridgeClient, folderPath: string, onProgress?: (count: number) => void): Promise<GameFileInfo[]> {
    const files: GameFileInfo[] = [];
    const pending = [folderPath];
    while (pending.length > 0) {
      const result = await bridge.tree(pending.shift()!);
      files.push(...result.files);
      pending.push(...result.folders.map((f) => f.path));
      onProgress?.(files.length);
    }
    return files;
  }
}

/** The folder icon in REDcode's views, colored by the theme's redcode.folder color. */
export function folderIcon(id = "folder"): vscode.ThemeIcon {
  return new vscode.ThemeIcon(id, new vscode.ThemeColor("redcode.folder"));
}

/** A VS Code icon by file type. The game has about 150 extensions; these are the common groups. */
export function iconFor(name: string): vscode.ThemeIcon {
  const ext = path.extname(name).toLowerCase();
  switch (ext) {
    case ".xbm": case ".dds": case ".inkatlas": case ".cubemap": case ".texarray": return new vscode.ThemeIcon("file-media");
    case ".mesh": case ".w2mesh": case ".morphtarget": case ".rig": return new vscode.ThemeIcon("symbol-structure");
    case ".ent": case ".app": return new vscode.ThemeIcon("symbol-class");
    case ".anims": case ".animgraph": return new vscode.ThemeIcon("run");
    case ".wem": case ".bnk": case ".opuspak": return new vscode.ThemeIcon("unmute");
    case ".inkwidget": case ".inkmenu": case ".inkstyle": return new vscode.ThemeIcon("layout");
    case ".scene": case ".quest": case ".questphase": return new vscode.ThemeIcon("type-hierarchy");
    case ".streamingsector": case ".streamingblock": return new vscode.ThemeIcon("globe");
    case ".mi": case ".mt": case ".mlsetup": case ".mltemplate": case ".mlmask": return new vscode.ThemeIcon("color-mode");
    case ".json": case ".csv": case ".xml": return new vscode.ThemeIcon("json");
    default: return vscode.ThemeIcon.File;
  }
}
