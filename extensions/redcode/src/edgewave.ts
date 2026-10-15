// EDGEwave, the EDGE sound studio, when it is installed (REDcode request #4). REDcode's player and
// sound list hand a sound to it through its command edgewave.openSound, never importing its code.
// See EDGEwave's design: https://edgemodders.github.io/EDGEwave/design.html

import * as vscode from "vscode";
import type { SoundRef } from "./api";

export const EDGEwaveId = "edgemodders.edgewave";
const OpenSound = "edgewave.openSound";

/** Opens a sound in EDGEwave; without EDGEwave, offers to install it. Run on a click, so activating EDGEwave here is fine. */
export async function openInEdgeWave(ref: SoundRef, log: vscode.OutputChannel): Promise<void> {
  const ext = vscode.extensions.getExtension(EDGEwaveId);
  if (!ext) {
    const pick = await vscode.window.showInformationMessage("Open in EDGEwave needs EDGEwave, the EDGE sound studio for editing and mixing the game's sounds.", "Install EDGEwave");
    if (pick) {
      try {
        await vscode.commands.executeCommand("workbench.extensions.installExtension", EDGEwaveId);
      } catch {
        // Not on this marketplace yet: show the search, which says so or offers it.
        await vscode.commands.executeCommand("workbench.extensions.search", EDGEwaveId);
      }
    }
    return;
  }
  if (!ext.isActive) await ext.activate();
  if (!(await vscode.commands.getCommands(true)).includes(OpenSound)) {
    void vscode.window.showWarningMessage(`EDGEwave ${String((ext.packageJSON as { version?: string }).version ?? "")} cannot open sounds from REDcode yet (no ${OpenSound}). Update EDGEwave.`);
    return;
  }
  log.appendLine(`Open in EDGEwave: ${JSON.stringify(ref)}`);
  await vscode.commands.executeCommand(OpenSound, ref);
}
