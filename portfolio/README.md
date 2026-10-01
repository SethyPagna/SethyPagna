# Pagna Air · portfolio

The personal site of **Sethy Pagna UNG (Pagna)**: a neon night-city terminal that flies from Angkor Wat to Hong Kong, with every project's screenshots, working links, and five builds you can play inside the page.

Production address: **https://sethy-pagna.vercel.app**. Vercel is connected to the `portfolio/` folder of this GitHub profile repository. Preview deployments follow pull requests; production follows `main`.

## What's on the page

| Section | What it does |
|---|---|
| Hero | Canvas skyline (Angkor Wat → Hong Kong harbour) with rain, reflections, a KH→HK flight and fireworks when you click the sky |
| About | A boarding pass: passenger photo, studies, languages, next stop |
| Now building | Split-flap departures board; each row opens its project window |
| Projects | Screenshot, title and Explore buttons open full-screen project windows with purpose, gallery, features and current links |
| Game dev lab | Living Kingdom (UE5), Sandline (UE5) and Wreckabulary (Unity 6) |
| Arcade | Browser editions of Sandline and Living Kingdom (ported from the UE5 builds), AllChess, Cargo Twin v3 and AI Summary v2, in the page |
| Build · Toolbox · Road · Activity · Contact | The AI-assisted build loop, tools cross-linked to projects, a timeline, the daily GitHub activity cards and contact links |

Project windows open across the viewport. Minimize keeps the running iframe and provides a restore bar; Overview also preserves its session. Close or Escape ends the session and returns focus to the opener. The size button switches between full-screen and inset windows. An aiming game may require releasing pointer lock before Escape exits. Selecting another project ends the previous session. Restart creates a fresh iframe.

Extras: <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> (or <kbd>/</kbd>) opens a command palette, deep links such as `#project/allchess` or `#arcade/sandline` work, and the Konami code does something.

## Structure

It's a static site: plain HTML, CSS and ES modules, with no build step.

```
index.html          page skeleton and copy
css/site.css        styles (palette and shapes follow the GitHub profile artwork)
js/data.js          everything said about the projects, arcade cabinets, toolbox and timeline
js/shots.js         generated list of screenshots per project
js/main.js          rendering and interactions
js/project-window.js fullscreen, minimize/restore and background focus controls
css/project-window.css window sizing and responsive controls
js/skyline.js       the hero scene
js/flap.js          split-flap text
fonts/              Unbounded, Sora, Chakra Petch, Kantumruy Pro (Khmer), Noto Sans SC subset (all SIL OFL)
img/shots/<id>/     WebP screenshots, NN.webp (1600 px) and NN-sm.webp (720 px)
play/               self-hosted playable builds (see below)
tools/              images.py (screenshots → WebP + js/shots.js) and fonts.py (Chinese subset)
```

## Run it locally

```powershell
python -m http.server 8080 --directory "C:/path/to/checkout/portfolio"
```

Open http://localhost:8080. The page must be served over HTTP (not `file://`) because it uses ES modules and the games load in iframes.

## Deploy on Vercel

The existing `sethy-pagna` project already uses this configuration. To reproduce it:

1. **Settings → Git → Connect** the `SethyPagna/SethyPagna` repository.
2. **Settings → Build and Deployment → Root Directory**: `portfolio`.
3. Framework preset **Other**, no build command, output directory left empty.

Only changes inside `portfolio/` need a redeploy; you can tick "Skip deployments when there are no changes to the root directory" so README edits don't redeploy. `vercel.json` sets cache headers; `.vercelignore` keeps `tools/` out of the deployment.

For CLI archive previews, use a clean staging folder. The archive uploader can include local files excluded by `.vercelignore`; a dry file listing is insufficient proof. After linking the existing project, run `python scripts/prepare_deployment.py --output ABSOLUTE_NEW_STAGING_FOLDER` from the repository root. This copies only the static site and project link, checks each source and staged file twice, and writes its receipt outside the upload folder. Deploy that staging folder with the CLI. Inspect the uploaded archive before promotion; progress logs, screenshots, tools and environment files must stay out of it.

