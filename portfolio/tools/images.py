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
        (RAW / "learn/learn-hero.png", "Landing page: capture what you learn, turn it into practice.", "screen"),
        (CLONES / "learn/public/intro/workflow-studio.png", "Studio: projects, templates and recent work.", "screen"),
        (RAW / "learn/learn-practice.png", "Algorithms practice quiz, two of six answered (demo account).", "screen"),
        (CLONES / "learn/public/intro/workflow-dashboard.png", "Dashboard with AI suggestions, review queue and calendar.", "screen"),
        (CLONES / "learn/public/intro/workflow-ai.png", "AI tutor workspace.", "screen"),
        (RAW / "learn/learn-studio.png", "Studio with the demo account's seeded notes.", "screen"),
        (RAW / "learn/learn-showcase-1-dashboard.png", "Product tour: the dashboard slide.", "screen"),
        (RAW / "learn/learn-login-phone.png", "Sign-in on a phone, with demo-account shortcuts.", "phone"),
    ],
    "allchess": [
        (RAW / "allchess-latest/allchess-02-classic-tabletop-bot-game.png", "Classic chess in the 29 September arcade build: bot replies and a played suggestion on the 3D tabletop.", "screen"),
        (RAW / "allchess-shore/konane-shore-desktop.png", "Shore Konane in the latest 29 September arcade: stone board and counters under studio lighting.", "screen"),
        (RAW / "allchess-latest/allchess-03-xiangqi-celadon-3d.png", "Xiangqi with the Celadon collection: glazed ceramic discs on a wood 3D board.", "screen"),
        (RAW / "allchess-latest/allchess-04-shogi-carved-3d.png", "Shogi with the carved collection, lacquered glyphs and hand stands.", "screen"),
        (RAW / "allchess-latest/allchess-05-ouk-courtyard-3d.png", "Ouk Chaktrang (Khmer chess) with the Courtyard sandstone and charcoal set.", "screen"),
        (RAW / "allchess-latest/allchess-01-home.png", "Game studio home: a visual library with bot, local, friend, quick match and watch modes.", "screen"),
        (RAW / "allchess-latest/allchess-06-draughts-club-3d.png", "English draughts with the Club ivory and oxblood counters.", "screen"),
        (RAW / "allchess-latest/allchess-08-collection-picker.png", "Board style picker: piece collection, 2D style and board colours per game.", "screen"),
        (RAW / "allchess-latest/allchess-10-all-games.png", "All 21 games, each with its own artwork.", "screen"),
        (RAW / "allchess-latest/allchess-09-move-review.png", "Move review with factual notation and playback.", "screen"),
        (RAW / "allchess-latest/allchess-phone-02-xiangqi-3d.png", "Celadon Xiangqi on a phone.", "phone"),
    ],
    "urcut": [
        (RAW / "urcut/editor-text.png", "Khmer and Chinese text on a 9:16 video, both clips on the timeline.", "screen"),
        (RAW / "urcut/voice.png", "AI voice panel with a Khmer script (voice list mocked here; UrVoice runs on your machine).", "screen"),
        (RAW / "urcut/captions.png", "Imported English and Khmer captions on the timeline (sample subtitle file).", "screen"),
        (RAW / "urcut/editor.png", "Editor: media, preview, transform properties and timeline.", "screen"),
        (RAW / "urcut/voice-zh.png", "Chinese voice gallery (mocked voice list).", "screen"),
        (RAW / "urcut/projects.png", "Projects dashboard with aspect-ratio tiles.", "screen"),
        (RAW / "urcut/projects-916.png", "A 9:16 poster project in the light theme.", "screen"),
    ],
    "codeage": [
        (RAW / "codeage/codeage-chat.png", "Chat panels beside a real terminal (no model connected, drafts only).", "screen"),
        (RAW / "codeage/codeage-code.png", "Code view: file tree, editor and terminal.", "screen"),
        (RAW / "codeage/codeage-agents.png", "Built-in agents: builder, code reviewer, researcher, debugger, planner.", "screen"),
        (RAW / "codeage/codeage-jarvis.png", "Jarvis, the voice assistant, with its 3D presence.", "screen"),
        (RAW / "codeage/codeage-settings-connect.png", "Connect a model: Ollama, OpenAI-compatible or Anthropic.", "screen"),
        (RAW / "codeage/codeage-library.png", "Library of imported project assets.", "screen"),
        (PROFILE / "codeage.jpg", "Chat and side panel, September 2026 capture.", "wide"),
    ],
    "edsync": [
        (CLONES / "edsync/public/showcase/teacher-create-dark.png", "Teacher: create a lesson with AI, from a draft or blank.", "screen"),
        (CLONES / "edsync/public/showcase/admin-dashboard-dark.png", "Admin command center.", "screen"),
        (CLONES / "edsync/public/showcase/student-dashboard-dark.png", "Student home.", "screen"),
        (CLONES / "edsync/public/showcase/login-organization-dark.png", "Organisation sign-in.", "screen"),
        (CLONES / "edsync/public/showcase/student-dashboard.jpg", "Student home, light theme.", "screen"),
        (CLONES / "edsync/public/showcase/teacher-work-dark.png", "Teacher work builder.", "screen"),
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
        (CLONES / "wreckabulary/docs/art/key_art.jpg", "Key art (team concept).", "screen"),
        (CLONES / "wreckabulary/docs/art/gameplay_mockup.jpg", "Gameplay mock-up: versus round (team concept).", "screen"),
        (CLONES / "wreckabulary/docs/art/sketch_room.png", "Early room sketch.", "art"),
        (CLONES / "wreckabulary/docs/art/sketch_logo.png", "Logo sketch.", "art"),
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
        (RAW / "cargo-twin-v2/01-buildup-pallet.png", "A 96-in PMC pallet packed from seven air waybills, with dangerous-goods labels and the ULD's centre of gravity.", "screen"),
        (RAW / "cargo-twin-v2/03-stress-test-result.png", "Physics stress test: cartons that tipped or shifted are flagged and the ULD is marked for restacking.", "screen"),
        (RAW / "cargo-twin-v2/04-aircraft-weight-balance.png", "777F load plan after auto-optimisation: 32 ULDs, deck plan and the CG envelope (representative data).", "screen"),
        (RAW / "cargo-twin-v2/05-strategy-comparison.png", "Strategy comparison on a 589-piece manifest: the genetic refinement wins with 36 ULDs.", "screen"),
        (RAW / "cargo-twin-v2/02-stress-test-live.png", "Stress test running: loose cartons lean into the void under a 1.5 g lateral load.", "screen"),
        (RAW / "cargo-twin-v2/06-equipment-library.png", "Equipment library: ULD contours drawn to scale with weights and aircraft compatibility.", "screen"),
        (RAW / "cargo/cargo-packed.png", "Version 1 (hackathon, Nov 2025): the original pseudo-3D packing view.", "screen"),
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
            name = f"{index:02d}"
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
