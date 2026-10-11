// The texture viewer: a .xbm from the project or the archives, converted to PNG by the bridge and shown in a webview.
//
// Project files open through a read-only custom editor, so a double-click in the Project view or the
// Explorer shows the texture. Archive files have no URI on disk, so they open in a webview panel instead.

import * as path from "node:path";
import * as vscode from "vscode";
import type { BridgeClient } from "./bridgeClient";

export const TextureViewType = "redcode.texture";

const TextureExtensions = new Set([".xbm"]);

/** True for the file types the viewer can show. */
export function isTexture(file: string): boolean {
  return TextureExtensions.has(path.extname(file).toLowerCase());
}

export interface TextureSource {
  /** The name shown in the header and the tab. */
  title: string;
  /** Where it came from: the game path and archive, or the project path. */
  subtitle: string;
  /** The PNG to show. */
  png: string;
}

interface TextureDocument extends vscode.CustomDocument {
  readonly uri: vscode.Uri;
}

export class TextureViewer implements vscode.CustomReadonlyEditorProvider<TextureDocument> {
  constructor(
    private readonly getBridge: () => BridgeClient | undefined,
    private readonly storage: vscode.Uri,
    private readonly log: vscode.OutputChannel,
  ) {}

  register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(TextureViewType, this, {
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: true,
    });
  }

  /** Where the PNG for a file on disk goes: <storage>/png/disk/<drive>/<path>.png */
  pngForFile(file: string): string {
    const parts = path.resolve(file).replace(/^([A-Za-z]):/, "$1").split(/[\\/]+/).filter(Boolean);
    return path.join(this.storage.fsPath, "png", "disk", ...parts) + ".png";
  }

  /** Where the PNG for a game path goes: <storage>/png/game/<game path>.png */
  pngForGamePath(gamePath: string): string {
    return path.join(this.storage.fsPath, "png", "game", ...gamePath.split("\\")) + ".png";
  }

  openCustomDocument(uri: vscode.Uri): TextureDocument {
    return { uri, dispose: () => undefined };
  }

  async resolveCustomEditor(doc: TextureDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.storage] };
    const file = doc.uri.fsPath;
    const bridge = this.getBridge();
    if (!bridge?.running) {
      panel.webview.html = messageHtml(panel.webview, "The REDbridge process is not running.", "Run REDcode: Restart bridge, then reopen this file.");
      return;
    }
    panel.webview.html = messageHtml(panel.webview, `Converting ${path.basename(file)}`, "");
    try {
      const png = this.pngForFile(file);
      const result = await bridge.fileToPng(file, png);
      this.log.appendLine(`texture.fileToPng ${file} -> ${result.file} (${result.bytes.toLocaleString()} bytes)`);
      const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
      const subtitle = folder ? path.relative(folder.uri.fsPath, file) : file;
      panel.webview.html = textureHtml(panel.webview, { title: path.basename(file), subtitle, png });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.log.appendLine(`Error: ${message}`);
      panel.webview.html = messageHtml(
        panel.webview,
        `Could not show ${path.basename(file)}`,
        isMethodMissing(e) ? "Viewing project textures needs REDbridge 0.3.0 or newer. Run npm run bridge:update in the REDcode folder, then REDcode: Restart bridge." : message,
      );
    }
  }

  /** Shows a texture that is not a file on disk, such as one straight from the archives. */
  show(source: TextureSource): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(TextureViewType, source.title, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [this.storage],
    });
    panel.webview.html = textureHtml(panel.webview, source);
    return panel;
  }
}

/** JSON-RPC's "method not found", which an older bridge answers for methods it does not have. */
function isMethodMissing(e: unknown): boolean {
  const code = (e as { code?: unknown })?.code;
  return code === -32601 || /method not found/i.test(e instanceof Error ? e.message : String(e));
}

function nonce(): string {
  let s = "";
  for (let i = 0; i < 24; i++) {
    s += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)];
  }
  return s;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shellHtml(webview: vscode.Webview, n: string, body: string, script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src 'nonce-${n}'; script-src 'nonce-${n}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${n}">
:root { --accent: #fcee0a; }
html, body { height: 100%; margin: 0; }
body { display: flex; flex-direction: column; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
header { display: flex; align-items: center; gap: 14px; padding: 6px 12px; border-bottom: 1px solid var(--vscode-panel-border, #333); font-family: var(--vscode-editor-font-family); white-space: nowrap; overflow: hidden; }
header .name { color: var(--accent); font-weight: 600; }
header .meta { opacity: .7; overflow: hidden; text-overflow: ellipsis; }
header .spacer { flex: 1; }
header button { background: transparent; color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border, #555); padding: 2px 9px; cursor: pointer; font: inherit; }
header button.on { border-color: var(--accent); color: var(--accent); }
main { flex: 1; min-height: 0; overflow: auto; display: grid; place-items: center; background-color: #161616; background-image: conic-gradient(#232323 25%, #161616 0 50%, #232323 0 75%, #161616 0); background-size: 16px 16px; }
main.fit img { max-width: calc(100% - 24px); max-height: calc(100% - 24px); object-fit: contain; }
main.pixel img { image-rendering: pixelated; }
img { display: block; }
.message { padding: 24px; text-align: center; }
.message h2 { color: var(--accent); font-weight: 600; margin: 0 0 8px; }
.message p { opacity: .8; margin: 0; }
</style>
</head>
<body>
${body}
${script ? `<script nonce="${n}">${script}</script>` : ""}
</body>
</html>`;
}

function messageHtml(webview: vscode.Webview, title: string, detail: string): string {
  return shellHtml(webview, nonce(), `<main><div class="message"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p></div></main>`);
}

function textureHtml(webview: vscode.Webview, source: TextureSource): string {
  const n = nonce();
  const src = webview.asWebviewUri(vscode.Uri.file(source.png)).toString();
  const body = `<header>
  <span class="name">${escapeHtml(source.title)}</span>
  <span class="meta" title="${escapeHtml(source.subtitle)}">${escapeHtml(source.subtitle)}</span>
  <span class="meta" id="dims"></span>
  <span class="spacer"></span>
  <button id="fit" class="on">Fit</button>
  <button id="one">1:1</button>
  <button id="pixel">Pixels</button>
</header>
<main id="main" class="fit"><img id="img" src="${src}" alt="${escapeHtml(source.title)}"></main>`;
  const script = `
const main = document.getElementById("main"), img = document.getElementById("img");
const fit = document.getElementById("fit"), one = document.getElementById("one"), pixel = document.getElementById("pixel");
img.addEventListener("load", () => { document.getElementById("dims").textContent = img.naturalWidth + " x " + img.naturalHeight; });
fit.addEventListener("click", () => { main.classList.add("fit"); fit.classList.add("on"); one.classList.remove("on"); });
one.addEventListener("click", () => { main.classList.remove("fit"); one.classList.add("on"); fit.classList.remove("on"); });
pixel.addEventListener("click", () => { pixel.classList.toggle("on"); main.classList.toggle("pixel"); });`;
  return shellHtml(webview, n, body, script);
}
