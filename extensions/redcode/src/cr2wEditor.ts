// The CR2W editor: a custom editor over a bridge document session. See docs/design/cr2w-editor.md.
//
// The bridge keeps the parsed file; the page reads one node at a time and sends edits as patches. The
// document keeps the forward operations since the last save, so a backup is that log and a bridge
// restart is survived by reopening the file and replaying it.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { BridgeClient } from "./bridgeClient";
import { gamePathOfUri } from "./gameFs";
import { meshGlbFor, meshPayload } from "./meshExport";
import { findEdgemat, mapsForWebview } from "./edgemat";
import { ProjectFolders } from "./project";
import type { TextureViewer } from "./textureViewer";
import type { DocumentInfo, PatchOp, PatchResult } from "./types";

export const Cr2wViewType = "redcode.cr2w";
/**
 * The same editor under a second view type, offered under Open With for .xbm, .json and .csv. VS Code
 * keeps one manifest entry per view type, so a default and an option registration need two names.
 */
export const Cr2wOptionViewType = "redcode.cr2wOption";

/** The view type to open a file with: the default one for the editor's own types, else the option one. */
export function cr2wViewTypeFor(file: string): string {
  return Cr2wExtensions.has(path.extname(file).toLowerCase()) ? Cr2wViewType : Cr2wOptionViewType;
}

/** File types the CR2W editor opens by default. Others get it through Open With. */
export const Cr2wExtensions = new Set([
  ".ent", ".app", ".mesh", ".inkatlas", ".mi", ".mt", ".mlsetup", ".mltemplate", ".mlmask", ".anims", ".animgraph", ".rig",
  ".morphtarget", ".inkwidget", ".inkmenu", ".inkstyle", ".scene", ".quest", ".questphase", ".streamingsector", ".streamingblock",
  ".physicalscene", ".workspot", ".cubemap", ".texarray", ".envprobe", ".es", ".gamedef", ".lipmap", ".fp", ".cminimap", ".csv",
  ".inkanim", ".inkfontfamily", ".inkcharcustomization", ".garmentlayerparams", ".behavior", ".effect", ".particle", ".w2mesh",
]);

/**
 * True for the file types the editor owns, and for a .json or .csv that is a CR2W file inside (the
 * localization and C2dArray resources), which the first four bytes tell apart from plain text.
 */
