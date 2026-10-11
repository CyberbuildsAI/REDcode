// Bundles the extension (CommonJS, VS Code's module loader) and the bridge client on its own
// (for the smoke test and other Node tools). `node esbuild.mjs --watch` rebuilds on change.
import * as esbuild from "esbuild";

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

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(client)]);
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(client)]);
}
