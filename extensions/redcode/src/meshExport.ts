// Meshes for the 3D view: a .mesh exported to a .glb in REDcode's cache through REDbridge's
// project.export (0.7.0), again only when the source is newer; and a .glb or .gltf read for the
// webview, a .gltf with its buffers and images put inline, since the page gets bytes, not URLs.
// No VS Code imports. See docs/design/view.md, V1.

import * as fs from "node:fs";
import * as path from "node:path";
import type { BridgeClient } from "./bridgeClient";
import { cachedExport, type ExportSource } from "./exportCache";

export interface MeshGlb {
  glb: string;
  /** True when the cached export was still newer than the source. */
  cached: boolean;
}

/**
 * The .glb for a mesh: a file on disk (a project's source/archive, or anywhere) or a game path, which
 * is extracted into the cache first. All LODs, no materials (the viewer colours by material name).
 */
export async function meshGlbFor(bridge: BridgeClient, cacheRoot: string, source: ExportSource): Promise<MeshGlb> {
  const r = await cachedExport(bridge, cacheRoot, source, ".glb", { meshBinary: true, meshMaterials: false, meshLodFilter: false }, "glTF");
  return { glb: r.file, cached: r.cached };
}

/** A .glb as base64, or a .gltf as JSON text with its .bin and image files inlined as data URIs. */
export function meshPayload(file: string): { data?: string; json?: string } {
  if (path.extname(file).toLowerCase() === ".glb") {
    return { data: fs.readFileSync(file).toString("base64") };
  }
  const gltf = JSON.parse(fs.readFileSync(file, "utf8")) as { buffers?: { uri?: string }[]; images?: { uri?: string; mimeType?: string }[] };
  const dir = path.dirname(file);
  const inline = (uri: string | undefined, mime: string) => {
    if (!uri || uri.startsWith("data:")) return uri;
    const p = path.resolve(dir, decodeURIComponent(uri));
    if (!fs.existsSync(p)) throw new Error(`${path.basename(file)} refers to ${uri}, which is not there`);
    return `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
  };
  for (const b of gltf.buffers ?? []) b.uri = inline(b.uri, "application/octet-stream");
  for (const i of gltf.images ?? []) {
    const ext = path.extname(i.uri ?? "").toLowerCase();
    i.uri = inline(i.uri, i.mimeType ?? (ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png"));
  }
  return { json: JSON.stringify(gltf) };
}
