// REDcode Core: owns the bridge process for this VS Code window, the project, and the views.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { AssetBrowser, type AssetNode } from "./assetBrowser";
import { BridgeClient } from "./bridgeClient";
import { checkDotnetRuntime, DotnetDownloadUrl, DotnetInstallCommand, findCheckout, installRelease, latestRelease, managedDir, updateCheckout } from "./bridgeUpdater";
import { Cr2wEditorProvider, Cr2wPropertiesView, Cr2wViewType, opensInCr2wEditor } from "./cr2wEditor";
import { GameFileSystem, gameUri } from "./gameFs";
import { compareJson, formatDifference, type JsonComparison } from "./jsonDiff";
import { createProject, findProject, gamePathOf, projectPathFor, type ProjectInfo } from "./project";
import { ProjectExplorer, type ProjectNode } from "./projectExplorer";
import { isTexture, TextureViewer, TextureViewType } from "./textureViewer";
import type { BridgeInfo, GameFileInfo } from "./types";

/**
 * The oldest REDbridge this extension works with: it needs archive.tree, extractMany and cr2w.fileToJson.
 * Project textures also need texture.fileToPng (0.3.0); the viewer says so when the bridge is older.
 */
const MinBridgeVersion = "0.2.0";

let bridge: BridgeClient | undefined;
let project: ProjectInfo | undefined;
let status: vscode.StatusBarItem;
let log: vscode.OutputChannel;
let storage: vscode.Uri;
let restartTimer: NodeJS.Timeout | undefined;
let assets: AssetBrowser;
let explorer: ProjectExplorer;
let projectView: vscode.TreeView<ProjectNode>;
let textures: TextureViewer;
let watcher: vscode.FileSystemWatcher | undefined;
/** The last bridge.info from the running bridge, for version comparisons. */
let lastInfo: BridgeInfo | undefined;
/** True while Update bridge owns the bridge process, so a settings change does not restart it underneath. */
let updating = false;
/** Prompts shown once per session. */
let offeredInstall = false;
let offeredUpdate = false;
let offeredDotnet = false;

export function activate(context: vscode.ExtensionContext): void {
  log = vscode.window.createOutputChannel("REDcode");
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "redcode.showLog";
  status.show();
  storage = context.globalStorageUri;

  assets = new AssetBrowser(() => bridge);
  explorer = new ProjectExplorer(() => project);
  textures = new TextureViewer(() => bridge, storage, log);
  const cr2w = new Cr2wEditorProvider(
    context,
    () => bridge,
    log,
    textures,
    (file) => void withBridge((b) => openProjectFileAsJson(b, { kind: "file", file })),
    (gamePath) => void withBridge((b) => openJsonOf(b, gamePath)),
  );
  const gameFs = new GameFileSystem(() => bridge, path.join(storage.fsPath, "cache"));

  context.subscriptions.push(
    log,
    status,
    gameFs.register(),
    vscode.commands.registerCommand("redcode.openAssetInEditor", (node: AssetNode) => openAssetInEditor(node)),
    vscode.window.createTreeView("redcode.assets", { treeDataProvider: assets, showCollapseAll: true }),
    (projectView = vscode.window.createTreeView("redcode.project", { treeDataProvider: explorer, showCollapseAll: true })),
    textures.register(),
    cr2w.register(),
    new Cr2wPropertiesView(cr2w).register(),
    vscode.commands.registerCommand("redcode.openTexture", (node: AssetNode) => withBridge((b) => openTexture(b, node))),
    vscode.commands.registerCommand("redcode.openGameFileAsJson", () => withBridge(openGameFileAsJson)),
    vscode.commands.registerCommand("redcode.searchGameFiles", () => withBridge(searchGameFiles)),
    vscode.commands.registerCommand("redcode.openAssetAsJson", (node: AssetNode) => withBridge((b) => openAssetAsJson(b, node))),
    vscode.commands.registerCommand("redcode.addToProject", (node: AssetNode) => withBridge((b) => addToProject(b, node))),
    vscode.commands.registerCommand("redcode.extractTo", (node: AssetNode) => withBridge((b) => extractTo(b, node))),
    vscode.commands.registerCommand("redcode.copyAssetPath", (node: AssetNode) => copyAssetPath(node)),
    vscode.commands.registerCommand("redcode.openProjectFile", (node: ProjectNode) => openProjectFile(node)),
    vscode.commands.registerCommand("redcode.openProjectFileAsJson", (node: ProjectNode) => withBridge((b) => openProjectFileAsJson(b, node))),
    vscode.commands.registerCommand("redcode.revealInExplorer", (node: ProjectNode) => revealInExplorer(node)),
    vscode.commands.registerCommand("redcode.deleteProjectFile", (node: ProjectNode) => deleteProjectFile(node)),
    vscode.commands.registerCommand("redcode.saveJsonToProject", () => withBridge(saveJsonToProject)),
    vscode.commands.registerCommand("redcode.newProject", () => newProject()),
    vscode.commands.registerCommand("redcode.refreshProject", () => detectProject()),
    vscode.commands.registerCommand("redcode.refreshAssets", () => assets.refresh()),
    vscode.commands.registerCommand("redcode.restartBridge", () => restartBridge(context)),
    vscode.commands.registerCommand("redcode.updateBridge", () => updateBridge(context, false)),
    vscode.commands.registerCommand("redcode.installBridge", () => updateBridge(context, true)),
    vscode.commands.registerCommand("redcode.showLog", () => log.show(true)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => detectProject()),
    vscode.window.onDidChangeActiveTextEditor(() => updateJsonContext()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      // Settings often change one after another; restart once they settle.
      if (e.affectsConfiguration("redcode") && !updating) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => restartBridge(context), 800);
      }
    }),
  );

  detectProject();
  startBridge(context);
}

