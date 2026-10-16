# @edgemodders/redcode-mcp

Cyberpunk 2077 modding tools for AI assistants, over the Model Context Protocol (MCP). An assistant such as Claude Code gets the same engine as REDcode, the Cyberpunk 2077 modding workspace for Visual Studio Code. It can:
- search and extract from the game's archives
- read CR2W files as WolvenKit JSON, write them back, and edit them node by node with patches
- decode textures
- read TweakDB
- find and extract game sounds
- export, import and pack a WolvenKit project

The server starts [REDbridge](https://github.com/Edgemodders/REDbridge), which runs [WolvenKit](https://github.com/WolvenKit/WolvenKit)'s libraries, and talks to it over stdio. Nothing links WolvenKit into this package, so it stays MIT. Credit for the file formats and the engine belongs to the WolvenKit team.

## What you need

- Windows, and Cyberpunk 2077 installed.
- REDbridge. REDcode's **Install REDbridge** command fetches it, or you can unzip a [REDbridge release](https://github.com/Edgemodders/REDbridge/releases) anywhere.
- The .NET 10 runtime: `winget install Microsoft.DotNet.Runtime.10`.
- Node.js 20 or newer.

## Setup

Register it with Claude Code:

```
claude mcp add redcode -- npx -y @edgemodders/redcode-mcp
```

Any other MCP client takes the same command: `npx -y @edgemodders/redcode-mcp`.

The server needs REDbridge.exe and the game folder. It looks for them in order: the command line, then the environment, then the VS Code settings REDcode uses. So on a machine where REDcode is set up, it needs no configuration.

| Setting | Command line | Environment | VS Code setting |
|---|---|---|---|
| REDbridge.exe, or the folder containing it | `--bridge <path>` | `REDBRIDGE_EXE` | `redcode.bridgePath` |
| Game folder | `--game <path>` | `REDCODE_GAME_PATH` | `redcode.gamePath` |
| Per-user .NET runtime | `--dotnet-root <path>` | `DOTNET_ROOT` | `redcode.dotnetRoot` |

For example: `claude mcp add redcode -- npx -y @edgemodders/redcode-mcp --bridge "D:\Tools\REDbridge" --game "D:\Games\Cyberpunk 2077"`.

The bridge starts on the first tool call and loads the archive index in about three seconds, then stays up for the session. If it dies, the next call restarts it, and any open document sessions are lost. The tools need REDbridge 0.8.0 or newer; TweakDB and the sound names need 0.8.0 and 0.7.2.

To build from source, run `npm install` and `npm run mcp:build` in the [REDcode repository](https://github.com/Edgemodders/REDcode), then point the client at `packages/redcode-mcp/dist/server.cjs` with `node`.

## Tools

| Tool | What it does |
|---|---|
| `bridge_info` | Versions, game folder, archive and file counts |
| `archive_search`, `archive_list`, `archive_tree` | Find game files by substring, by prefix or archive with paging, or one folder level at a time |
| `archive_extract`, `archive_extract_many` | Copy game files to disk as they are |
| `cr2w_to_json`, `cr2w_file_to_json` | A game file or a file on disk as WolvenKit JSON, inline (cut at `maxChars`, 200,000 by default) or written to `outFile` |
| `cr2w_from_json` | Write a CR2W file from WolvenKit JSON |
| `texture_to_png`, `texture_file_to_png` | Decode an `.xbm` to PNG |
| `hash_fnv1a64`, `hash_resolve` | Hash a string; look a hash up |
| `archive_open_mod`, `archive_extract_from_mod` | List the resources in a mod's `.archive` on disk; extract them, by game path or hash. No game needed |
| `project_export`, `project_import`, `project_pack` | WolvenKit's exporter (a mesh to glTF, a texture to an image, a `.wem` to Ogg) and importer between `source/archive` and `source/raw`; pack a folder into `<modName>.archive` |
| `loc_languages`, `loc_search`, `loc_get` | The game's on-screen texts (LocKeys) per language, base game and Phantom Liberty, read offline. Search by LocKey, secondary key or words of the text; get by LocKey or secondary key. With `projectDir`, the project's own onscreens entries win. Bridge 0.10.0 |
| `tweakdb_types`, `tweakdb_records`, `tweakdb_record`, `tweakdb_flat`, `tweakdb_search`, `tweakdb_names` | TweakDB as the game ships it, read offline from `tweakdb_ep1.bin` (the first call loads it, about 12 s). Records by type (subtypes included) or prefix with the flats you name, one record with every flat, one flat, a search by path words, and ids to paths. Record links come back as paths, LocKeys as `{ key, text }`. Bridge 0.8.0 |
| `sound_events` | Find the game's sound effect events by words in their name or tags, each with the hashes of its sounds (its variations). Names from WolvenKit's event list, game 1.6. Bridge 0.7.2 |
| `sound_import` | Override game sound effects in a project from `<hash>.wav` files: the changed `.opuspak` files and a new index go into its `source/archive`. Bridge 0.9.0 |
| `sound_extract` | Write an event's sounds, by name or hash, or single sounds by hash, as `.opus` files (Ogg Opus, 48 kHz) |
| `cr2w_open`, `cr2w_get_node`, `cr2w_get_nodes`, `cr2w_search`, `cr2w_patch`, `cr2w_save`, `cr2w_close`, `cr2w_documents` | A document session: parse once, read one node or several at a time with arrays paged, search values and property names below a path, apply JSON Patch operations atomically with inverse operations returned, write through WolvenKit's writer |
| `cr2w_describe_type`, `cr2w_create_instance` | A type's properties, defaults and enum values; a default instance to add |
| `cr2w_read` | Open, read several paths, close, in one call |
| `cr2w_edit_file` | Open, patch, save, close, in one call. With a game path and `outFile`, a modified copy; the archives are never changed |

Paths are dotted from the root chunk and match WolvenKit's JSON: property names, array indices, `Data` under a handle or a buffer, `Chunks` under a package. The tool descriptions carry the three format rules an assistant has to know: numbers are 32-bit floats, `compiledData` is rebuilt from `components` on save, and defaults are not stored. The design is in [docs/design/cr2w-editor.md](../../docs/design/cr2w-editor.md).

## Example

Make a copy of a game light with a bigger radius, in one call:

```json
{
  "tool": "cr2w_edit_file",
  "path": "base\\entities\\lights\\photomode_arealight.ent",
  "outFile": "E:\\mods\\mymod\\source\\archive\\base\\entities\\lights\\photomode_arealight.ent",
  "ops": [{ "op": "replace", "path": "components.0.radius", "value": 12 }]
}
```

The result names the file written, its size, and the inverse operation that would undo the edit.
