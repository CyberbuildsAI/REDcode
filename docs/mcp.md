# MCP server

`@edgemodders/redcode-mcp` ([npm](https://www.npmjs.com/package/@edgemodders/redcode-mcp)) exposes REDbridge to AI assistants as an MCP server over stdio. Claude Code, REDagent or any MCP client gets the same engine the REDcode editor uses: the archives, CR2W files as JSON, textures, hashes, and node-by-node editing through document sessions. This is the "mcp" row of the bridge protocol in the [design document](design.html).

The package lives at `packages/redcode-mcp` and is MIT: it spawns REDbridge and talks JSON-RPC over stdio, the same boundary the extension keeps.

## Setup

```
claude mcp add redcode -- npx -y @edgemodders/redcode-mcp
```

It needs Windows, the game, the .NET 10 runtime and REDbridge 0.8.0 or newer (REDcode's Install REDbridge fetches it). To run it from a REDcode checkout instead: `npm install`, `npm run mcp:build`, then `claude mcp add redcode -- node "<REDcode checkout>\packages\redcode-mcp\dist\server.cjs"`.

Releases go out from a pushed `mcp-vX.Y.Z` tag: `.github/workflows/publish-mcp.yml` checks the tag against the package version, builds, publishes to npm with provenance (secret `NPM_TOKEN`) and makes a GitHub release from `packages/redcode-mcp/CHANGELOG.md`.

The server finds REDbridge.exe and the game folder from `--bridge` and `--game`, from `REDBRIDGE_EXE` and `REDCODE_GAME_PATH`, or from the VS Code settings `redcode.bridgePath` and `redcode.gamePath`. On a machine with REDcode set up, no configuration is needed. The bridge starts on the first tool call, loads the archive index in about three seconds, and stays up for the session.

## Tools

| Group | Tools |
|---|---|
| Archives | `bridge_info`, `archive_search`, `archive_list`, `archive_tree`, `archive_extract`, `archive_extract_many`, `archive_open_mod`, `archive_extract_from_mod` |
| Conversion | `cr2w_to_json`, `cr2w_file_to_json`, `cr2w_from_json`, `texture_to_png`, `texture_file_to_png`, `hash_fnv1a64`, `hash_resolve` |
| Project | `project_export` (a game file under `source/archive` to glTF, an image, Ogg and so on under `source/raw`), `project_import` (back again), `project_pack` |
| TweakDB | `tweakdb_types`, `tweakdb_records` (by type or prefix, with chosen flats and LocKey text), `tweakdb_record`, `tweakdb_flat`, `tweakdb_search`, `tweakdb_names`: the game's TweakDB as shipped, read offline (REDnode reads the live one) |
| Sounds | `sound_events` (find sound effect events by name or tag, with their variations), `sound_extract` (write them as `.opus`) and `sound_import` (replace them in a project from `<hash>.wav` files) |
| Document sessions | `cr2w_open`, `cr2w_get_node`, `cr2w_get_nodes`, `cr2w_search`, `cr2w_patch`, `cr2w_save`, `cr2w_close`, `cr2w_documents`, `cr2w_describe_type`, `cr2w_create_instance` |
| One call | `cr2w_read` (open, read paths, close) and `cr2w_edit_file` (open, patch, save, close; a game path with `outFile` gives a modified copy, the archives are never changed) |

The tool descriptions carry the path convention and the three format rules, so an assistant that has only the tool list can work correctly: paths are dotted from the root chunk as in WolvenKit's JSON; numbers are 32-bit floats; `compiledData` is rebuilt from `components` on save; defaults are not stored.

Verified on 2026-10-12 with an MCP client script against a game install: 21 checks covering every tool group, including a one-call edit of a game light into a mod folder with `compiledData` rebuilt to match.

Full tool reference: [packages/redcode-mcp/README.md](https://github.com/Edgemodders/REDcode/blob/main/packages/redcode-mcp/README.md).