export function deactivate(): void {
  bridge?.stop();
  watcher?.dispose();
}

// ---- project ------------------------------------------------------------------------------

function detectProject(): void {
  const folders = vscode.workspace.workspaceFolders ?? [];
  project = undefined;
  for (const folder of folders) {
    project = findProject(folder.uri.fsPath);
    if (project) {
      break;
    }
  }
  void vscode.commands.executeCommand("setContext", "redcode.projectOpen", project !== undefined);

  watcher?.dispose();
  watcher = undefined;
  if (project) {
    log.appendLine(`Project: ${project.name} (${project.file})`);
    watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(project.dir, "{source,packed}/**"));
    const refresh = () => explorer.refresh();
    watcher.onDidCreate(refresh);
    watcher.onDidDelete(refresh);
    watcher.onDidChange(refresh);
  }
  explorer.refresh();
  updateStatus();
  updateJsonContext();
}

async function newProject(): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "Project name (also the mod's name)",
    placeHolder: "MyMod",
    validateInput: (v) => (/^[A-Za-z0-9 _\-]+$/.test(v.trim()) ? undefined : "Letters, digits, spaces, - and _ only"),
  });
  if (!name) {
    return;
  }
  const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "Create project here", title: "Choose where to create the project folder" });
  if (!picked?.[0]) {
    return;
  }
  const dir = path.join(picked[0].fsPath, name.trim());
  const author = vscode.workspace.getConfiguration("redcode").get<string>("author", "");
  const created = createProject(dir, name.trim(), author);
  log.appendLine(`Created project ${created.file}`);
  await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(dir), { forceNewWindow: false });
}

function requireProject(): ProjectInfo {
  if (!project) {
    throw new Error("No project is open. Open a folder with a .cpmodproj file, or run REDcode: New Project.");
  }
  return project;
}

// ---- bridge lifecycle ---------------------------------------------------------------------

