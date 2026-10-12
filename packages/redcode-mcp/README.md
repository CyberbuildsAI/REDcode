# redcode-mcp

REDbridge as an MCP server. An assistant such as Claude Code or REDagent gets the same engine REDcode's editor uses: search and extract from the Cyberpunk 2077 archives, convert CR2W files to WolvenKit JSON and back, decode textures, hash strings, and edit CR2W files node by node through a document session with patches. The server spawns REDbridge and talks to it over stdio; nothing links WolvenKit in-process, so this package stays MIT.

## Setup

The server needs REDbridge.exe and the game folder. It looks, in order, at the command line, the environment, and the VS Code settings REDcode uses, so a machine with REDcode set up needs no configuration.

| Setting | Command line | Environment | VS Code setting |
|---|---|---|---|
| REDbridge.exe, or the folder containing it | `--bridge <path>` | `REDBRIDGE_EXE` | `redcode.bridgePath` |
| Game folder | `--game <path>` | `REDCODE_GAME_PATH` | `redcode.gamePath` |
| Per-user .NET runtime | `--dotnet-root <path>` | `DOTNET_ROOT` | `redcode.dotnetRoot` |

Build it from the REDcode checkout:

```
npm install
npm run mcp:build
```

Register it with Claude Code (the path is the built server):

```
claude mcp add redcode -- node "E:\Modding\Cyberpunk 2077\REDcode\packages\redcode-mcp\dist\server.cjs"
```

Any other MCP client takes the same command. The bridge starts on the first tool call and loads the archive index, about three seconds, then stays up for the session. If it dies, the next call restarts it; open document sessions are lost.

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
| `cr2w_open`, `cr2w_get_node`, `cr2w_patch`, `cr2w_save`, `cr2w_close`, `cr2w_documents` | A document session: parse once, read one node at a time with arrays paged, apply JSON Patch operations atomically with inverse operations returned, write through WolvenKit's writer |
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
