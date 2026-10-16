# Changelog

## Unreleased

- **The LocKeys view** (C5 V4): the game's on-screen texts, base game and Phantom Liberty, in any of its 19 languages, through REDbridge 0.10.0's `loc` methods. Search by `LocKey#123`, a secondary key or words of the text. The open project's own onscreens entries count and win over the game's. A click opens the entry in its onscreens file on its row, the project's to edit or the game's read-only. Copy LocKey, Copy Text, and Add to Project Onscreens, which copies the entry into the project's onscreens file (creating it, and naming it in an `.xl`, when there is none) and opens the table view on that row, with the file selected in the Project view. A hover on `LocKey#...` in tweak, YAML, JSON, Lua and Redscript files shows the text, and the CR2W editor shows it beside `LocKey#...` values. Setting `redcode.loc.language`.
- **REDmod custom sounds in the pack** (REDcode issue #8, for EDGEwave): with `redcode.pack.redmod`, the `customSounds` entries of `source/resources/info.json` go into the written manifest, and each entry's file is copied from `source/customSounds` to `packed/mods/<name>/customSounds`, as WolvenKit's pack does. Pack warns about a listed WAV that is missing, and about custom sounds in a plain pack, which the game does not play. Pack and Install, and Pack and Try, ask before installing a REDmod whose custom sound is missing. The Project view shows `source/customSounds` as Custom Sounds when the project has it.
- **Edit in Blender** (REDcode issue #7, for EDGEfab): a project `.glb` or `.gltf`, or a `.mesh` exported to Raw first, opens in Blender. Every save there exports the GLB with normals and tangents, and REDcode imports it into Archive until Blender closes. Blender comes from `redcode.blenderPath`, Program Files or a Steam library; a Blender REDcode finds is written to `redcode.blenderPath`, so the setting shows the one used. Checked with Blender 5.2.2: the export keeps WolvenKit's `submesh_NN_LOD_N` names, and the bridge imports it.
- **Pack and Try** (REDcode issue #7): pack, then into the hot folder for Red Hot Tools to reload in the running game, or Pack and Install when it is not there. REDnode's archive reload (REDnode issue #12) will take its place when it ships.
- `REDcodeApi` gains `packAndTry()` and `editInBlender(file)`.
- **The mesh viewer switches appearances** (REDcode issue #6): an Appearance list for a `.mesh`, and each submesh shows the material that appearance's `chunkMaterials` names for it.
- **A GLB's own textures**: a model that carries its materials and textures, such as one from Blender or a model service, opens with them, with Shading to switch to flat colours.
- **EDGEmat materials**: with EDGEmat installed, the viewer asks it to render the mesh's materials for the appearance shown (`renderMaterials`) and redraws when EDGEmat reports a change. Built to the API EDGEmat proposed; untested until EDGEmat ships it. Layered material preview moves to EDGEmat, so REDcode does not build it (C6).
- **A GLB can become a new mesh.** Import from Raw on a `.glb` or `.gltf` with no `.mesh` at its path asks for a template: a game mesh to start from, whose materials and appearances the new mesh keeps. WolvenKit only imports a model over an existing mesh, so REDbridge 0.9.0 copies the template there first. The log lists the submeshes, the GLB's materials and how appearances were sized. `REDcodeApi.importFile` takes `{ template }` and returns the same `mesh` report; MCP `project_import` takes `template`. From REDbridge issue #5, for EDGEfab and EDGEmat.
- **Import from Raw takes sound effects again**, as WAV files named after the sound's hash (`832549876.wav`, from Copy Hash in the sound list). REDbridge 0.9.0's `sound.importWavs` writes the changed `.opuspak` and a new `sfx_container.opusinfo` into `source/archive`, keeping earlier replacements. A folder import takes every such WAV under it. The API's `importFile` does the same. Voice lines (`.wem`) cannot be imported yet. MCP tool `sound_import`. An import through the API, such as EDGEwave's Into the Game, shows its result in the Project view as Import from Raw does, a sound's `.opuspak` selected.

## 0.9.0 (2026-10-15)

C5 V3, the TweakDB view, is done and hand-tested. Needs REDbridge 0.8.0.

- **An API for other extensions** (REDcode issue #4, for EDGEwave). `activate()` returns `REDcodeApi` version 1 (`src/api.ts`, docs/api.md): the bridge, the game folder, the open project and its changes, the game's sound effect index with event names, any sound by reference as audio a webview decodes (WAV for sound effects and Opus, Ogg Vorbis for `.wem`), import of a raw file, and pack.
- **Open in EDGEwave** in the audio player and the sound list runs EDGEwave's `edgewave.openSound` with the sound now playing, and offers to install EDGEwave when it is missing.
- **Import from Raw no longer offers `.wav`**, and Export no longer offers `.opusinfo` (REDcode issue #5). WolvenKit's library imports nothing from a WAV (its `ImportWav` only logs "Use WolvenKit to import opus.") and exports nothing from an `.opusinfo` without sound hashes, so both silently wrote nothing. Sound effect import will come through a REDbridge method over WolvenKit's `OpusTools`.
- **TweakDB view** (C5 V3). A TweakDB view in the REDcode sidebar lists record types with their counts and their records, with a filter that finds records by words of their path.
  - **The record page** shows a record's flats, with record links you can follow, Back and Forward, LocKey text, and resource paths that open the game file.
  - **New Tweak from This Record** writes a TweakXL YAML file into the project that clones or changes the record, with every flat listed and commented out.
  - **Hovering** a record path in `.yaml` and `.tweak` files shows its type and main flats.
  - **REDcode: Open TweakDB Record...** searches as you type.
  - The new tweak file is selected in the Project view, with its folders expanded, so you see where it landed.
  - It reads the game's TweakDB as shipped, through REDbridge 0.8.0. The first use loads it, in about 12 seconds.
- The third-party notices are in one file, `ThirdPartyNotices.txt` (vscode-jsonrpc, three.js, opus-decoder, libopus); `THIRD_PARTY_NOTICES.md` is folded into it.

## 0.8.2 (2026-10-15)

The first version on the VS Code Marketplace, as a Preview. Needs REDbridge 0.8.0.

**The extension is now `edgemodders.redcode-cyberpunk`** (it was `edgemodders.redcode`). The Marketplace refused 0.8.0 and 0.8.1 because the extension name `redcode` is taken by another publisher's extension for Core War's Redcode language. VS Code sees a new extension: install this one, then uninstall the old one; REDcode says so if both are loaded. Settings, commands and keybindings carry over, since their names start with `redcode.`. The extension's storage folder moves with the id, so run **REDcode: Install REDbridge** once more if REDcode downloaded the bridge for you.

## 0.8.1 (2026-10-15)

On Open VSX and GitHub only, as `edgemodders.redcode`. Needs REDbridge 0.8.0.

- The display name is now **REDcode for Cyberpunk 2077**. It did not get 0.8.1 onto the Marketplace: the name `redcode`, not the display name, was the conflict.
- The first-run game folder offer no longer activates REDdeck to ask for its game path; it asks only when REDdeck is already running, and stops once REDcode is deactivated. Activating REDdeck there raced a window reload, and VS Code warned that REDdeck's output channel went into a disposed store. Found while looking into an intermittent startup abort (exit code 134) of the development host, whose cause is still unverified.

## 0.8.0 (2026-10-15)

The first Marketplace release, as a Preview. C5 V2, the audio player, is done. Needs REDbridge 0.8.0. REDcode refuses an older bridge and offers Update REDbridge, which downloads it.

- **The game folder is found on first start.** When `redcode.gamePath` is not the game, REDcode offers the install REDdeck uses, or one it finds in any Steam library (from `libraryfolders.vdf`), GOG or the Epic launcher's manifests. **REDcode: Set Game Folder** lists the installs found or browses for one, and it is also a button in the empty Game Assets view. Before, a new machine got an empty Game Assets view with no hint.
- A REDcode release needs its REDbridge released first. `redcode.minBridgeVersion` in `package.json` is the one place the minimum is written. `scripts/check-bridge-release.mjs` runs in `vscode:prepublish`, so `vsce package`, `vsce publish` and `ovsx publish` stop unless the latest REDbridge release on GitHub is at least that version and has its Windows zip. `REDCODE_SKIP_BRIDGE_CHECK=1` allows an offline development build.
- Marketplace listing: marked Preview, a new README opening (what REDcode is, the credit to WolvenKit, what you need), more categories and keywords.
- **Audio player** (C5 V2).
  - A `.wem`, from the project or straight from Game Assets, opens in a player. It has a waveform you click or drag to seek, Play, Loop, the time, codec, channels and rate, and Save. REDbridge exports the `.wem` to Ogg into REDcode's cache, again only when the file is newer.
  - `.opus` files open in the same player. WAV, Ogg, MP3 and FLAC offer it under Open With and keep VS Code's preview.
- **Game sounds** (C5 V2). **REDcode: Browse Game Sounds**, also in the Game Assets `...` menu, opens the game's sound effect index, `sfx_container.opusinfo`. Clicking that file opens it too. It shows 73,139 sounds as a list of 16,127 events, each with its sounds as numbered variations.
  - Filter by event name, tag or hash. A click plays, the arrow keys step through the list, and Copy Hash and Save act on the sound now playing.
  - Each sound plays straight from its `.opuspak`, which is extracted into the cache on first use.
  - Event names need REDbridge 0.7.2 (`sound.events`, WolvenKit's event list for game 1.6, names for about 10,900 of the 16,100 events with sounds). On an older bridge the list shows hashes only.
  - MCP tools `sound_events` and `sound_extract`.
- TweakDB in the bridge client and the MCP server, ahead of the TweakDB view (C5 V3): `tweakTypes`, `tweakRecords`, `tweakRecord`, `tweakFlat`, `tweakSearch`, `tweakNames`, and MCP tools `tweakdb_types`, `tweakdb_records`, `tweakdb_record`, `tweakdb_flat`, `tweakdb_search`, `tweakdb_names`. Needs REDbridge 0.8.0.
- **Open With...** in the Project view's right-click menu: VS Code's editor picker, which only the Explorer offered, so a `.wav` in Raw can open in the audio player.
- The player plays through Web Audio from the decoded samples, not an `<audio>` element: VS Code's media build refused the game's Ogg Opus sounds there ("no supported source was found"), where Chrome plays them. VS Code's webview turned out to decode no Opus at all (`decodeAudioData` and WebCodecs refused it too), so REDcode decodes the game's Opus sounds itself with opus-decoder (MIT, libopus in WebAssembly) and plays them as 16-bit WAV, sample for sample the length WolvenKit's index records. Save still writes the original `.opus`. The decoder's notices are in `THIRD_PARTY_NOTICES.md`, with three.js's.
- README: an exported `.wem` is Ogg, not WAV.

## 0.7.0 (2026-10-14)

C5 starts: the mesh viewer. Needs REDbridge 0.7.0, as 0.6.1 did.

- **3D mesh viewer** (C5 V1). A `.mesh`, from the project or straight from Game Assets, opens in the CR2W editor on a 3D view, with **Tree** one click away: orbit, pan and zoom, a ground grid, wireframe, the bounding box, the LOD to show, each submesh on or off with its material and triangle count, and the size in metres. `.glb` and `.gltf` files, such as an export in Raw, open in the same viewer. The mesh is exported to a `.glb` in REDcode's cache through REDbridge's exporter, again only when the file is newer, so the view shows the saved file and refreshes after a save. Submeshes are coloured by material for now; textures come later. three.js is bundled into the extension, under its MIT licence, so nothing loads from the network.
- **Filter** in the Game Assets and Project views. The filter button in each view's title bar opens an input box, and the tree narrows to the matching files as you type. It does not leave the tree, as Search does. Words separated by spaces must all match. Plain words match anywhere in the path. `*` and `?` are wildcards (`ep1\weapons\*.mesh`, `*.inkatlas`). `/` and `\` are the same, and case does not matter. The folders on the way to the matches open by themselves, up to 300 matches, and single-folder chains fold into one row. The filter stays until **Clear Filter**, the button that appears next to it, and the message above the tree shows the pattern and the match count. Game Assets asks the bridge for the pattern's longest plain fragment and shows up to 5,000 files. Add to Project on a filtered folder takes only its matching files.
- **Copy path** hover button on files and folders in Game Assets and the Project view, and Copy Path in the Project view's right-click menu. Game Assets copies the game path. The Project view copies the full path on disk, of the project folder and its roots too. The status bar shows what was copied.

## 0.6.1 (2026-10-14)

Needs REDbridge 0.7.0; `redcode.extractToProject` needs 0.7.1 and says so on an older bridge.

- `redcode.extractToProject` for REDdeck (REDcode request #1): `{ archive, paths, overwrite? }` extracts resources, by game path or hash, from a mod's `.archive` on disk into the open project's `source/archive`, and returns `{ written, kept, failed }` with project-relative paths. Files the project already has are left alone and listed as kept unless `overwrite` is set. REDdeck calls it by name to offer Add to Project on the resources inside a mod's archives. MCP tool `archive_extract_from_mod`. Needs REDbridge 0.7.1 (`archive.extractFromMod`).
- When the old REDcode Core extension is still installed or still loaded, REDcode says so and offers to show it and to reload the window, instead of failing to start with "already registered" errors and missing views. Found when 0.6.0 was installed into windows that still had REDcode Core 0.3.1 loaded.
- Project view: PNG, JPG, BMP and TIFF files open in REDcode's texture viewer, with the checkerboard behind transparency, Fit, 1:1 and Pixels. In VS Code's own preview a black texture on a dark theme could not be seen. Elsewhere in VS Code those formats keep VS Code's preview; REDcode Texture is offered under Open With. PNG, JPG and BMP need no bridge.

## 0.6.0 (2026-10-14)

C4 done: a mod exported, edited, imported, packed, installed and started from REDcode. Needs REDbridge 0.7.0 or newer; the extension refuses an older bridge and offers Update REDbridge.

**The extension is now `edgemodders.redcode`, named REDcode** (it was `edgemodders.redcode-core`, "REDcode Core"). Everything REDcode does lives in this one extension, and the id cannot change once it is on the Marketplace, so it changes now. VS Code sees a new extension: install this one, then uninstall REDcode Core. Settings, commands and keybindings carry over, since their names already start with `redcode.`. The extension's storage folder moves with the id, so run **REDcode: Install REDbridge** once more if REDcode fetched the bridge for you (a bridge you pointed `redcode.bridgePath` at is not affected).

- Project view: a click on a file REDcode has no editor for opens it the way VS Code would, so an exported `.png`, `.jpg` or `.wav` in Raw shows in VS Code's own preview and a `.gltf` in the text editor; it opened everything as text and failed on images. `.tga` and `.dds` open in REDcode's texture viewer (REDbridge 0.7.0), since VS Code cannot show them.
- **Export to Raw** and **Import from Raw** in the Project view, on files (also as hover buttons) and folders. Export writes a game file under `source/archive` to the same path under `source/raw` through WolvenKit's exporter: glTF for meshes, with their material textures, an image for textures, WAV for sounds, and the other types WolvenKit converts; other files stay with Open as JSON. Import brings a raw file back, and the file it replaces keeps its settings (`redcode.import.keepSettings`): a texture keeps all its setup, flags included, which WolvenKit's import alone does not. A folder import takes only re-imports, the newest raw file per game file, so the material textures a mesh export writes into `raw` do not turn into new game textures in the mod. A file open in the CR2W editor reloads after an import. Settings `redcode.export.textureFormat`, `redcode.export.meshFormat` and `redcode.export.meshMaterials`. Needs REDbridge 0.7.0.

## 0.5.0 (2026-10-14)

C4's first half: a mod packed, installed and started from REDcode. Needs REDbridge 0.6.1 or newer; the extension refuses an older bridge and offers Update REDbridge.

- Install, Pack and Install, Uninstall and Run Game. With REDdeck 0.21.0 or newer installed, Install hands the packed project to REDdeck, which adds it as a mod (version dev), refreshes the same mod on every later install and deploys it with its own manifest, conflict check and undo; REDcode asks first when other mods have changes waiting. Without REDdeck, Install copies `packed` into the game itself, records the files in the project's `.redcode/installed.json`, backs up any file that was already there and puts it back on Uninstall. **Install to the Hot Folder** sends the archive to `archive/pc/hot` when Red Hot Tools is in the game. **Run Game** starts it through Steam for a Steam install, else the exe, with `-modded` for a REDmod project (`redcode.launch`).
- The bridge commands name REDbridge, as REDdeck's do: **REDcode: Restart REDbridge**, **Update REDbridge**, **Install REDbridge** and **Show REDbridge log** (the command IDs are unchanged, so keybindings keep working).
- The status bar shows the running bridge's version beside the file count; it was only in the tooltip.
- Pack: cleaning `packed` deletes its files and then the empty folders, so a folder that something has open (a File Explorer window, a terminal) no longer fails the pack with EPERM. Tweak files outside `r6/tweaks` are reported, since TweakXL does not read them there. Resources follow WolvenKit's rules exactly, checked against a WolvenKit pack of the same project: a `.tweak` file outside `r6/tweaks` is left out, and a REDmod gets its `.script` and `.ws` files under `mods/<name>/scripts`, which were dropped before. One deviation: `.tweak` files in `r6/tweaks` are packed, where WolvenKit leaves them out.
- Update bridge on a git checkout first looks for REDbridge processes from other VS Code windows on the same exe, which hold the files the build replaces, and offers to stop them. Without this the build failed with MSB3021. Those windows say the bridge is being updated elsewhere and restart it on the new build when the update finishes. A bridge that stops for any other reason shows a toast with Restart bridge and Show log.
- Pack: **REDcode: Pack**, the package button on the Project view, or the `redcode: pack` build task (Ctrl+Shift+B) packs the project the way WolvenKit does. `packed` is emptied first (`redcode.pack.clean`), `source/archive` becomes `packed/archive/pc/mod/<mod name>.archive` through the bridge, ArchiveXL files go beside it and other resources keep their paths under `packed`. `redcode.pack.redmod` lays it out as a REDmod instead. Paths with capital letters or spaces are reported. Needs REDbridge 0.6.1.
- Project view: the project is the root node, named after the project with the mod name and version beside it, and Reveal in File Explorer on it opens the project folder. Open in CR2W Editor is offered for textures only, since a click already opens the editor for everything else.
- Properties view: follows an editor that opens after every editor was closed. It listened to tab changes, which fire before the document is registered.

## 0.4.0

Needs REDbridge 0.5.1 or newer; the extension refuses an older bridge and offers Update bridge.

- Properties view in the REDcode activity bar: the selected node of the active CR2W editor in the same grid, editable, following the editor's selection; an edit in either place shows in the other.
- CR2W editor E5: a texture (`.xbm`) opens with its image above the grid and the setup fields selected. Game files open in the editor straight from the archives, read-only, through the `redcode-game` scheme: click a file in Game Assets, or Open in Editor; Open as JSON stays in the menu.
- Project view: hovering a file or folder shows Reveal in File Explorer and Delete buttons on the right, like Add to Project in Game Assets. Delete asks first, counting the files in a folder, and sends it to the Recycle Bin.
- Add to Project reveals what it added in the Project view, expanded down to the file (or the folder) and selected, since editing it is the likely next step.
- Install bridge and Update bridge: download the latest REDbridge release from GitHub into the extension's storage and point the bridge path at it, or pull and rebuild when the bridge runs from a git checkout. The bridge is stopped and restarted around the update and the versions are reported. A newer release is offered once per session (`redcode.bridgeUpdateCheck`), and a missing .NET 10 runtime is explained with a winget install offer.

- Bridge client: cr2w document sessions (open, getNode, patch, save, close, describeType, createInstance) for the CR2W editor, with a smoke step. Needs REDbridge 0.5.0.
- The CR2W editor: tree and property grid over a bridge document session, with undo, redo, save, backup and replay. Default for the CR2W file types in a project, and for .json and .csv files that are CR2W inside.
- CR2W editor: search across the file, and a table view for localization files with filter, inline edit, add and delete.
- CR2W editor, from the E3 hand test: the tree pane is resizable (drag the divider, double-click to reset), search hits wrap over two lines instead of being cut off, and Add row scrolls to the new row and focuses it.
- CR2W editor: the atlas view for `.inkatlas` files. The slot's texture with every part drawn over it, click to select, a parts list with filter, add and delete, and the rectangle edited in pixels with both the pixel and the UV rectangle written. Fit, 1:1, Pixels and Labels toggles, a slot picker, the tree one click away. Needs REDbridge 0.5.1, which writes textures the right way up; on 0.5.0 the texture viewer and the atlas view show them upside down.

## 0.3.1

- Publisher is now `edgemodders`, following the move to the Edgemodders organization. The extension id changes from `cyberbuildsai.redcode-core` to `edgemodders.redcode-core`, so VS Code sees a new extension: uninstall the old one after installing this version.

## 0.3.0

- Save JSON to Project: edit a project file as JSON and rebuild the game file from it. The file is read back and values the format did not keep are reported.
- TweakXL: language, grammar, comments, brackets and snippets for `.tweak` files.
- Texture viewer for `.xbm` files in the project and the archives.

## 0.2.0

- Project view over WolvenKit `.cpmodproj` projects, with New Project.
- Game Assets tree over the archives, expanded on demand.
- Add to Project and Extract to..., for files and whole folders.
- Open project files as JSON.

## 0.1.0

- Bridge client, status bar, log channel, Open game file as JSON.
