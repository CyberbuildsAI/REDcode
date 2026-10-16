# Changelog

## Unreleased

- `loc_languages`, `loc_search` and `loc_get`: the game's on-screen texts (LocKeys), with a project's own over them. Needs REDbridge 0.10.0.
- `project_import` takes `template`, a game path or `.mesh` to start a new mesh from when a GLB has no mesh to import over, and a mesh import returns `mesh`: submeshes, the GLB's material names per submesh, material entries, appearances and what was resized. Needs REDbridge 0.9.0.
- `sound_import`: override game sound effects in a project from `<hash>.wav` files. Needs REDbridge 0.9.0.

## 0.2.0 (2026-10-16)

The first version on npm, as `@edgemodders/redcode-mcp`. It needs REDbridge 0.8.0.

- Run it with `npx -y @edgemodders/redcode-mcp`. Everything is bundled into one file, so an install pulls no other package. The bundled packages' notices are in `dist/ThirdPartyNotices.txt`.
- TweakDB tools: `tweakdb_types`, `tweakdb_records`, `tweakdb_record`, `tweakdb_flat`, `tweakdb_search`, `tweakdb_names`.
- Game sound tools: `sound_events`, `sound_extract`.
- Project tools: `project_export`, `project_import`, `project_pack`.
- Mod archive tools: `archive_open_mod`, `archive_extract_from_mod`.

## 0.1.0 (2026-10-12)

Not published. The first tools were the archives, CR2W to JSON and back, textures, hashes, and document sessions with patches.
