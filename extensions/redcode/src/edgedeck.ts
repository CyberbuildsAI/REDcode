// EDGEdeck, the mod manager, when it is installed. REDcode installs a packed project through it, so
// one tool owns the game folder. Found at runtime and never imported: the interface below copies the
// shape of EDGEdeck's exported API (apiVersion 1, EDGEdeck 0.27.0, src/extension.ts there).

import * as vscode from "vscode";

export const EDGEdeckId = "edgemodders.edgedeck";

export interface EDGEdeckApi {
  apiVersion: number;
  gamePath(): string;
  projectMod(projectFile: string): string | undefined;
  installProject(projectFile: string): { id: string; name: string; files: number; added: boolean };
  pendingMods(except?: string): string[];
  deploy(): Promise<{ linked: number; removed: number; kept: number; skipped: string[]; conflicts: number } | undefined>;
  turnOff(id: string): void;
}

/**
 * EDGEdeck's API only when EDGEdeck is already running, never activating it: for things REDcode does
 * by itself at startup, where activating another extension can race a window reload (VS Code then
 * warns that EDGEdeck's output channel was added to a disposed store).
 */
export function runningEDGEdeck(): EDGEdeckApi | undefined {
  const ext = vscode.extensions.getExtension<Partial<EDGEdeckApi> | undefined>(EDGEdeckId);
  const api = ext?.isActive ? ext.exports : undefined;
  return api && api.apiVersion === 1 && typeof api.gamePath === "function" ? (api as EDGEdeckApi) : undefined;
}

/** EDGEdeck's API, activating EDGEdeck if needed; undefined when it is not installed. */
export async function findEDGEdeck(): Promise<EDGEdeckApi | undefined> {
  const ext = vscode.extensions.getExtension<Partial<EDGEdeckApi> | undefined>(EDGEdeckId);
  if (!ext) return undefined;
  const exports = ext.isActive ? ext.exports : await ext.activate();
  return exports && exports.apiVersion === 1 && typeof exports.installProject === "function" ? (exports as EDGEdeckApi) : undefined;
}
