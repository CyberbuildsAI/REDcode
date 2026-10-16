# REDcode for Visual Studio Code

**[Docs](https://edgemodders.github.io/REDcode/)** · [Extension API](https://edgemodders.github.io/REDcode/api.html) · [Repo](https://github.com/Edgemodders/REDcode) · [Issues](https://github.com/Edgemodders/REDcode/issues)

REDcode for Visual Studio Code is a Cyberpunk 2077 modding workspace. You can do all of this in one window:
- Browse the game's archives.
- Add files to a WolvenKit project.
- Edit CR2W files in a tree and property grid.
- View textures, atlases, meshes in 3D, and sounds.
- Export and import.
- Pack, install and start the game.

Projects are WolvenKit's own `.cpmodproj` projects, byte for byte, so they move freely between REDcode and WolvenKit.

REDcode stands on [WolvenKit](https://github.com/WolvenKit/WolvenKit). Every game file is read and written by WolvenKit's libraries, which run in [REDbridge](https://github.com/Edgemodders/REDbridge), a small local process that REDcode starts and talks to. Credit for the file formats, the archive reader, the importers and exporters, and years of research belongs to the WolvenKit team and contributors.

> **Preview.** What is here works and is tested against the game. New features land in small updates. Please report problems on [GitHub](https://github.com/Edgemodders/REDcode/issues).

**What you need**
- Windows.
- Cyberpunk 2077: the Steam, GOG or Epic install.
- The .NET 10 runtime. REDcode offers to install it when it is missing.

On first start REDcode looks for the game, which you can change with **REDcode: Set Game Folder**. It also offers to download REDbridge for you.

**For assistants.** REDcode's MCP server, [redcode-mcp](https://github.com/Edgemodders/REDcode/tree/main/packages/redcode-mcp), gives AI assistants such as Claude Code the same engine. They can browse the archives, read and patch CR2W files, export, pack and query TweakDB.

## Views

Click the REDcode icon in the activity bar.

| View | What it shows |
|---|---|
| **Project** | The open WolvenKit project: `Archive` (game files added to the project), `Raw` (exports and imports), `Resources` (scripts and tweaks copied as they are), `Packed` (build output). Click a texture (`.xbm`) to view it, another game file to open it as JSON, a text file to edit it. Right-click: Open as JSON, Open With... (VS Code's editor picker, as in the Explorer), Copy Path, Reveal in File Explorer. Edit the JSON and use **Save JSON to Project** (the icon in the editor title) to rebuild the game file from it |
| **TweakDB** | The game's TweakDB as it ships, read from `tweakdb_ep1.bin`: record types with their counts, each opening to its records grouped by the first part of the path. Click a record to open its page. The filter button finds records by words of their path. Right-click a record for Copy Record Path and New Tweak from This Record. The first use loads TweakDB, which takes about 12 seconds |
| **Game Assets** | The game archives as a folder tree, expanded on demand, with file counts. Click a texture to view it, another file to open it as JSON. Right-click: Add to Project, Extract to..., Open Texture, Open as JSON, Copy Game Path. The search icon opens search-as-you-type |

On hover, files and folders in both trees show a copy button. In Game Assets it copies the game path (`base\gameplay\...`). In the Project view it copies the full path on disk. The status bar shows what was copied.

Both trees have a **Filter** button in their title bar. Type a path or a pattern, and the tree narrows to the matching files while you type. The folders on the way to them open, and a chain of single folders shows as one row. Enter keeps the filter, and the message above the tree shows the pattern and the count. **Clear Filter** returns to the full tree. A pattern is words separated by spaces, and a file must match them all. A plain word matches anywhere in the path, so `osprey mesh` finds the Nokota Osprey's meshes. `*` and `?` are wildcards, so `ep1\weapons\*.xbm` or `*.inkatlas` work, and `/` works as well as `\`. Case does not matter. Game Assets shows at most 5,000 matches and says so when there are more. Add to Project on a folder in a filtered tree takes only the matching files under it.

A project is any folder with a `.cpmodproj` file in it, opened as the workspace folder. REDcode writes the same XML WolvenKit does, so projects move between the two.

## Commands

| Command | What it does |
|---|---|
| **REDcode: New Project** | Asks for a name and a parent folder, creates the project with WolvenKit's layout, and opens it |
| **REDcode: Open game file as JSON** | Search the game archives as you type, pick a file, and it opens as WolvenKit JSON in an editor tab |
| **REDcode: Search game files** | Same search, then Open as JSON, Add to project, or Copy path |
| **REDcode: Browse Game Sounds** | The game's sound effects as a list of events to filter and play. See [Sounds](#sounds) |
| **REDcode: Save JSON to Project** | On a JSON document opened from a project file: saves the document, asks to confirm, rebuilds the game file in `source/archive` from it through the bridge, then reads the file back into the editor and reports any value the format did not keep. It never runs on plain save, so a half-edited document cannot clobber the file |
| **REDcode: Restart REDbridge** | Stops and restarts the bridge process |
| **REDcode: Show REDbridge log** | Opens the REDcode output channel. Clicking the status bar item does the same |

The status bar shows the open project and the bridge state: starting, the number of indexed files when ready, or what went wrong.

The extension checks the bridge's version when it starts. If REDbridge is older than the extension needs, the status bar says so and offers **REDcode: Update REDbridge**.

**Installing and updating the bridge.** With no bridge configured, the extension offers **REDcode: Install REDbridge**: it downloads the latest REDbridge release from GitHub, unpacks it under the extension's storage and points `redcode.bridgePath` at it. Nothing to type. **REDcode: Update REDbridge** does the same when a newer release exists, stopping and restarting the bridge around it; when the bridge runs from a git checkout of REDbridge, it pulls and rebuilds there instead (`npm run update`), which is the developer's path. Once per session the extension asks GitHub whether a newer release exists and offers it (`redcode.bridgeUpdateCheck`). The bridge needs the .NET 10 runtime: if it fails to start and no runtime is installed, the extension says so and offers `winget install Microsoft.DotNet.Runtime.10` in a terminal, or the download page.

## The CR2W editor

Game files in the project (`.ent`, `.app`, `.mesh`, `.inkatlas`, materials, animations, scenes and the other CR2W types) open in the CR2W editor: a tree of the file's chunks on the left, the selected node's properties on the right. The bridge keeps the parsed file and the editor reads one node at a time, so a 21 MB localization file opens in under half a second and pages its rows 200 at a time. Edits go to the bridge as patches: numbers are committed as the 32-bit value the file will hold, names and paths edit their text, enums are dropdowns, booleans are checkboxes, arrays get add, remove and move, empty handles get create. Ctrl+Z and Ctrl+Y work through VS Code, the tab shows the dirty state, Ctrl+S writes the file through WolvenKit's writer and refreshes the view, and unsaved edits are backed up and restored if VS Code restarts. The JSON button opens the same file as text. `compiledData` is shown but read-only: after parsing it holds the very same objects as `components`, so every edit is made once, under `components`. The search box in the footer finds values and property names anywhere in the file and jumps to them. Localization files (`onscreens.json`, subtitle files) open as a table: filter as you type, edit the texts in place, add and delete rows; the tree is one click away. Atlases (`.inkatlas`) open on the texture with every part drawn over it: click a rectangle or a part in the list to select it, edit its rectangle in pixels (the UV rectangle the game reads is written with it), add and delete parts, switch slots. Needs REDbridge 0.7.0. Open With still offers the text editor, and `.xbm`, `.json` and `.csv` files offer the editor under Open With; an `.xbm` in the editor shows its image above the grid with the setup fields selected. Clicking a file in Game Assets opens it in the same editor straight from the archives, read-only, with a banner; Add to Project is the way to an editable copy. The Properties view in the REDcode activity bar shows the selected node of the active editor in the same grid and edits it in place, so the editor can stay on the tree, the table or the atlas while the values sit in the sidebar.

## What the file format keeps

After Save JSON to Project the editor shows the JSON read back from the written file, and a notice says whether it matches what you saved. Three rules of WolvenKit's format explain almost every difference:

| Rule | What you see |
|---|---|
| Numbers are 32-bit floats | 0.22 reads back as 0.219999999. A change below about seven significant digits, such as 0.0500000007 to 0.05, is no change at all |
| `compiledData` is rebuilt from `components` on every write, in `.ent` and `.app` files | An edit made inside `compiledData` vanishes. Edit the same component under `components` and `compiledData` follows |
| Properties at their default value are not stored | Setting a value back to its default makes the file smaller. Nothing is lost |

## Textures

`.xbm` files open in the texture viewer: the bridge converts them to PNG and the viewer shows the image over a checkerboard, with the size and Fit, 1:1 and Pixels buttons. In the Project view and the Explorer this is the default editor for `.xbm`; **Open With...** still offers the text editor. The extension needs REDbridge 0.7.0 or newer: 0.5.1 writes textures the right way up, 0.6.1 adds the packer and 0.7.0 export and import.

## TweakXL files

`.tweak` files get syntax highlighting, bracket matching, comment toggling and snippets (`package`, `record`, `clone`, `edit`, `flat`, `fk`, `append`, `remove`, `inline`, `lockey`). The grammar follows the RED format on the [TweakXL wiki](https://github.com/psiberx/cp2077-tweak-xl/wiki/RED-Tweaks). `samples/example.tweak` shows every construct it knows. YAML tweaks use VS Code's built-in YAML support.

## Packing

**REDcode: Pack**, the package button in the Project view's title bar, or the `redcode: pack` build task (**Ctrl+Shift+B**) builds the project's `packed` folder the way WolvenKit does, so it installs the same way:

| From | To |
|---|---|
| `source/archive` | `packed/archive/pc/mod/<mod name>.archive`, written by WolvenKit's packer on the bridge |
| `source/resources/**/*.xl` | Beside the archive |
| Other files under `source/resources` | `packed/<same relative path>`, so `resources/r6/tweaks/x.yaml` becomes `packed/r6/tweaks/x.yaml`. `.script`, `.ws` and `info.json` are left out, and so is a `.tweak` file outside `r6/tweaks`. WolvenKit leaves out `.tweak` files in `r6/tweaks` too, which drops TweakXL tweaks in RED format; REDcode packs them |

`packed` is emptied first, so a file removed from the project does not linger in the mod (`redcode.pack.clean`). With `redcode.pack.redmod` the archive and the ArchiveXL files go under `packed/mods/<mod name>/archives`, with an `info.json`, as WolvenKit's REDmod option does. Paths with capital letters or spaces are listed in the log, as WolvenKit warns about them. Needs REDbridge 0.6.1.

## Meshes in 3D

A `.mesh` opens on a 3D view in the CR2W editor, from the Project view or from Game Assets; the header's **Tree** button shows the file's tree and **3D** goes back. Drag to orbit, right-drag or Shift-drag to pan, wheel to zoom. The toolbar picks the LOD (LOD 1 has the most detail), and toggles wireframe, the bounding box and the ground grid; **Frame** fits the view. The list on the right turns submeshes on and off and shows each one's material and triangle count, and the toolbar shows the totals and the size in metres. The view shows the saved file: save to see your edits. `.glb` and `.gltf` files open in the same viewer. **Appearance** picks one of a `.mesh`'s appearances, and each submesh then shows the material that appearance gives it. **Shading** picks a colour per material name, a GLB's **own textures** (the default for a model from Blender or a model service that carries them), or **EDGEmat**: when the EDGE material editor is installed, it renders the materials and the view shows them, marked approximate until EDGEmat has checked them against the game. The viewer uses [three.js](https://threejs.org) (MIT), bundled into the extension.

## Sounds

A `.wem` file opens in the audio player from the Project view or Game Assets. It is mostly voice lines, under `localization` folders. The bridge exports it to Ogg into REDcode's cache, again only when the file is newer. The player shows the waveform. Click or drag on it to seek. **Play** and **Loop** are below it, Space plays and pauses, and the toolbar shows the time, codec, channels and rate. **Save...** writes the sound to a file. `.opus` files open in the same player. WAV, Ogg, MP3 and FLAC keep VS Code's own preview and offer the player under **Open With...** (right-click in the Project view or the Explorer). The player decodes the sound once and plays it through Web Audio. VS Code's webview decodes no Opus, so REDcode decodes Opus itself, with libopus, and plays it as WAV; Save still writes the original `.opus`.

The game's sound effects are 73,000 sounds packed into `.opuspak` files. **REDcode: Browse Game Sounds**, in the Game Assets `...` menu, opens their index, `base\sound\soundbanks\sfx_container.opusinfo`, as a list of sound events. Each event has its sounds as numbered variations. Type in the filter box to narrow the list by event name, tag or hash, where all words must match, such as `revol reload`. Click a row to play its first sound, or a number to play that variation. The arrow keys step through the list and play as they go. **Copy Hash** copies the hash of the sound now playing, and **Save...** writes it as `.opus`. Event names come from WolvenKit's event list for game version 1.6, which names about 10,900 of the 16,100 events with sounds. The names need REDbridge 0.7.2; on an older bridge the list shows hashes only.

## TweakDB

The **TweakDB** view, **REDcode: Open TweakDB Record...** and the hover all read the game's TweakDB through REDbridge 0.8.0. They show TweakDB as the game ships it, without mods. The first use loads it, which takes about 12 seconds, and the view says so while it loads.

- **The record page** shows every flat with its type and value. Record links open the record they name, and Back and Forward (Alt+Left and Alt+Right) step through what you opened. LocKeys show their text. Resource paths open the game file. Click a flat's name to copy its path, such as `Items.money.quality`. The filter box narrows the flats by name or value.
- **New Tweak from This Record**, on the record page or a record in the view, writes a TweakXL YAML file under the project's `source/resources/r6/tweaks/<mod name>/`. You choose to clone the record as a new one (`$base`) or to change the record itself. Every flat is listed with its current value, commented out, so you uncomment the ones to change. Pack copies the file to `r6/tweaks`, where TweakXL loads it.
- **Hover** on a record path in a `.yaml` or `.tweak` file to see its type and main flats, with a link to the record page. It works once TweakDB is loaded, so a hover never starts the load.

**Open in EDGEwave**, in the player and the sound list, hands the sound now playing to EDGEwave, the EDGE sound studio, to edit, mix or re-voice. Without EDGEwave installed, it offers to install it.

## For other extensions

REDcode returns an API from `activate()`: the bridge, the game folder, the open project, the game's sound effect index, any sound as audio a webview decodes, import and pack. See [Extension API](https://edgemodders.github.io/REDcode/api.html).

## Making a new asset

**Edit in Blender** (right-click a `.glb` or `.gltf` in Raw, or a `.mesh` in Archive) opens the model in Blender. A `.mesh` is exported to Raw first. Blender saves it as a `.blend` beside the GLB, and from then on every save (Ctrl+S) also exports the GLB, with the normals and tangents WolvenKit's importer needs. REDcode imports each save into Archive and stops watching when Blender closes, or when you click the Blender item in the status bar. Blender is found from `redcode.blenderPath`, the newest version under Program Files, or a Steam library.

A GLB with no `.mesh` at its path becomes a new mesh from a template: Import asks for a game mesh of a similar kind, whose materials and appearances the new mesh keeps.

**Pack and Try** (the flame in the Project view) packs and gets the mod into the game as fast as the game allows. With Red Hot Tools installed, the archive goes to the hot folder and the running game reloads it; respawn or re-equip what uses it to see the change. Without it, the mod is packed and installed, and the change shows after a restart.

## Export and import

**Export to Raw** on a game file under Archive writes it to the same path under Raw in a format other tools edit, through WolvenKit's exporter: a mesh as glTF (`.glb`, or `.gltf` with `redcode.export.meshFormat`) with its material textures, a texture as an image (`redcode.export.textureFormat`, PNG by default), a sound (`.wem`) as Ogg, and the other types WolvenKit converts (masks, animations, morph targets, fonts, CSV). Files with no such format keep **Open as JSON**. **Import from Raw** on a raw file brings it back. A game sound effect can be replaced too: name the WAV after the sound's hash, such as `832549876.wav` (Copy Hash in the sound list gives it), and Import writes the changed `.opuspak` and a new `sfx_container.opusinfo` into Archive, keeping earlier replacements. Needs REDbridge 0.9.0. Voice lines (`.wem`) cannot be imported yet. With `redcode.import.keepSettings` (on by default) the file it replaces keeps its settings: a texture its group, format, compression and every flag, a mesh its materials. Both work on a folder too; a folder import takes only files whose game file is already in Archive, the newest raw file of each, so the material textures a mesh export writes into Raw stay out of the mod unless you import one on its own. A file open in the CR2W editor reloads after the import. Needs REDbridge 0.7.0.

## Installing and running

The rocket button in the Project view, **REDcode: Pack and Install**, packs and installs in one go; **Install** and **Uninstall** sit in the view's `...` menu, and the play button is **Run Game**.

| With | Install does |
|---|---|
| [REDdeck](https://github.com/Edgemodders/REDdeck) 0.21.0 or newer | Hands the project to REDdeck: the first time it becomes a mod named after the project (version dev), after that the same mod gets the new files and keeps its place in the order. REDdeck deploys it with its manifest, conflict check and undo. When other mods have changes waiting, REDcode asks before the deploy takes them along. Uninstall turns the mod off in REDdeck and deploys |
| No REDdeck | Copies `packed` into the game folder and records the files in the project's `.redcode/installed.json`. A file that was already in the game is backed up there first, after a question, and put back on Uninstall. Reinstalling removes the previous set first, so a file the project dropped does not stay behind |

**Install to the Hot Folder** (the flame button) copies the packed archive into `archive/pc/hot`, which [Red Hot Tools](https://github.com/psiberx/cp2077-red-hot-tools) reloads while the game runs. It shows only when the game has Red Hot Tools under `red4ext/plugins`. **Run Game** starts the game through Steam when it is in a Steam library and from `bin/x64/Cyberpunk2077.exe` otherwise (`redcode.launch`), with `-modded` when the project packs as a REDmod.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `redcode.gamePath` | The default Steam folder | The Cyberpunk 2077 install, the folder containing `bin`, `archive` and `r6`. When it is not the game, REDcode offers on start the install REDdeck uses or one it finds: every Steam library, GOG, Epic. **REDcode: Set Game Folder** changes it |
| `redcode.bridgePath` | empty | Path to `REDbridge.exe`. Empty means a bridge bundled with the extension, or one on `PATH` |
| `redcode.dotnetRoot` | empty | `DOTNET_ROOT` for the bridge when the .NET 10 runtime is installed per user |
| `redcode.bridgeRepository` | `Edgemodders/REDbridge` | The GitHub repository whose releases Install REDbridge and Update REDbridge download |
| `redcode.bridgeUpdateCheck` | `true` | Ask GitHub once per session whether a newer release exists; skipped for a git checkout |
| `redcode.author` | empty | Author name written into new projects |
| `redcode.pack.clean` | `true` | Empty `packed` before packing |
| `redcode.pack.redmod` | `false` | Pack as a REDmod under `packed/mods/<mod name>` |
| `redcode.export.textureFormat` | `png` | The image format Export to Raw writes for textures: `png`, `tga`, `dds`, `bmp`, `jpg` or `tiff` |
| `redcode.export.meshFormat` | `glb` | Meshes as one `.glb`, or `.gltf` with its `.bin` |
| `redcode.export.meshMaterials` | `true` | Export a mesh's materials and textures with it |
| `redcode.import.keepSettings` | `true` | Import keeps the settings of the file it replaces |
| `redcode.launch` | `auto` | How Run Game starts the game: `auto` (Steam for a Steam install, else the exe), `steam` or `exe` |

## Running from source

```powershell
npm install                     # at the repository root
cd extensions/redcode
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