## Public app links

Checked on 1 October 2026. Keep `js/data.js` and the root profile README consistent. A working public preview, a packaged arcade export and a development branch have separate release states; a successful protected preview build is not a public app link.

| Project | Public entry points | What visitors can use |
|---|---|---|
| AllChess | [Arcade](https://sethy-pagna.vercel.app/#arcade/allchess); [older online app](https://allchess.learn-app.workers.dev) | Browser export built on 1 October from the 30 September `codex/compact-game-studio` source provides 21 games with browser bots/local play. The separate older online app has accounts and rooms. |
| LEARN | [Vercel preview](https://learn-ten-pearl.vercel.app); [Cloudflare preview](https://learn.learn-app.workers.dev) | Both expose public demo sign-in, but run different earlier builds. They are not identical mirrors. The newer studio is on `cleanup/stage-1`; providers and other release work remain. |
| EdSync | [Read-only demo](https://edsync-demo.learn-app.workers.dev); [official app](https://edsync.learn-app.workers.dev) | The demo exposes fictional courses and learner/teacher previews. The official app is for account access. |
| UrCut | [Desktop web preview](https://urcut-preview.ungsethypagna.workers.dev) | Browser editing/export; voice generation requires local UrCut/UrVoice. |
| AI Summary | [Standalone v2](https://ai-summary.ungsethypagna.workers.dev); [arcade](https://sethy-pagna.vercel.app/#arcade/ai-summary) | Local document ingestion, summaries and cited questions/answers. |
| Cargo Twin | [Cargo studio v3](https://sethy-pagna.vercel.app/#arcade/cargo-twin) | Current packing studio; the separately labeled Figma link is the historical hackathon prototype. |

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
| `play/living-kingdom/` | `livingkingdom/web` (browser edition of the UE5 playtest) | Vite + TypeScript + three.js + Rapier; the font, sound and Rapier licences sit next to the files in `assets/` |
| `play/allchess/` | `AllChess` commit `9d2b7ff66636a4669c1519f9d337b682832759d1`; adapter in `tools/allchess-arcade/` | Current packed knowledge loads lazily. Unchanged model sources retain the previously reviewed optimized GLBs, including the quantized 1024-pixel marble derivative. `BUILD-INFO.json` records provenance and hashes. Stockfish GPL/source records are in `engines/stockfish/`; model and HDR credits ship with the export. |
| `play/cargo-twin/` | `cargo-twin/cargo-twin` (v3) | Responsive cargo studio with custom spaces and constrained 3D packing; earlier aircraft workspace retained |
| `play/ai-summary/` | `ai-summary-app/web` (v2) | Runs in the browser; Claude features use the visitor's own API key, kept in their browser and sent only to the Claude API |

Online AllChess matches, rooms and accounts are in the live app at allchess.learn-app.workers.dev, which still runs an older build.

Update the arcade only from a completed, verified export; do not copy a working tree's unfinished changes into `play/`. Source links pin the revisions used for the packaged browser builds. Cargo Twin v3 opens its responsive transport studio by default and retains the aircraft workspace through its navigation.

## Credits

- UrCut is built on [OpenCut classic](https://github.com/OpenCut-app/opencut-classic) (MIT).
- JARVIS is built on [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research (MIT).
- Cargo Twin originated as the team's Cathay Cargo Twin hackathon project; its current studio and aircraft workspace retain that attribution. Wreckabulary is a team project.
- Fonts: [Unbounded](https://github.com/googlefonts/unbounded), [Sora](https://github.com/sora-xor/sora-font), [Chakra Petch](https://github.com/cadsondemak/Chakra-Petch), [Kantumruy Pro](https://github.com/google/fonts/tree/main/ofl/kantumruypro) and [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc), all under the SIL Open Font License.
