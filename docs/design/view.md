---
title: View (C5)
---

# View: meshes, sound, TweakDB, LocKeys, and the REDnode loop

Draft 0.2, 2026-10-14, agreed with the owner the same day (decisions at the end). The C5 phase of the [design](../design.html): seeing and looking up what a mod is made of, without leaving REDcode. Five steps, each a commit or two with a hand test on the owner's machine, in the order below. Each step is detailed when its turn comes, as with [Ship (C4)](ship.html).

## Two sources: the files, and the running game

| | Offline, through REDbridge | Live, through REDnode |
|---|---|---|
| Reads | The game's files: archives, `tweakdb.bin`, localization | The running game: TweakDB as it is in play, with every mod's changes |
| Needs | REDbridge and the game folder | The game running with REDnode, and a development endpoint REDcode can reach |
| Good for | Writing a mod: browsing, looking up, previewing | Testing a mod: live values, trying a change, logs, the debugger |

REDcode reads offline first, since that works while a mod is being written. The live side arrives with the REDnode loop (V5). Where both exist, they share the shape of their answers, so a view can show the live value next to the file's.

## V1 Mesh viewer

A 3D view of meshes, so a modder sees what a `.mesh` is without Blender. **Built 2026-10-14**, hand test pending: `webview/meshViewer.ts` (bundled with three.js 0.170.0 into `media/mesh/viewer.js`, its licence beside it), the CR2W editor's `mesh` mode, `src/meshExport.ts` (export to the cache through `project.export` with all LODs and no materials, again only when the source is newer; a `.gltf` sent with its buffers inline) and `src/meshViewer.ts` (the `.glb` and `.gltf` viewer). Checked in Chrome on `tower.mesh` from the owner's project (7 submeshes, 338 triangles) and the Nokota Osprey from the game (LOD 1 44,459 triangles, LOD 2 4,638). Found: WolvenKit names nodes `submesh_NN_LOD_N` with LOD 1 the most detailed, exports one LOD unless the LOD filter is off, and keeps each submesh's material name in the mesh's extras.

- **A mode of the CR2W editor**, as the atlas and the table are: a `.mesh` opens on the 3D view with **Tree** one click away. `.glb` and `.gltf` files in `source/raw` open in the same viewer, since VS Code has none.
- **The model comes from the export REDcode already has.** The bridge's `project.export` (0.7.0) writes a `.glb`; for a game file the extension extracts it into a cache first. No new bridge method.
- **Rendering**: three.js, bundled into the extension (MIT), so the webview loads nothing from the network. Orbit, pan and zoom, a grid, wireframe, bounds and polygon counts, LOD and submesh toggles. Materials as flat colours first; textures from the export's material files after that.
- **Test**: the owner's `tower.mesh`, a weapon and a character mesh from the game.

## V2 Audio player

Listening to the game's sounds and a mod's own, in the editor.

- `.wem` files and the sounds an `.opusinfo` lists, from the project or the game, export to WAV through `project.export` into the cache and play in a webview with a waveform, play, loop and the length. WAV files in `source/raw` already play in VS Code's own preview.
- Unverified: how the game's sounds are spread over `.wem` and `.opus` packages, and how long an `.opusinfo` export takes. Settled at the start of V2.

## V3 TweakDB browser

Looking up records and flats while writing a mod: `Items.Preset_Yinglong_Default`, its type, every flat with its value, and the records it points to.

- **REDbridge 0.8.0 `tweakdb` methods** over WolvenKit's TweakDB reader, on the game's `tweakdb.bin` and `tweakdb_ep1.bin`, loaded once when first asked:

  | Method | Returns |
  |---|---|
  | `tweakdb.records(type?, prefix?, offset, limit)` | Record paths, by type or path prefix, paged |
  | `tweakdb.record(path)` | The record's type and every flat with its type and value; ids as paths where names are known |
  | `tweakdb.flat(path)` | One flat's type and value |
  | `tweakdb.search(text, limit)` | Records and flats whose path contains the text |
  | `tweakdb.types()` | Record types with their record counts |
  | `tweakdb.names(ids)` | Paths for TweakDB ids, from WolvenKit's names list |

  The same methods are what REDnode's T3 waits for (reads through `kernel.bridge()` without the game) and what REDbridge request #3 asks for (`tweakdb.names`), so one piece of bridge work serves REDcode, REDnode and REDagent.
