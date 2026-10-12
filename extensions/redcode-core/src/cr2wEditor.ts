// The CR2W editor: a custom editor over a bridge document session. See docs/design/cr2w-editor.md.
//
// The bridge keeps the parsed file; the page reads one node at a time and sends edits as patches. The
// document keeps the forward operations since the last save, so a backup is that log and a bridge
// restart is survived by reopening the file and replaying it.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { BridgeClient } from "./bridgeClient";
import type { DocumentInfo, PatchOp, PatchResult } from "./types";

export const Cr2wViewType = "redcode.cr2w";

/** File types the CR2W editor opens by default. Others get it through Open With. */
export const Cr2wExtensions = new Set([
  ".ent", ".app", ".mesh", ".inkatlas", ".mi", ".mt", ".mlsetup", ".mltemplate", ".mlmask", ".anims", ".animgraph", ".rig",
  ".morphtarget", ".inkwidget", ".inkmenu", ".inkstyle", ".scene", ".quest", ".questphase", ".streamingsector", ".streamingblock",
  ".physicalscene", ".workspot", ".cubemap", ".texarray", ".envprobe", ".es", ".gamedef", ".lipmap", ".fp", ".cminimap", ".csv",
  ".inkanim", ".inkfontfamily", ".inkcharcustomization", ".garmentlayerparams", ".behavior", ".effect", ".particle", ".w2mesh",
]);

export function opensInCr2wEditor(file: string): boolean {
  return Cr2wExtensions.has(path.extname(file).toLowerCase());
}

interface Backup {
  ops: PatchOp[];
}

export class Cr2wDocument implements vscode.CustomDocument {
  private readonly changed = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<Cr2wDocument>>();
  readonly onDidChange = this.changed.event;
  private readonly reloaded = new vscode.EventEmitter<string>();
  /** Fired when the pages must refetch what they show: after undo, redo, revert, save or a reopen. */
  readonly onDidReload = this.reloaded.event;

  info: DocumentInfo | undefined;
  /** The forward operations since the last save. Replayed from a backup or after the bridge restarts. */
  log: PatchOp[] = [];
  private openedOn: BridgeClient | undefined;

  constructor(
    readonly uri: vscode.Uri,
    private readonly logChannel: vscode.OutputChannel,
  ) {}

  get doc(): string {
    if (!this.info) {
      throw new Error("The document is not open on the bridge.");
    }
    return this.info.doc;
  }

  /** Opens the file on this bridge if it is not open there yet, replaying the log after a restart. */
  async ensureOpen(bridge: BridgeClient): Promise<DocumentInfo> {
    if (this.info && this.openedOn === bridge) {
      return this.info;
    }
    this.info = await bridge.openDocument({ file: this.uri.fsPath });
    this.openedOn = bridge;
    if (this.log.length > 0) {
      await bridge.patch(this.info.doc, this.log);
      this.logChannel.appendLine(`cr2w editor: replayed ${this.log.length} operation(s) on ${path.basename(this.uri.fsPath)}`);
    }
    return this.info;
  }

  async edit(bridge: BridgeClient, ops: PatchOp[], label: string): Promise<PatchResult> {
    await this.ensureOpen(bridge);
    const result = await bridge.patch(this.doc, ops);
    this.log.push(...ops);
    this.changed.fire({
      document: this,
      label,
      undo: async () => {
        await this.ensureOpen(bridge);
        await bridge.patch(this.doc, result.inverse);
        this.log.push(...result.inverse);
        this.reloaded.fire("undo");
      },
      redo: async () => {
        await this.ensureOpen(bridge);
        await bridge.patch(this.doc, ops);
        this.log.push(...ops);
        this.reloaded.fire("redo");
      },
    });
    return result;
  }

  async save(bridge: BridgeClient, outFile?: string): Promise<void> {
    await this.ensureOpen(bridge);
    const result = await bridge.saveDocument(this.doc, outFile);
    this.logChannel.appendLine(`cr2w.save ${this.doc} -> ${result.file} (${result.bytes.toLocaleString()} bytes)`);
    this.log = [];
    this.reloaded.fire("save");
  }

  async revert(bridge: BridgeClient): Promise<void> {
    if (this.info && this.openedOn === bridge) {
      await bridge.closeDocument(this.doc).catch(() => undefined);
    }
    this.info = undefined;
    this.openedOn = undefined;
    this.log = [];
    await this.ensureOpen(bridge);
    this.reloaded.fire("revert");
  }

  dispose(): void {
    if (this.info && this.openedOn?.running) {
      void this.openedOn.closeDocument(this.info.doc).catch(() => undefined);
    }
    this.info = undefined;
    this.changed.dispose();
    this.reloaded.dispose();
  }
}

interface Request {
  type: string;
  id?: number;
  path?: string;
  offset?: number;
  limit?: number;
  name?: string;
  ops?: PatchOp[];
  label?: string;
}

