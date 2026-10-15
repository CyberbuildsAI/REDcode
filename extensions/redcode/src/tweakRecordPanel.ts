// The TweakDB record page (C5 V3): one editor tab that shows a record's flats, reused as you follow
// links, with back and forward. Record links open the record they name; resource paths open the game
// file. See docs/design/view.md, V3.

import * as vscode from "vscode";
import type { TweakDb } from "./tweakView";
import { shortType } from "./tweakYaml";

export class TweakRecordPanel {
  private panel: vscode.WebviewPanel | undefined;
  private history: string[] = [];
  private at = -1;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly db: TweakDb,
    private readonly log: vscode.OutputChannel,
    private readonly openGameFile: (gamePath: string) => void,
  ) {}

  /** Shows a record by path or id, adding it to the history. */
  show(pathOrId: string): void {
    this.history = this.history.slice(0, this.at + 1);
    if (this.history[this.at] !== pathOrId) this.history.push(pathOrId);
    this.at = this.history.length - 1;
    this.ensurePanel();
    void this.load();
  }

  private ensurePanel(): void {
    if (this.panel) {
      this.panel.reveal(undefined, true);
      return;
    }
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("redcode.tweakRecord", "TweakDB", { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] });
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.history = [];
      this.at = -1;
    });
    panel.webview.onDidReceiveMessage((m: { type?: string; path?: string; text?: string }) => {
      switch (m.type) {
        case "ready":
          void this.load();
          return;
        case "open":
          if (m.path) this.show(m.path);
          return;
        case "back":
        case "forward":
          this.at = Math.max(0, Math.min(this.history.length - 1, this.at + (m.type === "back" ? -1 : 1)));
          void this.load();
          return;
        case "copy":
          void vscode.env.clipboard.writeText(m.text ?? "");
          vscode.window.setStatusBarMessage(`$(copy) Copied ${m.text}`, 3000);
          return;
        case "newTweak":
          void vscode.commands.executeCommand("redcode.newTweakFromRecord", this.history[this.at]);
          return;
        case "resource":
          if (m.path) this.openGameFile(m.path);
          return;
      }
    });
    const webview = panel.webview;
    const nonce = Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");
    const asset = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(media, ...p));
    webview.html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset("cr2w", "editor.css")}">
<link rel="stylesheet" href="${asset("tweakdb", "record.css")}">
<title>TweakDB</title>
</head>
<body>
<header>
  <button id="back" class="icon" title="Back (Alt+Left)" disabled>←</button><button id="forward" class="icon" title="Forward (Alt+Right)" disabled>→</button>
  <span class="name" id="path"></span><span class="meta" id="type"></span><span class="spacer"></span>
  <button id="copy" title="Copy the record path">Copy Path</button><button id="newTweak" title="Write a TweakXL YAML file that clones or changes this record">New Tweak…</button>
</header>
<div class="toolbar tweakbar"><input id="filter" type="text" placeholder="Filter flats by name or value" spellcheck="false"><span id="count" class="dim"></span><span class="spacer"></span><span id="id" class="dim mono"></span></div>
<main id="flats"><div class="note">Loading…</div></main>
<script nonce="${nonce}" src="${asset("tweakdb", "record.js")}"></script>
</body>
</html>`;
    this.panel = panel;
  }

  private async load(): Promise<void> {
    const panel = this.panel;
    const path = this.history[this.at];
    if (!panel || !path) return;
    panel.title = path.slice(path.lastIndexOf(".") + 1) || path;
    const nav = { canBack: this.at > 0, canForward: this.at < this.history.length - 1 };
    void panel.webview.postMessage({ type: "loading", path, ...nav });
    try {
      const record = await this.db.record(path);
      if (this.history[this.at] !== path) return;
      if (!record) {
        void panel.webview.postMessage({ type: "error", path, error: `No TweakDB record ${path}. It may be a flat, or a record added by a mod, which this offline view does not see.`, ...nav });
        return;
      }
      panel.title = (record.path ?? record.id).replace(/^.*\./, "");
      void panel.webview.postMessage({ type: "record", record, shortType: shortType(record.type), ...nav });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.log.appendLine(`tweakdb: ${path}: ${message}`);
      void panel.webview.postMessage({ type: "error", path, error: message, ...nav });
    }
  }
}
