# REDcode on Nexus Mods

The source of REDcode's Nexus Mods page lives here, so updates are edits in the repo, not in Nexus's text box.

| File | What it is |
|---|---|
| `description.bbcode` | The page's description, in Nexus's BBCode. Paste the whole file into the description field (the editor's source mode, or switch to BBCode) |
| `README.md` | This page: the other fields of the Nexus form, the download file, and how to update |

## The Nexus form

| Field | Value |
|---|---|
| Mod name | REDcode for Cyberpunk 2077 |
| Version | REDcode's version, from `extensions/redcode/package.json` (for example 0.9.0) |
| Category | Modders Resources and Tutorials (check the list for Cyberpunk 2077 when creating the page) |
| Brief overview | A Cyberpunk 2077 modding workspace in VS Code, built on WolvenKit: browse the archives, edit CR2W files, view textures, meshes and sounds, browse the TweakDB, pack and install. A VS Code extension, not a game mod. (255 characters at most; this is 213) |
| Author | Edgemodders |
| Language | English |
| Primary image | `docs/assets/brand/social.png` (1280 x 640). The banner (`docs/assets/brand/banner.png`) is already at the top of the description |
| Requirements | None on Nexus. Off-site: VS Code 1.70 or later (or VSCodium, or EDGEkit); REDbridge and the .NET 10 runtime, which REDcode offers to install. Optional: EDGEdeck, once it has a Nexus page |
| Permissions | MIT: open source, free to modify and redistribute with the license notice. Bundled packages keep their licenses (`ThirdPartyNotices.txt`). REDbridge, a separate download, is GPL-3.0 |
| Tags | Modders resource, utility, tools |

The description has screenshot placeholders in cyan italics (`[Screenshot N: ...]`). Upload each picture to the page's Images tab, then replace its placeholder line with `[img]<the image's Nexus URL>[/img]` and a one-line caption.

## The download

One main file: `REDcode-<version>-nexus.zip`, with:

| File | What it is |
|---|---|
| `redcode-cyberpunk-<version>.vsix` | The extension, the same file the Marketplace and Open VSX have |
| `README.txt` | How to install it: Install from VSIX in VS Code, or `code --install-extension` |
| `LICENSE.txt`, `ThirdPartyNotices.txt` | REDcode's license and its bundled packages' |

REDbridge is not in it: REDcode downloads the release it needs on first start.

**When uploading, turn off the Mod Manager Download button** for this file (Nexus's file form has the option). It is a VS Code extension: Vortex would deploy it into the game folder, where it does nothing.

File description on Nexus:

> REDcode for Cyberpunk 2077 &lt;version&gt;, the VS Code extension. Extract, then in VS Code: Extensions view, ..., Install from VSIX. Or install it from the Marketplace or Open VSX, where it updates itself.

### Building it

The publish workflow (`.github/workflows/publish.yml`) builds it with every REDcode release (`v*` tags, not the theme's) and attaches it to the GitHub release, beside the `.vsix`. A release stays one step, as in CLAUDE.md: bump the version and the CHANGELOG, push, then push the tag `vX.Y.Z`. Download the zip from the release and upload it to Nexus.

By hand, after packaging the vsix: `node tools/nexus-zip.mjs` writes `dist/REDcode-<version>-nexus.zip`.

## Updating the page

1. Edit `description.bbcode` here, commit, push.
2. Check it: `node tools/check-bbcode.mjs nexus/description.bbcode`.
3. Paste the whole file into the description field on Nexus and save.
4. For a new version: upload the release's Nexus zip as the main file with the version from `extensions/redcode/package.json`, Mod Manager Download off. Archive the old file.

Keep these in step with the extension (its README and CHANGELOG):

| Where in the description | Update when |
|---|---|
| The STATUS box near the top | The preview flag goes |
| "Highlights" | A release adds a view, an editor or a command a modder would notice |
| "Coming next" | Its items are released (move them to Highlights) or new ones are built |
| "Requirements" | The VS Code minimum (`engines.vscode`) or REDbridge's runtime changes |

## BBCode used

Nexus's BBCode has no tables or Markdown, so the page uses only: `[b]`, `[i]`, `[size=2..5]`, `[color=#hex]`, `[center]`, `[quote]`, `[line]`, `[list]` with `[*]`, `[url=...]` and `[img]`. The banner is linked from this repo's `main` branch on GitHub, so it must stay at its path. The colours are the house palette: yellow `#fcee0a` for headings, cyan `#19f3ff` for highlights.