export function opensInCr2wEditor(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  if (Cr2wExtensions.has(ext)) {
    return true;
  }
  if (ext === ".json" || ext === ".csv") {
    try {
      const fd = fs.openSync(file, "r");
      try {
        const head = Buffer.alloc(4);
        return fs.readSync(fd, head, 0, 4, 0) === 4 && head.toString("latin1") === "CR2W";
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return false;
    }
  }
  return false;
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
  private readonly disposed = new vscode.EventEmitter<void>();
  /** Fired when VS Code closes the document, so the Properties view can let go of it. */
  readonly onDidDispose = this.disposed.event;

  info: DocumentInfo | undefined;
  /** The forward operations since the last save. Replayed from a backup or after the bridge restarts. */
  log: PatchOp[] = [];
  private openedOn: BridgeClient | undefined;
  /** Edits, saves and reverts run one after another, so a save never overlaps an edit on the bridge. */
  private chain: Promise<unknown> = Promise.resolve();

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Set when the document is a game file opened through the redcode-game scheme: read-only, straight from the archives. */
  readonly gamePath: string | undefined;

  constructor(
    readonly uri: vscode.Uri,
    private readonly logChannel: vscode.OutputChannel,
  ) {
    this.gamePath = gamePathOfUri(uri);
  }

  /** The name shown in the header and the tab. */
  get name(): string {
    return path.basename(this.gamePath ?? this.uri.fsPath);
  }

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
    this.info = await bridge.openDocument(this.gamePath ? { path: this.gamePath } : { file: this.uri.fsPath });
    this.openedOn = bridge;
    if (this.log.length > 0) {
      await bridge.patch(this.info.doc, this.log);
      this.logChannel.appendLine(`cr2w editor: replayed ${this.log.length} operation(s) on ${path.basename(this.uri.fsPath)}`);
    }
    return this.info;
  }

  edit(bridge: BridgeClient, ops: PatchOp[], label: string): Promise<PatchResult> {
    return this.enqueue(async () => {
      await this.ensureOpen(bridge);
      const result = await bridge.patch(this.doc, ops);
      this.log.push(...ops);
      this.changed.fire({
        document: this,
        label,
        undo: () =>
          this.enqueue(async () => {
            await this.ensureOpen(bridge);
            await bridge.patch(this.doc, result.inverse);
            this.log.push(...result.inverse);
            this.reloaded.fire("undo");
          }),
        redo: () =>
          this.enqueue(async () => {
            await this.ensureOpen(bridge);
            await bridge.patch(this.doc, ops);
            this.log.push(...ops);
            this.reloaded.fire("redo");
          }),
      });
      return result;
    });
  }

  save(bridge: BridgeClient, outFile?: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.gamePath && !outFile) {
        throw new Error("This is the game's copy and is read-only. Add it to the project to edit and save it.");
      }
      await this.ensureOpen(bridge);
      const result = await bridge.saveDocument(this.doc, outFile);
      this.logChannel.appendLine(`cr2w.save ${this.doc} -> ${result.file} (${result.bytes.toLocaleString()} bytes)`);
      this.log = [];
      this.reloaded.fire("save");
    });
  }

  revert(bridge: BridgeClient): Promise<void> {
    return this.enqueue(async () => {
      if (this.info && this.openedOn === bridge) {
        await bridge.closeDocument(this.doc).catch(() => undefined);
      }
      this.info = undefined;
      this.openedOn = undefined;
      this.log = [];
      await this.ensureOpen(bridge);
      this.reloaded.fire("revert");
    });
  }

  dispose(): void {
    if (this.info && this.openedOn?.running) {
      void this.openedOn.closeDocument(this.info.doc).catch(() => undefined);
    }
    this.info = undefined;
    this.disposed.fire();
    this.changed.dispose();
    this.reloaded.dispose();
    this.disposed.dispose();
  }
}

interface Request {
  type: string;
  id?: number;
  path?: string;
  paths?: string[];
  offset?: number;
  limit?: number;
  name?: string;
  query?: string;
  ops?: PatchOp[];
  label?: string;
  /** texture: the depot path of a texture the page wants to show. */
  depot?: string;
  /** textureData: the PNG the page could not load through its resource URI. */
  png?: string;
  /** renderMaterials: the appearance shown and the material names it uses. */
  appearance?: string;
  materials?: string[];
}

export class Cr2wEditorProvider implements vscode.CustomEditorProvider<Cr2wDocument> {
  private readonly changed = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<Cr2wDocument>>();
  readonly onDidChangeCustomDocument = this.changed.event;
  /** The open pages per document (editor panels and the Properties view), so a save can ask them to commit any input still being edited. */
  private readonly pages = new Map<Cr2wDocument, Set<vscode.Webview>>();
  /** The last selected path per document, which a page attaching later (the Properties view) starts on. */
  private readonly selection = new Map<Cr2wDocument, string>();
  private readonly documents = new Map<string, Cr2wDocument>();
  private readonly flushes = new Map<number, () => void>();
  private nextFlush = 1;

  /** The open document for an editor tab's URI, for the Properties view. */
  documentFor(uri: vscode.Uri): Cr2wDocument | undefined {
    return this.documents.get(uri.toString());
  }

