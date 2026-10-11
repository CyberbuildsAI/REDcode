// REDcode Core: owns the bridge process for this VS Code window and the commands that use it.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { BridgeClient } from "./bridgeClient";
import type { GameFileInfo } from "./types";

let bridge: BridgeClient | undefined;
let status: vscode.StatusBarItem;
let log: vscode.OutputChannel;
let storage: vscode.Uri;
let restartTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel("REDcode");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "redcode.showLog";
  status.show();
  storage = context.globalStorageUri;

  context.subscriptions.push(
    log,
    status,
    vscode.commands.registerCommand("redcode.openGameFileAsJson", () => withBridge(openGameFileAsJson)),
    vscode.commands.registerCommand("redcode.searchGameFiles", () => withBridge(searchGameFiles)),
    vscode.commands.registerCommand("redcode.restartBridge", () => restartBridge(context)),
    vscode.commands.registerCommand("redcode.showLog", () => log.show(true)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      // Settings often change one after another; restart once they settle.
      if (e.affectsConfiguration("redcode")) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => restartBridge(context), 800);
      }
    }),
  );

  startBridge(context);
}

export function deactivate(): void {
  bridge?.stop();
}

// ---- bridge lifecycle ---------------------------------------------------------------------

function startBridge(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("redcode");
  const configured = config.get<string>("bridgePath", "");
  const exe = resolveBridgeExe(context, configured);
  if (!exe) {
    const hint = configured ? `redcode.bridgePath is set to "${configured}", which is not REDbridge.exe.` : "Set redcode.bridgePath to REDbridge.exe.";
    setStatus("$(warning) REDcode: bridge not found", hint);
    log.appendLine(`REDbridge.exe not found. ${hint}`);
    return;
  }
  const gamePath = config.get<string>("gamePath", "");
  const dotnetRoot = config.get<string>("dotnetRoot", "") || undefined;

  const client = new BridgeClient({ exe, gamePath, dotnetRoot });
  bridge = client;
  client.on("log", (line) => log.appendLine(line));
  client.on("error", (error) => {
    if (client !== bridge) return;
    setStatus("$(error) REDcode: bridge failed to start", error.message);
    log.appendLine(`Could not start the bridge: ${error.message}`);
  });
  client.on("exit", (code) => {
    if (client !== bridge) return;
    setStatus("$(debug-disconnect) REDcode: bridge stopped", `Exit code ${code}. Run "REDcode: Restart bridge".`);
    log.appendLine(`Bridge exited with code ${code}.`);
  });
  setStatus("$(sync~spin) REDcode: starting bridge", exe);
  log.appendLine(`Starting ${exe}`);
  bridge.start();

  bridge
    .info()
    .then((info) => {
      if (info.gameLoaded) {
        setStatus(`$(circuit-board) REDcode ${info.files.toLocaleString()} files`, `${info.archives} archives from ${info.gameDir}\nREDbridge ${info.version}, WolvenKit ${info.wolvenKit}`);
      } else {
        setStatus("$(warning) REDcode: no game loaded", "Set redcode.gamePath to the Cyberpunk 2077 folder");
      }
    })
    .catch((e) => {
      setStatus("$(error) REDcode: bridge error", String(e));
      log.appendLine(`bridge.info failed: ${e}`);
    });
}

function restartBridge(context: vscode.ExtensionContext): void {
  bridge?.stop();
  bridge = undefined;
  startBridge(context);
}

/** The configured path (a file, or a folder containing REDbridge.exe), else a bridge bundled under the extension, else REDbridge on PATH. */
function resolveBridgeExe(context: vscode.ExtensionContext, configured: string): string | undefined {
  if (configured) {
    const asFile = isFile(configured) ? configured : undefined;
    const inFolder = path.join(configured, "REDbridge.exe");
    return asFile ?? (isFile(inFolder) ? inFolder : undefined);
  }
  const bundled = path.join(context.extensionPath, "bridge", "REDbridge.exe");
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, "REDbridge.exe");
    if (dir && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

async function withBridge(action: (b: BridgeClient) => Promise<void>): Promise<void> {
  if (!bridge?.running) {
    const pick = await vscode.window.showWarningMessage("The REDbridge process is not running.", "Restart bridge", "Show log");
    if (pick === "Show log") {
      log.show(true);
    } else if (pick === "Restart bridge") {
      await vscode.commands.executeCommand("redcode.restartBridge");
    }
    return;
  }
  try {
    await action(bridge);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.appendLine(`Error: ${message}`);
    void vscode.window.showErrorMessage(`REDcode: ${message}`);
  }
}

function setStatus(text: string, tooltip: string): void {
  status.text = text;
  status.tooltip = tooltip;
}

// ---- commands -----------------------------------------------------------------------------

/** Search-as-you-type over the archives. Resolves with the chosen file, or undefined. */
async function pickGameFile(b: BridgeClient, placeholder: string): Promise<GameFileInfo | undefined> {
  const picker = vscode.window.createQuickPick<vscode.QuickPickItem & { file: GameFileInfo }>();
  picker.placeholder = placeholder;
  picker.matchOnDescription = true;
  let timer: NodeJS.Timeout | undefined;
  let latest = 0;

  const update = async (query: string) => {
    const mine = ++latest;
    if (query.trim().length < 3) {
      picker.items = [];
      picker.title = "Type at least 3 characters";
      return;
    }
    picker.busy = true;
    try {
      const result = await b.search(query.trim(), 200);
      if (mine !== latest) {
        return;
      }
      picker.title = `${result.total.toLocaleString()} matches${result.total > result.items.length ? `, showing ${result.items.length}` : ""}`;
      picker.items = result.items.map((file) => ({
        label: path.basename(file.name),
        description: path.dirname(file.name),
        detail: `${file.archive}  ${file.size.toLocaleString()} bytes`,
        file,
      }));
    } finally {
      if (mine === latest) {
        picker.busy = false;
      }
    }
  };

  picker.onDidChangeValue((value) => {
    clearTimeout(timer);
    timer = setTimeout(() => void update(value), 150);
  });

  return new Promise((resolve) => {
    picker.onDidAccept(() => {
      resolve(picker.selectedItems[0]?.file);
      picker.hide();
    });
    picker.onDidHide(() => {
      resolve(undefined);
      picker.dispose();
    });
    picker.show();
  });
}

async function openGameFileAsJson(b: BridgeClient): Promise<void> {
  const file = await pickGameFile(b, "Search game files (name or path), then pick one to open as JSON");
  if (!file) {
    return;
  }
  await fs.promises.mkdir(storage.fsPath, { recursive: true });
  const outFile = path.join(storage.fsPath, "json", `${file.name}.json`);
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Converting ${path.basename(file.name)}` }, async () => {
    const result = await b.toJson(file.name, outFile);
    log.appendLine(`cr2w.toJson ${file.name} -> ${result.file} (${result.bytes.toLocaleString()} bytes)`);
  });
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(outFile));
  await vscode.languages.setTextDocumentLanguage(doc, "json");
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function searchGameFiles(b: BridgeClient): Promise<void> {
  const file = await pickGameFile(b, "Search game files (name or path)");
  if (!file) {
    return;
  }
  const action = await vscode.window.showInformationMessage(`${file.name}\n${file.archive}, ${file.size.toLocaleString()} bytes, hash ${file.hash}`, { modal: false }, "Open as JSON", "Copy path");
  if (action === "Open as JSON") {
    await vscode.commands.executeCommand("redcode.openGameFileAsJson");
  } else if (action === "Copy path") {
    await vscode.env.clipboard.writeText(file.name);
  }
}
