# <span class="y">Tests</span>

Every test of REDcode on record: how to run it again, what to expect, and what it showed. Each step of the build ends with a hand test by the owner in VS Code ([CR2W editor](design/cr2w-editor.html#milestones), [Ship](design/ship.html), [View](design/view.html)). Add new tests here when they are first run.

Gathered on 2026-10-16 from the design pages, the project notes and the session logs. Last updated 2026-10-16.

## At a glance

| Test | Kind | Phase | Last run | Result |
|---|---|---|---|---|
| [Type check and build](#type-check-and-build) | Automated | All | 2026-10-16 | Pass |
| [Smoke test](#smoke-test-the-bridge-client-against-the-game) | Automated, needs the game | C1 on | 2026-10-16 | Pass |
| [Bridge checks against the game](#bridge-checks-against-the-game) | Scripts outside the repo | C3 on | 2026-10-16 | Pass |
| [MCP server](#mcp-server) | MCP client script | C3 on | 2026-10-16 | Pass; `loc_*` not run |
| [WolvenKit round trip](#c2-wolvenkit-round-trip-and-extract-to) | By hand | C2 | 2026-10-11 | Pass |
| [Save JSON to Project](#save-json-to-project) | By hand | C3 | 2026-10-11 | Pass |
| [Texture viewer](#texture-viewer) | By hand | C3 | 2026-10-11 | Pass after a fix |
| [TweakXL language](#tweakxl-language) | By hand | C3 | 2026-10-11 | Pass |
| [E2 CR2W editor](#e2-the-cr2w-editor) | By hand | C3 | 2026-10-12 | Pass after a fix |
| [E3 search and table](#e3-search-and-the-table-view) | By hand | C3 | 2026-10-13 | Pass, three fixes |
| [E4 atlas view](#e4-the-atlas-view) | By hand | C3 | 2026-10-13 | Pass after REDbridge 0.5.1 |
| [Bridge install and update](#bridge-install-and-update) | By hand | C3 | 2026-10-13 | Pass |
| [E5 texture view, read-only files, Properties](#e5-texture-view-read-only-game-files-properties-view) | By hand | C3 | 2026-10-13 | Pass, three fixes |
| [S1 Pack](#s1-pack) | By hand | C4 | 2026-10-13 | Pass after two fixes |
| [S2 Install and Run](#s2-install-and-run) | By hand | C4 | 2026-10-14 | Pass; hot folder not run |
| [S3 Export, S4 Import](#s3-export-and-s4-import) | By hand | C4 | 2026-10-14 | Pass, one fix |
| [V1 mesh viewer](#v1-mesh-viewer) | By hand | C5 | 2026-10-14 | Pass |
| [Tree filter](#tree-filter) | By hand | C5 | 2026-10-14 | Pass |
| [Copy path](#copy-path) | By hand | C5 | 2026-10-14 | Pass |
| [V2 audio player](#v2-audio-player) | By hand | C5 | 2026-10-15 | Pass on the retest |
| [V3 TweakDB view](#v3-tweakdb-view) | By hand | C5 | 2026-10-15 | Pass, one fix |
| [Unreleased: issues #5 to #8 and V4](#pending-the-unreleased-work) | By hand | C5 | Not run | |
| [Never run](#never-run) | | | Not run | |

## Automated

### Type check and build

```powershell
npm install
npm run typecheck
npm run build
```

Expected: no errors. `npm run build` bundles every extension and the MCP server with esbuild.

### Smoke test: the bridge client against the game

```powershell
cd extensions\redcode
$env:DOTNET_ROOT = "$env:LOCALAPPDATA\Microsoft\dotnet"
npm run smoke -- "<path to REDbridge.exe>" "<Cyberpunk 2077 folder>"
```

Drives `bridgeClient.ts` without VS Code ([dev setup](dev-setup.html), section 4). It prints one line per step with its time; any step that throws stops the run.

| Step | Checks |
|---|---|
| `bridge.info`, `archive.archives`, `archive.search nokota` | The bridge starts and indexes the game |
| `cr2w.toJson`, `hash.fnv1a64`, `hash.resolve` | Conversion and hashing on the first search hit |
| `sound.events`, `tweakdb` | Event names (bridge 0.7.2) and TweakDB reads (bridge 0.8.0); skipped on an older bridge |
| `archive.tree`, `archive.extractMany`, `cr2w.fileToJson` | Browsing and extraction |
| `cr2w.open`, `getNode`, `patch` and its inverse, `save` | A document session: a value patched, undone, saved to a new file and read back after reopening |
| `texture.toPng`, `texture.fileToPng` | Textures from the game and from disk |
| `project.pack`, `archive.openMod`, `archive.extractFromMod` | Pack the extracted files and read the archive back (bridge 0.6.1 on) |
| `project.export`, `project.import` | A texture to PNG and back, keeping its setup (bridge 0.7.0 on) |

About 8 seconds on the reference machine before TweakDB; the first TweakDB load adds about 12 seconds.

### Bridge checks against the game

Each new bridge method was checked by a script against the owner's game before the hand test. The scripts lived in the session's scratch folder and are **not in the repo**, so they cannot be rerun as they are. What they showed:

| Date | Bridge | Checks | Result |
|---|---|---|---|
| 2026-10-12 | 0.5.0 document sessions (E1) | 40: node reads at every level of an entity, replace with its inverse, add, insert, move and remove on a mesh's bone names, a bad operation leaves nothing applied, a wrong value type is rejected with its path, save and reopen, `compiledData` rebuilt after save, read-only game opens refuse patches, the onscreens file | Pass. Open the 8.8 MB onscreens file 377 ms, a page of 200 rows under 1 ms |
| 2026-10-13 | 0.5.1 to 0.7.0 (C4) | Pack against WolvenKit's pack of TestMod; export and re-import of a texture keeps all ten setup fields and the image the right way up | Pass |
| 2026-10-14 | 0.7.2 sound (V2) | 74 sounds sampled across all packages come out as valid Ogg | Pass |
| 2026-10-15 | 0.8.0 TweakDB (V3) | 843 types; Clothing has `Items` (1,991) and `TEST` (6); "quadra type66" finds 415 records in 38 ms | Pass |
| 2026-10-15 | `REDcodeApi` (#4) | Sound index in 126 ms, a sound effect as WAV in 16 ms, voice lines, project files, bad references | Pass |
| 2026-10-16 | 0.9.0 (REDbridge #5, #6) | A GLB imported over a game mesh template; sound effect WAVs back into `.opuspak` and `.opusinfo` | Pass |
| 2026-10-16 | 0.10.0 `loc` (V4) | 22: 19 languages; search by words, `LocKey#n`, number and secondary key; an unknown key gives null; a project `.xl` overlay wins for its language only; `loc.newFile` with no `.xl`, with an `.xl` holding other blocks (CRLF kept), a second language, a flow list; a row added through a patch reads back as the project's row 0 | Pass |

The editor page, the mesh viewer, the audio player and the TweakDB record page were also run in Chrome over a recorded bridge fixture before each hand test. That checks the page, not the extension host.

### MCP server

Register the server ([MCP](mcp.html)) and run a client against it. Checked by an MCP client script each time tools were added:

| Date | Tools | Result |
|---|---|---|
| 2026-10-12 | The first 23 (archives, conversion, document sessions, `cr2w_read`, `cr2w_edit_file`) | 21 checks pass, including a game light copied with a bigger radius and both `components` and the rebuilt `compiledData` holding it |
| 2026-10-14 | `sound_events`, `sound_extract` | Pass |
| 2026-10-15 | The six `tweakdb_*` tools | Pass |
| 2026-10-16 | `@edgemodders/redcode-mcp` 0.2.0 installed from its packed `.tgz` into an empty folder and started through `npx` | All 38 tools listed; bridge, TweakDB and sound tools answer |
| | `loc_languages`, `loc_search`, `loc_get` | **Not run through a client yet.** The bridge methods under them pass |

## Before any hand test

| Need | Why |
|---|---|
| The repo built and **F5** with **Run REDcode** (or **Run REDcode and REDdeck** when REDdeck is part of the test) | Runs the source in an Extension Development Host; the installed copy is replaced while it runs |
| **REDcode: Update REDbridge** first when the test needs a new bridge | The checkout path pulls and builds. Other windows' bridges lock the exe; the command offers to stop them |
| The test project `E:\Modding\Cyberpunk 2077\Projects\TestMod` | WolvenKit project with an `.ent`, `.app`, atlas, onscreens file, `tower.mesh`, a decal `.xbm` and tweaks. Nothing from it goes into this repo |
| The REDcode output channel | Most steps log there; send its lines with any failure |

**Known: the development host sometimes aborts at startup** (exit code 134, seen on 2026-10-12, 10-13, 10-14 and 10-15). Pressing F5 again works, sometimes on the third try. Cause unverified. Next time, read the Debug Console of the F5 window for the assertion text.

## C2: WolvenKit round trip and Extract To

Run 2026-10-11 by the owner: **pass.**

| # | Do | Expected |
|---|---|---|
| 1 | **New Project**, then add one file and one whole folder from Game Assets | Files under `source/archive` |
| 2 | Open the `.cpmodproj` in WolvenKit | It loads, shows the same files and packs |
| 3 | Edit or add a file in WolvenKit, save, then **Refresh Project** in REDcode | The view picks it up; the XML diffs cleanly |
| 4 | **Extract To** on a folder; extract the same folder in WolvenKit | Same output |

## C3: Edit

### Save JSON to Project

Run 2026-10-11: **pass.** On the first try the value reverted, because the edit was under `compiledData`, which WolvenKit rebuilds from `components`. Numbers come back as 32-bit floats (0.22 reads 0.219999...).

| # | Do | Expected |
|---|---|---|
| 1 | Add an `.ent` or `.app` from Game Assets, click it under Archive | It opens as JSON with the yellow Save JSON to Project icon in the editor title |
| 2 | Change a value under `components`, Ctrl+S | The project file is not touched yet |
| 3 | Click the yellow icon and confirm | "Saved" with the byte count; the Project view refreshes |
| 4 | Click the file again | The JSON shows the new value |
| 5 | Open the project in WolvenKit | The file loads with the value |
| 6 | Break the JSON and click the icon | Refused with "not valid JSON"; the file is left alone |

### Texture viewer

Run 2026-10-11: **pass after a fix.** The image first showed as broken (401 from the webview resource URL); the viewer now sends the PNG inline when the URL fails.

| # | Do | Expected |
|---|---|---|
| 1 | Click an `.xbm` in Game Assets | The image over a checkerboard, its size in the header |
| 2 | Fit, 1:1, Pixels | Each works |
| 3 | Add it to the project and click it under Archive; open it from the Explorer too | The same viewer, from the file on disk |
| 4 | Open With... the text editor | Still possible |
| 5 | Stop the bridge and reopen a project `.xbm` | "Bridge is not running", not an empty tab |

### TweakXL language

Run 2026-10-11: **pass.**

| # | Do | Expected |
|---|---|---|
| 1 | Open `extensions/redcode/samples/example.tweak` | Keywords, names, types, numbers, strings and comments each coloured |
| 2 | `record`, `append`, `fk` and Tab | Snippets expand |
| 3 | Ctrl+/ on some lines | `//` comments toggle |
| 4 | Type `{` | `}` auto-closes; brackets highlight their pair |

### E2: the CR2W editor

Run 2026-10-12 on an `.ent` and an `.app`: **pass after a fix.** Found: after an edit and Ctrl+S, a duplicate row appeared and the tab stayed dirty until a second save. Fixed (pending input is flushed before every save) and retested the same day.

| # | Do | Expected |
|---|---|---|
| 1 | Click an `.ent` under Archive | The CR2W editor: yellow file name, root type and size, tree and property grid |
| 2 | Expand `components`, click one | Its properties with types; small structs inline |
| 3 | Change a number, Enter | "Set components.0.radius" in the footer, dirty dot |
| 4 | Ctrl+Z, Ctrl+Y | Reverts and reapplies |
| 5 | Click `compiledData` | Yellow banner, fields disabled |
| 6 | Change a value, Ctrl+S, reopen | The value is there, in `compiledData` too |
| 7 | Close the host with an unsaved edit, reopen | The edit is restored, the tab dirty |
| 8 | On an array, + add, remove, move | Each works |
| 9 | JSON button | The file as text |

### E3: search and the table view

Run 2026-10-13: **pass, three fixes.** Found: Add row did not scroll to the new row; long search hits overflowed the pane; the tree pane needed a resizable divider. All three fixed the same night; no separate retest is recorded.

Setup: add `base\localization\en-us\onscreens\onscreens.json`, one file from `base\localization\en-us\subtitles\` and an `.ent` to the project.

| # | Do | Expected |
|---|---|---|
| 1 | In the `.ent`, type in the footer search, Enter | A results list: path, type, preview |
| 2 | Click a hit | The tree expands to it, the grid shows it |
| 3 | Search a component name | Two hits; the `compiledData` one dimmed and read-only with its banner |
| 4 | Esc | Results clear |
| 5 | Open `onscreens.json` | The CR2W editor in table mode: keys, female and male text, 200 rows a page |
| 6 | Type in the filter | Rows narrow, the count in the status line |
| 7 | Edit a text and a key cell; undo, redo | The cells follow |
| 8 | + add row, edit, delete, undo the delete | Lands on the new row; the row returns |
| 9 | Tree, then Table | Same file; filter and page kept |
| 10 | Ctrl+S, close, reopen | Edits kept; the file still opens in WolvenKit |
| 11 | Open the subtitles file | The same table with a `stringId` column |
| 12 | Open a plain settings `.json` | The normal text editor |

### E4: the atlas view

Run 2026-10-13: **pass after REDbridge 0.5.1.** Found: on `item_icons.inkatlas` the parts did not sit on their icons, while WolvenKit's did. Game textures are stored bottom-up; REDbridge 0.5.1 flips them on `toPng` as WolvenKit does. Use `base\gameplay\gui\common\icons\items\item_icons0.inkatlas`; `item_icons.inkatlas` one folder up, in `basegame_1_engine`, is an older leftover.

| # | Do | Expected |
|---|---|---|
| 1 | Add `base\gameplay\gui\common\icons\achievement_icons.inkatlas`, open it | The texture with five rectangles, labels on, the first part selected |
| 2 | Click rectangles and list rows; change a pixel value, Enter; Ctrl+Z | The rectangle moves and back |
| 3 | Slot picker to slot 1 and back | The 1080p texture |
| 4 | Add a part, rename, delete, undo | Each works |
| 5 | Save, reopen | Edits kept |
| 6 | Open `base\gameplay\gui\common\icons\items\item_icons0.inkatlas` | Hundreds of parts, labels off, each on its icon; filter, Fit and 1:1 work |
| 7 | Tree, then Atlas | The part expanded and selected |

### Bridge install and update

Run 2026-10-13: **pass.** Not run: the .NET runtime prompt, which needs a machine without .NET 10.

| # | Do | Expected |
|---|---|---|
| 1 | Reload with a checkout one commit behind | The old version in the status bar |
| 2 | **REDcode: Update REDbridge** | Build lines in the log, about a minute, then "REDbridge 0.5.0 → 0.5.1" |
| 3 | Update again | A quick rebuild, "0.5.1 is running" |
| 4 | Clear `redcode.bridgePath` | A prompt offers Install REDbridge |
| 5 | Accept | Download with progress; the setting points under the extension's storage |
| 6 | Update on that install | "Already the latest release" |
| 7 | Set `redcode.bridgePath` back to the checkout exe | |

Install REDbridge overwrites `redcode.bridgePath`, so note the old value first. REDdeck has its own `reddeck.bridgePath`.

### E5: texture view, read-only game files, Properties view

Run 2026-10-13: **pass, three fixes.** Found: the Open With list lacked the editor for `.xbm` (a second view type fixed it); the Project view needed the project as its root node; the Properties view did not follow a newly opened file after all editors were closed (it now follows the editor's own shown event). No separate retest is recorded.

| # | Do | Expected |
|---|---|---|
| 1 | Open With **REDcode CR2W Editor** on a project `.xbm` | The image above the grid, `setup` selected |
| 2 | Click an `.ent` in Game Assets | The editor with a lock on the tab, "game copy, read-only", no edit controls; Open as JSON still in the menu |
| 3 | Open the Properties view with a project `.ent` active; click nodes, edit on each side; Ctrl+Z in the editor | The sidebar follows; edits show on both sides; undo reverts both |
| 4 | Switch to a text tab, then close the editor | The sidebar keeps the node, then shows the empty message |

## C4: Ship

### S1 Pack

Run 2026-10-13 on TestMod: **pass after two fixes.** Found: Update REDbridge failed while other windows ran bridges from the same exe (it now offers to stop them); the build task failed with EPERM on cleaning `packed` (fixed). Against WolvenKit's pack of TestMod: the same 21 resources, same sizes, same archive size, identical loose files. Kept on purpose: `.tweak` files in `r6/tweaks` are packed, where WolvenKit drops them.

| # | Do | Expected |
|---|---|---|
| 1 | **REDcode: Update REDbridge** | "REDbridge 0.5.1 → 0.6.1" |
| 2 | Open TestMod, press the package button | `packed/archive/pc/mod/TestMod.archive` revealed; the tweak under `packed/r6/tweaks` |
| 3 | Ctrl+Shift+B, `redcode: pack` | The same log in a terminal |
| 4 | Pack the same project in WolvenKit into a copy and compare | Same file list |
| 5 | Turn on `redcode.pack.redmod`, pack | The archive in `packed/mods/<mod>/archives`, `info.json` from the project file. Turn it off and pack again after |

### S2 Install and Run

Run 2026-10-14 through REDdeck: **pass.** The direct install (no REDdeck) was checked against a fake game folder only. Not run: the hot folder, since Red Hot Tools is not installed here.

TestMod carries edited copies of real game files; while installed they replace the game's. Uninstall takes them out.

| # | Do | Expected |
|---|---|---|
| 1 | F5 with **Run REDcode and REDdeck** | REDdeck's Mods view shows the library |
| 2 | Open TestMod, press the rocket (**Pack and Install**) | A pack, then REDdeck adds "TestMod" version dev and deploys; a question first if other mods have changes waiting |
| 3 | Look in the game folder | `archive/pc/mod/TestMod.archive`, the `.xl`, the YAML in `r6/tweaks`, all in `reddeck.deployment.json` |
| 4 | Rocket again | The same TestMod refreshed, not a second one |
| 5 | **Uninstall** from the Project view's `...` | REDdeck turns it off and deploys; the files leave |
| 6 | Play button, **Run Game** | Steam starts the game |

### S3 Export and S4 Import

Run 2026-10-14: **pass, one fix.** Found: a click on a `.png` in Raw gave a "cannot open" toast. Fixed: files with no REDcode editor open as VS Code would, and `.tga` and `.dds` open in the texture viewer (`texture.imageToPng`). A follow-up the same day sends project PNG, JPG, BMP and TIFF to the texture viewer too, for its checkerboard behind an all-black texture; **that follow-up has not been retested.**

| # | Do | Expected |
|---|---|---|
| 1 | **REDcode: Update REDbridge** | "REDbridge 0.6.1 → 0.7.0" |
| 2 | Export button on `tower.mesh` | `tower.glb`, a `.Material.json` and material textures under Raw, the `.glb` selected |
| 3 | Export `w_borg_decal_01_n01_alpha.xbm`, edit the PNG, **Import from Raw**, open the `.xbm` in the editor | The edit shows; setup fields unchanged |
| 4 | **Import from Raw** on the Raw root | Only the mesh and the decal, not the `engine/textures/editor` images |
| 5 | Right-click an `.ent` | No Export entry |
| 6 | Optional: change `tower.glb` in Blender, import, Pack and Install, look in game | Not reported |

## C5: View

### V1 mesh viewer

Run 2026-10-14: **pass** (step 2 first, steps 3 to 5 after the filter below).

| # | Do | Expected |
|---|---|---|
| 1 | Click `tower.mesh` under Archive | The 3D view; orbit, wireframe and submesh checkboxes work; Tree and 3D switch |
| 2 | Open `ep1\weapons\firearms\rifle_sniper\nokota_osprey\entities\meshes\w_rifle_sniper__nokota_osprey__base1_01.mesh` from Game Assets | The LOD picker: 44,459 triangles at LOD 1, 4,638 at LOD 2 |
| 3 | Click `tower.glb` under Raw | The same viewer |
| 4 | Look at the contrast in the dark theme and how it navigates | Acceptable |

### Tree filter

Run 2026-10-14: **pass.**

| # | Do | Expected |
|---|---|---|
| 1 | Game Assets, Filter, `osprey mesh` | The Osprey meshes as you type, folders open |
| 2 | Enter | The filter stays; the pattern and count above the tree |
| 3 | `ep1/weapons/*.xbm`, then `*.mesh` | The second says it shows only part (5,000 of about 102,000) |
| 4 | Add to Project on a folder in the filtered tree | Only the matching files |
| 5 | Clear Filter | The full tree |
| 6 | Project view, filter `.xbm`, clear | Roots with no match hidden, then back |

### Copy path

Run 2026-10-14: **pass.**

| # | Do | Expected |
|---|---|---|
| 1 | Copy button on a file and a folder in Game Assets, paste | The game path, without quotes |
| 2 | Copy button on a file, a folder and a root in the Project view, paste | The full path on disk |

### V2 audio player

First run 2026-10-14: sound effects failed with "no supported source was found" (VS Code's webview decodes no Opus), and a `.wav` in Raw had no Open With. Fixed: REDcode decodes Opus itself (opus-decoder) and sends WAV; the Project view runs VS Code's Open With. **Retest 2026-10-15: pass.**

| # | Do | Expected |
|---|---|---|
| 1 | **REDcode: Update REDbridge** | 0.7.2 or later in the status bar |
| 2 | **Browse Game Sounds**, filter `revol reload`, click a row, then a variation | It plays, the clock moves; the format line says "Played as WAV, decoded from Opus by REDcode" |
| 3 | Loop, seek, Space, arrow keys, Copy Hash, Save | Each works |
| 4 | Game Assets filter `vo .wem`, click one | A voice line plays |
| 5 | Save a sound as `.opus` into Raw, click it | The same player |
| 6 | Right-click a `.wav` in Raw, Open With..., **REDcode Audio** | The player |
| 7 | Set `redcode.gamePath` to a wrong folder, reload | REDcode offers the found install (REDdeck's or Steam's); **Use It** restores it |

Found in step 7: the host aborted at startup twice after the setting change (see [Before any hand test](#before-any-hand-test)).

### V3 TweakDB view

Run 2026-10-15: **pass, one fix.** Found: the new tweak file stayed buried in the Project view; it is now revealed. No separate retest is recorded. Open in EDGEwave was checked without EDGEwave installed.

| # | Do | Expected |
|---|---|---|
| 1 | Open the **TweakDB** view | A loading message for about 10 s, then 843 types |
| 2 | Clothing, Items, click a record | The record page with its flats |
| 3 | Click a link such as `equipArea`, then Back | Follows and returns |
| 4 | Filter `quadra type66`, then Clear | 415 records, then the types |
| 5 | Right-click a record, **New Tweak from This Record**, Clone, keep the path | A YAML file under `source/resources/r6/tweaks/<mod>/` opens |
| 6 | Hover the `$base` path in it | Type and main flats, with a link |
| 7 | **REDcode: Open TweakDB Record...**, type `jacket` | Matching records |
| 8 | Play a sound in Browse Game Sounds, **Open in EDGEwave** | Without EDGEwave: an offer to install it |

## Pending: the unreleased work

Built 2026-10-16, on main, not released. Run **REDcode: Update REDbridge** first (bridge 0.10.0), then F5. Not run yet.

| # | Do | Expected |
|---|---|---|
| 1 | **Sound WAV import** (REDbridge #6): Copy Hash on a sound, export it, edit the WAV, save it as `<hash>.wav` under `source/raw`, **Import from Raw** | The log lists the `.opuspak` and `.opusinfo` written |
| 2 | **GLB as a new mesh** (REDbridge #5): Import from Raw on a `.glb` with no `.mesh` at its path | Asks for a game mesh as template; the log reports submeshes, materials and appearances |
| 3 | **Viewer appearances** (#6): a `.mesh` with several appearances; a GLB with its own textures | An Appearance list; the GLB's textures, with Shading back to flat colours |
| 4 | **Pack and Try** (#7) | Without Red Hot Tools: Pack and Install |
| 5 | **Edit in Blender** (#7) on a `.glb` or `.mesh` | Blender opens; each Ctrl+S in Blender re-imports; the status bar shows the watch |
| 6 | **Custom sounds** (#8): `redcode.pack.redmod` on, a `customSounds` entry in `source/resources/info.json`, its WAV in `source/customSounds`, Pack | The WAV in `packed/mods/<mod>/customSounds`, the entry in the manifest. A missing WAV, or a plain pack, warns |
| 7 | **LocKeys** (V4): search `Johnny Silverhand`, then `LocKey#7052`; switch the language | Results with key and texts in each language |
| 8 | Add a result to Project Onscreens | A new `.json` and `.xl` appear; the table opens on row 0 |
| 9 | Change the text, save, search again | The project's version, with a pencil icon |
| 10 | Hover a `LocKey#` in a `.yaml` file; open a file with `LocKey#` values in the CR2W editor | The text in the hover, and beside the value |

Checked outside VS Code so far: the bridge methods ([above](#bridge-checks-against-the-game)), the Blender script with Blender 5.2.2 in background mode, the custom sound copy on a fake project with REDmod on and off, and the viewer's appearances in the Chrome harness.

## Never run

| Test | Why |
|---|---|
| Hot folder install and Pack and Try's hot path | Red Hot Tools is not installed here; its detection is unverified |
| The EDGEmat material hook in the mesh viewer | Waits on EDGEmat shipping `renderMaterials`; checked only with a stand-in |
| The .NET runtime prompt | Needs a machine without .NET 10 |
| Open in EDGEwave with EDGEwave installed | EDGEwave does not register `edgewave.openSound` yet |
| A custom sound from a REDmod pack in game | Not tried in the game |
