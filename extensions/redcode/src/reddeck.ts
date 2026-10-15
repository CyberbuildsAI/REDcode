// REDdeck, the mod manager, when it is installed. REDcode installs a packed project through it, so
// one tool owns the game folder. Found at runtime and never imported: the interface below copies the
// shape of REDdeck's exported API (apiVersion 1, REDdeck 0.21.0, src/extension.ts there).

import * as vscode from "vscode";

export const REDdeckId = "edgemodders.reddeck";

export interface REDdeckApi {
  apiVersion: number;
  gamePath(): string;
  projectMod(projectFile: string): string | undefined;
  installProject(projectFile: string): { id: string; name: string; files: number; added: boolean };
  pendingMods(except?: string): string[];
  deploy(): Promise<{ linked: number; removed: number; kept: number; skipped: string[]; conflicts: number } | undefined>;
  turnOff(id: string): void;
}

export type REDdeckLookup = { api: REDdeckApi } | { missing: true } | { tooOld: string };

/**
 * REDdeck's API only when REDdeck is already running, never activating it: for things REDcode does
 * by itself at startup, where activating another extension can race a window reload (VS Code then
 * warns that REDdeck's output channel was added to a disposed store).
 */
export function runningREDdeck(): REDdeckApi | undefined {
  const ext = vscode.extensions.getExtension<Partial<REDdeckApi> | undefined>(REDdeckId);
  const api = ext?.isActive ? ext.exports : undefined;
  return api && api.apiVersion === 1 && typeof api.gamePath === "function" ? (api as REDdeckApi) : undefined;
}

/** REDdeck's API, activating REDdeck if needed. tooOld names the installed version when its API is not version 1. */
export async function findREDdeck(): Promise<REDdeckLookup> {
  const ext = vscode.extensions.getExtension<Partial<REDdeckApi> | undefined>(REDdeckId);
  if (!ext) return { missing: true };
  const exports = ext.isActive ? ext.exports : await ext.activate();
  if (!exports || exports.apiVersion !== 1 || typeof exports.installProject !== "function") {
    return { tooOld: String((ext.packageJSON as { version?: string }).version ?? "unknown") };
  }
  return { api: exports as REDdeckApi };
}