/** Starts the bridge from the settings. onReady runs once bridge.info has answered and the version is acceptable. */
function startBridge(context: vscode.ExtensionContext, onReady?: (info: BridgeInfo) => void): void {
  const config = vscode.workspace.getConfiguration("redcode");
  const configured = config.get<string>("bridgePath", "");
  const exe = resolveBridgeExe(context, configured);
  if (!exe) {
    const hint = configured ? `redcode.bridgePath is set to "${configured}", which is not REDbridge.exe.` : "Run REDcode: Install bridge, or set redcode.bridgePath to REDbridge.exe.";
    setGameLoaded(false);
    updateStatus("$(warning) REDcode: bridge not found", hint);
    log.appendLine(`REDbridge.exe not found. ${hint}`);
    if (!offeredInstall) {
      offeredInstall = true;
      void vscode.window
        .showInformationMessage("REDcode needs REDbridge, the local process that hosts WolvenKit's engine. Install the latest release?", "Install bridge", "Show log")
        .then((pick) => {
          if (pick === "Install bridge") void updateBridge(context, true);
          else if (pick === "Show log") log.show(true);
        });
    }
    return;
  }
  const gamePath = config.get<string>("gamePath", "");
  const dotnetRoot = config.get<string>("dotnetRoot", "") || undefined;

  const client = new BridgeClient({ exe, gamePath, dotnetRoot });
  bridge = client;
  client.on("log", (line) => log.appendLine(line));
  client.on("error", (error) => {
    if (client !== bridge) return;
    setGameLoaded(false);
    updateStatus("$(error) REDcode: bridge failed to start", error.message);
    log.appendLine(`Could not start the bridge: ${error.message}`);
    void explainStartFailure(dotnetRoot);
  });
  client.on("exit", (code) => {
    if (client !== bridge) return;
    setGameLoaded(false);
    updateStatus("$(debug-disconnect) REDcode: bridge stopped", `Exit code ${code}. Run "REDcode: Restart bridge".`);
    log.appendLine(`Bridge exited with code ${code}.`);
    if (code !== 0) void explainStartFailure(dotnetRoot);
  });
  setGameLoaded(false);
  updateStatus("$(sync~spin) REDcode: starting bridge", exe);
  log.appendLine(`Starting ${exe}`);
  client.start();

  client
    .info()
    .then((info) => {
      if (client !== bridge) return;
      if (compareVersions(info.version, MinBridgeVersion) < 0) {
        setGameLoaded(false);
        updateStatus("$(warning) REDcode: bridge is out of date", `REDbridge ${info.version} found, ${MinBridgeVersion} or later needed. Run "npm run update" in the REDbridge folder, then "REDcode: Restart bridge".`);
        log.appendLine(`REDbridge ${info.version} is older than this extension needs (${MinBridgeVersion}). Run "npm run update" in the REDbridge folder, then restart the bridge.`);
        void vscode.window
          .showWarningMessage(`REDcode: REDbridge ${info.version} is older than this extension needs (${MinBridgeVersion}).`, "Update bridge", "Show log")
          .then((pick) => {
            if (pick === "Update bridge") void updateBridge(context, false);
            else if (pick === "Show log") log.show(true);
          });
        return;
      }
      lastInfo = info;
      onReady?.(info);
      void checkForNewerRelease(exe, info.version);
      if (info.gameLoaded) {
        bridgeSummary = `${info.files.toLocaleString()} files`;
        bridgeTooltip = `${info.archives} archives from ${info.gameDir}\nREDbridge ${info.version}, WolvenKit ${info.wolvenKit}`;
        setGameLoaded(true);
        updateStatus();
        assets.refresh();
      } else {
        setGameLoaded(false);
        updateStatus("$(warning) REDcode: no game loaded", "Set redcode.gamePath to the Cyberpunk 2077 folder");
      }
    })
    .catch((e) => {
      if (client !== bridge) return;
      updateStatus("$(error) REDcode: bridge error", String(e));
      log.appendLine(`bridge.info failed: ${e}`);
    });
}

function restartBridge(context: vscode.ExtensionContext, onReady?: (info: BridgeInfo) => void): void {
  bridge?.stop();
  bridge = undefined;
  lastInfo = undefined;
  startBridge(context, onReady);
}

/** Stops the bridge and waits for the process to go, so its exe can be replaced. */
async function stopBridgeAndWait(): Promise<void> {
  const client = bridge;
  bridge = undefined;
  lastInfo = undefined;
  setGameLoaded(false);
  if (client) {
    await client.stopAndWait();
  }
}