export class Cr2wEditorProvider implements vscode.CustomEditorProvider<Cr2wDocument> {
  private readonly changed = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<Cr2wDocument>>();
  readonly onDidChangeCustomDocument = this.changed.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getBridge: () => BridgeClient | undefined,
    private readonly log: vscode.OutputChannel,
    private readonly openAsJson: (file: string) => void,
  ) {}

  register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(Cr2wViewType, this, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  private requireBridge(): BridgeClient {
    const bridge = this.getBridge();
    if (!bridge?.running) {
      throw new Error("The REDbridge process is not running. Run REDcode: Restart bridge, then reopen the file.");
    }
    return bridge;
  }

  async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<Cr2wDocument> {
    const document = new Cr2wDocument(uri, this.log);
    document.onDidChange((e) => this.changed.fire(e));
    if (openContext.backupId) {
      try {
        const backup = JSON.parse(fs.readFileSync(vscode.Uri.parse(openContext.backupId).fsPath, "utf8")) as Backup;
        document.log = backup.ops ?? [];
        this.log.appendLine(`cr2w editor: restoring ${document.log.length} unsaved operation(s) for ${path.basename(uri.fsPath)}`);
      } catch (e) {
        this.log.appendLine(`cr2w editor: could not read the backup for ${uri.fsPath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const bridge = this.getBridge();
    if (bridge?.running) {
      await document.ensureOpen(bridge);
    }
    return document;
  }

  async resolveCustomEditor(document: Cr2wDocument, panel: vscode.WebviewPanel): Promise<void> {
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media", "cr2w");
    panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
    panel.webview.html = this.html(panel.webview, media);

    const post = (message: unknown) => void panel.webview.postMessage(message);
    const reply = (id: number | undefined, value: unknown) => post({ type: "reply", id, ok: true, value });
    const fail = (id: number | undefined, e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      this.log.appendLine(`cr2w editor: ${message}`);
      // A request carries an id and gets a reply; a notification such as "ready" gets a page-level error.
      post(id === undefined ? { type: "error", error: message } : { type: "reply", id, ok: false, error: message });
    };

    const reload = document.onDidReload((reason) => post({ type: "reload", reason }));
    const messages = panel.webview.onDidReceiveMessage(async (m: Request) => {
      try {
        switch (m.type) {
          case "ready": {
            const info = await document.ensureOpen(this.requireBridge());
            post({ type: "document", info, file: path.basename(document.uri.fsPath), dirty: document.log.length > 0 });
            return;
          }
          case "getNode":
            return reply(m.id, await this.requireBridge().getNode(document.doc, m.path ?? "", m.offset ?? 0, m.limit ?? 200));
          case "describeType":
            return reply(m.id, await this.requireBridge().describeType(m.name ?? ""));
          case "createInstance":
            return reply(m.id, await this.requireBridge().createInstance(m.name ?? ""));
          case "patch":
            return reply(m.id, await document.edit(this.requireBridge(), m.ops ?? [], m.label ?? "Edit"));
          case "openAsJson":
            this.openAsJson(document.uri.fsPath);
            return;
          case "reveal":
            await vscode.commands.executeCommand("revealFileInOS", document.uri);
            return;
          case "log":
            this.log.appendLine(`cr2w page: ${m.label ?? ""}`);
            return;
        }
      } catch (e) {
        fail(m.id, e);
      }
    });
    panel.onDidDispose(() => {
      reload.dispose();
      messages.dispose();
    });
  }

  async saveCustomDocument(document: Cr2wDocument): Promise<void> {
    await document.save(this.requireBridge());
  }

  async saveCustomDocumentAs(document: Cr2wDocument, destination: vscode.Uri): Promise<void> {
    await document.save(this.requireBridge(), destination.fsPath);
  }

  async revertCustomDocument(document: Cr2wDocument): Promise<void> {
    await document.revert(this.requireBridge());
  }

  async backupCustomDocument(document: Cr2wDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
    const backup: Backup = { ops: document.log };
    fs.mkdirSync(path.dirname(context.destination.fsPath), { recursive: true });
    fs.writeFileSync(context.destination.fsPath, JSON.stringify(backup));
    return {
      id: context.destination.toString(),
      delete: () => {
        try {
          fs.unlinkSync(context.destination.fsPath);
        } catch {
          // Already gone.
        }
      },
    };
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, "editor.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, "editor.css"));
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}">
<title>CR2W</title>
</head>
<body>
<header id="header">
  <span class="name" id="file">Loading</span>
  <span class="meta" id="type"></span>
  <span class="meta" id="size"></span>
  <span class="spacer"></span>
  <button id="json" title="Open this file as WolvenKit JSON in a text editor">JSON</button>
</header>
<div id="body">
  <aside id="tree"><div class="label">Tree</div><ul id="treeRoot" class="tree"></ul></aside>
  <main id="props"><div class="label" id="propsLabel">Properties</div><div id="grid"></div></main>
</div>
<footer id="footer"><span id="status"></span><span class="spacer"></span><span id="selected" class="meta"></span></footer>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
