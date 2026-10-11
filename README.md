# REDcode

A Cyberpunk 2077 modding IDE built on VS Code.

REDcode brings the workflows of [WolvenKit](https://github.com/WolvenKit/WolvenKit), browsing game archives, editing game files, importing and exporting assets, packing mods, into VS Code as extensions. WolvenKit's own C# engine does the file work behind a local bridge process, and REDcode provides the editor. The name is RED for REDengine and code for VS Code.

REDcode is the build-time half of a Node-based modding ecosystem; [REDnode](https://github.com/CyberbuildsAI/REDnode) is the runtime half. Both share one visual identity.

> **Status: design phase.** The architecture is settled and the first code is the shared theme below. The design document will be published with the first working extension.

## Repository layout

| Path | Contents |
|---|---|
| `extensions/rednode-hud-theme/` | The REDnode HUD color theme, the default theme of REDcode. Shared with REDnode |

## Build

```powershell
npm install
npm run theme:package   # writes dist/rednode-hud-theme-<version>.vsix
code --install-extension dist/rednode-hud-theme-0.1.0.vsix
```

## Relationship to WolvenKit

REDcode depends on WolvenKit's engine and is meant to sit alongside it, not replace it. Which tools a modder uses is their choice. WolvenKit is GPL-3.0; how REDcode's own license interacts with that is being settled before the bridge is written.

## License

[MIT](LICENSE)