// ---- bridge update and install --------------------------------------------------------------

/**
 * Update bridge and Install bridge. Stops the bridge, replaces it, starts it again and reports the
 * versions. A bridge that runs from a git checkout is pulled and rebuilt there, which is the
 * developer's path; forceRelease skips that. Anything else gets the latest GitHub release unpacked
 * under the extension's storage, with redcode.bridgePath pointed at it, so nobody types a path.
 */
async function updateBridge(context: vscode.ExtensionContext, forceRelease: boolean): Promise<void> {
  if (updating) {
    void vscode.window.showInformationMessage("REDcode: a bridge update is already running.");
    return;
  }
  updating = true;
  clearTimeout(restartTimer);
  const config = vscode.workspace.getConfiguration("redcode");
  const exe = resolveBridgeExe(context, config.get<string>("bridgePath", ""));
  const checkout = exe && !forceRelease ? findCheckout(exe) : undefined;
  const before = lastInfo?.version;
  const appendLine = (line: string) => log.appendLine(line);
  let stopped = false;
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: checkout ? "REDcode: updating the bridge from its checkout" : "REDcode: installing REDbridge" },
      async (progress) => {
        let shown = 0;
        const report = (message: string, fraction?: number) => {
          const pct = fraction === undefined ? undefined : Math.round(fraction * 100);
          progress.report({ message, increment: pct === undefined ? undefined : pct - shown });
          if (pct !== undefined) shown = pct;
        };
        if (checkout) {
          report("stopping the bridge");
          await stopBridgeAndWait();
          stopped = true;
          updateStatus("$(sync~spin) REDcode: updating bridge", checkout);
          log.appendLine(`Updating the bridge checkout at ${checkout} (npm run update)`);
          await updateCheckout(checkout, appendLine, report);
          return;
        }
        report("asking GitHub for the latest release");
        const release = await latestRelease(config.get<string>("bridgeRepository", "Edgemodders/REDbridge"));
        if (!forceRelease && before && compareVersions(release.version, before) <= 0) {
          log.appendLine(`REDbridge ${before} is the latest release (${release.tag}).`);
          void vscode.window.showInformationMessage(`REDcode: REDbridge ${before} is already the latest release.`);
          return;
        }
        await stopBridgeAndWait();
        stopped = true;
        updateStatus("$(sync~spin) REDcode: installing bridge", release.url);
        const installed = await installRelease(release, managedDir(storage.fsPath, release.version), appendLine, report);
        await config.update("bridgePath", installed, vscode.ConfigurationTarget.Global);
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.appendLine(`Bridge update failed: ${message}`);
    void vscode.window.showErrorMessage(`REDcode: the bridge update failed. ${message}`, "Show log").then((pick) => pick && log.show(true));
  }
  if (stopped) {
    restartBridge(context, (info) => {
      const text = before && before !== info.version ? `REDcode: REDbridge ${before} → ${info.version}.` : `REDcode: REDbridge ${info.version} is running.`;
      log.appendLine(text);
      void vscode.window.showInformationMessage(text);
    });
  }
  // The settings change above fires its event before update() resolves, but a late one must not restart the bridge twice.
  setTimeout(() => (updating = false), 1000);
}

