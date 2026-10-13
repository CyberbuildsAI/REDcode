# Changelog

## Unreleased

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
