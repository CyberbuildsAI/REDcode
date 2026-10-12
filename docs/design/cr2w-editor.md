---
title: CR2W editor design
---

# CR2W editor

Draft 0.1, 2026-10-12, for review. The architecture document ([design.html](../design.html), section 07) fixes the shape: a custom editor with a chunk tree, a property grid and a raw JSON view, reading through the bridge in pieces and writing edits as patches, with undo and redo through VS Code's custom editor API. This page turns that into something that can be built and tested.

## What it is for

The owner's five most used file types, measured on 2026-10-12 against a typical file of each kind from the game archives:

| Type | File | JSON | What a modder edits in it | Shape of the edit |
|---|---|---|---|---|
| `.ent` entity | 3.6 KB | 79 KB | Components: names, mesh paths, transforms, appearances | A tree of about 500 nodes. `compiledData` is a copy that WolvenKit rebuilds on save |
| `.mesh` | 163 KB | 495 KB | Appearances, material entries, local material instances | A tree of about 1,000 nodes, but 70% of the JSON is two binary buffers (`renderResourceBlob`, `parameters`) that are never edited by hand |
| `.inkatlas` | 2.8 KB | 20 KB | Slots and their parts: names and clipping rectangles over the atlas texture | A short list that only makes sense drawn over the image |
| `onscreens.json` localization | 8.8 MB | 21 MB | Entries: primary key, secondary key, female and male text | One array of 60,303 rows. A table, not a tree |
| `.xbm` texture | varies | small | Setup: compression, group, mip settings. The pixels come from an import | A handful of properties next to the viewer that already exists |

Two conclusions set the design:

- **One generic editor, three specialised views.** The tree and property grid handle every CR2W file. Localization gets a table, atlases get an overlay on the image, textures get their properties beside the viewer. Each specialised view is a different page over the same data calls, not a different editor.
- **The document never crosses the bridge whole.** The localization file is 21 MB as JSON and takes 0.8 s to convert. Opening it as a text document is already slow, and a text editor is the wrong tool for 60,000 rows. The editor asks for one node at a time, pages arrays, and sends edits as patches.

## What the user sees