  get media(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, "media", "cr2w");
  }

  /** What a page may load: the editor's media and the converted PNGs. */
  get resourceRoots(): vscode.Uri[] {
    return [this.media, vscode.Uri.joinPath(this.context.extensionUri, "media", "mesh"), this.textures.root];
  }

  /**
   * Asks every page of the document to commit the input that has focus and to let its in-flight
   * patches land, then returns. Ctrl+S with the cursor still in an input would otherwise commit the
   * edit as the save starts, and the file would be written without it.
   */
  private async flush(document: Cr2wDocument): Promise<void> {
    const pages = [...(this.pages.get(document) ?? [])];
    await Promise.all(
      pages.map(
        (webview) =>
          new Promise<void>((resolve) => {
            const id = this.nextFlush++;
            const timer = setTimeout(() => {
              this.flushes.delete(id);
              resolve();
            }, 1500);
            this.flushes.set(id, () => {
              clearTimeout(timer);
              resolve();
            });
            void webview.postMessage({ type: "flush", id });
          }),
      ),
    );
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getBridge: () => BridgeClient | undefined,
    private readonly log: vscode.OutputChannel,
    /** Converts textures to PNG and knows where they go, for the atlas view. */
    private readonly textures: TextureViewer,
    private readonly openAsJson: (file: string) => void,
    private readonly openGameAsJson: (gamePath: string) => void,
  ) {}

  /**
   * The PNG for a texture an atlas refers to by depot path. The project's own copy under
   * source/archive wins when it exists, since that is the texture a mod ships; otherwise the game's.
   * A game document has no project, so it always gets the game's texture.
   */
  private async texturePng(bridge: BridgeClient, documentFile: string | undefined, depot: string): Promise<string> {
    const lower = (documentFile ?? "").toLowerCase();
    const marker = `${path.sep}${ProjectFolders.archive.toLowerCase()}${path.sep}`;
    const at = documentFile ? lower.indexOf(marker) : -1;
    if (documentFile && at >= 0) {
      const own = path.join(documentFile.slice(0, at), ProjectFolders.archive, ...depot.split("\\"));
      if (fs.existsSync(own)) {
        const png = this.textures.pngForFile(own);
        await bridge.fileToPng(own, png);
        this.log.appendLine(`cr2w editor: atlas texture from the project, ${own}`);
        return png;
      }
    }
    const png = this.textures.pngForGamePath(depot);
    await bridge.toPng(depot, png);
    return png;
  }

  register(): vscode.Disposable {
    const options = { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false };
    return vscode.Disposable.from(
      vscode.window.registerCustomEditorProvider(Cr2wViewType, this, options),
      vscode.window.registerCustomEditorProvider(Cr2wOptionViewType, this, options),
    );
  }

  private requireBridge(): BridgeClient {
    const bridge = this.getBridge();
    if (!bridge?.running) {
      throw new Error("The REDbridge process is not running. Run REDcode: Restart REDbridge, then reopen the file.");
    }
    return bridge;
  }

  async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<Cr2wDocument> {
    const document = new Cr2wDocument(uri, this.log);
    document.onDidChange((e) => this.changed.fire(e));
    this.documents.set(uri.toString(), document);
    document.onDidDispose(() => {
      if (this.documents.get(uri.toString()) === document) this.documents.delete(uri.toString());
      this.pages.delete(document);
      this.selection.delete(document);
    });
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

  private readonly opened = new vscode.EventEmitter<Cr2wDocument>();
  /** Fired when an editor panel for the document resolves or becomes active, which the Properties view follows. */
  readonly onDidShowEditor = this.opened.event;

  async resolveCustomEditor(document: Cr2wDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.options = { enableScripts: true, localResourceRoots: this.resourceRoots };
    panel.webview.html = this.html(panel.webview, false);
    const page = this.attachPage(document, panel.webview);
    const state = panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) this.opened.fire(document);
    });
    panel.onDidDispose(() => {
      page.dispose();
      state.dispose();
    });
    this.opened.fire(document);
  }

  /**
   * Wires a page (an editor panel, or the Properties view) to a document: answers its requests,
   * forwards reloads, and tells the document's other pages when it edits or selects something.
   * Returns the detach.
   */
  attachPage(document: Cr2wDocument, webview: vscode.Webview): vscode.Disposable {
    const post = (message: unknown) => void webview.postMessage(message);
    const reply = (id: number | undefined, value: unknown) => post({ type: "reply", id, ok: true, value });
    const fail = (id: number | undefined, e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      this.log.appendLine(`cr2w editor: ${message}`);
      // A request carries an id and gets a reply; a notification such as "ready" gets a page-level error.
      post(id === undefined ? { type: "error", error: message } : { type: "reply", id, ok: false, error: message });
    };
    const others = (message: unknown) => {
      for (const w of this.pages.get(document) ?? []) {
        if (w !== webview) void w.postMessage(message);
      }
    };

    if (!this.pages.has(document)) {
      this.pages.set(document, new Set());
    }
    this.pages.get(document)!.add(webview);

    const reload = document.onDidReload((reason) => post({ type: "reload", reason }));
    // The mesh as EDGEmat knows it: its game path, or the file on disk.
    const meshRef = () => document.gamePath ?? document.uri.fsPath;
    let materialWatch: vscode.Disposable | undefined;
    const messages = webview.onDidReceiveMessage(async (m: Request) => {
      try {
        switch (m.type) {
          case "flushed": {
            const done = m.id === undefined ? undefined : this.flushes.get(m.id);
            if (done && m.id !== undefined) {
              this.flushes.delete(m.id);
              done();
            }
            return;
          }
          case "ready": {
            const info = await document.ensureOpen(this.requireBridge());
            post({ type: "document", info, file: document.name, game: document.gamePath !== undefined, dirty: document.log.length > 0, selected: this.selection.get(document) ?? "" });
            return;
          }
          case "getNode":
            return reply(m.id, await this.requireBridge().getNode(document.doc, m.path ?? "", m.offset ?? 0, m.limit ?? 200));
          case "getNodes":
            return reply(m.id, await this.requireBridge().getNodes(document.doc, m.paths ?? [], m.limit ?? 200));
          case "search":
            return reply(m.id, await this.requireBridge().searchDocument(document.doc, m.query ?? "", m.path ?? "", m.limit ?? 200));
          case "describeType":
            return reply(m.id, await this.requireBridge().describeType(m.name ?? ""));
          case "createInstance":
            return reply(m.id, await this.requireBridge().createInstance(m.name ?? ""));
          case "patch": {
            const result = await document.edit(this.requireBridge(), m.ops ?? [], m.label ?? "Edit");
            reply(m.id, result);
            others({ type: "changed", path: m.ops?.[0]?.path ?? "" });
            return;
          }
          case "selected":
            this.selection.set(document, m.path ?? "");
            others({ type: "select", path: m.path ?? "" });
            return;
          case "texture": {
            const png = await this.texturePng(this.requireBridge(), document.gamePath ? undefined : document.uri.fsPath, m.depot ?? "");
            return reply(m.id, { png, src: webview.asWebviewUri(vscode.Uri.file(png)).toString() });
          }
          case "meshPayload": {
            // The open mesh, exported to a cached .glb (the saved file: unsaved edits show after a save).
            const cache = path.join(this.textures.root.fsPath, "mesh");
            const r = await meshGlbFor(this.requireBridge(), cache, document.gamePath ? { gamePath: document.gamePath } : { file: document.uri.fsPath });
            if (!r.cached) this.log.appendLine(`cr2w editor: exported ${document.name} to ${r.glb} for the 3D view`);
            const appearances = await this.meshAppearances(document).catch(() => []);
            // EDGEmat renders materials when it is installed (REDcode issue #6).
            const edgemat = await findEdgemat();
            if (edgemat && !materialWatch) {
              materialWatch = edgemat.onDidChangeMaterials((e) => {
                if (!e.mesh || e.mesh.toLowerCase() === meshRef().toLowerCase()) post({ type: "materialsChanged", materials: e.materials });
              });
            }
            return reply(m.id, { ...meshPayload(r.glb), path: r.glb, cached: r.cached, dirty: document.log.length > 0, appearances, materialProvider: !!edgemat });
          }
          case "renderMaterials": {
            const edgemat = await findEdgemat();
            if (!edgemat) throw new Error("EDGEmat is not installed or not running");
            const maps = await edgemat.renderMaterials({ mesh: meshRef(), appearance: m.appearance, materials: m.materials });
            return reply(m.id, Object.fromEntries(Object.entries(maps).map(([name, r]) => [name, mapsForWebview(r)])));
          }
          case "documentTexture": {
            // The open file itself, for the texture view: the game's copy, or the file on disk.
            const bridge = this.requireBridge();
            let png: string;
            if (document.gamePath) {
              png = this.textures.pngForGamePath(document.gamePath);
              await bridge.toPng(document.gamePath, png);
            } else {
              png = this.textures.pngForFile(document.uri.fsPath);
              await bridge.fileToPng(document.uri.fsPath, png);
            }
            return reply(m.id, { png, src: webview.asWebviewUri(vscode.Uri.file(png)).toString() });
          }
          case "textureData": {
            // The resource URI was refused (it has been, with a 401, on one machine): send the bytes inline.
            const png = path.resolve(m.png ?? "");
            if (!png.toLowerCase().startsWith(this.textures.root.fsPath.toLowerCase())) {
              throw new Error("Only PNGs the extension converted can be sent inline.");
            }
            this.log.appendLine(`cr2w editor: the page could not load ${png}; sending it inline`);
            return reply(m.id, `data:image/png;base64,${fs.readFileSync(png).toString("base64")}`);
          }
          case "openAsJson":
            if (document.gamePath) this.openGameAsJson(document.gamePath);
            else this.openAsJson(document.uri.fsPath);
            return;
          case "reveal":
            if (!document.gamePath) await vscode.commands.executeCommand("revealFileInOS", document.uri);
            return;
          case "log":
            this.log.appendLine(`cr2w page: ${m.label ?? ""}`);
            return;
        }
      } catch (e) {
        fail(m.id, e);
      }
    });
    return new vscode.Disposable(() => {
      reload.dispose();
      messages.dispose();
      materialWatch?.dispose();
      this.pages.get(document)?.delete(webview);
    });
  }

  /** A .mesh's appearances and the material each names per submesh (chunkMaterials), read from the document. */
  private async meshAppearances(document: Cr2wDocument): Promise<{ name: string; chunkMaterials: string[] }[]> {
    const bridge = this.requireBridge();
    await document.ensureOpen(bridge);
    const list = await bridge.getNode(document.doc, "appearances", 0, 1000);
    const count = list.total ?? list.children?.length ?? 0;
    if (count === 0) return [];
    const paths = Array.from({ length: count }, (_, i) => [`appearances.${i}.Data.name`, `appearances.${i}.Data.chunkMaterials`]).flat();
    const nodes = await bridge.getNodes(document.doc, paths, 1000);
    const text = (v: unknown) => (v && typeof v === "object" && "$value" in v ? String((v as { $value: unknown }).$value ?? "") : String(v ?? ""));
    const out: { name: string; chunkMaterials: string[] }[] = [];
    for (let i = 0; i < count; i++) {
      const name = nodes[i * 2];
      const chunks = nodes[i * 2 + 1];
      out.push({ name: text(name?.value), chunkMaterials: (chunks?.children ?? []).map((c) => text(c.value)) });
    }
    return out;
  }

  async saveCustomDocument(document: Cr2wDocument): Promise<void> {
    await this.flush(document);
    await document.save(this.requireBridge());
  }

  async saveCustomDocumentAs(document: Cr2wDocument, destination: vscode.Uri): Promise<void> {
    await this.flush(document);
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

  /** The page. The same markup serves the editor and, with sidebar set, the Properties view, which hides everything but the grid. */
  html(webview: vscode.Webview, sidebar: boolean): string {
    const media = this.media;
    const nonce = Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, "editor.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, "editor.css"));
    // The 3D viewer (three.js) loads first, so the mesh mode is there when the document arrives; the sidebar skips it.
    const viewer = sidebar ? "" : `<script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "mesh", "viewer.js"))}"></script>\n`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; connect-src data: blob:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${style}">
<title>CR2W</title>
</head>
<body${sidebar ? ' data-mode="sidebar"' : ""}>
<header id="header">
  <span class="name" id="file">Loading</span>
  <span class="meta" id="type"></span>
  <span class="meta" id="size"></span>
  <span class="spacer"></span>
  <button id="view" hidden title="Switch between this file's own view and the tree">Tree</button>
  <button id="json" title="Open this file as WolvenKit JSON in a text editor">JSON</button>
</header>
<div id="body">
  <aside id="tree"><div class="label">Tree</div><ul id="treeRoot" class="tree"></ul></aside>
  <aside id="parts" hidden><div class="label">Parts</div><div id="partsBar"></div><div id="partsList"></div></aside>
  <div id="splitter" title="Drag to resize the tree"></div>
  <main id="props"><div class="label" id="propsLabel">Properties</div><div id="grid"></div></main>
</div>
<footer id="footer">
  <span id="status"></span>
  <span class="spacer"></span>
  <span id="selected" class="meta"></span>
  <input id="search" type="search" placeholder="search values and names" title="Finds values and property names anywhere in the file. Enter to search, Esc to clear.">
</footer>
${viewer}<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

/**
 * The Properties view in the REDcode activity bar: the selected node of the active CR2W editor, in
 * the same grid, editable. It follows the active editor tab and keeps the last CR2W document while
 * another kind of editor has focus, letting go only when that document closes.
 */
export class Cr2wPropertiesView implements vscode.WebviewViewProvider {
  static readonly viewType = "redcode.properties";
  private view: vscode.WebviewView | undefined;
  private attached: { document: Cr2wDocument; page: vscode.Disposable; closed: vscode.Disposable } | undefined;

  constructor(private readonly editor: Cr2wEditorProvider) {}

  register(): vscode.Disposable {
    return vscode.Disposable.from(
      vscode.window.registerWebviewViewProvider(Cr2wPropertiesView.viewType, this, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.window.tabGroups.onDidChangeTabs(() => this.follow()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.follow()),
      // The tab events can fire before the document is registered; the editor says when it is really showing.
      this.editor.onDidShowEditor((document) => this.follow(document)),
      new vscode.Disposable(() => this.detach()),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: this.editor.resourceRoots };
    view.webview.html = this.editor.html(view.webview, true);
    view.onDidDispose(() => {
      this.detach();
      this.view = undefined;
    });
    this.follow();
  }

  private activeDocument(): Cr2wDocument | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return input instanceof vscode.TabInputCustom && (input.viewType === Cr2wViewType || input.viewType === Cr2wOptionViewType) ? this.editor.documentFor(input.uri) : undefined;
  }

  private follow(shown?: Cr2wDocument): void {
    if (!this.view) {
      return;
    }
    const document = shown ?? this.activeDocument();
    if (!document || document === this.attached?.document) {
      if (!this.attached) void this.view.webview.postMessage({ type: "none" });
      return;
    }
    this.detach();
    const webview = this.view.webview;
    this.attached = {
      document,
      page: this.editor.attachPage(document, webview),
      closed: document.onDidDispose(() => {
        this.detach();
        void webview.postMessage({ type: "none" });
      }),
    };
    // The page asks for the document when it is ready; after a switch it has to ask again.
    void webview.postMessage({ type: "attach" });
  }

  private detach(): void {
    this.attached?.page.dispose();
    this.attached?.closed.dispose();
    this.attached = undefined;
  }
}
