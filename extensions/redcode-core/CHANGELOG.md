# Changelog

## Unreleased

- Bridge client: cr2w document sessions (open, getNode, patch, save, close) for the CR2W editor, with a smoke step. Needs REDbridge 0.5.0.

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
