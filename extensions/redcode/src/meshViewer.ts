// The 3D viewer for .glb and .gltf files, such as an exported mesh in a project's source/raw. VS Code
// has none. The same bundled viewer as the CR2W editor's mesh mode (media/mesh/viewer.js); no bridge
// is needed, since the file is already glTF. See docs/design/view.md, V1.

import * as path from "node:path";
import * as vscode from "vscode";
import { meshPayload } from "./meshExport";

export const MeshViewType = "redcode.mesh";

export class MeshViewer implements vscode.CustomReadonlyEditorProvider {
  constructor(private readonly extensionUri: vscode.Uri, private readonly log: vscode.OutputChannel) {}

  register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(MeshViewType, this, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true });
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const file = document.uri.fsPath;
    const nonce = Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");
    const viewer = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "mesh", "viewer.js"));
    const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, "cr2w", "editor.css"));
    const send = () => {
      try {
        void panel.webview.postMessage({ type: "mesh", title: path.basename(file), ...meshPayload(file) });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.log.appendLine(`mesh viewer: ${message}`);
        void panel.webview.postMessage({ type: "error", error: message });
      }
    };
    panel.webview.onDidReceiveMessage((m: { type?: string }) => m?.type === "ready" && send());
    // Re-read the file when it changes on disk, such as after a new export.
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)));
    watcher.onDidChange(send);
    panel.onDidDispose(() => watcher.dispose());
    panel.webview.html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data: blob:; style-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'; connect-src data: blob:;">
<link rel="stylesheet" href="${style}">
<title>${path.basename(file)}</title>
</head>
<body class="mesh-mode meshfile">
<main id="mesh" class="meshfile-main"><div class="note">Loading…</div></main>
<script nonce="${nonce}" src="${viewer}"></script>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const host = document.getElementById("mesh");
let view = null;
window.addEventListener("message", async (e) => {
  const m = e.data;
  if (m.type === "error") { host.textContent = "Could not read the file: " + m.error; return; }
  if (m.type !== "mesh") return;
  view?.dispose();
  let source;
  if (m.json) source = { json: m.json };
  else { const bin = atob(m.data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); source = { data: bytes.buffer }; }
  view = await window.REDcodeMesh.mount(host, source, m.title);
});
vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`;
  }
}
