# How the profile graphics are made

Every picture on the profile is an SVG drawn by code in this folder. No design tool and no third-party image service is involved.

| Script | Makes | Runs |
|---|---|---|
| `build_assets.py` | Everything in `assets/*.svg`: the hero skyline, section banners, boarding pass, departures board, project and side-quest cards, build loop, toolbox, timeline, buttons and footer | By hand, whenever the content changes |
| `shots.py` | `assets/shots/*.jpg`: the cropped screenshots that `build_assets.py` embeds in the cards | By hand, when a screenshot changes |
| `stats.py` | `stats.svg` (contributions, streaks, top languages) and `skyline.svg` (the contribution calendar as a city, one tower per week) | Daily in `.github/workflows/profile-assets.yml`, which publishes both to the `output` branch |
| `outline.py` | Nothing on its own: the shared text engine that turns lettering into vector outlines | Imported by the two builders above |

## Type

Text is shaped with HarfBuzz and converted to outlines, so the Khmer, Chinese and display lettering looks the same on every device, even without the fonts installed. Each glyph is stored once per SVG and reused.

| Style | Font | Used for |
|---|---|---|
| `head`, `head-semi` | [Unbounded](https://github.com/googlefonts/unbounded) 800 / 600 | Headlines and big numbers |
| `hud`, `hud-semi` | [Chakra Petch](https://github.com/cadsondemak/Chakra-Petch) Bold / SemiBold | Labels, tags and codes |
| `body`, `body-semi`, `body-bold` | [Sora](https://github.com/sora-xor/sora-font) 500 / 600 / 700 | Running text |
| `khmer`, `han` | Khmer UI Bold and Microsoft YaHei Bold (Windows system fonts) | Khmer and Chinese greetings, local builds only |

The three Latin families live in `fonts/` under the SIL Open Font License (`fonts/OFL-*.txt`). The Khmer and Chinese fonts are read from `C:/Windows/Fonts`, or from `PROFILE_FONTS_DIR` if you set it, and are not redistributed. `stats.py` uses only the bundled fonts, so the daily workflow runs on Linux.

## Rebuilding the artwork

Needs Python 3.10+ with `pip install fonttools uharfbuzz` (add `Pillow` if you run `shots.py`).

```bash
python scripts/shots.py <portfolio-assets-dir> <wreckabulary-key-art.jpg>   # only when screenshots change
python scripts/build_assets.py
```

To edit the copy, change the lists near each builder: `FLIGHTS`, `PROJECTS`, `SIDE_QUESTS`, `LOOP`, `LEVEL_UP`, `TOOLBOX`, `MILESTONES` and `SECTIONS`.

## Previewing the activity graphics

```bash
GITHUB_TOKEN="$(gh auth token)" python scripts/stats.py dist
```

`dist/` is git-ignored. With your own token the totals can include private contributions, whereas the workflow's token sees what the public profile shows.

## Design notes

- Palette: void `#08031A`, volt `#FCEE0A`, magenta `#FF2E88`, cyan `#19E6FF`, violet `#A974FF`, acid `#3CFFA4` and orange `#FF8A1F`, on violet-black panels with chamfered corners, scanlines and hazard stripes.
- Animation only ever adds a passing effect on top of a finished picture, such as a glitch, a flicker, rain or a moving plane. A static render, a paused image or `prefers-reduced-motion` still shows everything.
- Screenshots and images are embedded as data URIs, because GitHub renders SVGs as images and blocks external files.
