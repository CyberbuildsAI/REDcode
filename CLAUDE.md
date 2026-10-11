# REDcode: notes for Claude sessions

REDcode is a Cyberpunk 2077 modding IDE built on VS Code, wrapping WolvenKit's C# engine behind a local JSON-RPC bridge. It is the build-time half of the ecosystem; REDnode (https://github.com/CyberbuildsAI/REDnode) is the runtime half. The same person owns both, and REDnode's `CLAUDE.md` and `docs/dev-setup.md` set the conventions used here too.

## Current status and next step

- **Design:** done, as a private design document held by the owner. It is not in this repo yet. Ask the owner for it before architectural work.
- **License model (decided):** split. This repo stays MIT and holds the extensions and, later, the branded fork. The bridge lives in its own repo, REDbridge (https://github.com/CyberbuildsAI/REDbridge), under GPL-3.0 because it links WolvenKit's GPL-3.0 libraries. Extensions talk to the bridge only over stdio with JSON-RPC and never link it in-process. Keep that boundary.
- **In the repo:** only the shared VS Code theme.
- **C0 findings (2026-10-11):** the Redscript IDE extension is `jac3km4.redscript-ide-vscode` on the Microsoft Marketplace and is **not** on Open VSX, so the branded fork (C7) must either bundle it with the author's permission or depend on it being published there. The WolvenKit team will be contacted once a working proof of concept exists, not before. The .NET side of C0 (building WolvenKit's libraries) is tracked in REDbridge.

## Conventions

- Commit straight to `main` and push, in small logical commits. Agree the plan in chat first. PRs only for large or risky changes.
- Git identity is set per repo to `CyberbuildsAI` with the GitHub no-reply email. Never change the global identity.
- Never commit game files, WolvenKit binaries, or data extracted from the game.
- Record every tool install in a `docs/dev-setup.md`, with versions and exact commands.
- Writing style: plain, short sentences, tables for comparisons. Terms: the bridge (`REDcode.Bridge`), extensions `redcode-core`, `redcode-explorer`, `redcode-editors`, `redcode-tools`, phases C0 to C7. Mark anything unverified as unverified.
- House style is the HUD look from REDnode's design doc. The `rednode-hud-theme` extension is the default theme. Keep its package identity `cyberbuildsai.rednode-hud-theme`; REDnode carries a copy, so changes go to both until one is made canonical.
- Goal to keep in mind: an AI-first, Node-based ecosystem. Claude is the first assistant it is built with; the stack is JavaScript/TypeScript, npm packages, HTML views and VS Code. Prefer machine-readable interfaces (JSON-RPC, generated types, structured docs), and plan for the bridge to double as an MCP server. Coexist with WolvenKit and credit it.
- REDcode and REDnode form one loop: edit a REDnode mod in REDcode (with an assistant), deploy it to the running REDnode process without restarting the game, and stream the game's events and logs back. This lives in a `redcode-rednode` extension and needs a development endpoint on the REDnode side. Live debugging is part of it: VS Code's debugger attaches to the REDnode process over the Node inspector (breakpoints, Debug Console against the live game); Tier 1 interceptors in QuickJS get trace and replay instead.

## Docs site

- `docs/` is published by GitHub Pages at https://cyberbuildsai.github.io/REDcode/ through `.github/workflows/pages.yml`. Settings > Pages > Source must be GitHub Actions.
- Write docs as markdown in `docs/`. Jekyll renders them with the HUD layout (`docs/_layouts/default.html`, `docs/assets/css/hud.css`). Add every new page to `nav` in `docs/_config.yml`.
- `tools/brand/render.ps1` regenerates the banner, social preview, icon and badges. Re-run it when versions in the badges change.
- When the first extension has TypeScript, add TypeDoc to the Pages workflow the way REDnode does, so the API reference is generated.