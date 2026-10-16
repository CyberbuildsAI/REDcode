// EDGEmat, the EDGE material editor, when it is installed (REDcode issue #6). The mesh viewer asks it
// for renderable materials and shows them; without it, the viewer keeps flat colours or a GLB's own
// textures. Found at runtime and never imported: the interface copies the shape EDGEmat proposed in
// the issue (apiVersion 1, built in EDGEmat's M4). Unverified until EDGEmat ships it.

import * as vscode from "vscode";

export const EDGEmatId = "edgemodders.edgemat";

export interface RenderedMaterial {
  /** Baked PBR maps in the mesh's UV space, as PNG bytes. */
  baseColor?: Uint8Array;
  normal?: Uint8Array;
  roughness?: Uint8Array;
  metalness?: Uint8Array;
  fidelity: "approximate" | "checked";
}

export interface EdgematApi {
  apiVersion: 1;
  /** Renderable materials for a mesh as one appearance shows it, keyed by material name. */
  renderMaterials(req: { mesh: string; appearance?: string; materials?: string[] }): Promise<Record<string, RenderedMaterial>>;
  /** Fires when a material the viewer shows changed, such as while a setup is being edited. */
  onDidChangeMaterials: vscode.Event<{ mesh?: string; materials: string[] }>;
}

/** EDGEmat's API, activating EDGEmat when it is installed but not yet running; undefined without it or with another apiVersion. Call it on a user's action, such as opening a mesh, not at startup. */
export async function findEdgemat(): Promise<EdgematApi | undefined> {
  const ext = vscode.extensions.getExtension<Partial<EdgematApi> | undefined>(EDGEmatId);
  if (!ext) return undefined;
  try {
    const api = ext.isActive ? ext.exports : await ext.activate();
    return api && api.apiVersion === 1 && typeof api.renderMaterials === "function" ? (api as EdgematApi) : undefined;
  } catch {
    return undefined;
  }
}

/** A rendered material for the webview: each map as base64 PNG. */
export function mapsForWebview(r: RenderedMaterial): Record<string, string | undefined> {
  const b64 = (u?: Uint8Array) => (u ? Buffer.from(u).toString("base64") : undefined);
  return { baseColor: b64(r.baseColor), normal: b64(r.normal), roughness: b64(r.roughness), metalness: b64(r.metalness), fidelity: r.fidelity };
}
