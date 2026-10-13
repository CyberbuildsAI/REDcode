// Drives the TypeScript bridge client against a real REDbridge, without VS Code.
//
//   node scripts/smoke.mjs <path to REDbridge.exe> "<Cyberpunk 2077 folder>"
//
// Set DOTNET_ROOT in the environment when the .NET runtime is installed per user.
// Build first: npm run build (this uses dist/bridgeClient.js).
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const { BridgeClient } = require("../dist/bridgeClient.js");

const [exe, gamePath] = process.argv.slice(2);
if (!exe || !gamePath) {
  console.error('usage: node scripts/smoke.mjs <REDbridge.exe> "<game folder>"');
  process.exit(2);
}

const bridge = new BridgeClient({ exe, gamePath, dotnetRoot: process.env.DOTNET_ROOT });
bridge.on("log", (line) => console.error("  bridge |", line));
bridge.on("exit", (code) => console.error(`  bridge | exited ${code}`));

const started = Date.now();
const step = async (name, fn) => {
  const t = Date.now();
  const r = await fn();
  console.log(`[${((Date.now() - t) / 1000).toFixed(2).padStart(5)}s] ${name}:`, typeof r === "string" ? r : JSON.stringify(r).slice(0, 160));
  return r;
};

try {
  bridge.start();
  const info = await step("bridge.info", () => bridge.info());
  if (!info.gameLoaded) throw new Error("game not loaded");
  await step("archive.archives", async () => (await bridge.archives()).length + " archives");
  const hits = await step("archive.search nokota", () => bridge.search("nokota", 5));
  const first = hits.items.find((f) => f.name.endsWith(".ent")) ?? hits.items[0];
  const out = path.join(os.tmpdir(), "redcode-smoke", `${path.basename(first.name)}.json`);
  await step(`cr2w.toJson ${first.name}`, () => bridge.toJson(first.name, out));
  await step("hash.fnv1a64", () => bridge.fnv1a64(first.name));
  await step("hash.resolve", () => bridge.resolve(first.hash));
  const root = await step("archive.tree (root)", async () => {
    const t = await bridge.tree("");
    return t.folders.map((f) => `${f.name}:${f.files}`).join(" ") + ` files=${t.files.length}`;
  });
  const sub = await step("archive.tree base\\characters", async () => {
    const t = await bridge.tree("base\\characters");
    return `${t.folders.length} folders, ${t.files.length} files; first ${t.folders[0]?.path}`;
  });
  const bin = path.join(os.tmpdir(), "redcode-smoke", "extract", ...first.name.split("\\"));
  await step("archive.extractMany", () => bridge.extractMany([{ path: first.name, outFile: bin }]));
  await step("cr2w.fileToJson (from disk)", async () => (await bridge.fileToJson(bin)).bytes + " bytes of JSON");
  // E1: a document session on an extracted .ent: read a node, patch a value, undo it, save, reopen.
  const entFile = (await bridge.search(".ent", 50)).items.find((f) => f.name.endsWith(".ent"));
  const entBin = path.join(os.tmpdir(), "redcode-smoke", "session", path.basename(entFile.name));
  await bridge.extract(entFile.name, entBin);
  const d = await step(`cr2w.open ${path.basename(entFile.name)}`, () => bridge.openDocument({ file: entBin }));
  const rootNode = await step("cr2w.getNode root", async () => { const n = await bridge.getNode(d.doc); return `${n.type}: ${n.children.length} properties`; });
  await step("cr2w.getNode components", async () => { const n = await bridge.getNode(d.doc, "components", 0, 3); return `${n.total} items; first ${n.children[0]?.preview}`; });
  const before = (await bridge.getNode(d.doc, "components.0.isReplicable")).value;
  const r = await step("cr2w.patch replace components.0.isReplicable", () => bridge.patch(d.doc, [{ op: "replace", path: "components.0.isReplicable", value: before ? 0 : 1 }]));
  await step("cr2w.patch inverse (undo)", () => bridge.patch(d.doc, r.inverse));
  const after = (await bridge.getNode(d.doc, "components.0.isReplicable")).value;
  if (after !== before) throw new Error(`undo did not restore isReplicable: ${before} -> ${after}`);
  await bridge.patch(d.doc, [{ op: "replace", path: "components.0.isReplicable", value: before ? 0 : 1 }]);
  const saved = path.join(os.tmpdir(), "redcode-smoke", "session-save.ent");
  await step("cr2w.save (to a new file)", () => bridge.saveDocument(d.doc, saved));
  await bridge.closeDocument(d.doc);
  const d2 = await bridge.openDocument({ file: saved });
  const reread = (await bridge.getNode(d2.doc, "components.0.isReplicable")).value;
  await bridge.closeDocument(d2.doc);
  if (reread === before) throw new Error("the patched value did not survive save and reopen");
  console.log(`        isReplicable ${before} -> ${reread} survived save and reopen`);
  const tex = (await bridge.search(".xbm", 50)).items.find((f) => f.name.endsWith(".xbm"));
  if (tex) {
    const png = path.join(os.tmpdir(), "redcode-smoke", "png", path.basename(tex.name) + ".png");
    await step(`texture.toPng ${tex.name}`, () => bridge.toPng(tex.name, png));
    const xbm = path.join(os.tmpdir(), "redcode-smoke", "extract", ...tex.name.split("\\"));
    await bridge.extract(tex.name, xbm);
    await step("texture.fileToPng (from disk)", () => bridge.fileToPng(xbm, png.replace(/\.png$/, ".disk.png")));
  }
  // C4 S1: pack the extracted files as a mod's source/archive, then read the archive back.
  const [maj, min] = info.version.split(".").map(Number);
  if (maj > 0 || min >= 6) {
    const source = path.join(os.tmpdir(), "redcode-smoke", "extract");
    const outDir = path.join(os.tmpdir(), "redcode-smoke", "packed", "archive", "pc", "mod");
    const packed = await step("project.pack (the extracted files)", async () => {
      const r = await bridge.pack(source, outDir, "redcode_smoke");
      return `${r.files} files, ${r.bytes.toLocaleString()} bytes, ${r.warnings.length} warning(s)`;
    });
    const mod = await step("archive.openMod (the packed archive)", async () => (await bridge.openMod(path.join(outDir, "redcode_smoke.archive"))).files + " files");
    if (packed.split(" ")[0] !== mod.split(" ")[0]) throw new Error(`packed ${packed} but the archive lists ${mod}`);
  } else {
    console.log(`        project.pack skipped: REDbridge ${info.version} is older than 0.6.1`);
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  bridge.stop();
}
