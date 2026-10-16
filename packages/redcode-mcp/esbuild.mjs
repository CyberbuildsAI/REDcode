// Bundles the MCP server into one CommonJS file, with the bridge client and audio code taken from the
// extension's source (they have no VS Code dependency) and the MCP SDK included, so `node dist/server.cjs`
// needs nothing else. Also writes dist/ThirdPartyNotices.txt from the packages the bundle contains, and
// copies the repository's MIT licence beside package.json for npm.
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));

const result = await esbuild.build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: true,
  metafile: true,
  logLevel: "info",
  define: { __VERSION__: JSON.stringify(pkg.version) },
  banner: { js: "#!/usr/bin/env node" },
});

// The packages in the bundle: every input under a node_modules folder, by package root.
const roots = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /^(.*node_modules[\\/])((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(input);
  if (m) roots.set(m[2].replace(/\\/g, "/"), path.resolve(here, m[1] + m[2]));
}
const sections = [];
for (const [name, dir] of [...roots].sort((a, b) => a[0].localeCompare(b[0]))) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  const text = file
    ? fs.readFileSync(path.join(dir, file), "utf8").trim()
    : // opus-decoder and its helper declare MIT and ship no licence file; their notice, and libopus's,
      // are kept in the extension's ThirdPartyNotices.txt.
      `Licence: ${meta.license ?? "unknown"}. The package ships no licence file; see the extension's ThirdPartyNotices.txt in the REDcode repository for its notice.`;
  sections.push(`${name} ${meta.version}\n\n${text}`);
}
const extension = fs.readFileSync(path.join(here, "..", "..", "extensions", "redcode", "ThirdPartyNotices.txt"), "utf8").replace(/\r\n/g, "\n");
const opus = extension.slice(extension.indexOf("opus-decoder"));
const rule = "\n\n------------------------------------------------------------------------------\n\n";
fs.writeFileSync(
  path.join(here, "dist", "ThirdPartyNotices.txt"),
  `${pkg.name} ${pkg.version} bundles the following packages into dist/server.cjs. Their notices follow.${rule}${sections.join(rule)}${rule}${opus.trim()}\n`,
);
fs.copyFileSync(path.join(here, "..", "..", "LICENSE"), path.join(here, "LICENSE"));
console.log(`  dist/ThirdPartyNotices.txt: ${roots.size} bundled packages`);
