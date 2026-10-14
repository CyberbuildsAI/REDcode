// The Game Assets view: the archive folder tree, one level per request to the bridge.

import * as path from "node:path";
import * as vscode from "vscode";
import type { BridgeClient } from "./bridgeClient";
import { isGameTexture } from "./textureViewer";
import { compileFilter, type TreeFilter } from "./treeFilter";
import type { GameFileInfo } from "./types";

export type AssetNode =
  | { kind: "folder"; path: string; name: string; files: number }
  | { kind: "file"; file: GameFileInfo };

/** The filtered view: the matching files, indexed by folder, and how many there were. */
interface FilteredAssets {
  filter: TreeFilter;
  files: GameFileInfo[];
  /** Matches before the cap; more than files.length when the search was cut off. */
  total: number;
  /** Folder path (lower case, "" for the root) to its subfolder names and its files. */
  index: Map<string, { folders: Map<string, string>; files: GameFileInfo[]; count: number }>;
}

/** The most files a filter shows; a narrower pattern finds the rest. */
const FilterCap = 5000;
/** Up to this many matches, the filtered folders open by themselves. */
const ExpandUpTo = 300;

export class AssetBrowser implements vscode.TreeDataProvider<AssetNode> {
  private readonly changed = new vscode.EventEmitter<AssetNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private filtered: FilteredAssets | undefined;

  constructor(private readonly getBridge: () => BridgeClient | undefined) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  get filter(): FilteredAssets | undefined {
    return this.filtered;
  }

  /**
   * Filters the tree to the files matching pattern: the bridge searches for the pattern's longest plain
   * fragment, and the full pattern narrows the hits. An empty pattern clears the filter.
   */
  async setFilter(bridge: BridgeClient, pattern: string): Promise<FilteredAssets | undefined> {
    const filter = compileFilter(pattern);
    if (!filter) {
      this.filtered = undefined;
      this.refresh();
      return undefined;
    }
    const hits = filter.seed.length >= 2 ? await bridge.search(filter.seed, FilterCap) : { total: 0, items: [] };
    const files = hits.items.filter((f) => filter.test(f.name));
    const index: FilteredAssets["index"] = new Map();
    const entry = (key: string) => {
      let e = index.get(key);
      if (!e) index.set(key, (e = { folders: new Map(), files: [], count: 0 }));
      return e;
    };
    for (const f of files) {
      const parts = f.name.split("\\");
      let key = "";
      entry("").count++;
      for (let i = 0; i < parts.length - 1; i++) {
        const next = key ? `${key}\\${parts[i]}` : parts[i];
        entry(key.toLowerCase()).folders.set(parts[i].toLowerCase(), next);
        entry(next.toLowerCase()).count++;
        key = next;
      }
      entry(key.toLowerCase()).files.push(f);
    }
    this.filtered = { filter, files, total: hits.total > hits.items.length ? hits.total : files.length, index };
    this.refresh();
    return this.filtered;
  }

  /** The children of a folder in the filtered view, with chains of single subfolders folded into one row. */
  private filteredChildren(folderPath: string): AssetNode[] {
    const f = this.filtered!;
    const here = f.index.get(folderPath.toLowerCase());
    if (!here) return [];
    const folders = [...here.folders.values()].sort((a, b) => a.localeCompare(b)).map((p): AssetNode => {
      let path = p;
      let label = p.split("\\").pop()!;
      // ep1\weapons\firearms\... with nothing else on the way shows as one row.
      for (;;) {
        const e = f.index.get(path.toLowerCase())!;
        if (e.files.length > 0 || e.folders.size !== 1) break;
        path = [...e.folders.values()][0];
        label = `${label}\\${path.split("\\").pop()}`;
      }
      return { kind: "folder", path, name: label, files: f.index.get(path.toLowerCase())!.count };
    });
    const files = [...here.files].sort((a, b) => a.name.localeCompare(b.name)).map((file): AssetNode => ({ kind: "file", file }));
    return [...folders, ...files];
  }

  getTreeItem(node: AssetNode): vscode.TreeItem {
    if (node.kind === "folder") {
      const open = this.filtered && this.filtered.files.length <= ExpandUpTo;
      const item = new vscode.TreeItem(node.name, open ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
      // Filtered and plain folders differ in their children, so their ids must too.
      item.id = `${this.filtered ? `f:${this.filtered.filter.pattern}:` : ""}${node.path.toLowerCase()}`;
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
    if (this.filtered) {
      return this.filteredChildren(node?.path ?? "");
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
