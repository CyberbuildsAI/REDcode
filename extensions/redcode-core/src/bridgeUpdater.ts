// Updating and installing REDbridge from inside the extension.
//
// Two paths. A git checkout (the exe was built from a clone with REDbridge's `update` script) gets a
// pull and a full build, which is what a developer does by hand. Anything else gets the latest GitHub
// release: a zip of a finished build, downloaded and unpacked into the extension's storage, so a
// player never sees a path. No VS Code imports here: the extension supplies logging and progress.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const DefaultRepository = "Edgemodders/REDbridge";
export const DotnetInstallCommand = "winget install Microsoft.DotNet.Runtime.10";
export const DotnetDownloadUrl = "https://dotnet.microsoft.com/download/dotnet/10.0";

/** A short line for a progress notification, and how far along (0 to 1) when known. */
export type Progress = (message: string, fraction?: number) => void;
export type Log = (line: string) => void;

export interface ReleaseInfo {
  /** The version without the v: 0.5.1. */
  version: string;
  tag: string;
  /** The release page. */
  url: string;
  asset: { name: string; url: string; size: number };
}

/** Where a release goes: <storage>/bridge/<version>/REDbridge.exe. */
export function managedDir(storageDir: string, version: string): string {
  return path.join(storageDir, "bridge", version);
}

/** The git checkout the exe was built in, when it was: the nearest ancestor that is REDbridge's repository. */
export function findCheckout(exe: string): string | undefined {
  let dir = path.dirname(path.resolve(exe));
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg) && fs.existsSync(path.join(dir, ".git"))) {
      try {
        const scripts = (JSON.parse(fs.readFileSync(pkg, "utf8")) as { scripts?: Record<string, unknown> }).scripts ?? {};
        if (typeof scripts.update === "string") {
          return dir;
        }
      } catch {
        // Not a package.json we can read; keep looking upward.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

/** Runs `npm run update` in the checkout: git pull, submodules, a full build. About a minute. */
export function updateCheckout(dir: string, log: Log, progress: Progress): Promise<void> {
  return new Promise((resolve, reject) => {
    // One command string, so the shell resolves npm.cmd on Windows and Node does not warn about args with shell: true.
    const child = spawn("npm run update", { cwd: dir, shell: true, windowsHide: true, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
    const rest = { out: "", err: "" };
    const onLine = (line: string) => {
      if (line.trim()) {
        log(line);
        progress(line.trim().slice(0, 90));
      }
    };
    const feed = (key: "out" | "err", chunk: Buffer) => {
      rest[key] += chunk.toString();
      const lines = rest[key].split(/\r?\n/);
      rest[key] = lines.pop() ?? "";
      lines.forEach(onLine);
    };
    child.stdout?.on("data", (c: Buffer) => feed("out", c));
    child.stderr?.on("data", (c: Buffer) => feed("err", c));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (rest.out) onLine(rest.out);
      if (rest.err) onLine(rest.err);
      if (code === 0) resolve();
      else reject(new Error(`npm run update exited with code ${code}; see the REDcode log`));
    });
  });
}

/** The latest release and its Windows zip. */
export async function latestRelease(repository = DefaultRepository): Promise<ReleaseInfo> {
  const res = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "REDcode" },
  });
  if (!res.ok) {
    throw new Error(`GitHub answered ${res.status} for the latest ${repository} release`);
  }
  const json = (await res.json()) as { tag_name: string; html_url: string; assets: { name: string; browser_download_url: string; size: number }[] };
  const asset = json.assets.find((a) => /win-x64\.zip$/i.test(a.name));
  if (!asset) {
    throw new Error(`Release ${json.tag_name} of ${repository} has no win-x64 zip`);
  }
  return {
    version: json.tag_name.replace(/^v/i, ""),
    tag: json.tag_name,
    url: json.html_url,
    asset: { name: asset.name, url: asset.browser_download_url, size: asset.size },
  };
}

