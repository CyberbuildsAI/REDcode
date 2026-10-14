// Meshes for the 3D view: a .mesh exported to a .glb in REDcode's cache through REDbridge's
// project.export (0.7.0), again only when the source is newer; and a .glb or .gltf read for the
// webview, a .gltf with its buffers and images put inline, since the page gets bytes, not URLs.
// No VS Code imports. See docs/design/view.md, V1.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BridgeClient } from "./bridgeClient";

export interface MeshGlb {
  glb: string;
  /** True when the cached export was still newer than the source. */
  cached: boolean;
}

const mtime = (f: string) => {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return -1;
  }
};

/**
 * The .glb for a mesh: a file on disk (a project's source/archive, or anywhere) or a game path, which
 * is extracted into the cache first. All LODs, no materials (the viewer colours by material name).
 */
export async function meshGlbFor(bridge: BridgeClient, cacheRoot: string, source: { file?: string; gamePath?: string }): Promise<MeshGlb> {
  let file: string;
  let archiveDir: string;
  if (source.gamePath) {
    archiveDir = path.join(cacheRoot, "game", "archive");
    file = path.join(archiveDir, ...source.gamePath.split("\\"));
    if (!fs.existsSync(file)) await bridge.extract(source.gamePath, file);
  } else if (source.file) {
    file = path.resolve(source.file);
    // Inside a project, the archive root keeps the game path; elsewhere the file's own folder does.
    const marker = `${path.sep}source${path.sep}archive${path.sep}`;
    const at = file.toLowerCase().indexOf(marker);
    archiveDir = at >= 0 ? file.slice(0, at + marker.length - 1) : path.dirname(file);
  } else {
    throw new Error("meshGlbFor needs a file or a game path");
  }
  const key = crypto.createHash("sha1").update(archiveDir.toLowerCase()).digest("hex").slice(0, 12);
  const rawDir = path.join(cacheRoot, "raw", key);
  const rel = path.relative(archiveDir, file);
  const glb = path.join(rawDir, rel.replace(/\.(w2)?mesh$/i, ".glb"));
  if (mtime(glb) > mtime(file)) return { glb, cached: true };
  const r = await bridge.exportFile(file, archiveDir, rawDir, { meshBinary: true, meshMaterials: false, meshLodFilter: false });
  if (!r.ok || !fs.existsSync(glb)) {
    throw new Error(`WolvenKit could not export ${path.basename(file)} to glTF${r.written.length ? `; it wrote ${r.written.join(", ")}` : ""}`);
  }
  return { glb, cached: false };
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
