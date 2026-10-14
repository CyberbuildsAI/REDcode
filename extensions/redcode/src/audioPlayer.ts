// The audio player (C5 V2): .wem files from a project or the game, exported to Ogg through REDbridge;
// .opus files as they are; and the game's sound effects, an .opusinfo opened as a list of sound events
// that plays each sound straight out of its .opuspak. WAV and Ogg files keep VS Code's own player and
// get this one under Open With. See docs/design/view.md, V2.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { audioFormat, opusSound, parseOpusInfo, wemOggFor, type OpusIndex } from "./audio";
import type { BridgeClient } from "./bridgeClient";
import type { ExportSource } from "./exportCache";
import { gamePathOfUri } from "./gameFs";

export const AudioViewType = "redcode.audio";
export const AudioOptionViewType = "redcode.audioOption";
export const SoundsViewType = "redcode.sounds";

export class AudioPlayer implements vscode.CustomReadonlyEditorProvider {
  /** Event hash to name and tags, from REDbridge's sound.events (0.7.2), loaded once. */
  private events: Promise<Map<number, { name: string; tags: string[] }> | undefined> | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly cacheRoot: string,
    private readonly getBridge: () => BridgeClient | undefined,
    private readonly log: vscode.OutputChannel,
  ) {}

  register(): vscode.Disposable {
    const options = { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true };
    return vscode.Disposable.from(
      vscode.window.registerCustomEditorProvider(AudioViewType, this, options),
      vscode.window.registerCustomEditorProvider(AudioOptionViewType, this, options),
      vscode.window.registerCustomEditorProvider(SoundsViewType, this, options),
    );
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  private requireBridge(): BridgeClient {
    const bridge = this.getBridge();
    if (!bridge?.running) throw new Error("The REDbridge process is not running. Run REDcode: Restart REDbridge, then reopen the file.");
    return bridge;
  }

  private sourceOf(uri: vscode.Uri): ExportSource {
    const gamePath = gamePathOfUri(uri);
    return gamePath ? { gamePath } : { file: uri.fsPath };
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel): void {
    const uri = document.uri;
    const source = this.sourceOf(uri);
    const name = path.basename(uri.path);
    const isIndex = name.toLowerCase().endsWith(".opusinfo");
    const webview = panel.webview;
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    webview.options = { enableScripts: true, localResourceRoots: [media] };

    let index: OpusIndex | undefined;
    /** What Save writes: the bytes now playing and a file name for them. */
    let playing: { bytes: Buffer; name: string } | undefined;

    const subtitle = source.gamePath ? `${source.gamePath}  ·  game file, read-only` : uri.fsPath;
    const sendAudio = async () => {
      const ext = path.extname(name).toLowerCase();
      let bytes: Buffer;
      let saveName = name;
      if (ext === ".wem") {
        const r = await wemOggFor(this.requireBridge(), this.cacheRoot, source);
        if (!r.cached) this.log.appendLine(`audio: exported ${name} to ${r.file}`);
        bytes = fs.readFileSync(r.file);
        saveName = name.replace(/\.wem$/i, ".ogg");
      } else {
        bytes = Buffer.from(await vscode.workspace.fs.readFile(uri));
      }
      playing = { bytes, name: saveName };
      const format = audioFormat(bytes);
      void webview.postMessage({ type: "audio", title: name, subtitle, data: bytes.toString("base64"), mime: format.mime, format });
    };

    const sendSounds = async () => {
      index = parseOpusInfo(Buffer.from(await vscode.workspace.fs.readFile(uri)));
      const events = await this.eventNames();
      const rows = index.groups
        .filter((g) => g.sounds.length > 0)
        .map((g) => {
          const e = events?.get(g.hash);
          return { n: e?.name, h: g.hash, t: e?.tags, s: g.sounds };
        })
        .sort((a, b) => (a.n && b.n ? a.n.localeCompare(b.n) : a.n ? -1 : b.n ? 1 : a.h - b.h));
      const named = rows.filter((r) => r.n).length;
      const note = events
        ? `${index.count.toLocaleString()} sounds under ${rows.length.toLocaleString()} events, ${named.toLocaleString()} of them named from WolvenKit's event list. Filter by name, tag or hash; a number plays one variation. Space plays and pauses, arrow keys step through the list.`
        : `${index.count.toLocaleString()} sounds under ${rows.length.toLocaleString()} events, by hash only: event names need REDbridge 0.7.2 (REDcode: Update REDbridge).`;
      void webview.postMessage({ type: "sounds", title: name, subtitle, rows, hashes: Array.from(index.hashes), note });
    };

    const send = () =>
      (isIndex ? sendSounds() : sendAudio()).catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        this.log.appendLine(`audio: ${name}: ${message}`);
        void webview.postMessage({ type: "error", error: message });
      });

    webview.onDidReceiveMessage(async (m: { type?: string; id?: number; index?: number; text?: string }) => {
      const reply = (body: object) => void webview.postMessage({ type: "reply", id: m.id, ...body });
      try {
        switch (m.type) {
          case "ready":
            await send();
            return;
          case "sound": {
            if (!index || m.index === undefined) throw new Error("No sound index is loaded");
            const bytes = await opusSound(this.requireBridge(), this.cacheRoot, source, index, m.index);
            playing = { bytes, name: `${index.hashes[m.index]}.opus` };
            const format = audioFormat(bytes);
            return reply({ data: bytes.toString("base64"), mime: format.mime, format });
          }
          case "copy":
            await vscode.env.clipboard.writeText(m.text ?? "");
            vscode.window.setStatusBarMessage(`$(copy) Copied ${m.text}`, 3000);
            return;
          case "save":
            await this.save(playing, uri);
            return;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.log.appendLine(`audio: ${name}: ${message}`);
        if (m.id !== undefined) reply({ error: message });
        else void vscode.window.showErrorMessage(message);
      }
    });

    // A file on disk is read again when it changes, such as after an import or a new export.
    if (uri.scheme === "file") {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), path.basename(uri.fsPath)));
      watcher.onDidChange(() => void send());
      panel.onDidDispose(() => watcher.dispose());
    }

    const nonce = Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");
    const asset = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(media, ...p));
    webview.html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; media-src blob:;">
