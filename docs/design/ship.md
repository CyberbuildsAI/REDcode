---
title: Ship (C4)
---

# Ship: pack, install, export, import

Draft 0.1, 2026-10-13. The C4 phase of the [design](../design.html): the first mod built start to finish inside REDcode. Four steps, each a commit with a hand test on the owner's project. Pack is detailed here because it comes first; export and import get their detail when their turn comes.

## What WolvenKit does

Read from WolvenKit's `RED4Controller` and `ModTools` at the pinned submodule, so REDcode produces the same `packed` folder a WolvenKit user expects.

| Step | WolvenKit | Where it lands |
|---|---|---|
| Pack archives | Warns about capital letters or spaces in paths under `source/archive`, then writes every file there into one archive named after the mod | `packed/archive/pc/mod/<ModName>.archive` (REDmod: `packed/mods/<ModName>/archives/`) |
| ArchiveXL | Copies `source/resources/**/*.xl` | Beside the archive |
| Resources | Copies every other file under `source/resources`, keeping its relative path, except `.script`, `.ws` and `info.json` | `packed/<same relative path>`, so `resources/r6/tweaks/x.yaml` becomes `packed/r6/tweaks/x.yaml` |
| REDmod only | `info.json`, `customSounds`, scripts and tweaks | `packed/mods/<ModName>/` |
| Install | Copies `packed/` onto the game folder and writes an install log of the files for uninstall | The game folder |
| Hot install | Same, with archives sent to `archive/pc/hot` instead of `mod`, for Red Hot Tools to reload without a restart | `archive/pc/hot` |

Only the archive writer needs WolvenKit's libraries. The copies are plain file operations.

## Decisions

- **The bridge packs, the extension copies.** `project.pack` on the bridge writes the archive through `ModTools.Pack`. The ArchiveXL and resource copies, the install, the uninstall and the hot variant are file operations the extension does itself, so they work without a round trip and the bridge stays small.
- **Same output as WolvenKit.** The `packed` layout above is kept exactly, so a project packed in REDcode installs the same way and a WolvenKit user sees nothing new.
- **Packed is rebuilt from scratch.** Pack empties `packed` first (setting `redcode.pack.clean`, default on), so a file removed from the project does not linger in the mod.
- **Install is reversible.** Install records the files it copied in `.redcode/installed.json` inside the project; Uninstall removes those and nothing else. Reinstalling first removes the previous set, so a renamed file does not leave a stale copy in the game.
- **Pack is a build task too.** A task provider offers `redcode: pack` and `redcode: pack and install`, so Ctrl+Shift+B does the usual thing and keybindings and `tasks.json` can refer to them.
- **REDmod is a switch, not a second path.** `redcode.pack.redmod` changes the archive folder and adds the REDmod files, as in WolvenKit; the default is off, since most mods ship as plain archives.

## S1 Pack

Bridge, REDbridge 0.6.0:

| Method | Params | Result |
|---|---|---|
| `project.pack` | `dir` (the `source/archive` folder), `outDir`, `modName` | `{ archive, bytes, files, warnings }`; `warnings` lists the paths with capital letters or spaces |

Extension:

- **REDcode: Pack.** Needs a project and the bridge. Cleans `packed`, calls `project.pack`, copies ArchiveXL and resource files, then logs each step and the archive size to the REDcode channel. The Packed root in the Project view refreshes and reveals the archive. Warnings about paths show once as a notification with Show log.
- **An empty `source/archive`** is not an error: the mod may be resources only. Pack says so and still copies resources.
- **Progress** in the status bar while packing, since a large project takes seconds.
- **Task provider** with `redcode: pack` as the default build task of a project folder.

Test: the owner's TestMod, with its `.ent`, atlas, localization and tweak files. Compare the archive with one WolvenKit packs from the same project: same file list, loadable by the game.

## S2 Install and run

- **REDcode: Install** copies `packed` onto `redcode.gamePath` and writes `.redcode/installed.json`. **REDcode: Uninstall** removes what that file lists. **REDcode: Pack and Install** chains the two. A hot variant, offered when `archive/pc/hot` exists or Red Hot Tools is detected under `bin/x64/plugins` (unverified until tested), sends the archive there.
- **REDcode: Run game** launches the game. Starting `bin/x64/Cyberpunk2077.exe` directly works for GOG; a Steam install may want `steam://rungameid/1091500` so Steam's overlay and achievements come along. Both are offered, the choice remembered in a setting.

## S3 Export

Export a project file to `source/raw` over Modkit's exporter: glTF for meshes (with the material and rig options), PNG for textures, WAV for sounds, JSON for the rest. One command on a project file and on a folder, a small settings page for the options that matter, and the defaults WolvenKit uses. Detail to follow once S1 and S2 are done.

## S4 Import

The reverse: a changed `raw` file back into `source/archive`, keeping the original's settings where WolvenKit does (texture group and compression from the existing `.xbm`, for instance). Detail with S3.

## Deferred

- Packing sounds and REDmod scripts beyond the file copy.
- Zip of the packed folder for upload, which WolvenKit offers; cheap to add later.
- A launch configuration that attaches REDnode's debugger after Run game, which belongs to the `redcode-rednode` extension.