/** Once per session, asks GitHub whether a newer release exists than the running bridge. Not for checkouts, which are usually ahead. */
async function checkForNewerRelease(exe: string, current: string): Promise<void> {
  const config = vscode.workspace.getConfiguration("redcode");
  if (offeredUpdate || !config.get<boolean>("bridgeUpdateCheck", true) || findCheckout(exe)) {
    return;
  }
  offeredUpdate = true;
  try {
    const release = await latestRelease(config.get<string>("bridgeRepository", "Edgemodders/REDbridge"));
    if (compareVersions(release.version, current) > 0) {
      log.appendLine(`REDbridge ${release.version} is available; ${current} is running.`);
      const pick = await vscode.window.showInformationMessage(`REDcode: REDbridge ${release.version} is available; ${current} is running.`, "Update bridge", "Release notes");
      if (pick === "Update bridge") void vscode.commands.executeCommand("redcode.updateBridge");
      else if (pick === "Release notes") void vscode.env.openExternal(vscode.Uri.parse(release.url));
    }
  } catch (e) {
    log.appendLine(`Update check skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** After the bridge fails to start: when no .NET 10 runtime is installed, say so and offer the install. */
async function explainStartFailure(dotnetRoot: string | undefined): Promise<void> {
  if (offeredDotnet) {
    return;
  }
  const check = await checkDotnetRuntime(dotnetRoot);
  if (check.ok) {
    return;
  }
  offeredDotnet = true;
  log.appendLine(`No .NET 10 runtime found through ${check.dotnet}${check.runtimes.length ? `; installed: ${check.runtimes.join("; ")}` : ""}.`);
  const pick = await vscode.window.showErrorMessage("REDcode: the bridge needs the .NET 10 runtime, which is not installed.", "Install with winget", "Download page", "Show log");
  if (pick === "Install with winget") {
    const terminal = vscode.window.createTerminal("REDcode: install .NET 10");
    terminal.show();
    terminal.sendText(DotnetInstallCommand, true);
    void vscode.window.showInformationMessage("REDcode: when winget has finished, run REDcode: Restart bridge.");
  } else if (pick === "Download page") {
    void vscode.env.openExternal(vscode.Uri.parse(DotnetDownloadUrl));
  } else if (pick === "Show log") {
    log.show(true);
  }
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

/** Compares dotted version strings numerically: negative when a is older than b. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
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

// ---- status -------------------------------------------------------------------------------

let bridgeSummary = "";
let bridgeTooltip = "";

function setGameLoaded(loaded: boolean): void {
  void vscode.commands.executeCommand("setContext", "redcode.gameLoaded", loaded);
}

/** With no arguments, shows the normal state: project name and bridge summary. */
function updateStatus(text?: string, tooltip?: string): void {
  if (text !== undefined) {
    status.text = text;
    status.tooltip = tooltip;
    return;
  }
  const parts = [project ? `$(package) ${project.name}` : "$(circuit-board) REDcode", bridgeSummary].filter(Boolean);
  status.text = parts.join("  ");
  status.tooltip = [project ? `Project: ${project.file}` : "No project open", bridgeTooltip].filter(Boolean).join("\n");
}

// ---- commands: game assets ----------------------------------------------------------------

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

async function openJsonOf(b: BridgeClient, gamePath: string): Promise<void> {
  const outFile = path.join(storage.fsPath, "json", `${gamePath}.json`);
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Converting ${path.basename(gamePath)}` }, async () => {
    const result = await b.toJson(gamePath, outFile);
    log.appendLine(`cr2w.toJson ${gamePath} -> ${result.file} (${result.bytes.toLocaleString()} bytes)`);
  });
  await showJson(outFile);
}

async function showJson(file: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.languages.setTextDocumentLanguage(doc, "json");
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function openGameFileAsJson(b: BridgeClient): Promise<void> {
  const file = await pickGameFile(b, "Search game files (name or path), then pick one to open as JSON");
  if (file) {
    await openJsonOf(b, file.name);
  }
}

/** Opens a game file in the CR2W editor, read-only, straight from the archives through the redcode-game scheme. */
async function openAssetInEditor(node: AssetNode): Promise<void> {
  if (node.kind !== "file") {
    return;
  }
  if (!bridge?.running) {
    await withBridge(async () => undefined);
    return;
  }
  await vscode.commands.executeCommand("vscode.openWith", gameUri(node.file.name), Cr2wViewType);
}

async function openAssetAsJson(b: BridgeClient, node: AssetNode): Promise<void> {
  if (node.kind === "file") {
    await openJsonOf(b, node.file.name);
  }
}

async function searchGameFiles(b: BridgeClient): Promise<void> {
  const file = await pickGameFile(b, "Search game files (name or path)");
  if (!file) {
    return;
  }
  const action = await vscode.window.showInformationMessage(`${file.name}\n${file.archive}, ${file.size.toLocaleString()} bytes, hash ${file.hash}`, "Open as JSON", project ? "Add to project" : "Copy path", "Copy path");
  if (action === "Open as JSON") {
    await openJsonOf(b, file.name);
  } else if (action === "Add to project") {
    await addToProject(b, { kind: "file", file });
  } else if (action === "Copy path") {
    await vscode.env.clipboard.writeText(file.name);
  }
}

/** The files a node stands for: one file, or everything under a folder. */
async function filesOf(b: BridgeClient, node: AssetNode, title: string): Promise<GameFileInfo[]> {
  if (node.kind === "file") {
    return [node.file];
  }
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `${title}: listing ${node.name}` }, (progress) =>
    assets.collect(b, node.path, (n) => progress.report({ message: `${n.toLocaleString()} files` })),
  );
}

