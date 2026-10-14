// A read-only file system over the game archives, scheme redcode-game. The CR2W editor opens game
// files through it straight from the bridge, with no extracted copy; VS Code sees a read-only file
// and shows the lock on the tab. Reads that need bytes (a text editor, for instance) extract into
// the extension's cache.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { BridgeClient } from "./bridgeClient";

export const GameScheme = "redcode-game";

/** redcode-game:/base/gameplay/x.ent for base\gameplay\x.ent. */
export function gameUri(gamePath: string): vscode.Uri {
  return vscode.Uri.from({ scheme: GameScheme, path: "/" + gamePath.replace(/\\/g, "/") });
}

/** The game path (with backslashes) of a redcode-game URI, or undefined for any other scheme. */
export function gamePathOfUri(uri: vscode.Uri): string | undefined {
  return uri.scheme === GameScheme ? uri.path.replace(/^\/+/, "").replace(/\//g, "\\") : undefined;
}

export class GameFileSystem implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;

  constructor(
    private readonly getBridge: () => BridgeClient | undefined,
    /** Where extracted bytes go: <cacheDir>/<game path>. */
    private readonly cacheDir: string,
  ) {}

  register(): vscode.Disposable {
    return vscode.Disposable.from(vscode.workspace.registerFileSystemProvider(GameScheme, this, { isCaseSensitive: false, isReadonly: true }), this.emitter);
  }

  private bridge(): BridgeClient {
    const bridge = this.getBridge();
    if (!bridge?.running) {
      throw vscode.FileSystemError.Unavailable("The REDbridge process is not running.");
    }
    return bridge;
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const gamePath = gamePathOfUri(uri) ?? "";
    const bridge = this.bridge();
    if (gamePath === "") {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0, permissions: vscode.FilePermission.Readonly };
    }
    const files = await bridge.list({ prefix: gamePath, limit: 5 });
    const hit = files.items.find((f) => f.name.toLowerCase() === gamePath.toLowerCase());
    if (hit) {
      return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: hit.size, permissions: vscode.FilePermission.Readonly };
    }
    const tree = await bridge.tree(gamePath).catch(() => undefined);
    if (tree && (tree.folders.length > 0 || tree.files.length > 0)) {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0, permissions: vscode.FilePermission.Readonly };
    }
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const tree = await this.bridge().tree(gamePathOfUri(uri) ?? "");
    return [
      ...tree.folders.map((f): [string, vscode.FileType] => [f.name, vscode.FileType.Directory]),
      ...tree.files.map((f): [string, vscode.FileType] => [path.basename(f.name), vscode.FileType.File]),
    ];
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const gamePath = gamePathOfUri(uri) ?? "";
    const out = path.join(this.cacheDir, ...gamePath.split("\\"));
    await this.bridge().extract(gamePath, out);
    return fs.readFileSync(out);
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions("The game archives are read-only.");
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions("The game archives are read-only. Add the file to the project to edit it.");
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions("The game archives are read-only.");
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions("The game archives are read-only.");
  }
}
