// Bundles the extension (CommonJS, VS Code's module loader) and the bridge client on its own
// (for the smoke test and other Node tools). `node esbuild.mjs --watch` rebuilds on change.
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

const require = createRequire(import.meta.url);

const watch = process.argv.includes("--watch");

const extension = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
};

const client = {
  entryPoints: ["src/bridgeClient.ts"],
  outfile: "dist/bridgeClient.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: true,
  logLevel: "info",
};

// The 3D mesh viewer for the webviews, three.js included, as one browser script.
const meshViewer = {
  entryPoints: ["webview/meshViewer.ts"],
  outfile: "media/mesh/viewer.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  minify: true,
  legalComments: "linked",
  logLevel: "info",
};

// three.js is MIT: its licence text ships beside the bundle that contains it.
fs.mkdirSync("media/mesh", { recursive: true });
// three's exports hide its package.json; its main entry sits in <package>/build/.
fs.copyFileSync(path.join(path.dirname(require.resolve("three")), "..", "LICENSE"), "media/mesh/three.LICENSE.txt");

const builds = [extension, client, meshViewer];
if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