/** Downloads the release zip into dir, unpacks it there and returns the path of REDbridge.exe. */
export async function installRelease(release: ReleaseInfo, dir: string, log: Log, progress: Progress): Promise<string> {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, release.asset.name);
  const mb = (n: number) => (n / 1048576).toFixed(1);
  log(`Downloading ${release.asset.url} (${mb(release.asset.size)} MB)`);
  const res = await fetch(release.asset.url, { headers: { "user-agent": "REDcode" } });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get("content-length")) || release.asset.size;
  let got = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      got += chunk.length;
      progress(`Downloading REDbridge ${release.version}: ${mb(got)} of ${mb(total)} MB`, got / total);
      callback(null, chunk);
    },
  });
  // Node's fetch body is a web stream; Readable.fromWeb bridges it to the file stream.
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), counter, fs.createWriteStream(zip));
  progress(`Unpacking REDbridge ${release.version}`);
  await unzip(zip, dir);
  fs.rmSync(zip, { force: true });
  const exe = path.join(dir, "REDbridge.exe");
  if (!fs.existsSync(exe)) {
    throw new Error(`${release.asset.name} did not contain REDbridge.exe`);
  }
  log(`Installed REDbridge ${release.version} in ${dir}`);
  return exe;
}

/** Windows 10 and later ship bsdtar, which reads zips; PowerShell's Expand-Archive is the fallback. */
async function unzip(zip: string, dir: string): Promise<void> {
  try {
    await run("tar", ["-xf", zip, "-C", dir]);
  } catch (first) {
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    try {
      await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dir)} -Force`]);
    } catch (second) {
      throw new Error(`Could not unpack ${path.basename(zip)}: ${(first as Error).message}; ${(second as Error).message}`);
    }
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let err = "";
    const child = spawn(command, args, { windowsHide: true });
    child.stderr?.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}${err ? `: ${err.trim()}` : ""}`))));
  });
}

/**
 * The processes running this exe, other than the ones listed in except. Each VS Code window runs its
 * own bridge, so a build in the checkout fails while another window's bridge holds the files.
 */
export async function processesUsing(exe: string, except: number[] = []): Promise<number[]> {
  if (process.platform !== "win32") {
    return [];
  }
  const target = path.resolve(exe).toLowerCase();
  const script = "Get-CimInstance Win32_Process -Filter \"Name = 'REDbridge.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.ExecutablePath)\" }";
  let out = "";
  await new Promise<void>((resolve) => {
    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    child.stdout?.on("data", (c: Buffer) => (out += c.toString()));
    child.on("error", () => resolve());
    child.on("exit", () => resolve());
  });
  return out
    .split(/\r?\n/)
    .map((line) => line.trim().split("|"))
    .filter(([pid, file]) => pid && file && path.resolve(file).toLowerCase() === target)
    .map(([pid]) => Number(pid))
    .filter((pid) => Number.isInteger(pid) && !except.includes(pid));
}

/** Stops the processes and waits up to timeoutMs for them to go. Returns the ones still running. */
export async function stopProcesses(pids: number[], timeoutMs = 5000): Promise<number[]> {
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      // Already gone, or not ours to stop; the check below reports it.
    }
  }
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && pids.some(alive)) {
    await new Promise((r) => setTimeout(r, 200));
  }
  return pids.filter(alive);
}

export interface RuntimeCheck {
  /** A .NET 10 runtime was found. */
  ok: boolean;
  /** Every runtime `dotnet --list-runtimes` reported. */
  runtimes: string[];
  /** The dotnet that was asked. */
  dotnet: string;
}

/** Asks dotnet for its runtimes: the one on PATH, or the one under dotnetRoot when the runtime is per user. */
export function checkDotnetRuntime(dotnetRoot?: string): Promise<RuntimeCheck> {
  const dotnet = dotnetRoot ? path.join(dotnetRoot, process.platform === "win32" ? "dotnet.exe" : "dotnet") : "dotnet";
  return new Promise((resolve) => {
    let out = "";
    const child = spawn(dotnet, ["--list-runtimes"], { windowsHide: true });
    child.stdout?.on("data", (c: Buffer) => (out += c.toString()));
    child.on("error", () => resolve({ ok: false, runtimes: [], dotnet }));
    child.on("exit", () => {
      const runtimes = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      resolve({ ok: runtimes.some((r) => /^Microsoft\.NETCore\.App 10\./.test(r)), runtimes, dotnet });
    });
  });
}