async function addToProject(b: BridgeClient, node: AssetNode): Promise<void> {
  const p = requireProject();
  const files = await filesOf(b, node, "Add to project");
  if (node.kind === "folder" && files.length > 200) {
    const ok = await vscode.window.showWarningMessage(`Add ${files.length.toLocaleString()} files from ${node.path} to ${p.name}?`, { modal: true }, "Add");
    if (ok !== "Add") {
      return;
    }
  }
  const items = files.map((f) => ({ path: f.name, outFile: projectPathFor(p, f.name) }));
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Adding ${items.length.toLocaleString()} file(s) to ${p.name}` }, () => b.extractMany(items));
  log.appendLine(`Added ${result.extracted} file(s), ${result.bytes.toLocaleString()} bytes, to ${p.name}${result.failed.length ? `; failed: ${result.failed.join(", ")}` : ""}`);
  explorer.refresh();
  // Show what was added in the Project view, expanded down to it: editing it is the likely next step.
  const added = explorer.nodeFor(node.kind === "folder" ? projectPathFor(p, node.path) : items[0]?.outFile ?? "");
  if (added && result.extracted > 0) {
    await projectView.reveal(added, { select: true, focus: false, expand: node.kind === "folder" }).then(undefined, (e) => log.appendLine(`Could not reveal ${JSON.stringify(added)}: ${e}`));
  }
  if (result.failed.length) {
    void vscode.window.showWarningMessage(`REDcode: ${result.failed.length} file(s) could not be added. See the log.`);
  } else if (node.kind === "folder") {
    void vscode.window.showInformationMessage(`Added ${result.extracted.toLocaleString()} files to ${p.name}.`);
  }
}

async function extractTo(b: BridgeClient, node: AssetNode): Promise<void> {
  const picked = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: "Extract here", title: "Choose a folder to extract into" });
  if (!picked?.[0]) {
    return;
  }
  const root = picked[0].fsPath;
  const files = await filesOf(b, node, "Extract");
  const items = files.map((f) => ({ path: f.name, outFile: path.join(root, ...f.name.split("\\")) }));
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Extracting ${items.length.toLocaleString()} file(s)` }, () => b.extractMany(items));
  log.appendLine(`Extracted ${result.extracted} file(s), ${result.bytes.toLocaleString()} bytes, to ${root}${result.failed.length ? `; failed: ${result.failed.join(", ")}` : ""}`);
  void vscode.window.showInformationMessage(`Extracted ${result.extracted.toLocaleString()} file(s) to ${root}.`);
}