<link rel="stylesheet" href="${asset("cr2w", "editor.css")}">
<link rel="stylesheet" href="${asset("audio", "player.css")}">
<title>${name}</title>
</head>
<body>
<header><span class="name" id="title">${name}</span><span class="meta" id="meta"></span><span class="spacer"></span><button id="copy" hidden title="Copy the hash of the sound now playing">Copy Hash</button><button id="save" disabled title="Save the sound now playing to a file">Save…</button></header>
<section class="player">
  <div class="wave"><canvas id="wave"></canvas><div class="note" id="waveNote">Loading…</div></div>
  <div class="toolbar"><button id="play">▶ Play</button><button id="loop" title="Play again from the start at the end">Loop</button><span id="time" class="dim">0:00.0 / 0:00.0</span><span id="playing"></span><span class="spacer"></span><span id="info" class="dim"></span></div>
</section>
<section id="sounds" hidden>
  <div class="toolbar"><input id="filter" type="text" placeholder="Filter: event name, tag or hash (words must all match)" spellcheck="false"><span id="count" class="dim"></span></div>
  <div id="note" hidden></div>
  <div id="list"></div>
</section>
<script nonce="${nonce}" src="${asset("audio", "player.js")}"></script>
</body>
</html>`;
  }

  private async save(playing: { bytes: Buffer; name: string } | undefined, from: vscode.Uri): Promise<void> {
    if (!playing) return;
    const folder = from.scheme === "file" ? path.dirname(from.fsPath) : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ext = path.extname(playing.name).slice(1);
    const target = await vscode.window.showSaveDialog({
      title: `Save ${playing.name}`,
      defaultUri: folder ? vscode.Uri.file(path.join(folder, playing.name)) : undefined,
      filters: { [ext.toUpperCase()]: [ext] },
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, playing.bytes);
    vscode.window.setStatusBarMessage(`$(save) Saved ${target.fsPath}`, 4000);
  }

  private eventNames(): Promise<Map<number, { name: string; tags: string[] }> | undefined> {
    this.events ??= (async () => {
      try {
        const r = await this.requireBridge().soundEvents();
        return new Map(r.events.map((e) => [e.hash, { name: e.name, tags: e.tags }]));
      } catch (e) {
        this.log.appendLine(`audio: no sound event names (${e instanceof Error ? e.message : String(e)})`);
        this.events = undefined; // try again next time, such as after Update REDbridge
        return undefined;
      }
    })();
    return this.events;
  }
}
