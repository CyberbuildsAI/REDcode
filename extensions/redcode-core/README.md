# REDcode Core

The first REDcode extension. It runs [REDbridge](https://github.com/CyberbuildsAI/REDbridge), the local process that hosts WolvenKit's engine, and lets you open any Cyberpunk 2077 game file as JSON from VS Code.

> **Status: C2.** Projects, the asset browser, add to project and extract. The CR2W editor and viewers come in C3.

## Views

Click the REDcode icon in the activity bar.

| View | What it shows |
|---|---|
| **Project** | The open WolvenKit project: `Archive` (game files added to the project), `Raw` (exports and imports), `Resources` (scripts and tweaks copied as they are), `Packed` (build output). Click a game file to open it as JSON, a text file to edit it. Right-click: Open as JSON, Reveal in File Explorer |
| **Game Assets** | The game archives as a folder tree, expanded on demand, with file counts. Click a file to open it as JSON. Right-click: Add to Project, Extract to..., Open as JSON, Copy Game Path. The search icon opens search-as-you-type |

A project is any folder with a `.cpmodproj` file in it, opened as the workspace folder. REDcode writes the same XML WolvenKit does, so projects move between the two.

## Commands

| Command | What it does |
|---|---|
| **REDcode: New Project** | Asks for a name and a parent folder, creates the project with WolvenKit's layout, and opens it |
| **REDcode: Open game file as JSON** | Search the game archives as you type, pick a file, and it opens as WolvenKit JSON in an editor tab |
| **REDcode: Search game files** | Same search, then Open as JSON, Add to project, or Copy path |
| **REDcode: Restart bridge** | Stops and restarts the bridge process |
| **REDcode: Show bridge log** | Opens the REDcode output channel. Clicking the status bar item does the same |

The status bar shows the open project and the bridge state: starting, the number of indexed files when ready, or what went wrong.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `redcode.gamePath` | The default Steam folder | The Cyberpunk 2077 install, the folder containing `bin`, `archive` and `r6` |
| `redcode.bridgePath` | empty | Path to `REDbridge.exe`. Empty means a bridge bundled with the extension, or one on `PATH` |
| `redcode.dotnetRoot` | empty | `DOTNET_ROOT` for the bridge when the .NET 10 runtime is installed per user |
| `redcode.author` | empty | Author name written into new projects |

## Running from source

```powershell
npm install                     # at the repository root
cd extensions/redcode-core
npm run build                   # bundles dist/extension.js with esbuild
```

Then open the REDcode repository in VS Code and press **F5**. An Extension Development Host starts with the extension loaded. Set `redcode.bridgePath` in that window's settings to a built `REDbridge.exe` and run **REDcode: Open game file as JSON**.

Without VS Code, the bridge client can be exercised on its own:

```powershell
$env:DOTNET_ROOT = "$env:LOCALAPPDATA\Microsoft\dotnet"   # per-user runtime only
npm run smoke -- "<path to REDbridge.exe>" "<Cyberpunk 2077 folder>"
```

## How it is built

- `src/bridgeClient.ts` depends on Node only: it spawns the bridge and speaks JSON-RPC 2.0 over stdio with `vscode-jsonrpc`, the library language servers use. Tools and tests can use it without VS Code.
- `src/extension.ts` is the VS Code glue: configuration, status bar, output channel and commands.
- `src/types.ts` mirrors the bridge's response records. Hashes are strings, because JavaScript numbers cannot hold 64 bits.

The extension never links the bridge in-process. REDbridge is GPL-3.0 because it links WolvenKit; this extension is MIT and only exchanges data with it.
