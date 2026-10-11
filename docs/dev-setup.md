# Development setup

Everything needed to work on REDcode, in order. A fresh machine should be able to follow this top to bottom. The shared tools are the same as in [REDnode's setup guide](https://cyberbuildsai.github.io/REDnode/dev-setup.html).

Reference machine: Windows 11 Home (build 26200), 16 GB RAM.

## 1. Base tools

| Tool | Version used | Why | Install |
|---|---|---|---|
| Git for Windows | 2.55.0 | Source control | `winget install --id Git.Git -e` |
| nvm for Windows and Node.js | Node 24.18.0, npm 12.0.1 | Extensions are TypeScript; packaging needs npm | `winget install --id CoreyButler.NVMforWindows -e`, then `nvm install 24` and `nvm use 24` |
| VS Code | 1.70 or later | Runs and tests the extensions | `winget install --id Microsoft.VisualStudioCode -e` |
| Python | 3.14.6 | Brand tooling | Any Python 3.10 or later |
| Chrome or Edge | any | Renders the brand images | Already present on Windows |

## 2. Repository and GitHub

```powershell
git clone https://github.com/CyberbuildsAI/REDcode.git
cd REDcode
git config user.name  "CyberbuildsAI"
git config user.email "340969962+CyberbuildsAI@users.noreply.github.com"
npm install
```

## 3. Packaging the theme

| Tool | Version | Install |
|---|---|---|
| @vscode/vsce | 4.0.0 | Root dev dependency, installed by `npm install` |

```powershell
npm run theme:package   # writes dist/rednode-hud-theme-<version>.vsix (ignored by git)
code --install-extension dist/rednode-hud-theme-0.1.0.vsix
```

npm 12 blocks the install script of `@vscode/vsce-sign`, which downloads a signing binary. Packaging does not need it.

## 4. REDbridge

The extensions need a built REDbridge to do anything with game files. See [REDbridge's setup guide](https://cyberbuildsai.github.io/REDbridge/dev-setup.html). Until C1 there is nothing to run.

## 5. Docs site and brand images

The site at https://cyberbuildsai.github.io/REDcode/ is built by `.github/workflows/pages.yml` on every push to `main`. **Settings > Pages > Source** must be **GitHub Actions**.

```powershell
.\tools\brand\render.ps1   # banner, social preview, icon, badges
```

| Output | Used by |
|---|---|
| `docs/assets/brand/banner.png` | README header |
| `docs/assets/brand/social.png` | Upload by hand in Settings > General > Social preview |
| `docs/assets/brand/icon.png` | Site icon, and the branded fork later |
| `docs/assets/brand/badges/*.svg` | README badges. Edit the list in `tools/brand/badges.py` |
