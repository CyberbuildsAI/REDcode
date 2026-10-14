// The texture viewer: a .xbm from the project or the archives, converted to PNG by the bridge and shown in a webview.
//
// Project files open through a read-only custom editor, so a double-click in the Project view or the
// Explorer shows the texture. Archive files have no URI on disk, so they open in a webview panel instead.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { BridgeClient } from "./bridgeClient";

export const TextureViewType = "redcode.texture";
/**
 * The same viewer under a second view type, offered under Open With for the common image formats
 * and used by the Project view, so a PNG elsewhere keeps VS Code's own preview. VS Code keeps one
 * manifest entry per view type, so a default and an option registration need two names.
 */
export const TextureOptionViewType = "redcode.textureOption";

/** .xbm is a game texture; .tga and .dds are plain images (an exported texture in source/raw) VS Code cannot show itself. */
const DefaultExtensions = new Set([".xbm", ".tga", ".dds"]);
/** Images VS Code can show, but without a checkerboard behind transparency: a black texture vanishes on a dark theme. */
const OptionExtensions = new Set([".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"]);
/** What a webview shows as it is, so no bridge is needed for them. */
const BrowserImages = new Set([".png", ".jpg", ".jpeg", ".bmp"]);
export const isGameTexture = (file: string) => path.extname(file).toLowerCase() === ".xbm";

/** True for the file types the viewer can show. */
export function isTexture(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return DefaultExtensions.has(ext) || OptionExtensions.has(ext);
}

/** The view type to open a file in the viewer with. */
export function textureViewTypeFor(file: string): string {
  return DefaultExtensions.has(path.extname(file).toLowerCase()) ? TextureViewType : TextureOptionViewType;
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
  /**
   * The storage folder as a file: URI. The extension context gives it with the vscode-userdata scheme,
   * and the webview's resource check compares schemes before paths, so a vscode-userdata root never
   * matches the file: URIs that asWebviewUri produces and every image request gets a 401.
   */
  readonly root: vscode.Uri;

  constructor(
    private readonly getBridge: () => BridgeClient | undefined,
    private readonly storage: vscode.Uri,
    private readonly log: vscode.OutputChannel,
  ) {
    this.root = vscode.Uri.file(storage.fsPath);
  }

  register(): vscode.Disposable {
    const options = { webviewOptions: { retainContextWhenHidden: false }, supportsMultipleEditorsPerDocument: true };
    return vscode.Disposable.from(
      vscode.window.registerCustomEditorProvider(TextureViewType, this, options),
      vscode.window.registerCustomEditorProvider(TextureOptionViewType, this, options),
    );
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
    panel.webview.options = { enableScripts: true, localResourceRoots: [this.root] };
    const file = doc.uri.fsPath;
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const subtitle = folder ? path.relative(folder.uri.fsPath, file) : file;
    if (BrowserImages.has(path.extname(file).toLowerCase())) {
      // The webview shows these as they are: a copy under the viewer's storage root, no bridge needed.
      const copy = this.pngForFile(file);
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(file, copy);
      this.present(panel, { title: path.basename(file), subtitle, png: copy });
      return;
    }
    const bridge = this.getBridge();
    if (!bridge?.running) {
      panel.webview.html = messageHtml(panel.webview, "The REDbridge process is not running.", "Run REDcode: Restart REDbridge, then reopen this file.");
      return;
    }
    panel.webview.html = messageHtml(panel.webview, `Converting ${path.basename(file)}`, "");
    try {
      const png = this.pngForFile(file);
      const game = isGameTexture(file);
      const result = game ? await bridge.fileToPng(file, png) : await bridge.imageToPng(file, png);
      this.log.appendLine(`texture.${game ? "fileToPng" : "imageToPng"} ${file} -> ${result.file} (${result.bytes.toLocaleString()} bytes)`);
      this.present(panel, { title: path.basename(file), subtitle, png });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.log.appendLine(`Error: ${message}`);
      panel.webview.html = messageHtml(
        panel.webview,
        `Could not show ${path.basename(file)}`,
        isMethodMissing(e)
          ? `Viewing ${isGameTexture(file) ? "project textures needs REDbridge 0.3.0" : ".tga and .dds images needs REDbridge 0.7.0"} or newer. Run REDcode: Update REDbridge.`
          : message,
      );
    }
  }

  /** Shows a texture that is not a file on disk, such as one straight from the archives. */
  show(source: TextureSource): vscode.WebviewPanel {
    // Not TextureViewType: that id is registered as the custom editor, and a free panel must not share it.
    const panel = vscode.window.createWebviewPanel("redcode.texturePanel", source.title, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [this.root],
    });
    this.present(panel, source);
    return panel;
  }

  /**
   * Puts the texture page in the webview and answers its requests. The page loads the PNG through a
   * webview resource URI; if the host refuses that (it has, with a 401, on at least one machine even
   * though the file sits under the declared root), the page asks for the bytes and gets a data URI.
   */
  private present(panel: vscode.WebviewPanel, source: TextureSource): void {
    const uri = panel.webview.asWebviewUri(vscode.Uri.file(source.png));
    const roots = (panel.webview.options.localResourceRoots ?? []).map((r) => r.toString()).join(" ");
    this.log.appendLine(`texture viewer: ${source.title} image ${uri} roots [${roots}] storage ${this.storage.toString()} (VS Code ${vscode.version})`);
    const listener = panel.webview.onDidReceiveMessage((m: { type?: string }) => {
      if (m?.type === "imageFailed") {
        this.log.appendLine(`texture viewer: the webview could not load ${uri}; sending the PNG inline`);
        const data = fs.readFileSync(source.png).toString("base64");
        void panel.webview.postMessage({ type: "image", src: `data:image/png;base64,${data}` });
      }
    });
    panel.onDidDispose(() => listener.dispose());
    panel.webview.html = textureHtml(panel.webview, source);
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${n}'; script-src 'nonce-${n}';">
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
const vscode = acquireVsCodeApi();
const main = document.getElementById("main"), img = document.getElementById("img");
const fit = document.getElementById("fit"), one = document.getElementById("one"), pixel = document.getElementById("pixel");
img.addEventListener("load", () => { document.getElementById("dims").textContent = img.naturalWidth + " x " + img.naturalHeight; });
img.addEventListener("error", () => vscode.postMessage({ type: "imageFailed" }), { once: true });
window.addEventListener("message", (e) => { if (e.data && e.data.type === "image") { img.src = e.data.src; } });
fit.addEventListener("click", () => { main.classList.add("fit"); fit.classList.add("on"); one.classList.remove("on"); });
one.addEventListener("click", () => { main.classList.remove("fit"); one.classList.add("on"); fit.classList.remove("on"); });
pixel.addEventListener("click", () => { pixel.classList.toggle("on"); main.classList.toggle("pixel"); });`;
  return shellHtml(webview, n, body, script);
}
