// Bundles the MCP server into one CommonJS file, with the bridge client taken from the extension's
// source (it has no VS Code dependency) and the MCP SDK included, so `node dist/server.cjs` needs nothing else.
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  banner: { js: "#!/usr/bin/env node" },
});
