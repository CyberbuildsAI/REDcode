// Builds the Nexus Mods file from the packaged extension: dist/REDcode-<version>-nexus.zip with the
// .vsix, how to install it, and the licenses. Run after the vsix is packaged (npm run redcode:package,
// or the publish workflow's Package step).
//   node tools/nexus-zip.mjs
// The publish workflow runs it for REDcode's v* tags and attaches the zip to the GitHub release; it is
// uploaded to Nexus by hand (nexus/README.md).
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ext = path.join(root, "extensions", "redcode");
const { name, version } = JSON.parse(fs.readFileSync(path.join(ext, "package.json"), "utf8"));
const vsix = [path.join(root, "dist", `${name}-${version}.vsix`), path.join(ext, `${name}-${version}.vsix`)].find((p) => fs.existsSync(p));
const stage = path.join(root, "dist", "nexus");
const zip = path.join(root, "dist", `REDcode-${version}-nexus.zip`);

if (!vsix) throw new Error(`${name}-${version}.vsix is missing: package the extension first`);
fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
fs.mkdirSync(stage, { recursive: true });

fs.copyFileSync(vsix, path.join(stage, path.basename(vsix)));
fs.copyFileSync(path.join(root, "LICENSE"), path.join(stage, "LICENSE.txt"));
fs.copyFileSync(path.join(ext, "ThirdPartyNotices.txt"), path.join(stage, "ThirdPartyNotices.txt"));
fs.writeFileSync(
  path.join(stage, "README.txt"),
  [
    `REDcode for Cyberpunk 2077 ${version}: a modding workspace in VS Code, built on WolvenKit.`,
    "",
    "This is a VS Code extension, not a game mod. Do not install it with Vortex.",
    "",
    "Install:",
    "  1. In VS Code (or VSCodium, or EDGEkit), open the Extensions view (Ctrl+Shift+X).",
    "  2. Click ... at its top, choose Install from VSIX..., and pick",
    `     ${path.basename(vsix)} from this folder.`,
    "  3. Click the REDcode icon in the activity bar. REDcode looks for the game and offers",
    "     to download REDbridge, and the .NET 10 runtime when it is missing.",
    "",
    "Or from a terminal:",
    `  code --install-extension ${path.basename(vsix)}`,
    "",
    "The same extension is on the VS Code Marketplace and Open VSX (search for",
    "REDcode for Cyberpunk 2077), where it updates itself.",
    "",
    "Needs Windows 10 or 11, 64-bit, and VS Code 1.70 or later.",
    "",
    "Docs: https://edgemodders.github.io/REDcode/",
    "Source and issues: https://github.com/Edgemodders/REDcode",
    "",
  ].join("\r\n"),
);

// Windows' own tar writes zip files (-a picks the format from the name); Git's tar does not.
const tar = path.join(process.env.SystemRoot ?? "C:\Windows", "System32", "tar.exe");
const packed = spawnSync(tar, ["-a", "-c", "-f", zip, ...fs.readdirSync(stage)], { cwd: stage, stdio: "inherit" });
if (packed.status !== 0) throw new Error("Zipping failed");
fs.rmSync(stage, { recursive: true, force: true });
console.log(`${zip}: ${(fs.statSync(zip).size / 1048576).toFixed(1)} MB`);
