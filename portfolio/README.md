# Sethy Pagna Ung · portfolio

The personal site of **Sethy Pagna UNG (Pagna)**: a light, plain-language page with project screenshots, current links, and six builds you can play inside the page. A dark theme sits behind the button in the header.

Production address: **https://sethy-pagna.pages.dev**. Cloudflare Pages uses this GitHub profile repository. Its public-only staging step verifies copied bytes against committed source and excludes development tools, logs and private files. Vercel Git deployments are disabled.

## What's on the page

The header has four links: Work, Play, About and Contact.

| Section | What it does |
|---|---|
| Hero | Name, one sentence about the work, two buttons, and three featured screenshots that open their projects |
| Work | All 14 projects in one grid, with filters (All, Apps, AI tools, Games, Playable here). A card opens the project window |
| Play in your browser | Wreckabulary, Sandline, Living Kingdom, Cargo Twin, AllChess and AI Summary. Play opens the build over the page |
| About | Short bio and facts, the four-step way of working, skills cross-linked to projects, a timeline and the daily GitHub activity chart |
| Contact | Email (open or copy), LinkedIn and GitHub |

**The project window** is one dialog with two views. *Details* has the screenshot gallery, what the project does, its links and the stack. *Play* runs the build in a frame with Details, Restart, Full screen, New tab and Close. Close, Escape, the browser's Back button or a click outside all close it and return to where you were. Leaving the Play view ends that session. Escape pressed inside a running game belongs to the game.

**Addresses.** `#project/<id>` opens a project's details and `#arcade/<id>` starts a build, so both can be shared. Older links such as `#games` still land in the right place.

**Search.** <kbd>/</kbd> or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> opens a search over projects, games, sections and a few actions.

**GitHub activity.** `scripts/stats.py` publishes `stats.json` to the `output` branch every day, next to the two SVG pictures the profile README uses. The page draws its own chart from those numbers; if they cannot be read it shows the pictures instead.

## Structure

It's a static site: plain HTML, CSS and ES modules, with no build step.

```
index.html          page skeleton and copy
css/site.css        styles: colour and type tokens for both themes, then one block per section
js/data.js          everything said about the projects, playable builds, skills and timeline
js/shots.js         generated list of screenshots per project
js/main.js          rendering, the project window, search and the activity chart
fonts/              Sora, Kantumruy Pro (Khmer), Noto Sans SC subset (all SIL OFL)
img/shots/<id>/     WebP screenshots, NN.webp (1600 px) and NN-sm.webp (720 px)
play/               self-hosted playable builds (see below)
tools/              images.py (screenshots → WebP + js/shots.js) and fonts.py (Chinese subset)
```

To change what a card says, edit the project in `js/data.js`: `brief` is the one sentence on the card, `badge` is its status label, and the rest fills the project window.

## Run it locally

```powershell
python -m http.server 8080 --directory "C:/path/to/checkout/portfolio"
```

Open http://localhost:8080. The page must be served over HTTP (not `file://`) because it uses ES modules and the games load in iframes.

## Deploy on Cloudflare

The Git-based Pages project `sethy-pagna` uses the James Apps account and this configuration:

1. Repository: `SethyPagna/SethyPagna`; production branch: `main`; root: repository root.
2. Build command: `python scripts/prepare_cloudflare.py --output cloudflare-public`.
3. Output directory: `cloudflare-public`. Pull-request/branch preview deployments are disabled.

The preparation command checks every source and copied file twice, compares source with Git, preserves runtime licences and creates public `build-info.json`. Its detailed receipt stays outside the upload directory. `_headers` is a routing control file; it is copied and checked in the private receipt, while the public manifest lists served assets. A real `404.html` prevents missing script requests from returning the homepage.

Deploy only the reviewed, pushed `main` HEAD. Verify the deployment's actual Git SHA against `build-info.json`, then run the manual `Verify portfolio Cloudflare release` workflow for two full HTTP comparisons against committed Git blobs. Browser checks cover the project controls and playable editions; upload/build success alone is insufficient.

## Public app links

Updated 3 October 2026. Keep `js/data.js` and the root profile README consistent. A public app, a packaged arcade export and a development branch have separate release states.

