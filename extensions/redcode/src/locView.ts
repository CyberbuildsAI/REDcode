// The LocKeys view (C5 V4): the game's on-screen texts, read offline through REDbridge 0.10.0's loc.*
// methods, with the open project's own onscreens entries over them. A search finds texts by LocKey,
// secondary key or words; each result copies its LocKey or goes into the project's onscreens file.
// A hover shows the text behind LocKey#... in tweak, YAML, JSON, Lua and Redscript files.
// See docs/design/view.md, V4.

import * as vscode from "vscode";
import type { BridgeClient } from "./bridgeClient";
import type { LocEntry } from "./types";

export type LocNode = { kind: "entry"; entry: LocEntry } | { kind: "note"; text: string };

/** Results a search asks for. */
const SearchCap = 500;

/** The language texts are shown in (redcode.loc.language). */
export function locLanguage(): string {
  return vscode.workspace.getConfiguration("redcode").get<string>("loc.language", "en-us") || "en-us";
}

/** How a mod refers to the entry: LocKey#<number>, or LocKey#<secondary key> for an entry with no number. */
export function locKeyOf(e: LocEntry): string {
  return `LocKey#${e.key !== "0" ? e.key : (e.secondaryKey ?? e.key)}`;
}

/** The text an entry shows: the female variant, or the male one when that is all there is. */
export function locTextOf(e: LocEntry): string {
  return e.female || e.male;
}

/** Escapes Markdown in game text for a hover or tooltip. */
const md = (s: string) => s.replace(/[\\`*_[\]<>#|]/g, "\\$&").replace(/\r?\n/g, "  \n");

function entryMarkdown(e: LocEntry): vscode.MarkdownString {
  const m = new vscode.MarkdownString(undefined, true);
  m.appendMarkdown(`**${locKeyOf(e)}**${e.secondaryKey && e.key !== "0" ? ` · \`${md(e.secondaryKey)}\`` : ""} · ${e.source === "ep1" ? "Phantom Liberty" : e.source === "project" ? `project, ${md(e.file ?? "")}` : "base game"}\n\n`);
  if (e.female && e.male && e.female !== e.male) {
    m.appendMarkdown(`*female* ${md(e.female)}\n\n*male* ${md(e.male)}`);
  } else {
    m.appendMarkdown(md(locTextOf(e)) || "*(empty)*");
  }
  return m;
}

export class LocTree implements vscode.TreeDataProvider<LocNode> {
  private readonly changed = new vscode.EventEmitter<LocNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private results: { query: string; total: number; items: LocEntry[] } | undefined;
  view: vscode.TreeView<LocNode> | undefined;

  constructor(
    private readonly getBridge: () => BridgeClient | undefined,
    private readonly projectDir: () => string | undefined,
  ) {}

  bridge(): BridgeClient {
    const b = this.getBridge();
    if (!b?.running) throw new Error("The REDbridge process is not running.");
    return b;
  }

  get query(): string | undefined {
    return this.results?.query;
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  /** Searches in the current language; an empty query clears the results. */
  async search(query: string): Promise<void> {
    const q = query.trim();
    if (!q) {
      this.results = undefined;
      this.showSummary();
      this.refresh();
      return;
    }
    const r = await vscode.window.withProgress({ location: { viewId: "redcode.lockeys" }, title: "Searching LocKeys" }, () => this.bridge().locSearch(q, locLanguage(), SearchCap, this.projectDir()));
    this.results = { query: q, total: r.total, items: r.items };
    this.showSummary();
    this.refresh();
  }

  /** Runs the search again, after a language change or a save of the project's onscreens. */
  async rerun(): Promise<void> {
    if (this.results) await this.search(this.results.query);
  }

  private showSummary(): void {
    if (!this.view) return;
    const r = this.results;
    this.view.description = r ? `${locLanguage()} · "${r.query}"` : locLanguage();
    this.view.message = !r ? undefined : r.total === 0 ? `No text matches "${r.query}".` : r.total > r.items.length ? `${r.total.toLocaleString()} matches; showing the first ${r.items.length}. Add words to narrow it.` : undefined;
  }

  getTreeItem(node: LocNode): vscode.TreeItem {
    if (node.kind === "note") {
      const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon("info");
      return item;
    }
    const e = node.entry;
    const text = locTextOf(e).replace(/\s+/g, " ").trim();
    const item = new vscode.TreeItem(text.length > 120 ? `${text.slice(0, 117)}…` : text || "(empty)", vscode.TreeItemCollapsibleState.None);
    item.id = `${e.source}:${e.key}:${e.secondaryKey ?? ""}:${e.file ?? ""}`;
    item.description = locKeyOf(e) + (e.source === "project" ? " · project" : e.source === "ep1" ? " · PL" : "");
    item.tooltip = entryMarkdown(e);
    item.iconPath = new vscode.ThemeIcon(e.source === "project" ? "edit" : "symbol-string");
    item.contextValue = e.source === "project" ? "locEntryProject" : "locEntry";
    item.command = { command: "redcode.copyLocKey", title: "Copy LocKey", arguments: [node] };
    return item;
  }

  getChildren(node?: LocNode): LocNode[] {
    if (node || !this.results) return [];
    return this.results.items.map((entry): LocNode => ({ kind: "entry", entry }));
  }
}

/** Hover on LocKey#... : the text in the current language, the project's own when it has one. */
export class LocHover implements vscode.HoverProvider {
  constructor(
    private readonly getBridge: () => BridgeClient | undefined,
    private readonly projectDir: () => string | undefined,
  ) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const range = document.getWordRangeAtPosition(position, /LocKey#[\w\-.]+/);
    const b = this.getBridge();
    if (!range || !b?.running) return undefined;
    const key = document.getText(range);
    let entry: LocEntry | null | undefined;
    try {
      entry = (await b.locGet([key], locLanguage(), this.projectDir()))[key];
    } catch {
      return undefined;
    }
    const m = entry ? entryMarkdown(entry) : new vscode.MarkdownString(`**${md(key)}** has no text in ${locLanguage()}.`);
    // Trusted for the Find link; the game's text has its Markdown characters escaped.
    m.isTrusted = true;
    m.appendMarkdown(`\n\n[Find in LocKeys](command:redcode.searchLocKeys?${encodeURIComponent(JSON.stringify([key]))})`);
    return new vscode.Hover(m, range);
  }
}