- **REDcode**: a TweakDB view in the REDcode activity bar (by type, then by path; a search box) and a record page with its flats, where a foreign key opens the record it names. **New tweak from this record** writes a TweakXL YAML file under `source/resources/r6/tweaks/<mod>/` that clones or edits the record, ready to change and pack. Hovering a record path in a `.yaml` or `.tweak` file shows its type and main flats.
- **Live, with V5**: the record page shows the running game's value beside the file's, and **Try in game** sets a flat through REDnode's T2, which REDnode undoes when the mod stops.
- **No TweakDB data in this repository**, as in REDnode: everything is read from the player's game.

## V4 LocKey browser

Finding the text behind `LocKey#12345`, and the LocKey for a text.

- **REDbridge `loc` methods** over the game's localization files (`onscreens.json` per language, the base game and Phantom Liberty): `loc.search(text, language, limit)` by key or text, `loc.get(keys, language)`. The project's own `onscreens.json` entries win over the game's, as they do in game.
- **REDcode**: a search box in the TweakDB view's neighbour, results with the key, the secondary key and the female and male text; **Copy LocKey**; **Add to the project's onscreens** opens the table view on a new row. Hovering `LocKey#...` in a tweak file or the CR2W editor shows the text.

## V5 The REDnode loop

Edit a REDnode mod in REDcode, deploy it into the running game without a restart, and get the game's logs, events and a debugger back. This is the core of the "one loop" goal, and it spans two repositories.

- **Its own extension**, `redcode-rednode`, an optional add-on, and its own design page written with the REDnode session, since it needs a **development endpoint on REDnode's side** that does not exist yet: deploy or hot reload a package, stream logs and events, report the Node inspector's port.
- **What REDcode brings**: a deploy command over REDdeck's REDnode kind (REDdeck already deploys REDnode packages to `red4ext/plugins/REDnode/apps/<id>`), an output channel for the game's log, a launch configuration that attaches VS Code's debugger to the REDnode process, and the live halves of V3 and V4.
- **Order**: last in C5, because it waits on REDnode. Its design page can start as soon as REDnode has room for the endpoint.

## Deferred

- **Textures on meshes** beyond flat colours, if the export's material files turn out to be costly to map: V1 ships geometry first.
- **Animations** played on a rig in the mesh viewer: needs the rig and `.anims` export, a later step.

## Decisions

Agreed with the owner, 2026-10-14:

1. The mesh viewer is a mode of the CR2W editor, as the atlas and the table are; `.glb` and `.gltf` files open in the same viewer.
2. **New tweak from this record** writes YAML, TweakXL's common form.
3. The order is V1 to V5, with the REDnode loop last.
4. **The script runner is dropped**, on the owner's condition that what WolvenKit's scripts do can reasonably be done another way, such as by asking an agent. Checked against WolvenKit's `ScriptFunctions`:

   | WolvenKit scripts do | In REDcode |
   |---|---|
   | Read game files; convert to and from JSON, and between YAML and JSON | An agent with the MCP tools (`archive_*`, `cr2w_to_json`, `cr2w_from_json`); YAML and JSON it converts itself |
   | Batch export, import, pack, and value edits over many files | An agent with `project_export`, `project_import`, `project_pack` and the `cr2w_*` document tools |
   | Templates: named presets for new objects | Partly: `cr2w_create_instance` gives the game's defaults; named presets do not exist yet |
   | Hooks: a script run by itself on every export, import or save | **Not covered**: an agent acts when asked. If a mod needs "always do X after import", it comes back as a small REDcode setting or task, not a script runner |