/** Converts an archive texture to PNG and shows it in the viewer. */
async function openTexture(b: BridgeClient, node: AssetNode): Promise<void> {
  if (node.kind !== "file") {
    return;
  }
  const f = node.file;
  const png = textures.pngForGamePath(f.name);
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Converting ${path.basename(f.name)}` }, async () => {
    const result = await b.toPng(f.name, png);
    log.appendLine(`texture.toPng ${f.name} -> ${result.file} (${result.bytes.toLocaleString()} bytes)`);
  });
  textures.show({ title: path.basename(f.name), subtitle: `${f.name}  ${f.archive}  ${f.size.toLocaleString()} bytes`, png });
}

async function copyAssetPath(node: AssetNode): Promise<void> {
  await vscode.env.clipboard.writeText(node.kind === "file" ? node.file.name : node.path);
}

// ---- commands: project files --------------------------------------------------------------

const TextLike = new Set([".json", ".yaml", ".yml", ".tweak", ".reds", ".lua", ".txt", ".md", ".xml", ".csv", ".xl", ".ini", ".toml", ".js", ".ts"]);

async function openProjectFile(node: ProjectNode): Promise<void> {
  if (node.kind !== "file") {
    return;
  }
  if (isTexture(node.file)) {
    await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(node.file), TextureViewType);
    return;
  }
  if (opensInCr2wEditor(node.file)) {
    await vscode.commands.executeCommand("vscode.openWith", vscode.Uri.file(node.file), Cr2wViewType);
    return;
  }
  const ext = path.extname(node.file).toLowerCase();
  const inArchive = project ? gamePathOf(project, node.file) !== undefined : false;
  if (inArchive && !TextLike.has(ext)) {
    await withBridge((b) => openProjectFileAsJson(b, node));
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.file(node.file), { preview: true });
}

async function openProjectFileAsJson(b: BridgeClient, node: ProjectNode): Promise<void> {
  if (node.kind !== "file") {
    return;
  }
  const p = requireProject();
  const rel = path.relative(p.dir, node.file);
  const outFile = path.join(storage.fsPath, "project-json", p.name, `${rel}.json`);
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Converting ${path.basename(node.file)}` }, async () => {
    const result = await b.fileToJson(node.file, outFile);
    log.appendLine(`cr2w.fileToJson ${rel} -> ${result.file} (${result.bytes.toLocaleString()} bytes)`);
  });
  jsonSources.set(pathKey(outFile), node.file);
  await showJson(outFile);
  updateJsonContext();
}

// ---- commands: JSON back to the project ---------------------------------------------------

/** JSON files written by openProjectFileAsJson, and the project file each one came from. */
const jsonSources = new Map<string, string>();

/** Windows paths compare without case, and VS Code lowercases drive letters. */
function pathKey(file: string): string {
  const normal = path.normalize(file);
  return process.platform === "win32" ? normal.toLowerCase() : normal;
}

/** The project file a JSON document stands for, or undefined when it did not come from the open project. */
function projectFileOfJson(jsonFile: string): string | undefined {
  const known = jsonSources.get(pathKey(jsonFile));
  if (known) {
    return known;
  }
  // After a restart the map is empty, but the JSON file's location still says where it came from:
  // <storage>/project-json/<project name>/<path relative to the project>.json
  if (!project) {
    return undefined;
  }
  const base = path.join(storage.fsPath, "project-json", project.name);
  const rel = path.relative(base, jsonFile);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || !rel.toLowerCase().endsWith(".json")) {
    return undefined;
  }
  return path.join(project.dir, rel.slice(0, -".json".length));
}

/** Tells the editor title and context menus whether the active document can be saved back to the project. */
function updateJsonContext(): void {
  const doc = vscode.window.activeTextEditor?.document;
  const editable = doc?.uri.scheme === "file" && projectFileOfJson(doc.uri.fsPath) !== undefined;
  void vscode.commands.executeCommand("setContext", "redcode.jsonFromProject", editable);
}

