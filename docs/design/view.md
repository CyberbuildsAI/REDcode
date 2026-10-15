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

A 3D view of meshes, so a modder sees what a `.mesh` is without Blender. **Done 2026-10-14**, hand-tested by the owner and released in REDcode 0.7.0: `webview/meshViewer.ts` (bundled with three.js 0.170.0 into `media/mesh/viewer.js`, its licence beside it), the CR2W editor's `mesh` mode, `src/meshExport.ts` (export to the cache through `project.export` with all LODs and no materials, again only when the source is newer; a `.gltf` sent with its buffers inline) and `src/meshViewer.ts` (the `.glb` and `.gltf` viewer). Checked in Chrome on `tower.mesh` from the owner's project (7 submeshes, 338 triangles) and the Nokota Osprey from the game (LOD 1 44,459 triangles, LOD 2 4,638). Found: WolvenKit names nodes `submesh_NN_LOD_N` with LOD 1 the most detailed, exports one LOD unless the LOD filter is off, and keeps each submesh's material name in the mesh's extras.

- **A mode of the CR2W editor**, as the atlas and the table are: a `.mesh` opens on the 3D view with **Tree** one click away. `.glb` and `.gltf` files in `source/raw` open in the same viewer, since VS Code has none.
- **The model comes from the export REDcode already has.** The bridge's `project.export` (0.7.0) writes a `.glb`; for a game file the extension extracts it into a cache first. No new bridge method.
- **Rendering**: three.js, bundled into the extension (MIT), so the webview loads nothing from the network. Orbit, pan and zoom, a grid, wireframe, bounds and polygon counts, LOD and submesh toggles. Materials as flat colours first; textures from the export's material files after that.
- **Test**: the owner's `tower.mesh`, a weapon and a character mesh from the game.

## V2 Audio player

Listening to the game's sounds and a mod's own, in the editor. **Done 2026-10-15**, hand-tested by the owner and released in REDcode 0.8.0: `src/audio.ts` (no VS Code imports), `src/audioPlayer.ts`, `media/audio/`, and REDbridge 0.7.2 `sound.events`.

Settled at the start of V2, against the game:

| Kind | Where | How REDcode plays it |
|---|---|---|
| Voice lines and some music, `.wem` with readable paths | `lang_en_voice.archive` (most), `audio_1_general.archive` | `project.export` writes Ogg Vorbis in about 0.1 s; cached by modification time, like the 3D view's `.glb` |
| Sound effects, 73,139 sounds in 1,879 `.opuspak` files | `audio_2_soundbanks.archive`, indexed by `sfx_container.opusinfo` (2 MB) | Read straight from the pack: each sound is a RIFF header and then a plain Ogg Opus stream, which the webview plays as it is. WolvenKit's export of the index writes nothing unless given sound hashes, so it is not used |
| Wwise soundbanks, 202 `.bnk` | `audio_2_soundbanks.archive` | Not covered |

- **V2a, one sound.** `.wem` and `.opus` open in the player by default, from the project, Game Assets or the redcode-game scheme; WAV, Ogg, MP3 and FLAC get it under Open With and keep VS Code's preview. The page shows the waveform (click or drag to seek), play, loop, the time, codec, channels and rate, and Save writes what is playing to a file.
- **V2b, the sound effects.** An `.opusinfo` opens as a list of its events with each event's sounds as numbered variations; **REDcode: Browse Game Sounds** opens the game's own index. The index groups sounds under event hashes, and an event's hash is Wwise's FNV-1 of its lower-case name, so REDbridge's `sound.events` (0.7.2) serves WolvenKit's event list (game 1.6) with hashes: 14,476 of the 20,569 groups get a name, 16,127 events have sounds. Filter by name, tag or hash; a click plays; arrow keys step; Copy Hash and Save. Without 0.7.2 the list shows hashes only and says so. The pack comes out of the archives into the cache on first use (a few ms); a project's `.opusinfo` reads packs beside it first.
- **MCP**: `sound_events` (find events by words) and `sound_extract` (write an event's variations, or sounds by hash, as `.opus`).
- **Found**: the .opusinfo layout follows WolvenKit's `OpusInfo`. In the owner's hand test (2026-10-14) VS Code's `<audio>` refused the Ogg Opus sounds that Chrome plays ("no supported source was found"), and the retest showed `decodeAudioData` and WebCodecs refuse Opus there too. So the extension decodes Opus itself: `audio.ts` reads the Ogg pages and feeds the packets to opus-decoder (MIT, libopus in WebAssembly), trims to the last granule position, and sends 16-bit WAV, which the page plays through Web Audio. ogg-opus-decoder was not used: its codec-parser dependency is LGPL. Measured: 1 to 5 ms for a typical sound, 0.7 s for the longest (7 minutes, 42 MB of WAV), lengths equal to the index's WAV sizes. The Project view had no Open With..., which only the Explorer offers; it now runs VS Code's `explorer.openWith` on the file.

## V3 TweakDB browser

Looking up records and flats while writing a mod: `Items.Preset_Yinglong_Default`, its type, every flat with its value, and the records it points to.

**Bridge methods and MCP tools built 2026-10-14** (REDbridge 0.8.0, `BridgeApi.TweakDB.cs`; client methods `tweak*` in `bridgeClient.ts`; MCP `tweakdb_*`), ahead of the view because other sessions' agents need TweakDB reads. The view is next.

- **REDbridge 0.8.0 `tweakdb` methods** over WolvenKit's TweakDB reader, on the game's `tweakdb_ep1.bin` (`tweakdb.bin` when there is none), loaded once when first asked:

  | Method | Returns |
  |---|---|
  | `tweakdb.records(type?, prefix?, flats?, offset, limit, resolveLocKeys?, language?)` | Records by type (subtypes included, short names like `Clothing` work) or path prefix, paged, each with the flats asked for (`["*"]` for all). This is the shape EDGEmat asked for in REDbridge issue #4 |
  | `tweakdb.record(path)` | The record's type and every flat with its type and value; ids as paths where names are known |
  | `tweakdb.flat(path)` | One flat's type and value |
  | `tweakdb.search(text, type?, limit)` | Records whose path contains every word |
  | `tweakdb.types()` | Record types with their record counts |
  | `tweakdb.names(ids)` | Paths for TweakDB ids, from WolvenKit's names list, matched on the low 40 bits; needs no load |

  The same methods are what REDnode's T3 waits for (reads through `kernel.bridge()` without the game) and what REDbridge request #3 asks for (`tweakdb.names`), so one piece of bridge work serves REDcode, REDnode and REDagent.
- **Measured** on the owner's game: 193,354 records of 843 types, loaded in about 12 s; after that, the 1,997 clothing records with four flats and their display names come back in 37 ms. A record's flats are found by extending the record's hash with `.name`, as WolvenKit's `GetFullRecord` does, so every record reads, named or not. Values: record links as paths (a `0x` id when the names list does not know it), LocKeys as `{ key, text }` with the text from the base and Phantom Liberty `onscreens.json` when asked, resource references as paths, enums as names, structs in WolvenKit's JSON. Unverified: whether the game loads `tweakdb_ep1.bin` or `tweakdb.bin` without Phantom Liberty installed; the bridge takes the first it finds.
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
