# Pagna Air · portfolio

The personal site of **Sethy Pagna UNG (Pagna)**: a neon night-city terminal that flies from Angkor Wat to Hong Kong, with every project's screenshots, working links, and five builds you can play inside the page.

Production address: **https://sethy-pagna.vercel.app**. Vercel is connected to the `portfolio/` folder of this GitHub profile repository. Preview deployments follow pull requests; production follows `main`.

## What's on the page

| Section | What it does |
|---|---|
| Hero | Canvas skyline (Angkor Wat → Hong Kong harbour) with rain, reflections, a KH→HK flight and fireworks when you click the sky |
| About | A boarding pass: passenger photo, studies, languages, next stop |
| Now building | Split-flap departures board; each flight opens that project's dossier |
| Projects | Cards that preview their screenshots on hover; each opens a dossier (gallery, features, stack, links). Projects with a cabinet can be played from the dossier too |
| Game dev lab | Living Kingdom (UE5), Sandline (UE5) and Wreckabulary (Unity 6) |
| Arcade | Browser editions of Sandline and Living Kingdom (ported from the UE5 builds), AllChess, Cathay Cargo Twin v2 and AI Summary v2, in the page |
| Build · Toolbox · Road · Activity · Contact | The AI-assisted build loop, tools cross-linked to projects, a timeline, the daily GitHub activity cards and contact links |

Extras: <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>K</kbd> (or <kbd>/</kbd>) opens a command palette, deep links such as `#project/allchess` or `#arcade/sandline` work, and the Konami code does something.

## Structure

It's a static site: plain HTML, CSS and ES modules, with no build step.

```
index.html          page skeleton and copy
css/site.css        styles (palette and shapes follow the GitHub profile artwork)
js/data.js          everything said about the projects, arcade cabinets, toolbox and timeline
js/shots.js         generated list of screenshots per project
js/main.js          rendering and interactions
js/skyline.js       the hero scene
js/flap.js          split-flap text
fonts/              Unbounded, Sora, Chakra Petch, Kantumruy Pro (Khmer), Noto Sans SC subset (all SIL OFL)
img/shots/<id>/     WebP screenshots, NN.webp (1600 px) and NN-sm.webp (720 px)
play/               self-hosted playable builds (see below)
tools/              images.py (screenshots → WebP + js/shots.js) and fonts.py (Chinese subset)
```

## Run it locally

```bash
cd portfolio
npx http-server . -p 8080 -c-1     # or: python -m http.server 8080
```

Open http://localhost:8080. The page must be served over HTTP (not `file://`) because it uses ES modules and the games load in iframes.

## Deploy on Vercel

The existing `sethy-pagna` project already uses this configuration. To reproduce it:

1. **Settings → Git → Connect** the `SethyPagna/SethyPagna` repository.
2. **Settings → Build and Deployment → Root Directory**: `portfolio`.
3. Framework preset **Other**, no build command, output directory left empty.

Only changes inside `portfolio/` need a redeploy; you can tick "Skip deployments when there are no changes to the root directory" so README edits don't redeploy. `vercel.json` sets cache headers; `.vercelignore` keeps `tools/` out of the deployment.

## Updating screenshots

1. Capture PNGs of a project (Playwright against a local build works well) into `raw/<project>/`.
2. Add them to the `SHOTS` table in `tools/images.py` with a caption.
3. From `portfolio/`: `pip install Pillow && python tools/images.py raw`.

`raw/` is git-ignored. Wide in-engine crops are read from the profile's `../assets/shots/`, and art from the project repositories is read from clones next to this one (set `CLONES` to their parent folder). After adding Chinese text, run `python tools/fonts.py NotoSansSC[wght].ttf` to refresh `fonts/han.woff2`.

## Playable builds in `play/`

Each folder is the static build of a project, copied in as-is. They all use relative paths, so they work from a sub-folder and inside the arcade iframe. Third-party licences ship with each build (`NOTICES.txt`, `THIRD-PARTY-NOTICES.txt` or the licence files next to the assets); the site's own fonts are covered by `fonts/OFL.txt`.

| Folder | Source | Notes |
|---|---|---|
| `play/sandline/` | `sandline/web` (browser edition of the UE5 v0.2.x build) | Vite + TypeScript + three.js; desktop only (WebGL 2, keyboard and mouse). Notices in `NOTICES.txt` |
| `play/living-kingdom/` | `livingkingdom/web` (browser edition of the UE5 playtest) | Vite + TypeScript + three.js + Rapier; the font, sound and Rapier licences sit next to the files in `assets/` |
| `play/allchess/` | `AllChess` commit `444b0c0b910b3a6a58ce30fd2f67122045cc2fc3` (`codex/portfolio-arcade-20260929`; `npm run build:arcade`) | 29 September 2026 game-studio export (bots and pass-and-play); 3D set models are compressed with gltf-transform. Stockfish (GPLv3) ships with its licence and source links in `engines/stockfish/` |
| `play/cargo-twin/` | `ainnovator_prototype/cargo-twin` (v2) | React + three.js + cannon-es; the cabinet renders it at 1280 px wide and scales it to fit |
| `play/ai-summary/` | `ai-summary-app/web` (v2) | Runs in the browser; Claude features use the visitor's own API key, kept in their browser and sent only to the Claude API |

Online AllChess matches, rooms and accounts are in the live app at allchess.learn-app.workers.dev, which still runs an older build.

This AllChess export includes the committed game-studio source through `418f8bd`; further source work continues separately. Update the arcade only from a completed, verified export; do not copy a working tree's unfinished changes into `play/`. The source links for AI Summary v2 and Cargo Twin v2 point to their exact commits because their repository default branches still contain v1.

## Credits

- UrCut is built on [OpenCut classic](https://github.com/OpenCut-app/opencut-classic) (MIT).
- Secretary Jarvis is built on [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research (MIT).
- Cathay Cargo Twin and Wreckabulary are team projects.
- Fonts: [Unbounded](https://github.com/googlefonts/unbounded), [Sora](https://github.com/sora-xor/sora-font), [Chakra Petch](https://github.com/cadsondemak/Chakra-Petch), [Kantumruy Pro](https://github.com/google/fonts/tree/main/ofl/kantumruypro) and [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc), all under the SIL Open Font License.
