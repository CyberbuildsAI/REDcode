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
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} finally {
  bridge.stop();
}
