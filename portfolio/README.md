# Pagna Air · portfolio

The personal site of **Sethy Pagna UNG (Pagna)**: a neon night-city terminal that flies from Angkor Wat to Hong Kong, with every project's screenshots, working links, and five builds you can play inside the page.

Live at **https://sethy-pagna-portfolio.vercel.app** (once this folder is connected to the Vercel project; see below). It lives in the `portfolio/` folder of the GitHub profile repository, next to the profile artwork it borrows its look from.

## What's on the page

| Section | What it does |
|---|---|
| Hero | Canvas skyline (Angkor Wat → Hong Kong harbour) with rain, reflections, a KH→HK flight and fireworks when you click the sky |
| About | A boarding pass: passenger photo, studies, languages, next stop |
| Now building | Split-flap departures board; each flight opens that project's dossier |
| Projects | Cards that preview their screenshots on hover; each opens a dossier (gallery, features, stack, links; AllChess has a live preview) |
| Game dev lab | Living Kingdom (UE5), Sandline (UE5) and Wreckabulary (Unity 6) |
| Arcade | Sandline web arena, Living Kingdom *Worlds Within* and *The First Hearth*, Cathay Cargo Twin and the live AllChess app, in the page |
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

In the existing `sethy-pagna-portfolio` project (or a new one):

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

| Folder | Source | Notes |
|---|---|---|
| `play/sandline/` | `sandline/sandline_web` (v1 prototype) | three.js r157 (MIT) vendored in `lib/`; arena, models and audio are generated at runtime |
| `play/worlds-within/` | `LivingKingdom/…/Living-Kingdom-Play.html` | Single-file WebGL app (17 MB). Licence and data notices sit next to it |
| `play/first-hearth/` | `LivingKingdom/Development` | Static ES-module decisions lab |
| `play/cargo-twin/` | `Ainnovator_Prototype` | `vite build --base=./`, with Tailwind v4 recompiled from source |

The AllChess cabinet embeds the live app at allchess.learn-app.workers.dev.

## Credits

- UrCut is built on [OpenCut classic](https://github.com/opencut-app/opencut-classic) (MIT).
- Secretary Jarvis is built on [Hermes Agent](https://github.com/NousResearch/hermes-agent) by Nous Research (MIT).
- Cathay Cargo Twin and Wreckabulary are team projects.
- Fonts: [Unbounded](https://github.com/googlefonts/unbounded), [Sora](https://github.com/sora-xor/sora-font), [Chakra Petch](https://github.com/cadsondemak/Chakra-Petch), [Kantumruy Pro](https://github.com/google/fonts/tree/main/ofl/kantumruypro) and [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc), all under the SIL Open Font License.
