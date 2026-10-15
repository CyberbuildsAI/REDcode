// Refuses to package or publish REDcode unless a REDbridge release it can run is on GitHub.
//
//   node scripts/check-bridge-release.mjs
//
// REDcode refuses a bridge older than redcode.minBridgeVersion in package.json, and Install and
// Update REDbridge fetch the latest GitHub release of redcode.bridgeRepository. So a REDcode release
// that needs a bridge nobody can download would leave every user stuck. This runs as part of
// vscode:prepublish, so vsce package, vsce publish and ovsx publish all stop here. It needs the
// network; set REDCODE_SKIP_BRIDGE_CHECK=1 for an offline development build. GITHUB_TOKEN, when
// set, avoids the anonymous rate limit in CI.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const min = manifest.redcode?.minBridgeVersion;
const config = [manifest.contributes.configuration].flat().find((c) => c.properties?.["redcode.bridgeRepository"]);
const repository = config?.properties["redcode.bridgeRepository"].default ?? "Edgemodders/REDbridge";

if (process.env.REDCODE_SKIP_BRIDGE_CHECK === "1") {
  console.warn(`REDbridge release check skipped (REDCODE_SKIP_BRIDGE_CHECK=1). REDcode ${manifest.version} needs REDbridge ${min}.`);
  process.exit(0);
}
if (!/^\d+\.\d+\.\d+$/.test(min ?? "")) {
  console.error('package.json has no redcode.minBridgeVersion ("x.y.z").');
  process.exit(1);
}

const parse = (v) => v.replace(/^v/, "").split(/[.-]/).slice(0, 3).map(Number);
const compare = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

const headers = { "user-agent": "REDcode release check", accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
// After a fetch, exit by setting the code rather than process.exit: on Windows, process.exit with the
// fetch's handles still closing trips a libuv assertion.
const check = async () => {
  let release;
  try {
    const res = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, { headers });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} ${res.statusText}`);
    release = await res.json();
  } catch (e) {
    return `Could not read the latest release of ${repository}: ${e.message}. Set REDCODE_SKIP_BRIDGE_CHECK=1 for an offline build that will not be published.`;
  }
  const latest = release.tag_name;
  const zip = release.assets?.find((a) => /win-x64\.zip$/i.test(a.name));
  if (compare(latest, min) < 0) {
    return `REDcode ${manifest.version} needs REDbridge ${min}, but the latest release of ${repository} is ${latest}. Release REDbridge ${min} or newer first, so Install and Update REDbridge can fetch it.`;
  }
  if (!zip) return `The latest release of ${repository} (${latest}) has no win-x64 zip, which Install REDbridge downloads.`;
  console.log(`REDbridge release check: ${repository} ${latest} (${zip.name}) satisfies REDcode ${manifest.version}'s minimum ${min}.`);
  return undefined;
};

const problem = await check();
if (problem) {
  console.error(problem);
  process.exitCode = 1;
}
