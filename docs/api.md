---
title: Extension API
---

# REDcode's API for other extensions

REDcode returns an API from `activate()`, so other VS Code extensions can use REDcode without importing its code. EDGEwave, the EDGE sound studio, asked for it in [REDcode issue #4](https://github.com/Edgemodders/REDcode/issues/4); REDcode uses REDdeck's API the same way.

## Getting it

List REDcode in your `package.json`, so VS Code activates it first:

```json
"extensionDependencies": ["edgemodders.redcode-cyberpunk"]
```

Then:

```ts
const ext = vscode.extensions.getExtension<REDcodeApi>("edgemodders.redcode-cyberpunk");
const api = ext?.isActive ? ext.exports : await ext?.activate();
if (api?.apiVersion === 1) {
  // use it
}
```

`activate()` returns `undefined` when REDcode could not start, such as when an old REDcode id is still installed beside it. Copy the interfaces from [`src/api.ts`](https://github.com/Edgemodders/REDcode/blob/main/extensions/redcode/src/api.ts) into your extension; they are the contract. New members may be added within version 1. A change that breaks callers raises `apiVersion`.

## Version 1

| Member | What it does |
|---|---|
| `apiVersion` | `1` |
| `version` | REDcode's version, such as `0.9.0` |
| `bridge()` | The running REDbridge client, or `undefined`. Its methods mirror REDbridge's JSON-RPC methods |
| `gamePath()` | The game folder REDcode reads, or `undefined` when `redcode.gamePath` is not the game |
| `project()` | The open WolvenKit project: name, mod name, `.cpmodproj` file, folder, and its `archive`, `raw`, `resources` and `packed` folders. Or `undefined` |
| `onDidChangeProject` | Fires with the new `project()` when a project opens or closes |
| `soundIndex()` | The game's sound effects: `{ count, events }`, where each event has `hash`, `name` (or `null`), `tags` and `sounds` (the hashes of its variations). Loaded once per bridge process |
| `sound(ref)` | A sound's audio as `{ data, mime, codec, channels, sampleRate, name }`, in a form a webview decodes |
| `importFile(file, options?)` | Imports a file under the project's `source/raw` back into `source/archive`, as Import from Raw does, and returns `{ ok, written, mesh? }`. A GLB with no `.mesh` at its path needs `{ template }`, a game path or `.mesh` to start from; `mesh` reports the submeshes, the GLB's material names per submesh, the material entries, appearances and what was resized. A `<hash>.wav` replaces that game sound effect. Needs REDbridge 0.9.0 for templates and sounds |
| `pack()` | Packs the open project, as REDcode: Pack does, and returns `{ packedDir, archive, archiveFiles }` |
| `packAndTry()` | Packs and gets the mod into the game: `"hot"` when it went to Red Hot Tools' hot folder, which the running game reloads; `"installed"` when it was installed for the next start; `undefined` when the pack failed, or when it would break the mod (a missing REDmod custom sound) and the user cancelled |
| `editInBlender(file)` | Opens a project `.glb`, `.gltf` or `.mesh` in Blender; each save there is imported back into `source/archive` |

### Sound references

`sound(ref)` takes one of these, the shape EDGEwave's `edgewave.openSound` takes too:

| Reference | For | Comes back as |
|---|---|---|
| `{ soundHash, eventHash? }` | A sound effect in the game's `sfx_container.opusinfo` | 16-bit WAV at 48 kHz |
| `{ path }` | A game file, such as a voice line (`base\localization\en-us\vo\...wem`) | Ogg Vorbis for a `.wem`, through REDcode's export cache |
| `{ uri }` | A file on disk or a `redcode-game:` URI | Ogg Vorbis for a `.wem`, WAV for Opus, other formats as they are |

VS Code's webview cannot decode Opus, so REDcode decodes it and returns WAV. Ogg Vorbis and WAV decode with the webview's `decodeAudioData`, so a caller needs no decoder of its own.

## Open in EDGEwave

REDcode's audio player and its sound list (Browse Game Sounds) have an **Open in EDGEwave** button. It runs EDGEwave's command `edgewave.openSound` with the reference of the sound now playing:
- A sound effect gives `{ soundHash, eventHash }`.
- A game file gives `{ path }`.
- A file on disk gives `{ uri }`.

Without EDGEwave installed, the button offers to install it.