The editor opens for every CR2W extension in the project (the roughly 150 in WolvenKit's list) as the default editor, with "Open With..." still offering the text editor and Open as JSON. From the Game Assets view the same editor opens read-only on a temporary copy.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ t2_091_pma_jacket__racing_dec_sticker.mesh      CMesh   163,118 B   [JSON]   │ header, HUD yellow name
├──────────────────────────┬───────────────────────────────────────────────────┤
│ TREE                     │ PROPERTIES                                        │
│ ▸ appearances (6)        │ appearances[0]                 meshMeshAppearance │
│ ▾ materialEntries (9)    │ ─────────────────────────────────────────────── │
│    ▸ [0] default         │ name            CName   [default            ]   │
│    ▸ [1] glass           │ chunkMaterials  array   9 items              ▸   │
│ ▸ localMaterialBuffer    │ tags            array   0 items              +   │
│ ▸ boneNames (58)         │                                                   │
│   renderResourceBlob     │                                                   │
│   204,918 B buffer       │                                                   │
├──────────────────────────┴───────────────────────────────────────────────────┤
│ Modified: 2 edits   Ctrl+Z undo   search: [            ]   bridge 0.5.0      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Tree.** The root chunk's properties, expanded on demand. Arrays show their length and page in blocks of 200. Handles show as a child node with the class name; a reference to a handle already shown is a link that selects the original. Buffers show their size and are not expandable. `compiledData` in entities and appearances shows a note, "rebuilt from components on save", and is read-only.
- **Properties.** The selected node's own fields. Each field is typed: numbers get a number input that shows the 32-bit rounded value when committed, strings and CNames a text input, booleans a toggle, enums a dropdown from the type's values, resource paths a text input with "open" and "pick from Game Assets", and nested structs expand in place. Array fields get add, remove, move up and move down; add creates a default instance of the element type.
- **Raw JSON.** A button in the header, not a tab: it runs Open as JSON for the file. Keeping it outside the editor avoids loading 21 MB into a webview for the one case where it hurts.
- **Footer.** Edit count, undo hint, a search box that searches leaf values through the bridge and lists hits as paths, and the bridge version.

### Specialised views

| View | Opens for | What it adds | Reuses |
|---|---|---|---|
| Table | `localizationPersistenceOnScreenEntries` (the LocKey files such as `onscreens.json`, a few big ones) and `localizationPersistenceSubtitleEntries` (about 300 small files, one per quest or scene) | A virtual table over `root.Data.entries`: the key columns from the row type (`primaryKey` and `secondaryKey` for on-screens, `stringId` for subtitles), then the female and male variants; type-to-filter by key or text, add and delete rows, inline edit. Paged through the bridge 200 rows at a time | The same node and patch calls as the tree |
| Atlas | `inkTextureAtlas` | The texture (through `texture.toPng` of the referenced `.xbm`) with every part's clipping rectangle drawn over it. Click a rectangle to select the part, then edit `clippingRectInPixels` in the grid; the UV rectangle is recomputed from the texture size. Dragging the rectangle's edges is deferred | The texture viewer's image page |
| Texture | `CBitmapTexture` | The properties grid beside the existing viewer: setup fields only | The texture viewer |

Each view is a mode of the same webview page, chosen from the root chunk's `$type`. The tree is always reachable from the header, so nothing is hidden.

## How it reads and writes

### Addressing

A node is named by its path from the root chunk: property names and array indices, the same path the JSON uses, so a path is valid in the editor, in the bridge, in the log and in a patch. Examples: `components.3.name`, `root.Data.entries.41023.femaleVariant`, `slots.Elements.0.parts.2.clippingRectInPixels`. A handle's object is reached through its property, not through a separate chunk index, so the editor never sees WolvenKit's `HandleId` numbers.

### Bridge methods

The bridge holds the parsed file in memory for as long as the document is open. That is what makes partial reads and patches cheap: the 21 MB file is parsed once, in 0.8 s, and every call after that touches a few nodes.

| Method | Request | Response | Notes |
|---|---|---|---|
| `cr2w.open` | `file` (disk path) or `path` (game path) | `doc` id, root type, file size | A game path opens read-only. Parses once |
| `cr2w.getNode` | `doc`, `path`, `offset?`, `limit?` | The node: its kind (`class`, `array`, `handle`, `buffer`, `value`), type name, value for leaves and small structs, and one entry per child with name or index, kind, type, and a one-line preview. Arrays return `total` and the requested window | `limit` defaults to 200. A buffer returns its byte size only |
| `cr2w.describeType` | `type` | The class's properties with their types and default values, enum values for enums, and the element type for arrays | From WolvenKit's reflection. Cached per bridge run. Drives the property grid and validation |
| `cr2w.createInstance` | `type` | A default instance as JSON | For "add" on arrays and handles. Named in the architecture document |
| `cr2w.patch` | `doc`, `ops` | `applied` count and the `inverse` ops | JSON Patch (RFC 6902) subset: `replace`, `add`, `remove`, `move`. Values are in WolvenKit JSON form, the same the text document shows. Applied atomically: all or none, with the error naming the failing op and path |
| `cr2w.search` | `doc`, `query`, `limit?` | Paths and previews of leaves whose value contains the query | For the footer search and the table filter |
| `cr2w.save` | `doc`, `outFile?` | File path and bytes | Runs the same writer as `cr2w.fromJson`, so WolvenKit's pre-processors run (`compiledData` is rebuilt). Then the editor refreshes the nodes it shows |
| `cr2w.close` | `doc` | | Frees the parsed file |

Numbers in `ops` are 64-bit doubles on the wire; the bridge converts to the field's type and the inverse op carries the value as stored, so what undo restores is what the file held.

### The VS Code side

- **Provider.** A `CustomEditorProvider` with a `CustomDocument` per file holding the `doc` id, the bridge connection and the undo stack. `openCustomDocument` calls `cr2w.open`; `resolveCustomEditor` loads the page and wires messages.
- **Edits.** The page sends a patch; the extension calls `cr2w.patch`, keeps the forward and inverse ops, and fires `onDidChangeCustomDocument` with `undo` and `redo` callbacks that send the inverse or forward ops back to the bridge. VS Code owns the dirty flag, Ctrl+Z and the "save changes?" prompt. Nothing is written to disk until save.
- **Save, save as, revert.** `cr2w.save` to the file or the chosen path. Revert closes and reopens the document.
- **Backup.** VS Code asks for a backup of dirty documents at intervals and on shutdown. The backup is the patch log since the last save, as JSON. On reopen with a backup, the extension opens the file and replays the log. The same log replays if the bridge process dies, which is the crash isolation rule from the architecture document: the editor reconnects, reopens, replays, and the user loses nothing.
- **Messages.** The page talks to the extension only: `getNode`, `describeType`, `patch`, `search`, `select`. The extension forwards to the bridge and owns every side effect. `bridgeClient.ts` stays free of VS Code imports and gets one wrapper per method.
- **Properties sidebar.** A `Properties` view in the REDcode container that mirrors the active editor's selection, as the architecture document's layout shows. Second milestone: the in-editor grid comes first.

### Rules shown, not hidden

The three format rules found while testing Save JSON to Project become UI behaviour instead of a README table:

| Rule | In the editor |
|---|---|
| Numbers are 32-bit floats | The number input shows the value the file will hold as soon as the edit is committed |
| `compiledData` is rebuilt from `components` | Shown read-only with the note. The entity's `components` subtree is where edits go |
| Properties at their default are not stored | Invisible by design. The grid shows every property of the type with its default, because `describeType` knows the defaults |

A fourth rule found at the same time, that an unknown property name makes WolvenKit reject the whole file, cannot happen in the editor because the grid only offers the type's properties.

## Numbers that matter

| Measurement | Value | Consequence |
|---|---|---|
| Localization JSON | 21 MB, 60,303 rows, 0.8 s to produce | Page arrays. Never send the document whole |
| Mesh buffers | 70% of the JSON | Buffers are size-only nodes |
| Entity | 79 KB | Could be loaded whole, but the same paging code costs nothing here |
| Nodes per typical file | 500 to 1,000, except localization | The tree can keep every loaded node in memory on the page |
| Bridge parse | 10 ms atlas, 50 ms mesh, 770 ms entity (first call in a run), 790 ms localization | Parse once per open document |

## Milestones

Each is one or two commits and ends with a hand test on the owner's files plus a smoke step.

| Step | Bridge | Extension | Test file |
|---|---|---|---|
| E1 | `open`, `getNode`, `patch`, `save`, `close`, with a document session table and a smoke step that patches a value and reads it back | Client wrappers only | `.ent` |
| E2 | `describeType`, `createInstance` | The custom editor: tree, property grid, undo and redo, save, backup and replay | `.ent` and `.app`, then `.mesh` |
| E3 | `search` | Footer search. The table view | `onscreens.json`, then a subtitles file |
| E4 | | The atlas view, click to select | `.inkatlas` |
| E5 | | Texture properties beside the viewer. The Properties sidebar view. Read-only open from Game Assets | `.xbm` |

Bridge 0.5.0 carries E1 and E2 and `MinBridgeVersion` moves to 0.5.0 when the editor ships, since the editor cannot work without them.

## Deferred

- Embedded files inside a CR2W. Shown as a count in the header; editing them is a later step.
- Editing buffer contents, including material parameter buffers in meshes. Import and export (C4) is the path for those.
- Multi-selection and bulk edit. The table view's filter plus one edit at a time covers the first need.
- Diff against the game's copy. Useful, cheap once `open` accepts a game path, and not needed to ship.
- Graph file types (`.quest`, `.scene`), which get their own editors in C6.

## Decisions

Agreed with the owner on 2026-10-12:

1. `.app` appearance files are in the first test list with `.ent`. They share the `compiledData` rule and the components tree.
2. The table view opens subtitle files as well as on-screens from the start. The only difference is the key columns, which come from the row type.
3. The atlas view ships with click-to-select and numeric editing of the rectangle. Dragging edges is deferred.
