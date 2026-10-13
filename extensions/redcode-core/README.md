# REDcode Core

The first REDcode extension. It runs [REDbridge](https://github.com/Edgemodders/REDbridge), the local process that hosts WolvenKit's engine, and lets you open any Cyberpunk 2077 game file as JSON from VS Code.

> **Status: C2.** Projects, the asset browser, add to project and extract. The CR2W editor and viewers come in C3.

## Views

Click the REDcode icon in the activity bar.

| View | What it shows |
|---|---|
| **Project** | The open WolvenKit project: `Archive` (game files added to the project), `Raw` (exports and imports), `Resources` (scripts and tweaks copied as they are), `Packed` (build output). Click a texture (`.xbm`) to view it, another game file to open it as JSON, a text file to edit it. Right-click: Open as JSON, Reveal in File Explorer. Edit the JSON and use **Save JSON to Project** (the icon in the editor title) to rebuild the game file from it |
| **Game Assets** | The game archives as a folder tree, expanded on demand, with file counts. Click a texture to view it, another file to open it as JSON. Right-click: Add to Project, Extract to..., Open Texture, Open as JSON, Copy Game Path. The search icon opens search-as-you-type |

A project is any folder with a `.cpmodproj` file in it, opened as the workspace folder. REDcode writes the same XML WolvenKit does, so projects move between the two.

## Commands

| Command | What it does |
|---|---|
| **REDcode: New Project** | Asks for a name and a parent folder, creates the project with WolvenKit's layout, and opens it |
| **REDcode: Open game file as JSON** | Search the game archives as you type, pick a file, and it opens as WolvenKit JSON in an editor tab |
| **REDcode: Search game files** | Same search, then Open as JSON, Add to project, or Copy path |
| **REDcode: Save JSON to Project** | On a JSON document opened from a project file: saves the document, asks to confirm, rebuilds the game file in `source/archive` from it through the bridge, then reads the file back into the editor and reports any value the format did not keep. It never runs on plain save, so a half-edited document cannot clobber the file |
| **REDcode: Restart bridge** | Stops and restarts the bridge process |
| **REDcode: Show bridge log** | Opens the REDcode output channel. Clicking the status bar item does the same |

The status bar shows the open project and the bridge state: starting, the number of indexed files when ready, or what went wrong.

The extension checks the bridge's version when it starts. If REDbridge is older than the extension needs, the status bar says so; run `npm run update` in the REDbridge folder, then **REDcode: Restart bridge**.

## The CR2W editor

Game files in the project (`.ent`, `.app`, `.mesh`, `.inkatlas`, materials, animations, scenes and the other CR2W types) open in the CR2W editor: a tree of the file's chunks on the left, the selected node's properties on the right. The bridge keeps the parsed file and the editor reads one node at a time, so a 21 MB localization file opens in under half a second and pages its rows 200 at a time. Edits go to the bridge as patches: numbers are committed as the 32-bit value the file will hold, names and paths edit their text, enums are dropdowns, booleans are checkboxes, arrays get add, remove and move, empty handles get create. Ctrl+Z and Ctrl+Y work through VS Code, the tab shows the dirty state, Ctrl+S writes the file through WolvenKit's writer and refreshes the view, and unsaved edits are backed up and restored if VS Code restarts. The JSON button opens the same file as text. `compiledData` is shown but read-only: after parsing it holds the very same objects as `components`, so every edit is made once, under `components`. The search box in the footer finds values and property names anywhere in the file and jumps to them. Localization files (`onscreens.json`, subtitle files) open as a table: filter as you type, edit the texts in place, add and delete rows; the tree is one click away. Needs REDbridge 0.5.0. Open With still offers the text editor, and `.xbm`, `.json` and `.csv` files offer the editor under Open With.

## What the file format keeps

After Save JSON to Project the editor shows the JSON read back from the written file, and a notice says whether it matches what you saved. Three rules of WolvenKit's format explain almost every difference:

| Rule | What you see |
|---|---|
| Numbers are 32-bit floats | 0.22 reads back as 0.219999999. A change below about seven significant digits, such as 0.0500000007 to 0.05, is no change at all |
| `compiledData` is rebuilt from `components` on every write, in `.ent` and `.app` files | An edit made inside `compiledData` vanishes. Edit the same component under `components` and `compiledData` follows |
| Properties at their default value are not stored | Setting a value back to its default makes the file smaller. Nothing is lost |

## Textures

`.xbm` files open in the texture viewer: the bridge converts them to PNG and the viewer shows the image over a checkerboard, with the size and Fit, 1:1 and Pixels buttons. In the Project view and the Explorer this is the default editor for `.xbm`; **Open With...** still offers the text editor. Project textures need REDbridge 0.3.0; archive textures work with 0.2.0.

## TweakXL files

`.tweak` files get syntax highlighting, bracket matching, comment toggling and snippets (`package`, `record`, `clone`, `edit`, `flat`, `fk`, `append`, `remove`, `inline`, `lockey`). The grammar follows the RED format on the [TweakXL wiki](https://github.com/psiberx/cp2077-tweak-xl/wiki/RED-Tweaks). `samples/example.tweak` shows every construct it knows. YAML tweaks use VS Code's built-in YAML support.

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
