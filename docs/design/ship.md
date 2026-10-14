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
| Resources | Copies every other file under `source/resources`, keeping its relative path, except `.xl`, `.script`, `.ws`, `.tweak` and `info.json` | `packed/<same relative path>`, so `resources/r6/tweaks/x.yaml` becomes `packed/r6/tweaks/x.yaml` |
| REDmod only | `info.json`, `customSounds`, scripts and tweaks | `packed/mods/<ModName>/` |
| Install | Copies `packed/` onto the game folder and writes an install log of the files for uninstall | The game folder |
| Hot install | Same, with archives sent to `archive/pc/hot` instead of `mod`, for Red Hot Tools to reload without a restart | `archive/pc/hot` |

Only the archive writer needs WolvenKit's libraries. The copies are plain file operations.

One deviation, found in the S1 hand test on 2026-10-13: WolvenKit leaves every `.tweak` file out of a plain pack, so a TweakXL tweak in RED format under `resources/r6/tweaks` never reaches the game while the same tweak as `.yaml` does. REDcode packs `.tweak` files from `r6/tweaks` and, like WolvenKit, leaves out any `.tweak` elsewhere, with a warning. Worth reporting upstream when the WolvenKit team is contacted.

## Decisions

- **The bridge packs, the extension copies.** `project.pack` on the bridge writes the archive through `ModTools.Pack`. The ArchiveXL and resource copies, the install, the uninstall and the hot variant are file operations the extension does itself, so they work without a round trip and the bridge stays small.
- **Same output as WolvenKit.** The `packed` layout above is kept exactly, so a project packed in REDcode installs the same way and a WolvenKit user sees nothing new.
- **Packed is rebuilt from scratch.** Pack empties `packed` first (setting `redcode.pack.clean`, default on), so a file removed from the project does not linger in the mod.
- **Install is reversible.** Install records the files it copied in `.redcode/installed.json` inside the project; Uninstall removes those and nothing else. Reinstalling first removes the previous set, so a renamed file does not leave a stale copy in the game.
- **Pack is a build task too.** A task provider offers `redcode: pack` and `redcode: pack and install`, so Ctrl+Shift+B does the usual thing and keybindings and `tasks.json` can refer to them.
- **REDmod is a switch, not a second path.** `redcode.pack.redmod` changes the archive folder and adds the REDmod files, as in WolvenKit; the default is off, since most mods ship as plain archives.

## S1 Pack

Bridge, REDbridge 0.6.1 (0.6.0 went to EDGEbuilder's `mesh.info` and `sector.build`):

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

Agreed 2026-10-13, after looking at the owner's game folder: Vortex has marked `archive/pc/mod`, and REDdeck deploys with its own manifest. A third tool copying files in would go unseen by both, so **Install goes through REDdeck when it is installed**, and copies directly only when it is not. REDdeck 0.21.0 exports a small API from `activate()` for this, found at runtime with `extensions.getExtension("edgemodders.reddeck").exports`:

| Call | Does |
|---|---|
| `apiVersion` | 1; REDcode refuses anything else and offers the direct install |
| `gamePath()` | The folder REDdeck deploys to; REDcode notes it when it differs from `redcode.gamePath` |
| `projectMod(projectFile)` | The id of the mod that follows the project, for Uninstall |
| `installProject(projectFile)` | Adds the packed output as version dev, or refreshes that mod in place (order kept) and turns it on |
| `pendingMods(except)` | Mods with changes waiting, so REDcode asks before a deploy takes them along |
| `deploy()` | REDdeck's own Deploy, with its questions and its message |
| `turnOff(id)` | For Uninstall, followed by `deploy()` |

The same install is `reddeck install-project` on REDdeck's command line and the `reddeck_install_project` MCP tool. The direct install, the hot folder and Run game are REDcode's own, as below.


- **REDcode: Install** copies `packed` onto `redcode.gamePath` and writes `.redcode/installed.json`. **REDcode: Uninstall** removes what that file lists. **REDcode: Pack and Install** chains the two. A hot variant, offered when `archive/pc/hot` exists or Red Hot Tools is detected under `bin/x64/plugins` (unverified until tested), sends the archive there.
- **REDcode: Run game** launches the game. Starting `bin/x64/Cyberpunk2077.exe` directly works for GOG; a Steam install may want `steam://rungameid/1091500` so Steam's overlay and achievements come along. Both are offered, the choice remembered in a setting.

## S3 Export

Built 2026-10-14. REDbridge 0.7.0 `project.export` wraps `ModTools.Export` on the project layout: a file under `source/archive` goes to the same relative path under `source/raw`, and the result lists every file written (a mesh writes its `.glb`, a `.Material.json` and its material textures, which go into `raw` as WolvenKit's command line puts them in its output folder). Types come from WolvenKit's `ECookedFileFormat`: `.mesh`, `.w2mesh`, `.xbm`, `.wem`, `.opusinfo`, `.csv`, `.mlmask`, `.cubemap`, `.xcube`, `.envprobe`, `.texarray`, `.morphtarget`, `.fnt`, `.anims`, `.inkatlas`, `.physicalscene`. Others are refused, since WolvenKit would dump their raw buffers; JSON is their editable form. Two findings: WolvenKit's `ModTools` remembers what it exported in the process and silently skips a second export of the same file, so the bridge calls `ClearFileLookup` first; and the settings page is VS Code's own, with four settings for the options that matter (texture format, `.glb` or `.gltf`, materials on or off, keep settings on import) and WolvenKit's defaults for the rest.

## S4 Import

Built 2026-10-14. `project.import` wraps `ModTools.Import`: images to `.xbm`, glTF and GLB to `.mesh`, WAV, CSV, masks, fonts and animations back to their game files, with WolvenKit's "use existing file" on by default. Finding: WolvenKit reads the existing texture's setup itself only when it runs as its command line (`ImportExportArgs.IsCLI`); its app fills the import dialog from that file first. The bridge does what the dialog does, passing `XbmImportArgs(existing.Setup)`, and then puts back the four flags those settings cannot carry (`isStreamable`, `allowTextureDowngrade`, the two mip biases). Checked on TestMod and in the smoke run: a re-imported texture has all ten setup fields of the original and the image the right way up. REDcode's folder import takes only re-imports, raw files whose game file already exists in `source/archive`, the newest per game file, because a mesh export's material textures in `raw` would otherwise become new textures in the mod that override the game's.

## Deferred

- Packing sounds and REDmod scripts beyond the file copy.
- Zip of the packed folder for upload, which WolvenKit offers; cheap to add later.
- A launch configuration that attaches REDnode's debugger after Run game, which belongs to the `redcode-rednode` extension.
