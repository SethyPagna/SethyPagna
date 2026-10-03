#!/usr/bin/env python3
"""Turn raw screenshots and art into the site's WebP images and js/shots.js.

    python tools/images.py <raw-dir>

<raw-dir> holds captures made with Playwright against local builds of each project
(<raw-dir>/<project>/*.png); art from the project repositories is read from their clones
under CLONES (default /home/user). Missing sources are skipped with a warning, so the
script can be re-run as captures arrive. Needs Pillow.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "img" / "shots"
CLONES = Path(os.environ.get("CLONES", "/home/user"))
RAW = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "raw"

LK = CLONES / "livingkingdom"
KIT = LK / "Living-Kingdom-Unreal-Starter-Kit/Living-Kingdom-Playable-Kit"
SL = CLONES / "sandline"
PROFILE = ROOT.parent / "assets" / "shots"  # the profile artwork's cropped screenshots

# project -> [(source, caption, kind)]; kind: screen | phone | art | render | wide
SHOTS: dict[str, list[tuple[Path, str, str]]] = {
    "business-os": [
        (RAW / "business-os/bos-pos.png", "Point of sale: three lines in the cart, totals in USD and riel (test fixture data).", "screen"),
        (RAW / "business-os/bos-pos-km.png", "The same till in Khmer, from the app's language switch.", "screen"),
        (RAW / "business-os/bos-storefront-home.png", "Customer storefront, About tab.", "screen"),
        (RAW / "business-os/bos-catalog-preview.png", "Storefront editor with live preview (test fixture data).", "screen"),
        (RAW / "business-os/bos-products.png", "Products with cost, price, margin and stock.", "screen"),
        (RAW / "business-os/bos-receipt-settings.png", "Receipt settings beside a live 80 mm receipt preview.", "screen"),
        (PROFILE / "business-os.jpg", "The live Leang Beauty storefront, September 2026.", "wide"),
        (RAW / "business-os/bos-storefront-phone-home.png", "Storefront on a phone.", "phone"),
    ],
    "learn": [
        (RAW / "learn/demo-1280.jpg", "Latest public LEARN studio: anonymous editable canvas demo on Cloudflare, October 3 capture.", "screen"),
        (RAW / "learn/demo-390.jpg", "The current editable studio demo at 390px, with phone controls and no horizontal overflow.", "phone"),
        (RAW / "learn/request-access-1280.jpg", "Current LEARN access screen. AI tools need a configured provider; authenticated features have separate access requirements.", "screen"),
    ],
    "allchess": [
        (RAW / "allchess/classic.jpg", "Current Cloudflare app, October 3: actual e4/e5 bot moves on the rendered physical 3D chess board.", "screen"),
        (RAW / "allchess/home.jpg", "Latest public AllChess library: 21 games, including Ouk Chaktrang. The same engine powers local arcade play.", "screen"),
    ],
    "urcut": [
        (RAW / "urcut/desktop-effects.jpg", "Current development UI, October 1: desktop Effects & looks panel, scene preview and timeline. Local release validation is pending.", "screen"),
        (RAW / "urcut/mobile-effects.jpg", "Current development UI, October 1: mobile searchable Effects & looks library with scene look presets.", "phone"),
    ],
    "codeage": [
        (RAW / "codeage/codeage-web-code.png", "CodeAge web alpha 0.8.3-web.1: text editor and isolated interactive HTML preview on Cloudflare, October capture.", "screen"),
        (RAW / "codeage/codeage-web-chat.png", "Current browser Chat home: local history and your own API provider; no desktop terminal or device sync.", "screen"),
    ],
    "edsync": [
        (RAW / "edsync/signin.jpg", "Current official EdSync app: individual sign-in, October 2026 Cloudflare capture.", "screen"),
        (RAW / "edsync/organization.jpg", "Organization sign-in in the current official app; no account credentials entered.", "screen"),
        (RAW / "edsync/catalog.jpg", "Current public catalog: zero public courses at capture time. Account features require sign-in.", "screen"),
    ],
    "living-kingdom": [
        (PROFILE / "living-kingdom.jpg", "Unreal Engine 5 (the reference build): the Founder at the Origin shrine.", "wide"),
        (RAW / "living-kingdom-web/02-origin-golden-hour.png", "The Origin at golden hour, browser edition: sun and fog from the UE time-of-day keys, with the objective tracker, minimap and vitals.", "screen"),
        (RAW / "living-kingdom-web/05-stonebrook.png", "Stonebrook, the second map: the village pump you repair, kit-built houses and the villagers Tobin and Elias.", "screen"),
        (RAW / "living-kingdom-web/06-shade-fight.png", "Veil shades in the outer meadow, locked on mid-swing; the warden waits up the slope.", "screen"),
        (RAW / "living-kingdom-web/03-tree-falling.png", "Felling a jacaranda: three swings, then it splits into logs you can carry.", "screen"),
        (RAW / "living-kingdom-web/04-carry-to-stash.png", "Carrying a log to the stash; each one stowed adds timber to the journey ledger.", "screen"),
        (RAW / "living-kingdom-web/07-tab-hub.png", "The Tab hub: ten sections, live journey data, the local map and the current quest.", "screen"),
        (RAW / "living-kingdom-web/08-founder-page.png", "Founder page: a live turntable with coat and hair dyes, vitals and the journal.", "screen"),
        (RAW / "living-kingdom-web/01-title.png", "Title screen over the floating Origin at dusk.", "screen"),
        (LK / "Development/assets/characters/Founder_R2/render-three-quarter.png", "Founder character render.", "render"),
    ],
    "sandline": [
        (PROFILE / "sandline.jpg", "Unreal Engine 5 (the reference build): Sirocco, buy phase.", "wide"),
        (RAW / "sandline-web/04-firefight.png", "Firefight on Sirocco, browser edition: first-person arms with IK, muzzle flash, hit marker, radar and kill feed.", "screen"),
        (RAW / "sandline-web/06-oldtown-domination.png", "Old Town at golden hour in Domination, with the A/B/C capture points on the HUD and radar.", "screen"),
        (RAW / "sandline-web/03-sirocco-buy.png", "Buy menu: the full arsenal priced from the UE weapon table, with a stat card for the hovered gun.", "screen"),
        (RAW / "sandline-web/01-home.png", "Play screen: mode families, the maps for the chosen mode and match options (bots, skill, side, match length).", "screen"),
        (RAW / "sandline-web/02-agents.png", "Agent select: the five Blender-built agents, chosen per side.", "screen"),
        (RAW / "sandline-web/05-summary.png", "Match summary: 7:3 win, leaderboard, MVP and XP rewards carried into the career profile.", "screen"),
        (SL / "SandlineUE/Tools/maps/out/island.png", "Battle royale island, generated in Python.", "render"),
    ],
    "wreckabulary": [
        (RAW / "wreckabulary/workshop-desktop.jpg", "Creative Workshop, October browser edition: arrange supplied decor, apply finishes and save a portable house layout.", "screen"),
        (RAW / "wreckabulary/game-desktop.jpg", "Current browser gameplay: one human with AI housemates in an authored home.", "screen"),
        (RAW / "wreckabulary/workshop-tour-desktop.jpg", "A peaceful Workshop tour through the furnished house.", "screen"),
        (RAW / "wreckabulary/game-mobile.jpg", "Browser gameplay with illustrated touch controls, October capture.", "phone"),
    ],
    "omnidrama": [
        (CLONES / "omnidrama/artifacts/omni-drama-vibrant-desktop.png", "Discover: featured series and your collection.", "screen"),
        (CLONES / "omnidrama/artifacts/omni-drama-desktop-sidebar.png", "Episodes with filters and watch state.", "screen"),
        (CLONES / "omnidrama/artifacts/omni-drama-bottom-navigation.png", "Episodes on a phone.", "phone"),
    ],
    "khshop": [
        (PROFILE / "khshop.jpg", "Home with sample listings, September 2026 capture (fictional shops).", "wide"),
        (PROFILE / "thumb-khshop.jpg", "A sample listing card.", "art"),
    ],
    "jarvis": [
        (RAW / "jarvis/jarvis-home-cyberpunk.png", "Home in the cyberpunk theme: orb, live stats and terminal.", "screen"),
        (RAW / "jarvis/jarvis-home.png", "Home in the default theme.", "screen"),
        (RAW / "jarvis/jarvis-models.png", "Models: local runtimes and model settings.", "screen"),
        (RAW / "jarvis/jarvis-souls.png", "Souls: swappable identity and voice profiles.", "screen"),
        (RAW / "jarvis/jarvis-skills.png", "Skills hub.", "screen"),
        (RAW / "jarvis/jarvis-settings-cyberpunk.png", "Settings with theme presets.", "screen"),
        (CLONES / "secretary-jarvis/desktop/assets/icon.png", "App icon.", "art"),
    ],
    "cargo-twin": [
        (RAW / "cargo-twin/cargo-full-raw.png", "Current Cargo Twin v4 in the portfolio: guided Choose space â†’ Add cargo â†’ Review plan with a browser-local project.", "screen"),
        (RAW / "cargo-twin/cargo-scene-raw.png", "Current v4 3D delivery-van plan: 40 pieces rendered, labeled views and the replay sequence. Planning limits remain visible.", "screen"),
    ],
    "ai-summary": [
        (RAW / "ai-summary-v2/02-brief-cited-answer.png", "One click on a sample: TL;DR, key phrases and a suggested question answered with page citations, the source highlighted.", "screen"),
        (RAW / "ai-summary-v2/01-home.png", "Home: no account, no server, your files stay in the browser.", "screen"),
        (RAW / "ai-summary-v2/03-ask-dark.png", "Local Q&A in dark mode: cited sentences, and a plain answer when the text can't say.", "screen"),
        (RAW / "ai-summary-v2/04-study-quiz.png", "Study mode: a quiz generated from the document, with a citation for each answer.", "screen"),
        (RAW / "ai-summary-v2/05-mind-map.png", "Mind map from section headings and each section's key phrases.", "screen"),
        (RAW / "ai-summary-v2/06-claude-mocked.png", "Optional Claude mode: a streamed summary with citations (mocked response for this screenshot).", "screen"),
        (RAW / "ai-summary/ai-summary-login.png", "Version 1 (Feb 2026): Supabase sign-in.", "screen"),
    ],
}

SIZES = {"lg": 1600, "sm": 720}


def save(image: Image.Image, target: Path, width: int, quality: int) -> tuple[int, int]:
    img = image.copy()
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    target.parent.mkdir(parents=True, exist_ok=True)
    img.save(target, "WEBP", quality=quality, method=6)
    return img.size


def main() -> None:
    manifest: dict[str, list[dict]] = {}
    for project, items in SHOTS.items():
        out, index = [], 0
        for src, caption, kind in items:
            if not src.exists():
                print(f"skip  {project}: {src}")
                continue
            image = Image.open(src)
            image = image.convert("RGBA" if image.mode in ("RGBA", "LA", "P") and kind in ("render", "art") else "RGB")
            index += 1
            name = src.stem if project == "urcut" else f"{index:02d}"
            limit = 900 if kind == "phone" else SIZES["lg"]
            w, h = save(image, OUT / project / f"{name}.webp", limit, 80)
            save(image, OUT / project / f"{name}-sm.webp", 420 if kind == "phone" else SIZES["sm"], 72)
            out.append({"src": f"img/shots/{project}/{name}.webp", "sm": f"img/shots/{project}/{name}-sm.webp",
                        "w": w, "h": h, "caption": caption, "kind": kind})
        manifest[project] = out
        print(f"ok    {project}: {len(out)} images")
    js = ("// Generated by tools/images.py: screenshots per project.\n"
          f"export const SHOTS = {json.dumps(manifest, indent=1, ensure_ascii=False)};\n")
    (ROOT / "js" / "shots.js").write_text(js, encoding="utf-8")


if __name__ == "__main__":
    main()