| Project | Public entry points | What visitors can use |
|---|---|---|
| AllChess | [Latest app](https://allchess.pagna.workers.dev/en); [local arcade](https://sethy-pagna.pages.dev/#arcade/allchess) | Current 21-game studio. The full app has the online workspace; the arcade uses the same engine/art for bots/local play. |
| LEARN | [Open LEARN](https://learn.pagna.workers.dev) | Latest October 3 studio with anonymous editable canvas demo; AI requires a configured provider. Collaboration remains in development. |
| EdSync | [Official app](https://edsync.pagna.workers.dev) | Account access; the earlier separate demo was retired. |
| UrCut | [Project details](https://sethy-pagna.pages.dev/#project/urcut) | Latest local editor; new public release pending. Voice tools require local UrVoice. |
| CodeAge | [Web alpha](https://codeage-pagna.pages.dev) | Browser-local chats/projects, text editor and isolated preview. Your API key is required for provider chat; Windows adds native tools. |
| AI Summary | [Standalone v2](https://sethy-pagna.pages.dev/play/ai-summary/); [arcade](https://sethy-pagna.pages.dev/#arcade/ai-summary) | Local documents, summaries and cited Q&A; Claude is optional. |
| Cargo Twin | [Cargo studio v4](https://cargo-twin.pages.dev); [arcade](https://sethy-pagna.pages.dev/#arcade/cargo-twin) | Current guided 3D studio and CSV update. Figma is the historical hackathon prototype. |
| Wreckabulary | [Standalone](https://wreckabulary.pagna.workers.dev); [arcade](https://sethy-pagna.pages.dev/#arcade/wreckabulary) | One human with AI housemates; five modes and Creative Workshop. |
| Sandline | [Standalone](https://sandline.pagna.workers.dev); [arcade](https://sethy-pagna.pages.dev/#arcade/sandline) | Desktop WebGL 2 bot matches; online multiplayer unfinished. |
| OmniDrama | [Original sample preview](https://omnidrama.pagna.workers.dev) | Two original chapters; full processing/import/admin tools require its Windows backend. |

## Updating screenshots

1. Capture PNGs of a project (Playwright against a local build works well) into `raw/<project>/`.
2. Add them to the `SHOTS` table in `tools/images.py` with a caption.
3. From `portfolio/`: `pip install Pillow && python tools/images.py raw`.

`raw/` is git-ignored. Wide in-engine crops are read from the profile's `../assets/shots/`, and art from the project repositories is read from clones next to this one (set `CLONES` to their parent folder). After adding Chinese text, run `python tools/fonts.py NotoSansSC[wght].ttf` to refresh `fonts/han.woff2`.

## Playable builds in `play/`

Each folder is a verified static export using relative paths for subdirectory and iframe hosting. Third-party licences ship with each build (`NOTICES.txt`, `THIRD-PARTY-NOTICES.txt` or the licence files next to the assets); the site's own fonts are covered by `fonts/OFL.txt`.

| Folder | Source | Notes |
|---|---|---|
| `play/sandline/` | `sandline/web` (browser edition of the UE5 v0.2.x build) | Vite + TypeScript + three.js; desktop only (WebGL 2, keyboard and mouse). Notices in `NOTICES.txt` |
| `play/living-kingdom/` | Browser source `c6061aa`; web tree unchanged at native `d587050` | October combat/lifecycle playtest; three.js/Rapier with shipped font, sound and runtime licences |
| `play/allchess/` | `AllChess` commit `9d2b7ff66636a4669c1519f9d337b682832759d1`; adapter in `tools/allchess-arcade/` | Current packed knowledge loads lazily. Unchanged model sources retain the previously reviewed optimized GLBs, including the quantized 1024-pixel marble derivative. `BUILD-INFO.json` records provenance and hashes. Stockfish GPL/source records are in `engines/stockfish/`; model and HDR credits ship with the export. |
| `play/cargo-twin/` | `cargo-twin/cargo-twin`, `10e4151` (v4 + CSV successor) | Guided 3D studio, portable reports and projects, constrained packing; aircraft workspace retained |
| `play/wreckabulary/` | `wreckabulary/Web`, source `11f7293`, runtime `04f3331` | Plain JavaScript + three.js; one human with AI, authored houses, Workshop and touch controls |
| `play/ai-summary/` | `ai-summary-app/web` (v2) | Runs in the browser; Claude features use the visitor's own API key, kept in their browser and sent only to the Claude API |

Update the arcade only from completed exports with repeatable byte verification. Source links pin the packaged browser revisions. Preserve source/history separately from generated output; replace obsolete tracked chunks as part of the release. Browser-local saves belong to their hostname; export portable backups before changing hosts.

## Credits

- UrCut is built on [OpenCut classic](https://github.com/OpenCut-app/opencut-classic) (MIT).
- JARVIS is built on [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research (MIT).
- Cargo Twin originated as the team's Cathay Cargo Twin hackathon project; its current studio and aircraft workspace retain that attribution. Wreckabulary is a team project.
- Fonts: [Sora](https://github.com/sora-xor/sora-font), [Kantumruy Pro](https://github.com/google/fonts/tree/main/ofl/kantumruypro) and [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc), all under the SIL Open Font License.
