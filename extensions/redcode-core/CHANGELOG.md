# Changelog

## Unreleased

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