/** Rebuilds the CR2W file in the project from the JSON document in the active editor. */
async function saveJsonToProject(b: BridgeClient): Promise<void> {
  const doc = vscode.window.activeTextEditor?.document;
  if (!doc || doc.uri.scheme !== "file") {
    void vscode.window.showWarningMessage("REDcode: open a JSON document that came from a project file first.");
    return;
  }
  const p = requireProject();
  const target = projectFileOfJson(doc.uri.fsPath);
  if (!target || !fs.existsSync(target)) {
    void vscode.window.showWarningMessage("REDcode: this JSON did not come from a file in the open project, so there is nowhere to save it.");
    return;
  }
  if (doc.isDirty && !(await doc.save())) {
    return;
  }
  let saved: unknown;
  try {
    saved = JSON.parse(doc.getText());
  } catch (e) {
    void vscode.window.showErrorMessage(`REDcode: the document is not valid JSON. ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  const rel = path.relative(p.dir, target);
  const ok = await vscode.window.showWarningMessage(`Overwrite ${rel} in ${p.name} with this JSON?`, { modal: true, detail: "The bridge rebuilds the file from the JSON, then reads it back so the editor shows what the format kept. Keep a copy if you need the original." }, "Overwrite");
  if (ok !== "Overwrite") {
    return;
  }
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Writing ${path.basename(target)}` }, async () => {
    const written = await b.fromJson(target, { jsonFile: doc.uri.fsPath });
    log.appendLine(`cr2w.fromJson ${doc.uri.fsPath} -> ${written.file} (${written.bytes.toLocaleString()} bytes)`);
    // Read the file back into the same document, so the editor shows what the file really holds, and
    // compare it with what was saved. Edits the format cannot keep (32-bit floats, compiledData rebuilt
    // from components, see the README) are reported instead of vanishing silently.
    await b.fileToJson(target, doc.uri.fsPath);
    return written;
  });
  explorer.refresh();
  const comparison = compareJson(saved, JSON.parse(fs.readFileSync(doc.uri.fsPath, "utf8")));
  reportSave(rel, result.bytes, comparison);
}

/** Tells the user what the written file kept, with the details in the log. */
function reportSave(rel: string, bytes: number, c: JsonComparison): void {
  for (const d of c.lost) {
    log.appendLine(`  not kept: ${formatDifference(d)}`);
  }
  for (const d of c.regenerated) {
    log.appendLine(`  regenerated: ${formatDifference(d)}`);
  }
  const size = `${bytes.toLocaleString()} bytes`;
  const short = (d: { path: string }) => d.path.replace(/^Data\.RootChunk\./, "");
  if (c.lost.length > 0) {
    const first = c.lost.slice(0, 3).map(short).join(", ") + (c.lost.length > 3 ? ", ..." : "");
    void vscode.window
      .showWarningMessage(`REDcode: ${rel} was written (${size}), but ${c.lost.length} value(s) did not survive: ${first}. See the log.`, "Show log")
      .then((pick) => pick && log.show(true));
  } else if (c.regenerated.length > 0) {
    void vscode.window.showInformationMessage(`Saved ${rel} (${size}). compiledData was rebuilt from components, so ${c.regenerated.length} value(s) there differ from the JSON you saved. Edit components, not compiledData.`);
  } else {
    void vscode.window.showInformationMessage(`Saved ${rel} (${size}). The file reads back exactly as saved.`);
  }
}

async function revealInExplorer(node: ProjectNode): Promise<void> {
  const target = node.kind === "file" ? node.file : node.dir;
  await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(target));
}

/** Deletes a project file or folder after a confirmation, to the Recycle Bin so a slip can be undone. */
async function deleteProjectFile(node: ProjectNode): Promise<void> {
  if (node.kind === "root") {
    return;
  }
  const p = requireProject();
  const target = node.kind === "file" ? node.file : node.dir;
  const shown = path.relative(p.dir, target);
  const inside = node.kind === "folder" ? countFilesUnder(target) : 0;
  const what = node.kind === "folder" ? `the folder ${shown} and the ${inside.toLocaleString()} file${inside === 1 ? "" : "s"} in it` : shown;
  const pick = await vscode.window.showWarningMessage(`Delete ${what} from ${p.name}?`, { modal: true, detail: "It goes to the Recycle Bin." }, "Delete");
  if (pick !== "Delete") {
    return;
  }
  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(target), { recursive: node.kind === "folder", useTrash: true });
    log.appendLine(`Deleted ${target} (to the Recycle Bin)`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.appendLine(`Could not delete ${target}: ${message}`);
    void vscode.window.showErrorMessage(`REDcode: could not delete ${shown}. ${message}`);
  }
  explorer.refresh();
}

function countFilesUnder(dir: string): number {
  let n = 0;
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) pending.push(path.join(current, e.name));
      else n++;
    }
  }
  return n;
}
