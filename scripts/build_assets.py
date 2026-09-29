#!/usr/bin/env python3
"""Draw the profile artwork (assets/*.svg) from code.

    python scripts/build_assets.py

Dev-only requirements: fonttools and uharfbuzz. The generated SVGs are committed, so GitHub
needs none of this. All text is converted to outlines (see outline.py) so it looks the same on every
device: Unbounded for headlines, Chakra Petch for HUD labels, Sora for running text (all OFL, in
scripts/fonts), plus Khmer UI and Microsoft YaHei (bold) from PROFILE_FONTS_DIR for Khmer and Chinese.
Project images come from assets/shots (made by shots.py).

Every animation only adds motion on top of a complete still picture, so the art still reads
correctly where CSS/SMIL animation is unavailable or reduced motion is requested.
"""
from __future__ import annotations

import base64
import math
import random
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

from outline import cap, fit, glyph_defs, num, text, width, wrap

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
SHOTS = ASSETS / "shots"

# Palette: "night market cyberpunk" (violet-black base, volt yellow, magenta, cyan)
VOID = "#08031A"
PANEL = "#130A30"
PANEL_2 = "#1C1146"
EDGE = "#3B2A7C"
LINE = "#241659"
INK = "#F6F3FF"
MUTED = "#C4BAEC"
DIM = "#9187CC"
VOLT = "#FCEE0A"
MAGENTA = "#FF2E88"
CYAN = "#19E6FF"
VIOLET = "#A974FF"
ACID = "#3CFFA4"
ORANGE = "#FF8A1F"
BLUE = "#4F8DFF"
LIME = "#C4FF3D"
RED = "#FF3B5C"
SILHOUETTE = "#0A0418"
SILHOUETTE_BACK = "#1D1044"
WINDOW_LIGHTS = ("#FFE66B", "#FFE66B", "#FFF4B8", "#8CF3FF", "#FF8CC6", "#C8A8FF")

BASE_CSS = "@media (prefers-reduced-motion:reduce){*{animation:none!important}}"
GROUND = 400  # skyline base line in scenery coordinates


# ---------------------------------------------------------------- SVG helpers


def esc(value: str) -> str:
    return escape(value, {'"': "&quot;"})


def txt(x, y, value, size, fill=None, *, style="body", anchor="start", tracking=0.0, attrs=""):
    return text(value, size, x, y, style=style, fill=fill, anchor=anchor, tracking=tracking, attrs=attrs)


def chamfer(x, y, w, h, cut=14, corners="tl br") -> str:
    """Rectangle path with cut corners (any of tl, tr, br, bl)."""
    tl, tr, br, bl = (cut if c in corners.split() else 0 for c in ("tl", "tr", "br", "bl"))
    return (f"M{num(x + tl)} {num(y)}H{num(x + w - tr)}L{num(x + w)} {num(y + tr)}V{num(y + h - br)}"
            f"L{num(x + w - br)} {num(y + h)}H{num(x + bl)}L{num(x)} {num(y + h - bl)}V{num(y + tl)}Z")


def neon(fid: str, color: str, inner: float = 2.2, outer: float = 8.0, strength: float = 0.85) -> str:
    return (
        f'<filter id="{fid}" x="-20%" y="-60%" width="140%" height="220%" color-interpolation-filters="sRGB">'
        f'<feGaussianBlur in="SourceAlpha" stdDeviation="{inner}" result="a"/>'
        f'<feFlood flood-color="{color}"/><feComposite in2="a" operator="in" result="ga"/>'
        f'<feGaussianBlur in="SourceAlpha" stdDeviation="{outer}" result="b"/>'
        f'<feFlood flood-color="{color}" flood-opacity="{strength}"/><feComposite in2="b" operator="in" result="gb"/>'
        '<feMerge><feMergeNode in="gb"/><feMergeNode in="ga"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    )


def glow(fid: str, w: float, h: float, blur: float = 4.0) -> str:
    """Soft glow; user-space region so thin lines keep their halo."""
    return (
        f'<filter id="{fid}" filterUnits="userSpaceOnUse" x="-40" y="-40" width="{w + 80}" height="{h + 80}">'
        f'<feGaussianBlur stdDeviation="{blur}" result="b"/>'
        '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    )


def textures() -> str:
    """Circuit grid, scanlines and hazard stripes shared by the panels."""
    return (f'<pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">'
            f'<path d="M32 .5H.5V32" fill="none" stroke="{LINE}"/><rect x="-1" y="-1" width="3" height="3" fill="{EDGE}"/></pattern>'
            '<pattern id="scan" width="8" height="4" patternUnits="userSpaceOnUse"><rect width="8" height="1.3" fill="#000" opacity=".28"/></pattern>'
            f'<pattern id="hazard" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
            f'<rect width="14" height="14" fill="{VOID}"/><rect width="7" height="14" fill="{VOLT}"/></pattern>')


def panel(w: float, h: float, *, cut: float = 22, accent: str = MAGENTA, accent2: str = CYAN) -> str:
    """Chamfered dark HUD panel with coloured corner brackets."""
    d = chamfer(.75, .75, w - 1.5, h - 1.5, cut)
    return (f'<path d="{d}" fill="{VOID}"/><path d="{d}" fill="url(#grid)" opacity=".7"/><path d="{d}" fill="url(#scan)"/>'
            + frame(w, h, cut=cut, accent=accent, accent2=accent2))


def frame(w: float, h: float, *, cut: float = 22, accent: str = MAGENTA, accent2: str = CYAN) -> str:
    arm = min(90, h / 3)
    return (f'<path d="{chamfer(.75, .75, w - 1.5, h - 1.5, cut)}" fill="none" stroke="{EDGE}" stroke-width="1.5"/>'
            f'<path d="M2 {num(cut + arm)}V{num(cut + 1.2)}L{num(cut + 1.2)} 2H{num(cut + arm)}" fill="none" stroke="{accent}" stroke-width="3"/>'
            f'<path d="M{w - 2} {num(h - cut - arm)}V{num(h - cut - 1.2)}L{num(w - cut - 1.2)} {h - 2}H{num(w - cut - arm)}" '
            f'fill="none" stroke="{accent2}" stroke-width="3"/>'
            + "".join(f'<rect x="{w - 66 + i * 16}" y="8" width="11" height="3" fill="{accent2}" opacity="{1 - i * .3:.1f}"/>' for i in range(3))
            + "".join(f'<rect x="{12 + i * 7}" y="{h - 12}" width="4" height="4" fill="{accent}" opacity="{1 - i * .25:.2f}"/>' for i in range(3)))


def tag(x, y, value, color, *, size=12.0, height=24.0, mode="solid", anchor="start", dot=False, pulse=False,
        style="hud", tracking=.08) -> tuple[str, float]:
    """Chamfered label. mode: solid (dark text on colour), tint (colour on a tint) or dark (colour on black)."""
    pad = height * .45
    dot_w = height * .5 if dot else 0
    w = width(value, size, style, tracking) + 2 * pad + dot_w
    x -= {"start": 0, "middle": w / 2, "end": w}[anchor]
    d = chamfer(x, y, w, height, height * .3)
    ink = VOID if mode == "solid" else color
    shape = {"solid": f'fill="{color}"',
             "tint": f'fill="{color}" fill-opacity=".14" stroke="{color}" stroke-opacity=".85"',
             "dark": f'fill="{VOID}" fill-opacity=".86" stroke="{color}" stroke-opacity=".7"'}[mode]
    out = f'<path d="{d}" {shape}/>'
    if dot:
        s = height * .26
        out += (f'<rect x="{num(x + pad)}" y="{num(y + height / 2 - s / 2)}" width="{num(s)}" height="{num(s)}" fill="{ink}"'
                + (' class="pulse"' if pulse else "") + "/>")
    baseline = y + height / 2 + cap(style) * size / 2
    out += txt(x + pad + dot_w, baseline, value, size, ink, style=style, tracking=tracking)
    return out, w


PULSE_CSS = ".pulse{animation:pulse 1.6s steps(2,jump-none) infinite}@keyframes pulse{50%{opacity:.2}}"
GLITCH_CSS = (".ga,.gb{mix-blend-mode:screen}"
              ".ga{animation:ga 7s steps(1) infinite}.gb{animation:gb 7s steps(1) infinite}"
              "@keyframes ga{0%,87%,100%{transform:none}88%{transform:translate(-7px,-2px)}90%{transform:translate(5px,1px)}"
              "92%{transform:translate(-3px,0)}}"
              "@keyframes gb{0%,87%,100%{transform:none}88%{transform:translate(7px,2px)}90%{transform:translate(-4px,-1px)}"
              "92%{transform:translate(3px,0)}}")


def glitch(uid, x, y, value, size, fill, *, style="head", anchor="start", tracking=0.0, shift=2.0,
           left=CYAN, right=MAGENTA, delay=0.0) -> str:
    """Heading with an RGB-split shadow that jumps briefly every few seconds."""
    timing = f' style="animation-delay:{delay:.1f}s"' if delay else ""
    base = txt(x, y, value, size, style=style, anchor=anchor, tracking=tracking, attrs=f'id="{uid}"')
    return (f'<g class="ga"{timing}><use xlink:href="#{uid}" x="{-shift}" fill="{left}" opacity=".9"/></g>'
            f'<g class="gb"{timing}><use xlink:href="#{uid}" x="{shift}" fill="{right}" opacity=".9"/></g>'
            f'<g fill="{fill}">{base}</g>')


def document(w, h, body, *, title, desc, css="", defs="") -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}" '
        f'height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc">'
        f'<title id="title">{esc(title)}</title><desc id="desc">{esc(desc)}</desc>'
        f"<style><![CDATA[{BASE_CSS}{css}]]></style><defs>{defs}{glyph_defs()}</defs>{body}</svg>\n"
    )


def embed(path: Path) -> str:
    mime = "image/jpeg" if path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def save(name: str, content: str) -> None:
    target = ASSETS / name
    target.write_text(content, encoding="utf-8", newline="\n")
    print(f"{name:30} {len(content.encode()) / 1024:7.1f} KB")


RAIN_CSS = ".rain{animation:rain 1.1s linear infinite}@keyframes rain{from{transform:translate(10px,-60px)}to{transform:translate(-20px,90px)}}"


def rain(rnd: random.Random, w: float, h: float, count: int, color: str = "#B7C6FF") -> str:
    drops = []
    for _ in range(count):
        x, y, length = rnd.uniform(0, w + 40), rnd.uniform(-20, h), rnd.uniform(10, 22)
        drops.append(f'<path d="M{num(x)} {num(y)}l{num(-length * .28)} {num(length)}" class="rain" '
                     f'style="animation-delay:-{rnd.uniform(0, 1.1):.2f}s;animation-duration:{rnd.uniform(.8, 1.3):.2f}s"/>')
    return f'<g stroke="{color}" stroke-width="1.1" stroke-linecap="round" opacity=".32">{"".join(drops)}</g>'


# ---------------------------------------------------------------- scenery: Angkor Wat meets Hong Kong


def tower_path(x, base, w, h):
    """Angkor-style lotus-bud tower: stepped plinth, then a corbelled bud."""
    steps = [(x - w / 2, base), (x - w / 2, base - .14 * h), (x - .42 * w, base - .14 * h),
             (x - .42 * w, base - .26 * h), (x - .35 * w, base - .26 * h), (x - .35 * w, base - .36 * h)]
    d = "M" + " L".join(f"{num(px)} {num(py)}" for px, py in steps)
    d += (f" C{num(x - .37 * w)} {num(base - .62 * h)} {num(x - .15 * w)} {num(base - .86 * h)} {num(x)} {num(base - h)}"
          f" C{num(x + .15 * w)} {num(base - .86 * h)} {num(x + .37 * w)} {num(base - .62 * h)} {num(x + .35 * w)} {num(base - .36 * h)}")
    d += "".join(f" L{num(2 * x - px)} {num(py)}" for px, py in reversed(steps))
    return d + " Z"


ANGKOR_TOWERS = [(70, 362, 36, 64), (260, 362, 36, 64), (112, 358, 44, 88), (218, 358, 44, 88), (165, 356, 58, 124)]


def angkor() -> tuple[str, str]:
    """Returns (rim light, silhouette) for the temple."""
    shapes = ["M20 400V388H36V377H52V366H278V377H294V388H310V400Z", "M48 366V356H282V366Z"]
    shapes += [tower_path(*tower) for tower in ANGKOR_TOWERS]
    rim = "".join(f'<path d="{d}" fill="none" stroke="{ORANGE}" stroke-opacity=".7" stroke-width="2.6"/>' for d in shapes)
    body = "".join(f'<path d="{d}" fill="{SILHOUETTE}"/>' for d in shapes)
    tiers = []
    for x, base, w, h in ANGKOR_TOWERS[2:]:
        for f in (.46, .56, .66, .76):
            half = .36 * w * (1 - ((f - .36) / .64) ** 1.5)
            tiers.append(f'<path d="M{num(x - half)} {num(base - f * h)}h{num(2 * half)}" stroke="{VOLT}" stroke-opacity=".3"/>')
    return rim, body + "".join(tiers)


def sugar_palm(x, height, lean, rnd) -> str:
    top_x, top_y = x + lean, GROUND - height
    parts = [f'<path d="M{x} {GROUND}Q{num(x + lean * .2)} {num(GROUND - height * .6)} {num(top_x)} {num(top_y)}" '
             f'stroke="{SILHOUETTE}" stroke-width="2.6" fill="none"/>']
    for i in range(20):
        angle = i / 20 * 6.2832 + rnd.uniform(-.1, .1)
        length = rnd.uniform(12, 17) * (0.75 if 0.3 < angle < 2.8 else 1)
        dx, dy = length * math.cos(angle), length * math.sin(angle)
        parts.append(f'<path d="M{num(top_x)} {num(top_y)}l{num(dx)} {num(dy)}" stroke="{SILHOUETTE}" stroke-width="2.2" stroke-linecap="round"/>')
    parts.append(f'<circle cx="{num(top_x)}" cy="{num(top_y)}" r="5" fill="{SILHOUETTE}"/>')
    return "".join(parts)


def stilt_house(x) -> str:
    legs = "".join(f'<rect x="{x + dx}" y="382" width="2" height="18" fill="{SILHOUETTE}"/>' for dx in (3, 14, 25, 36))
    return (legs + f'<rect x="{x}" y="366" width="40" height="17" fill="{SILHOUETTE}"/>'
            f'<path d="M{x - 7} 367L{x + 20} 349L{x + 47} 367Z" fill="{SILHOUETTE}"/>'
            f'<rect x="{x + 16}" y="370" width="8" height="7" fill="{VOLT}" opacity=".9" filter="url(#soft)"/>')


def windows(rnd, x, w, top, *, density, dim=False, bottom=GROUND - 4) -> str:
    cols = max(1, int((w - 2) // 6))
    left = x + (w - cols * 6) / 2 + 1.5
    out = []
    for row_y in range(int(top) + 5, int(bottom) - 3, 8):
        for col in range(cols):
            if rnd.random() >= density:
                continue
            color = rnd.choice(WINDOW_LIGHTS)
            blink = not dim and rnd.random() < .08
            extra = f' class="win" style="animation-delay:-{rnd.uniform(0, 7):.1f}s"' if blink else ""
            out.append(f'<rect x="{num(left + col * 6)}" y="{row_y}" width="3" height="4" fill="{color}" '
                       f'opacity="{.35 if dim else .85}"{extra}/>')
    return "".join(out)


def neon_sign(x, top, height, color, glyphs: str = "") -> str:
    sign = (f'<rect x="{x}" y="{top}" width="14" height="{height}" fill="#0B0620" stroke="{color}" '
            f'stroke-width="1.6" filter="url(#soft)"/>')
    for i, char in enumerate(glyphs):
        sign += txt(x + 7, top + 12 + i * 12, char, 10.5, color, style="han", anchor="middle")
    if not glyphs:
        sign += "".join(f'<rect x="{x + 4}" y="{top + 5 + i * 7}" width="6" height="3" fill="{color}"/>'
                        for i in range(int(height // 7) - 1))
    return sign


def scenery(seed: int = 11) -> dict[str, str]:
    """Skyline layers in a 1200x480 space with the ground at y=400."""
    rnd = random.Random(seed)
    back, front, lights, reflections = [], [], [], []

    back.append('<path d="M780 400Q870 306 960 330Q1050 262 1130 292Q1172 282 1200 290V400Z" fill="#160A36"/>')
    x = 556
    while x < 1200:
        w = rnd.randint(18, 34)
        height = rnd.randint(95, 196) if x > 990 else rnd.randint(40, 108)
        back.append(f'<rect x="{x}" y="{GROUND - height}" width="{w}" height="{height}" fill="{SILHOUETTE_BACK}"/>')
        lights.append(windows(rnd, x, w, GROUND - height, density=.12, dim=True))
        x += w + rnd.randint(-4, 6)

    rim, temple = angkor()
    front += [rim, temple]
    for px, height, lean in ((30, 96, 3), (322, 84, -2), (352, 108, 4), (432, 100, -3), (512, 88, 3)):
        front.append(sugar_palm(px, height, lean, rnd))
    front += [stilt_house(378), stilt_house(456)]

    x, index = 556, 0
    special_signs = {4: (MAGENTA, "理大"), 11: (VOLT, "茶")}
    while x < 978:
        w, height = rnd.randint(22, 36), rnd.randint(40, 96)
        top = GROUND - height
        front.append(f'<rect x="{x}" y="{top}" width="{w}" height="{height}" fill="{SILHOUETTE}"/>')
        if rnd.random() < .5:
            front.append(f'<rect x="{x + 4}" y="{top - 7}" width="9" height="7" fill="{SILHOUETTE}"/>')
        if rnd.random() < .35:
            front.append(f'<path d="M{x + w - 5} {top}v-13" stroke="{SILHOUETTE}" stroke-width="1.6"/>')
        lights.append(windows(rnd, x + 2, w - 4, top + 4, density=.3))
        if index in special_signs or rnd.random() < .25:
            color, glyphs = special_signs.get(index, (rnd.choice((MAGENTA, CYAN, VOLT, ACID)), ""))
            sign_height = 30 if glyphs else rnd.randint(20, 34)
            sign_top = top + rnd.randint(8, max(9, height - sign_height - 14))
            lights.append(neon_sign(x + w - 7, sign_top, sign_height, color, glyphs))
            reflections.append(f'<path d="M{x + w} 404v{rnd.randint(30, 60)}" stroke="{color}" stroke-width="6" '
                               f'stroke-dasharray="5 4" opacity=".35" class="shim" style="animation-delay:-{rnd.uniform(0, 3):.1f}s"/>')
        for _ in range(rnd.randint(1, 2)):
            rx = x + rnd.uniform(3, w - 3)
            reflections.append(f'<path d="M{num(rx)} 404v{rnd.randint(18, 50)}" stroke="{rnd.choice(WINDOW_LIGHTS)}" '
                               f'stroke-width="2" stroke-dasharray="3 4" opacity=".3" class="shim" '
                               f'style="animation-delay:-{rnd.uniform(0, 3):.1f}s"/>')
        x += w + rnd.choice((0, 1, 2, 3))
        index += 1

    # Hong Kong towers: IFC, Bank of China, Central Plaza and friends
    ifc = "M994 400V178H998V172H1003V168H1027V172H1032V178H1036V400Z"
    boc = "M1046 400V262L1070 204L1094 236V400Z"
    plaza = "M1104 400V232L1124 210L1144 232V400Z"
    towers = [ifc, boc, plaza, "M1152 400V272H1178V400Z", "M1184 400V304H1200V400Z"]
    front += [f'<path d="{d}" fill="none" stroke="{CYAN}" stroke-opacity=".5" stroke-width="2.2"/>' for d in towers[:3]]
    front += [f'<path d="{d}" fill="{SILHOUETTE}"/>' for d in towers]
    front.append(''.join(f'<path d="M{x} 168v-11" stroke="{SILHOUETTE}" stroke-width="2.4"/>' for x in (1004, 1011, 1019, 1026)))
    front.append(f'<path d="M1066 204v-28M1074 204v-24M1124 210v-24M1165 272v-18" stroke="{SILHOUETTE}" stroke-width="2"/>')
    lights.append(''.join(f'<path d="M{x} 182V398" stroke="#9EEBFF" stroke-opacity=".2"/>' for x in range(999, 1034, 5)))
    lights.append(f'<path d="M1046 300L1094 338M1094 300L1046 338M1046 338L1094 376M1094 338L1046 376M1046 262L1094 300M1070 204V400" '
                  f'stroke="{MAGENTA}" stroke-opacity=".45" fill="none"/>')
    lights.append(f'<path d="M1104 232L1124 210L1144 232Z" class="crown" fill="{VOLT}" opacity=".9"/>')
    lights.append(windows(rnd, 1106, 36, 238, density=.35) + windows(rnd, 1152, 26, 276, density=.3))
    lights.append(''.join(f'<circle cx="{cx}" cy="{cy}" r="1.8" fill="{RED}" class="beacon" style="animation-delay:{d}s"/>'
                          for cx, cy, d in ((1015, 156, 0), (1066, 176, .6), (1074, 180, 1.1), (1124, 186, .3))))
    for rx in range(996, 1200, 7):
        reflections.append(f'<path d="M{rx} 404v{rnd.randint(25, 70)}" stroke="{rnd.choice((CYAN, MAGENTA, VOLT))}" '
                           f'stroke-width="2" stroke-dasharray="4 5" opacity=".24" class="shim" '
                           f'style="animation-delay:-{rnd.uniform(0, 3):.1f}s"/>')
    return {"back": "".join(back), "front": "".join(front), "lights": "".join(lights),
            "reflections": "".join(reflections), "rim": rim}


SCENERY_CSS = (
    ".win{animation:win 7s steps(1) infinite}@keyframes win{50%{opacity:.12}}"
    ".shim{animation:shim 3.2s ease-in-out infinite}@keyframes shim{50%{opacity:.65}}"
    ".beacon{animation:beacon 2s steps(1) infinite}@keyframes beacon{50%{opacity:.15}}"
    ".crown{animation:crown 12s linear infinite}@keyframes crown{0%,100%{fill:" + VOLT + "}33%{fill:" + MAGENTA + "}66%{fill:" + CYAN + "}}"
)


def water(y: float, height: float, rnd: random.Random, w: float = 1200) -> str:
    return "".join(
        f'<path d="M0 {num(ry)}H{w}" stroke="#040010" stroke-width="1.4" stroke-dasharray="{rnd.randint(20, 60)} {rnd.randint(6, 18)}" opacity=".7"/>'
        for ry in [y + 6 + i * 5 for i in range(int(height // 5))]
    )


# ---------------------------------------------------------------- hero


PLANE = ("M10 0Q10-1.4 8-1.4L2.5-1.4L-2-8L-4.2-8L-1.6-1.4L-7-1.4L-9-4.4L-10.6-4.4L-9.6-1V1L-10.6 4.4L-9 4.4"
         "L-7 1.4L-1.6 1.4L-4.2 8L-2 8L2.5 1.4L8 1.4Q10 1.4 10 0Z")


def diamond(cx, cy, r, color) -> str:
    return f'<path d="M{num(cx)} {num(cy - r)}L{num(cx + r)} {num(cy)}L{num(cx)} {num(cy + r)}L{num(cx - r)} {num(cy)}Z" fill="{color}"/>'


def hero() -> str:
    W, H, CUT = 1200, 480, 28
    rnd = random.Random(7)
    scene = scenery()
    css = (SCENERY_CSS + RAIN_CSS + GLITCH_CSS
           + ".tw{animation:tw 4s ease-in-out infinite}@keyframes tw{50%{opacity:.2}}"
           + ".ferry{animation:ferry 48s linear -30s infinite}@keyframes ferry{to{transform:translateX(-1480px)}}"
           + ".route{animation:route 1.4s linear infinite}@keyframes route{to{stroke-dashoffset:-22}}"
           + ".ring{animation:ring 2.4s ease-out infinite;transform-box:fill-box;transform-origin:center}"
           + "@keyframes ring{from{transform:scale(.4);opacity:1}to{transform:scale(2.2);opacity:0}}"
           + ".beam{animation:beam 10s ease-in-out infinite;transform-origin:1015px 170px}"
           + ".beam2{animation:beam 13s ease-in-out -5s infinite;transform-origin:1124px 210px}"
           + "@keyframes beam{50%{transform:rotate(-26deg)}}"
           + ".sweep{animation:sweep 7s linear infinite}@keyframes sweep{from{transform:translateY(-60px)}to{transform:translateY(560px)}}")
    defs = "".join([
        '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04010C"/>'
        '<stop offset=".42" stop-color="#12042E"/><stop offset=".7" stop-color="#2E0A4E"/><stop offset=".84" stop-color="#62105A"/></linearGradient>',
        f'<radialGradient id="haze"><stop offset="0" stop-color="{MAGENTA}" stop-opacity=".38"/><stop offset="1" stop-color="{MAGENTA}" stop-opacity="0"/></radialGradient>',
        f'<radialGradient id="cityglow"><stop offset="0" stop-color="{CYAN}" stop-opacity=".2"/><stop offset="1" stop-color="{CYAN}" stop-opacity="0"/></radialGradient>',
        f'<radialGradient id="warm"><stop offset="0" stop-color="{ORANGE}" stop-opacity=".3"/><stop offset="1" stop-color="{ORANGE}" stop-opacity="0"/></radialGradient>',
        '<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#170836"/><stop offset="1" stop-color="#030008"/></linearGradient>',
        f'<linearGradient id="shore" gradientUnits="userSpaceOnUse" x1="0" x2="{W}" y1="0" y2="0"><stop offset="0" stop-color="{ORANGE}" stop-opacity=".7"/>'
        f'<stop offset=".5" stop-color="{MAGENTA}" stop-opacity=".45"/><stop offset="1" stop-color="{CYAN}" stop-opacity=".8"/></linearGradient>',
        f'<linearGradient id="beamfill" gradientUnits="userSpaceOnUse" x1="0" y1="170" x2="0" y2="-20"><stop offset="0" stop-color="{CYAN}" stop-opacity=".32"/>'
        f'<stop offset="1" stop-color="{CYAN}" stop-opacity="0"/></linearGradient>',
        f'<linearGradient id="beamfill2" gradientUnits="userSpaceOnUse" x1="0" y1="210" x2="0" y2="-20"><stop offset="0" stop-color="{MAGENTA}" stop-opacity=".3"/>'
        f'<stop offset="1" stop-color="{MAGENTA}" stop-opacity="0"/></linearGradient>',
        f'<linearGradient id="sweepfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{CYAN}" stop-opacity="0"/>'
        f'<stop offset="1" stop-color="{CYAN}" stop-opacity=".09"/></linearGradient>',
        f'<clipPath id="frame"><path d="{chamfer(0, 0, W, H, CUT)}"/></clipPath>',
        f'<clipPath id="sea-clip"><rect y="{GROUND}" width="{W}" height="{H - GROUND}"/></clipPath>',
        '<mask id="crescent"><rect width="1200" height="480" fill="#fff"/><circle cx="1121" cy="61" r="19" fill="#000"/></mask>',
        neon("nc", CYAN, 2.4, 10, .9), neon("np", MAGENTA, 2, 8), neon("nv", VOLT, 2, 8), glow("soft", W, H, 2.4),
        textures(),
    ])
    b = [f'<g clip-path="url(#frame)"><rect width="{W}" height="{H}" fill="url(#sky)"/>',
         f'<ellipse cx="600" cy="{GROUND}" rx="760" ry="170" fill="url(#haze)"/>',
         f'<ellipse cx="1060" cy="{GROUND - 60}" rx="260" ry="190" fill="url(#cityglow)"/>',
         f'<ellipse cx="165" cy="{GROUND - 20}" rx="250" ry="150" fill="url(#warm)"/>']
    for _ in range(90):
        x, y = rnd.uniform(0, W), 300 * rnd.random() ** 1.6
        r = rnd.choice((.6, .8, 1, 1, 1.3, 1.6))
        b.append(f'<circle cx="{num(x)}" cy="{num(y)}" r="{r}" fill="#fff" class="tw" '
                 f'style="animation-delay:-{rnd.uniform(0, 4):.1f}s;animation-duration:{rnd.uniform(2.5, 6):.1f}s"/>')
    b.append(f'<circle cx="1110" cy="68" r="22" fill="{VOLT}" mask="url(#crescent)" filter="url(#nv)"/>')
    b.append('<path d="M1015 170L1050-20H1100Z" fill="url(#beamfill)" class="beam"/>'
             '<path d="M1124 210L1160-20H1215Z" fill="url(#beamfill2)" class="beam2"/>')

    b += [scene["back"], scene["front"], scene["lights"]]
    b.append(f'<rect y="{GROUND}" width="{W}" height="{H - GROUND}" fill="url(#sea)"/>')
    b.append(f'<g clip-path="url(#sea-clip)"><g transform="translate(0 {2 * GROUND}) scale(1 -1)" opacity=".5">{scene["rim"]}</g></g>')
    b.append(scene["reflections"] + water(GROUND, H - GROUND, rnd))
    b.append(f'<path d="M0 {GROUND + .5}H{W}" stroke="url(#shore)" stroke-width="1.6"/>')
    b.append(f'<g class="ferry"><g transform="translate(1260 426)">'
             f'<path d="M0 0H62L55 9H7Z" fill="{SILHOUETTE}" stroke="#34206E"/><rect x="10" y="-10" width="42" height="10" fill="#5B1250"/>'
             f'<rect x="14" y="-16" width="34" height="6" fill="#EDE6FF"/>'
             + "".join(f'<rect x="{14 + i * 7}" y="-7" width="4" height="4" fill="{VOLT}"/>' for i in range(5))
             + f'<path d="M4 12H58" stroke="{VOLT}" stroke-opacity=".4" stroke-dasharray="3 3"/></g></g>')
    b.append(rain(rnd, W, H, 110))

    route = "M165 226C300 30 880 20 1015 150"
    b.append(f'<path id="route" d="{route}" fill="none" stroke="{VOLT}" stroke-opacity=".8" stroke-width="2" '
             f'stroke-dasharray="2 9" stroke-linecap="round" class="route"/>')
    for cx, cy, color in ((165, 226, ORANGE), (1015, 150, CYAN)):
        b.append(f'<circle cx="{cx}" cy="{cy}" r="4" fill="{color}" filter="url(#soft)"/>'
                 f'<circle cx="{cx}" cy="{cy}" r="7" fill="none" stroke="{color}" class="ring"/>')
    b.append(tag(154, 196, "KH", ORANGE, size=13, height=22, anchor="end")[0])
    b.append(tag(1034, 134, "HK", CYAN, size=13, height=22)[0])
    b.append(f'<g opacity="0"><path d="{PLANE}" fill="{INK}" filter="url(#nv)"/>'
             f'<animateMotion dur="12s" repeatCount="indefinite" rotate="auto"><mpath xlink:href="#route"/></animateMotion>'
             f'<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.06;.92;1" dur="12s" repeatCount="indefinite"/></g>')

    # greeting: Khmer, Chinese, English
    greetings = [("សួស្តី", "khmer", 31, VOLT, "nv"), ("你好", "han", 29, MAGENTA, "np"), ("HELLO", "hud", 31, CYAN, "nc")]
    gap = 44
    widths = [width(value, size, style, .04 if style == "hud" else 0) for value, style, size, _, _ in greetings]
    x = 600 - (sum(widths) + gap * (len(greetings) - 1)) / 2
    for i, ((value, style, size, color, fid), w) in enumerate(zip(greetings, widths)):
        b.append(txt(x, 104, value, size, color, style=style, tracking=.04 if style == "hud" else 0, attrs=f'filter="url(#{fid})"'))
        x += w + gap
        if i < len(greetings) - 1:
            b.append(diamond(x - gap / 2, 94, 4, INK))

    name = "SETHY PAGNA UNG"
    size = fit(name, 76, 820, "head", .02)
    b.append(f'<g filter="url(#nc)" opacity=".55"><use xlink:href="#name" fill="{CYAN}"/></g>')
    b.append(glitch("name", 600, 190, name, size, INK, anchor="middle", tracking=.02, shift=2.6))

    tagline = ["COMPUTER SCIENCE @ POLYU", "FULL-STACK & AI APPS", "UNREAL ENGINE PROTOTYPES"]
    size, gap = 15.5, 34
    widths = [width(t, size, "hud", .12) for t in tagline]
    x = 600 - (sum(widths) + gap * (len(tagline) - 1)) / 2
    strip_w = sum(widths) + gap * (len(tagline) - 1) + 56
    b.append(f'<path d="{chamfer(600 - strip_w / 2, 216, strip_w, 38, 12)}" fill="{VOID}" fill-opacity=".72" stroke="{EDGE}"/>')
    for i, (t, w) in enumerate(zip(tagline, widths)):
        b.append(txt(x, 241, t, size, (INK, MUTED, INK)[i], style="hud", tracking=.12))
        x += w + gap
        if i < len(tagline) - 1:
            b.append(diamond(x - gap / 2, 235, 4.5, (MAGENTA, CYAN)[i]))

    b.append(tag(18, 446, "ANGKOR WAT · 13.41°N 103.87°E", ORANGE, size=11.5, height=22, mode="dark")[0])
    b.append(tag(1150, 446, "22.30°N 114.18°E · HUNG HOM", CYAN, size=11.5, height=22, mode="dark", anchor="end")[0])
    b.append(f'<rect y="0" width="{W}" height="60" fill="url(#sweepfill)" class="sweep"/>')
    b.append("</g>" + frame(W, H, cut=CUT, accent=MAGENTA, accent2=CYAN))
    return document(W, H, "".join(b), css=css, defs=defs,
                    title="Sethy Pagna UNG: សួស្តី · 你好 · Hello",
                    desc="Animated cyberpunk night scene in the rain: Angkor Wat on the left, the Hong Kong skyline with "
                         "searchlights on the right, and a plane flying from KH (Cambodia) to HK (Hong Kong). Computer Science "
                         "at PolyU; full-stack and AI apps; Unreal Engine prototypes.")


# ---------------------------------------------------------------- boarding pass (about me)


def barcode(x, y, w, height, rnd, color=INK) -> str:
    bars, cursor = [], x
    while cursor < x + w:
        bar = rnd.choice((1, 1, 2, 3))
        if rnd.random() < .62:
            bars.append(f'<rect x="{cursor}" y="{y}" width="{bar}" height="{height}"/>')
        cursor += bar + 1
    return f'<g fill="{color}">{"".join(bars)}</g>'


def boarding_pass() -> str:
    W, H, CUT = 1200, 450, 30
    rnd = random.Random(3)
    stub_x = 868
    css = (PULSE_CSS + ".fly{animation:fly 5s ease-in-out infinite}@keyframes fly{50%{transform:translateY(-5px)}}"
           ".sheen{animation:sheen 9s ease-in-out infinite}@keyframes sheen{from{transform:translateX(-500px)}60%,to{transform:translateX(1500px)}}")
    ticket = chamfer(10, 10, W - 20, H - 20, CUT)
    defs = "".join([
        f'<mask id="ticket"><path d="{ticket}" fill="#fff"/>'
        f'<circle cx="{stub_x}" cy="10" r="17" fill="#000"/><circle cx="{stub_x}" cy="{H - 10}" r="17" fill="#000"/></mask>',
        '<linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1A0E40"/><stop offset="1" stop-color="#0B0522"/></linearGradient>',
        f'<linearGradient id="holo" x1="0" y1="0" x2="1" y2=".4"><stop offset="0" stop-color="{MAGENTA}" stop-opacity=".2"/>'
        f'<stop offset=".5" stop-color="{VIOLET}" stop-opacity=".06"/><stop offset="1" stop-color="{CYAN}" stop-opacity=".2"/></linearGradient>',
        '<linearGradient id="shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/>'
        '<stop offset=".5" stop-color="#fff" stop-opacity=".09"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>',
        neon("nm", MAGENTA, 2, 9, .8), neon("nc", CYAN, 2, 9, .8), textures(),
    ])
    b = [f'<g mask="url(#ticket)">',
         f'<rect width="{W}" height="{H}" fill="url(#card)"/><rect width="{W}" height="{H}" fill="url(#grid)" opacity=".55"/>',
         f'<rect width="{W}" height="{H}" fill="url(#holo)"/><rect width="{W}" height="{H}" fill="url(#scan)"/>',
         f'<g class="sheen"><path d="M0 0H160L60 {H}H-100Z" fill="url(#shine)"/></g>',
         f'<rect width="{stub_x}" height="80" fill="{VOLT}"/><rect x="{stub_x}" width="{W - stub_x}" height="80" fill="{MAGENTA}"/>',
         f'<rect x="{stub_x}" y="80" width="{W - stub_x}" height="{H}" fill="#000" opacity=".22"/></g>',
         f'<path d="{ticket}" fill="none" stroke="{EDGE}" stroke-width="1.5" mask="url(#ticket)"/>',
         f'<path d="M{stub_x} 36V{H - 36}" stroke="{DIM}" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"/>']
    # header band
    b.append(f'<g transform="translate(58 45) scale(1.6)"><path d="{PLANE}" fill="{VOID}"/></g>')
    b.append(txt(86, 56, "BOARDING PASS", 26, VOID, style="head", tracking=.04))
    b.append(txt(104 + width("BOARDING PASS", 26, "head", .04), 55, "登機證", 22, VOID, style="han"))
    b.append(txt(stub_x - 30, 54, "PAGNA AIR", 17, VOID, style="hud", anchor="end", tracking=.24))
    b.append(txt(stub_x + 34, 54, "NEXT STOP", 17, VOID, style="hud", tracking=.24))

    # route: KH -> HK
    b.append(txt(52, 124, "FROM", 12, DIM, style="hud", tracking=.2))
    b.append(txt(48, 206, "KH", 86, MAGENTA, style="head", attrs='filter="url(#nm)"'))
    b.append(txt(52, 236, "CAMBODIA · HOME", 14, INK, style="hud", tracking=.12))
    b.append(txt(704, 124, "TO", 12, DIM, style="hud", anchor="end", tracking=.2))
    b.append(txt(708, 206, "HK", 86, CYAN, style="head", anchor="end", attrs='filter="url(#nc)"'))
    b.append(txt(704, 236, "HONG KONG · NOW", 14, INK, style="hud", anchor="end", tracking=.12))
    b.append(f'<path d="M226 170Q376 108 526 170" fill="none" stroke="{VOLT}" stroke-width="2.4" stroke-dasharray="3 8" stroke-linecap="round"/>')
    b.append(f'<g class="fly"><g transform="translate(376 139) scale(1.8)"><path d="{PLANE}" fill="{VOLT}"/></g></g>')
    b.append(txt(376, 198, "VIA  MY · CN · AU", 13, DIM, style="hud", anchor="middle", tracking=.16))

    fields = [
        (52, 282, "PASSENGER", "UNG / SETHY PAGNA", "call me Pagna (or James)"),
        (380, 282, "CLASS", "COMPUTER SCIENCE", "The Hong Kong Polytechnic University"),
        (52, 362, "LANGUAGES", None, "Khmer · English · Mandarin"),
        (380, 362, "ARRIVAL", "JUL 2027 · GRADUATION", "expected"),
        (700, 282, "SEAT", "FULL-STACK", "AI apps · games"),
        (700, 362, "BAGGAGE", "TS · PY · UE5", "React · Cloudflare"),
    ]
    for x, y, key, value, note in fields:
        b.append(f'<rect x="{x}" y="{y - 10}" width="3" height="12" fill="{VOLT}"/>')
        b.append(txt(x + 10, y, key, 11.5, DIM, style="hud", tracking=.2))
        if value:
            b.append(txt(x, y + 29, value, 23, INK, style="hud", tracking=.03))
        else:
            kx = x
            for value, style, size in (("ខ្មែរ", "khmer", 22), ("EN", "hud", 23), ("中文", "han", 21)):
                b.append(txt(kx, y + 29, value, size, INK, style=style))
                kx += width(value, size, style) + 22
                if value != "中文":
                    b.append(diamond(kx - 11, y + 20, 3, MAGENTA))
        b.append(txt(x, y + 50, note, 13.5, MUTED))

    # stub: next destination
    sx = stub_x + 34
    b.append(txt(sx, 124, "DESTINATION", 12, DIM, style="hud", tracking=.2))
    b.append(txt(sx, 168, "INTERNSHIP", fit("INTERNSHIP", 36, 262, "head"), INK, style="head"))
    for i, line in enumerate(("Software development", "AI applications", "Game development")):
        color = (MAGENTA, VIOLET, CYAN)[i]
        b.append(f'<rect x="{sx}" y="{192 + i * 25}" width="9" height="9" fill="{color}"/>')
        b.append(txt(sx + 20, 201 + i * 25, line, 16, INK, style="body-semi"))
    b.append(tag(sx, 280, "NOW BOARDING", ACID, size=13, height=30, dot=True, pulse=True)[0])
    b.append(barcode(sx, 330, 262, 46, rnd))
    b.append(txt(sx, 398, "SP-2027 · HKG · GATE 2027", 11.5, DIM, style="hud", tracking=.14))
    return document(W, H, "".join(b), css=css, defs=defs,
                    title="Boarding pass: about Sethy Pagna UNG",
                    desc="A holographic boarding pass from KH (Cambodia, home) to HK (Hong Kong, now), via Malaysia, China and "
                         "Australia. Passenger: UNG / SETHY PAGNA, call me Pagna or James. Class: Computer Science, The Hong "
                         "Kong Polytechnic University. Arrival: graduation, expected July 2027. Languages: Khmer, English, "
                         "Mandarin. Next stop: internships in software development, AI applications and game development.")


# ---------------------------------------------------------------- departures board (now building)


@dataclass
class Flight:
    code: str
    name: str
    route: str
    gate: str
    status: str
    color: str


FLIGHTS = [
    Flight("BOS 01", "BUSINESS OS", "Retail POS + storefront, EN/KH", "CLOUDFLARE", "IN SERVICE", ACID),
    Flight("LRN 02", "LEARN", "Notes → AI tutor → quizzes", "NEXT.JS", "ACTIVE DEV", CYAN),
    Flight("URC 03", "URCUT+URVOICE", "Local-first video editor + voice", "NEXT + PY", "BOARDING", MAGENTA),
    Flight("CDA 04", "CODEAGE", "AI workbench beside your code", "ELECTRON", "ALPHA", VIOLET),
    Flight("ACH 05", "ALLCHESS", "Chess variants of the world", "NEXT + D1", "PUBLIC", ACID),
    Flight("EDS 06", "EDSYNC", "Classes for students & teachers", "NEXT.JS", "PREVIEW", BLUE),
    Flight("LKG 07", "LIVING KINGDOM", "Fantasy world, UE5 prototype", "UE5 C++", "PROTOTYPE", VOLT),
    Flight("SND 08", "SANDLINE", "Offline bot shooter, UE5", "UE5 C++", "PROTOTYPE", VOLT),
    Flight("OMD 09", "OMNIDRAMA", "Local video library + player", "NODE + TS", "NEW", ORANGE),
]
FLAP_CHARS = "ABCDEFGHIJKLMNOPRSTUVWXYZ0123456789"


def tiles(x, y, value, count, rnd, row) -> str:
    out = []
    for i in range(count):
        char = value[i] if i < len(value) else " "
        tx = x + i * 24
        tile = (f'<rect x="{tx}" y="{y}" width="21" height="32" rx="2" fill="#1B0F40"/>'
                f'<path d="M{tx} {y + 16}h21" stroke="{VOID}" stroke-width="1.4"/>')
        out.append(tile)
        if char != " ":
            out.append(txt(tx + 10.5, y + 23.5, char, 20, VOLT, style="hud", anchor="middle"))
        for step in range(2):
            delay = .5 + row * .32 + i * .045 + step * .16  # the board shows clean text before the first flip
            ghost = rnd.choice(FLAP_CHARS)
            out.append(f'<g class="fx" style="animation-delay:{delay:.2f}s">{tile}'
                       + txt(tx + 10.5, y + 23.5, ghost, 20, "#B8AE4A", style="hud", anchor="middle") + "</g>")
    return "".join(out)


def departures() -> str:
    W, row_h, top = 1200, 46, 150
    H = top + row_h * len(FLIGHTS) + 74
    rnd = random.Random(5)
    ticker = ("PRODUCT DIRECTION + AI PAIR-PROGRAMMING WITH CLAUDE AND CODEX + REVIEW AND TESTING   ///   PRIVATE "
              "PROJECTS ARE DESCRIBED AT A HIGH LEVEL   ///   PASSENGERS WELCOME: OPEN TO INTERNSHIPS IN SOFTWARE, AI AND GAMES   ///   ")
    ticker_w = width(ticker, 15, "hud", .08) + 15 * .08
    css = (PULSE_CSS + GLITCH_CSS
           + ".fx{opacity:0;animation:fx 16s infinite}@keyframes fx{0%,1%{opacity:1}1.1%,100%{opacity:0}}"
           + ".blink{animation:blink 1.3s steps(1) infinite}@keyframes blink{50%{opacity:.35}}"
           + f".tick{{animation:tick {ticker_w / 38:.0f}s linear infinite}}@keyframes tick{{to{{transform:translateX(-{ticker_w:.1f}px)}}}}")
    band_y = H - 60
    defs = (textures() + neon("nv", VOLT, 1.6, 7, .7)
            + f'<clipPath id="band"><rect x="58" y="{band_y}" width="{W - 116}" height="34"/></clipPath>')
    b = [panel(W, H, accent=VOLT, accent2=MAGENTA),
         f'<path d="{chamfer(20, 18, W - 40, 82, 16)}" fill="{PANEL}" stroke="{EDGE}"/>',
         f'<g transform="translate(56 59) scale(1.6)"><path d="{PLANE}" fill="{VOLT}" filter="url(#nv)"/></g>']
    b.append(glitch("dep", 86, 73, "DEPARTURES", 30, VOLT, tracking=.03, shift=1.8))
    x = 86 + width("DEPARTURES", 30, "head", .03) + 22
    for value, style, size in (("出發", "han", 25), ("ចេញដំណើរ", "khmer", 24)):
        b.append(txt(x, 71, value, size, MUTED, style=style))
        x += width(value, size, style) + 18
    now, now_w = tag(W - 44, 43, "NOW BUILDING", ACID, size=14, height=32, dot=True, pulse=True, anchor="end")
    b.append(now)
    b.append(txt(W - 62 - now_w, 64, "SNAPSHOT · SEP 2026", 13, DIM, style="hud", anchor="end", tracking=.14))

    for x, head in ((40, "FLIGHT"), (196, "DESTINATION"), (548, "ROUTE"), (880, "GATE"), (1012, "STATUS")):
        b.append(txt(x, 130, head, 12, DIM, style="hud", tracking=.24))
    b.append(f'<path d="M30 139H{W - 30}" stroke="{EDGE}"/>')
    for row, flight in enumerate(FLIGHTS):
        y = top + row * row_h
        if row % 2:
            b.append(f'<rect x="30" y="{y - 6}" width="{W - 60}" height="{row_h}" fill="{PANEL_2}" opacity=".55"/>')
        b.append(tiles(40, y, flight.code, 6, rnd, row))
        b.append(tiles(196, y, flight.name, 14, rnd, row))
        b.append(txt(548, y + 22, flight.route, 16, INK, style="body"))
        b.append(txt(880, y + 22, flight.gate, 14, CYAN, style="hud", tracking=.06))
        boarding = flight.status == "BOARDING"
        status, _ = tag(1012, y + 3, flight.status, flight.color, size=12, height=26, mode="solid" if boarding else "tint",
                        dot=True, pulse=boarding)
        b.append(f'<g class="blink">{status}</g>' if boarding else status)

    b.append(f'<path d="{chamfer(30, band_y, W - 60, 34, 10)}" fill="{VOLT}"/>')
    b.append(f'<rect x="30" y="{band_y}" width="28" height="34" fill="url(#hazard)"/><rect x="{W - 58}" y="{band_y}" width="28" height="34" fill="url(#hazard)"/>')
    strip = (f'<g id="ticker">{txt(64, band_y + 22.5, ticker, 15, VOID, style="hud", tracking=.08)}</g>'
             f'<use xlink:href="#ticker" x="{ticker_w:.1f}"/><use xlink:href="#ticker" x="{2 * ticker_w:.1f}"/>')
    b.append(f'<g clip-path="url(#band)"><g class="tick">{strip}</g></g>')
    return document(W, H, "".join(b), css=css, defs=defs,
                    title="Departures: what I'm building now",
                    desc="Departures board listing current projects: Business OS (retail POS and storefront, in service); "
                         "LEARN (notes to AI tutor to quizzes, active development); UrCut and UrVoice (local-first video editor "
                         "and voice engine, boarding); CodeAge (AI workbench, alpha); AllChess (chess variants, public); EdSync "
                         "(classes for students and teachers, preview); Living Kingdom and Sandline (Unreal Engine 5 prototypes); "
                         "OmniDrama (local video library and player, new).")


# ---------------------------------------------------------------- project cards


@dataclass
class Project:
    slug: str
    name: str
    tagline: str
    blurb: str
    status: str
    color: str
    kind: str
    stack: tuple[str, ...]
    shot: str | None = None
    address: str | None = None
    game: bool = False


PROJECTS = [
    Project("business-os", "Business OS", "A connected workspace for retail",
            "Point of sale, inventory, branch transfers, shifts and reporting, plus a customer storefront, in English and Khmer.",
            "LIVE", VOLT, "SOFTWARE", ("React", "TypeScript", "Cloudflare Workers", "D1", "R2"), "business-os", "leangbeauty.com"),
    Project("learn", "LEARN", "Capture → create → practise → review",
            "Notes, docs, sheets and slides beside AI tutoring, quizzes, vocabulary practice and progress tracking.",
            "ACTIVE DEV", CYAN, "AI · EDTECH", ("Next.js", "React", "TypeScript", "Cloudflare"), "learn", "learn-ten-pearl.vercel.app"),
    Project("codeage", "CodeAge", "AI conversations beside your code",
            "A Windows workbench with chat and code panels, editor, terminal and Git diffs, using local Ollama models or API providers.",
            "ALPHA · PRIVATE", VIOLET, "AI · DEV TOOLS", ("Electron", "React", "TypeScript", "SQLite"), "codeage", "CodeAge · desktop alpha"),
    Project("urcut", "UrCut + UrVoice", "Your cut. Visual, fast, private.",
            "A local-first, CapCut-style video editor with AI voiceovers and captions from UrVoice, a speech engine on your own machine.",
            "NEW · PRIVATE", MAGENTA, "AI · CREATIVE", ("Next.js", "TypeScript", "Python", "Local AI")),
    Project("allchess", "AllChess", "Discover how the world plays chess",
            "Classic chess and global variants with rule guides, bot practice, rooms, history and game review.",
            "PUBLIC", ACID, "GAMES · WEB", ("Next.js", "TypeScript", "Cloudflare D1"), "allchess", "allchess.learn-app.workers.dev"),
    Project("edsync", "EdSync", "Connect classroom work across roles",
            "Separate student, teacher and admin spaces for lessons, classes, assignments, gradebooks and progress.",
            "PREVIEW", BLUE, "EDTECH", ("Next.js", "TypeScript", "Cloudflare"), "edsync", "edsync-two.vercel.app"),
    Project("living-kingdom", "Living Kingdom", "Experimenting with a fantasy world",
            "An Unreal Engine prototype fitting combat, gathering, inventory, recruitment and travel between areas together.",
            "PROTOTYPE", LIME, "GAME", ("Unreal Engine 5", "C++", "Blueprints"), "living-kingdom", game=True),
    Project("sandline", "Sandline", "Iterating on shooter gameplay",
            "An offline Unreal Engine shooter with bot matches, round state and data-driven modes. Online multiplayer is unfinished.",
            "OFFLINE PROTOTYPE", ORANGE, "GAME", ("Unreal Engine 5", "C++", "Blueprints"), "sandline", game=True),
]

URCUT_LOGO = ('<rect width="64" height="64" rx="16" fill="url(#urcut-bg)"/>'
              '<path d="M25.5 18.6C23.3 17.3 21.5 18.4 21.5 20.9V43.1C21.5 45.6 23.3 46.7 25.5 45.4L44.8 34.3C47 33 47 31 44.8 29.7Z" '
              'fill="#fff" mask="url(#urcut-cut)"/>')
URCUT_DEFS = ('<linearGradient id="urcut-bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">'
              '<stop offset="0" stop-color="#7C3AED"/><stop offset="1" stop-color="#EC4899"/></linearGradient>'
              '<mask id="urcut-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64"><rect width="64" height="64" fill="#fff"/>'
              '<path d="M16 48L48 16" stroke="#000" stroke-width="5" stroke-linecap="round"/></mask>')


def fit_lines(value: str, size: float, max_width: float, max_lines: int, style: str = "body") -> tuple[float, list[str]]:
    """Wrap text, shrinking it a little if it would need more than max_lines."""
    while True:
        lines = wrap(value, size, max_width, style)
        if len(lines) <= max_lines or size <= 11:
            return size, lines[:max_lines]
        size -= .5


def urcut_illustration(rnd) -> str:
    """Stylised editor timeline (clearly an illustration, not a screenshot)."""
    out = ['<rect x="8" y="8" width="600" height="210" fill="url(#urcut-wash)"/>',
           '<rect x="8" y="8" width="600" height="210" fill="url(#grid)" opacity=".6"/>',
           f'<g transform="translate(40 60) scale(1.1)">{URCUT_LOGO}</g>',
           txt(40, 162, "UrCut", 21, INK, style="head"), txt(40, 184, "+ UrVoice", 14, "#FFB3D9", style="body-semi")]
    left, right = 156, 590
    out.append(f'<path d="{chamfer(left - 8, 40, right - left + 16, 164, 10)}" fill="#0B0620" opacity=".8" stroke="#4A2A8E"/>')
    for i in range(12):
        tx = left + i * 37
        out.append(f'<path d="M{tx} 46v{8 if i % 2 == 0 else 4}" stroke="#7B64C8"/>')
        if i % 2 == 0:
            out.append(txt(tx + 3, 56, f"00:{i * 2:02d}", 9.5, "#A596E0", style="hud-semi"))
    clips = [(left, 146, MAGENTA), (left + 150, 166, VIOLET), (left + 320, right - left - 320, CYAN)]
    for cx, cw, color in clips:
        out.append(f'<rect x="{cx}" y="66" width="{cw - 4}" height="38" rx="3" fill="{color}" fill-opacity=".28" stroke="{color}" stroke-opacity=".85"/>')
        for k in range(int(cw // 34)):
            out.append(f'<rect x="{cx + 5 + k * 34}" y="71" width="28" height="28" rx="2" fill="{color}" fill-opacity=".22"/>')
    bars = []
    for k in range(int((right - left) // 5)):
        h = abs(math.sin(k * .45) * 9 + rnd.uniform(-4, 6)) + 2
        bars.append(f'<rect x="{left + k * 5}" y="{num(126 - h / 2)}" width="3" height="{num(h)}" rx="1.5"/>')
    out.append(f'<g fill="{ACID}" opacity=".9">{"".join(bars)}</g>')
    out.append(txt(left, 148, "AI VOICE", 9.5, ACID, style="hud", tracking=.16))
    cx = left
    for word in ("Your cut.", "Visual,", "fast,", "private."):
        w = width(word, 12, "body-semi") + 18
        out.append(f'<path d="{chamfer(cx, 158, w, 24, 6)}" fill="{VOLT}" fill-opacity=".16" stroke="{VOLT}" stroke-opacity=".75"/>'
                   + txt(cx + 9, 174.5, word, 12, VOLT, style="body-semi"))
        cx += w + 10
    out.append(f'<g class="playhead"><path d="M{left + 60} 40V194" stroke="{MAGENTA}" stroke-width="2"/>'
               f'<path d="M{left + 53} 38h14l-7 8z" fill="{MAGENTA}"/></g>')
    out.append(txt(40, 30, "ILLUSTRATION · BUILT ON OPENCUT (MIT)", 10, "#D6CCF7", style="hud", tracking=.12))
    return "".join(out)


def hud_corners(color, box=(22, 22, 594, 204)) -> str:
    x1, y1, x2, y2 = box
    corners = [(x1, y1, 1, 1), (x2, y1, -1, 1), (x1, y2, 1, -1), (x2, y2, -1, -1)]
    return "".join(f'<path d="M{x} {y + 14 * sy}V{y}H{x + 14 * sx}" fill="none" stroke="{color}" stroke-width="2.4"/>'
                   for x, y, sx, sy in corners)


def chips(x, y, items, color, *, size=12.5, height=26, max_x=540) -> str:
    out = []
    for item in items:
        w = width(item, size, "hud-semi", .04) + 22
        if x + w > max_x:
            break
        out.append(f'<path d="{chamfer(x, y, w, height, 7)}" fill="{color}" fill-opacity=".1" stroke="{color}" stroke-opacity=".55"/>'
                   + txt(x + 11, y + height / 2 + cap("hud-semi") * size / 2, item, size, INK, style="hud-semi", tracking=.04))
        x += w + 8
    return "".join(out)


def arrow_button(x, y, color, size=34) -> str:
    c = size / 2
    return (f'<path d="{chamfer(x, y, size, size, 8)}" fill="{color}" fill-opacity=".14" stroke="{color}" stroke-opacity=".8"/>'
            f'<path d="M{num(x + c - 5)} {num(y + c + 5)}L{num(x + c + 5)} {num(y + c - 5)}M{num(x + c - 3)} {num(y + c - 5)}H{num(x + c + 5)}V{num(y + c + 3)}" '
            f'fill="none" stroke="{color}" stroke-width="2" stroke-linecap="square"/>')


def project_card(project: Project, index: int) -> str:
    W, H, CUT = 616, 420, 24
    rnd = random.Random(project.slug)
    color = project.color
    css = (PULSE_CSS + ".playhead{animation:play 7s linear infinite}@keyframes play{to{transform:translateX(360px)}}"
           + ".halo{animation:halo 5s ease-in-out infinite}@keyframes halo{50%{opacity:.2}}")
    outer = chamfer(8, 8, 600, 404, CUT)
    defs = "".join([
        textures(),
        f'<clipPath id="shot"><path d="M8 {8 + CUT}L{8 + CUT} 8H608V218H8Z"/></clipPath>',
        '<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140A33" stop-opacity="0"/>'
        '<stop offset="1" stop-color="#140A33"/></linearGradient>',
        '<linearGradient id="card" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#170C3C"/><stop offset="1" stop-color="#0B0522"/></linearGradient>',
        f'<linearGradient id="tint" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{color}" stop-opacity=".22"/>'
        f'<stop offset=".6" stop-color="{color}" stop-opacity="0"/></linearGradient>',
        f'<linearGradient id="accent" gradientUnits="userSpaceOnUse" x1="8" x2="608" y1="0" y2="0"><stop offset="0" stop-color="{color}"/>'
        f'<stop offset="1" stop-color="{color}" stop-opacity=".1"/></linearGradient>',
        '<radialGradient id="urcut-wash" cx=".2" cy=".3" r="1"><stop offset="0" stop-color="#40157A"/><stop offset="1" stop-color="#170828"/></radialGradient>',
        URCUT_DEFS, glow("soft", W, H, 7),
    ])
    b = [f'<path d="{outer}" fill="none" stroke="{color}" stroke-width="3" opacity=".5" filter="url(#soft)" class="halo"/>',
         f'<path d="{outer}" fill="url(#card)"/><path d="{outer}" fill="url(#grid)" opacity=".35"/>',
         '<g clip-path="url(#shot)">']
    if project.shot:
        b.append(f'<image x="8" y="8" width="600" height="210" preserveAspectRatio="xMidYMid slice" xlink:href="{embed(SHOTS / (project.shot + ".jpg"))}"/>')
    else:
        b.append(urcut_illustration(rnd))
    b.append('<rect x="8" y="8" width="600" height="210" fill="url(#tint)"/><rect x="8" y="8" width="600" height="210" fill="url(#scan)" opacity=".4"/>')
    b.append('<rect x="8" y="160" width="600" height="58" fill="url(#fade)"/>')
    status_y = 22
    if project.address:
        status_y = 13
        b.append(f'<rect x="8" y="8" width="600" height="32" fill="{VOID}" opacity=".9"/>')
        b.append(f'<rect x="44" y="20" width="8" height="8" fill="{color}" class="pulse"/>'
                 f'<path d="M61 22.5v-2.5a3.5 3.5 0 0 1 7 0v2.5M59.5 22.5h10v7h-10z" fill="none" stroke="{MUTED}" stroke-width="1.3"/>'
                 + txt(78, 29.5, project.address, 12, MUTED, style="hud-semi", tracking=.04))
    if project.game:
        b.append(hud_corners(color))
    b.append("</g>")
    b.append(tag(592, status_y, project.status, color, size=11.5, height=22, dot=True, anchor="end")[0])
    b.append(f'<path d="M8 218H608" stroke="url(#accent)" stroke-width="2.5"/>'
             + "".join(f'<rect x="{30 + i * 12}" y="214" width="8" height="8" fill="{color}" opacity="{1 - i * .3:.1f}"/>' for i in range(3)))

    b.append(txt(30, 250, f"{index:02d} // {project.kind}", 12, color, style="hud", tracking=.18))
    b.append(txt(30, 282, project.name, fit(project.name, 28, 556, "head"), INK, style="head"))
    b.append(txt(30, 308, project.tagline, 16, color, style="body-semi"))
    size, lines = fit_lines(project.blurb, 14.5, 556, 2)
    for i, line in enumerate(lines):
        b.append(txt(30, 333 + i * 20, line, size, MUTED))
    b.append(chips(30, 370, project.stack, color))
    b.append(arrow_button(560, 366, color))
    return document(W, H, "".join(b), css=css, defs=defs, title=f"{project.name}: {project.tagline}",
                    desc=f"{project.name} ({project.status.lower()}). {project.blurb} Stack: {', '.join(project.stack)}.")


# ---------------------------------------------------------------- side quests (smaller projects)


@dataclass
class SideQuest:
    slug: str
    name: str
    tagline: str
    blurb: str
    status: str
    color: str
    kind: str
    thumb: str | None
    art: str = "spark"  # drawn thumbnail (QUEST_ART) when there is no screenshot


SIDE_QUESTS = [
    SideQuest("omnidrama", "OmniDrama", "Your shows in one local library",
              "A Windows video library: searchable catalogue, episode player with saved progress, and a studio that converts uploads with FFmpeg.",
              "NEW · PRIVATE", BLUE, "MEDIA · LOCAL APP", None, "play"),
    SideQuest("khshop", "KhShop", "Shopping designed around Khmer",
              "Khmer-first marketplace pilot: local discovery, USD/KHR prices, offers and viewing appointments.",
              "PILOT · TEST DATA", MAGENTA, "SOFTWARE", "thumb-khshop"),
    SideQuest("jarvis", "Secretary Jarvis", "A desktop home for an AI assistant",
              "Electron interface with a Python backend: chat, voice, terminal and local-model helpers.",
              "PROTOTYPE", CYAN, "AI · DESKTOP", "thumb-jarvis"),
    SideQuest("ai-summary", "AI Summary", "Ask questions of your documents",
              "Rebuilt in 2026: summaries, cited answers and study cards for PDF, Word and slides, worked out in your browser.",
              "REBUILT · V2", ORANGE, "AI · LOCAL", None),
    SideQuest("wreckabulary", "Wreckabulary", "Wreck the room, build the word!",
              "A 2–4 player couch party game in Unity 6: smash furniture into letters, then spell new things.",
              "TEAM · COMP4122", VIOLET, "GAME · TEAM", "thumb-wreckabulary"),
    SideQuest("cargo-twin", "Cathay Cargo Twin", "Planning air cargo in 3D",
              "v2 of our AInnovator hackathon prototype: ULD build-up against real contours, a physics stress test and 777F weight and balance.",
              "V2 · TEAM ORIGIN", ACID, "SIMULATION · 3D", None, "cargo"),
]

# name -> ((gradient from, gradient to), white icon drawn inside the 156px tile at x/y 24..180)
QUEST_ART = {
    "spark": ((ORANGE, "#C21D6B"),
              '<path d="M102 60C106 88 112 94 140 102C112 110 106 116 102 144C98 116 92 110 64 102C92 94 98 88 102 60Z" fill="#fff"/>'),
    "play": (("#2F5BFF", "#8A3DFF"),
             '<rect x="54" y="60" width="96" height="66" rx="4" fill="none" stroke="#fff" stroke-width="5"/>'
             '<path d="M92 79V107L116 93Z" fill="#fff"/>'
             '<path d="M58 144H84M94 144H120M130 144H146" stroke="#fff" stroke-width="5" opacity=".85"/>'),
    "cargo": (("#12B886", "#0B4F6B"),
              '<path d="M56 64H148V142H80L56 118Z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>'
              '<g fill="#fff" fill-opacity=".92"><rect x="90" y="110" width="22" height="24"/>'
              '<rect x="117" y="110" width="23" height="24"/><rect x="100" y="80" width="28" height="25"/></g>'),
}


def side_quest(quest: SideQuest) -> str:
    W, H = 616, 204
    color = quest.color
    (art_from, art_to), art_icon = QUEST_ART[quest.art]
    thumb = chamfer(24, 24, 156, 156, 16)
    outer = chamfer(8, 8, 600, 188, 18)
    defs = (textures() + f'<clipPath id="thumb"><path d="{thumb}"/></clipPath>'
            '<linearGradient id="card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#170C3C"/><stop offset="1" stop-color="#0B0522"/></linearGradient>'
            f'<linearGradient id="art" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{art_from}"/><stop offset="1" stop-color="{art_to}"/></linearGradient>')
    b = [f'<path d="{outer}" fill="url(#card)"/><path d="{outer}" fill="url(#grid)" opacity=".3"/>',
         f'<path d="{outer}" fill="none" stroke="{color}" stroke-opacity=".55" stroke-width="1.5"/>',
         f'<path d="M9 {8 + 18 + 40}V{8 + 18}L{8 + 18} 9H{8 + 18 + 60}" fill="none" stroke="{color}" stroke-width="3"/>',
         '<g clip-path="url(#thumb)">']
    if quest.thumb:
        b.append(f'<image x="24" y="24" width="156" height="156" xlink:href="{embed(SHOTS / (quest.thumb + ".jpg"))}"/>')
    else:
        b.append(f'<rect x="24" y="24" width="156" height="156" fill="url(#art)"/>{art_icon}')
    b.append('<rect x="24" y="24" width="156" height="156" fill="url(#scan)" opacity=".5"/></g>')
    b.append(f'<path d="{thumb}" fill="none" stroke="{color}" stroke-opacity=".7"/>')
    b.append(txt(202, 56, quest.name, fit(quest.name, 22, 386, "head"), INK, style="head"))
    b.append(txt(202, 82, quest.tagline, 14.5, color, style="body-semi"))
    size, lines = fit_lines(quest.blurb, 13.5, 386, 3)
    for i, line in enumerate(lines):
        b.append(txt(202, 106 + i * 19, line, size, MUTED))
    status_y = 116 + len(lines) * 19
    status, status_w = tag(202, status_y, quest.status, color, size=10.5, height=22, mode="tint", dot=True)
    b.append(status + txt(214 + status_w, status_y + 15, quest.kind, 10.5, color, style="hud", tracking=.16))
    return document(W, H, "".join(b), css="", defs=defs, title=f"{quest.name}: {quest.tagline}",
                    desc=f"{quest.name} ({quest.status.lower()}). {quest.blurb}")


# ---------------------------------------------------------------- how I build


ICONS = {
    "compass": '<circle r="11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0-7L3.2 0L0 7L-3.2 0Z" fill="currentColor"/>',
    "spark": ('<path d="M0-11C1-4 3-1.5 11 0C3 1.5 1 4 0 11C-1 4-3 1.5-11 0C-3-1.5-1-4 0-11Z" fill="currentColor"/>'
              '<path d="M9-12C9.4-9.6 10-9 12.4-8.6C10-8.2 9.4-7.6 9-5.2C8.6-7.6 8-8.2 5.6-8.6C8-9 8.6-9.6 9-12Z" fill="currentColor"/>'),
    "shield": ('<path d="M0-11L8.5-7.2V-.5C8.5 5 4.8 8.8 0 11C-4.8 8.8-8.5 5-8.5-.5V-7.2Z" fill="none" stroke="currentColor" stroke-width="2" '
               'stroke-linejoin="round"/><path d="M-3.8 0L-1 3L4.2-2.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
    "book": ('<path d="M0-6C-3-8.5-7-8.5-10.5-7V7.5C-7 6-3 6 0 8.5C3 6 7 6 10.5 7.5V-7C7-8.5 3-8.5 0-6ZM0-6V8.5" fill="none" '
             'stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
}

LOOP = [
    ("01", "DIRECT", "Decide what to build: requirements, UX details and priorities.", VOLT, "compass"),
    ("02", "BUILD WITH AI", "Pair-program with Claude and Codex to implement and debug.", MAGENTA, "spark"),
    ("03", "REVIEW & TEST", "Check behaviour, run the tests and catch regressions early.", CYAN, "shield"),
    ("04", "UNDERSTAND", "Study the code and architecture until I can own it.", ACID, "book"),
]
LEVEL_UP = ("I build with AI, and the AI grows too: each loop's experience becomes reusable skills, "
            "and I keep perfecting the workflow as we go.")
XP_SEGMENTS = 13


def how_i_build() -> str:
    W, H = 1200, 424
    card_w, card_h, gap, top = 252, 190, 40, 36
    css = (".flow{animation:flow 1s linear infinite}@keyframes flow{to{stroke-dashoffset:-16}}"
           ".breathe{animation:breathe 8s ease-in-out infinite}@keyframes breathe{0%,100%{opacity:.15}12%{opacity:.85}30%{opacity:.15}}"
           # the XP bar sits full, then drains and refills one segment at a time (full again at t=0 and at rest)
           + "".join(f".xp{s}{{animation:xp{s} 8s linear infinite}}@keyframes xp{s}{{0%,50%{{opacity:1}}50.1%,"
                     f"{50 + (s + 1) * 3}%{{opacity:.22}}{50 + (s + 1) * 3 + .1:.1f}%,100%{{opacity:1}}}}" for s in range(XP_SEGMENTS)))
    defs = (textures() + glow("soft", W, H, 5)
            + f'<marker id="arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z" fill="{MUTED}"/></marker>')
    b = [panel(W, H, accent=MAGENTA, accent2=ACID)]
    for i, (number, title, blurb, color, icon) in enumerate(LOOP):
        x = 36 + i * (card_w + gap)
        d = chamfer(x, top, card_w, card_h, 16)
        b.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="3" filter="url(#soft)" class="breathe" style="animation-delay:{i * 2}s"/>')
        b.append(f'<path d="{d}" fill="{PANEL}" stroke="{color}" stroke-opacity=".6"/>')
        b.append(txt(x + card_w - 16, top + 62, number, 54, color, style="head", anchor="end", attrs='opacity=".16"'))
        b.append(f'<path d="{chamfer(x + 20, top + 20, 46, 46, 10)}" fill="{color}" fill-opacity=".14" stroke="{color}" stroke-opacity=".6"/>'
                 f'<g transform="translate({x + 43} {top + 43})" color="{color}" style="color:{color}">{ICONS[icon]}</g>')
        b.append(txt(x + card_w - 22, top + 36, number, 13, color, style="hud", anchor="end", tracking=.12))
        b.append(txt(x + 22, top + 102, title, fit(title, 18, card_w - 44, "head"), INK, style="head"))
        for k, line in enumerate(wrap(blurb, 14, card_w - 44)[:3]):
            b.append(txt(x + 22, top + 128 + k * 20, line, 14, MUTED))
        if i < len(LOOP) - 1:
            ax = x + card_w + 6
            b.append(f'<path d="M{ax} {top + card_h / 2}H{ax + gap - 14}" stroke="{MUTED}" stroke-width="2" stroke-dasharray="4 4" '
                     f'class="flow" marker-end="url(#arrow)"/>')
    first_c, last_c = 36 + card_w / 2, 36 + 3 * (card_w + gap) + card_w / 2
    low = top + card_h + 40
    loop = (f"M{last_c} {top + card_h + 4}V{low - 16}Q{last_c} {low} {last_c - 16} {low}H{first_c + 16}"
            f"Q{first_c} {low} {first_c} {low - 16}V{top + card_h + 10}")
    b.append(f'<path id="loop" d="{loop}" fill="none" stroke="{MUTED}" stroke-width="2" stroke-dasharray="4 4" class="flow" marker-end="url(#arrow)"/>')
    b.append(tag(W / 2, low - 13, "REPEAT FOR EVERY FEATURE AND EVERY FIX", CYAN, size=12.5, height=26, mode="dark", anchor="middle")[0])
    b.append(f'<g opacity="0"><rect x="-4" y="-4" width="8" height="8" fill="{MAGENTA}" filter="url(#soft)"/>'
             f'<animateMotion dur="5s" repeatCount="indefinite"><mpath xlink:href="#loop"/></animateMotion>'
             f'<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.9;1" dur="5s" repeatCount="indefinite"/></g>')

    # level-up band: the workflow and the AI improve every loop
    by, bh = low + 30, 84
    b.append(f'<path d="{chamfer(36, by, W - 72, bh, 14)}" fill="{PANEL_2}" stroke="{VOLT}" stroke-opacity=".55"/>')
    b.append(f'<rect x="36" y="{by + 14}" width="4" height="{bh - 28}" fill="{VOLT}"/>')
    b.append(tag(60, by + bh / 2 - 13, "LEVEL-UP LOOP", VOLT, size=13, height=26)[0])
    for k, line in enumerate(wrap(LEVEL_UP, 15, 600, "body-semi")[:2]):
        b.append(txt(248, by + 36 + k * 23, line, 15, INK if k == 0 else MUTED, style="body-semi"))
    bar_x, seg, seg_gap = 884, 16, 4
    b.append(txt(bar_x, by + 32, "EXPERIENCE → SKILLS", 11.5, DIM, style="hud", tracking=.16))
    for s in range(XP_SEGMENTS):
        color = (VOLT, MAGENTA, CYAN)[s * 3 // XP_SEGMENTS]
        b.append(f'<path d="{chamfer(bar_x + s * (seg + seg_gap), by + 44, seg, 18, 4, "tr bl")}" fill="{color}" class="xp{s}"/>')
    return document(W, H, "".join(b), css=css, defs=defs, title="How I build: a four-step loop",
                    desc="01 Direct: decide what to build. 02 Build with AI: pair-program with Claude and Codex. "
                         "03 Review and test: check behaviour and catch regressions. 04 Understand: study the code and "
                         "architecture until I can own it. Then repeat for every feature and every fix. Level-up loop: "
                         + LEVEL_UP)


# ---------------------------------------------------------------- what drives me


def storefront_icon(color):
    return (f'<g fill="none" stroke="{color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">'
            '<path d="M-26-10V24H26V-10"/><path d="M-30-24H30L34-10H-34Z"/>'
            '<path d="M-34-10Q-28.3-2-22.7-10Q-17-2-11.3-10Q-5.7-2 0-10Q5.7-2 11.3-10Q17-2 22.7-10Q28.3-2 34-10"/>'
            '<path d="M-8 24V6H8V24"/><rect x="14" y="4" width="8" height="8"/><rect x="-22" y="4" width="8" height="8"/></g>')


def book_icon(color):
    return (f'<g fill="none" stroke="{color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">'
            '<path d="M0-14C-8-20-20-20-30-16V20C-20 16-8 16 0 22C8 16 20 16 30 20V-16C20-20 8-20 0-14ZM0-14V22"/>'
            '<path d="M14-19V-4L18-7L22-4V-18"/><path d="M-22-6H-8M-22 2H-8M-22 10H-12"/></g>')


def gamepad_icon(color):
    return (f'<g fill="none" stroke="{color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">'
            '<path d="M-18-14H18C27-14 32-2 34 12C35 20 27 24 22 18L15 10H-15L-22 18C-27 24-35 20-34 12C-32-2-27-14-18-14Z"/>'
            '<path d="M-20-4V6M-25 1H-15"/><circle cx="16" cy="-3" r="2.4"/><circle cx="22" cy="3" r="2.4"/></g>')


def what_drives_me() -> str:
    W, H = 1200, 436
    css = (GLITCH_CSS
           + ".lamp{animation:lamp 9s ease-in-out infinite}@keyframes lamp{0%,100%{opacity:.12}15%{opacity:.8}33%{opacity:.12}}")
    defs = textures() + neon("nc", CYAN, 1.5, 7, .55) + glow("soft", W, H, 9)
    b = [panel(W, H, accent=ORANGE, accent2=MAGENTA)]
    b.append(f'<g filter="url(#nc)" opacity=".5"><use xlink:href="#motto" fill="{CYAN}"/></g>')
    b.append(glitch("motto", W / 2, 80, "Software lives in the details.", 32, INK, anchor="middle", shift=1.8))
    b.append(txt(W / 2, 114, "Small moments decide whether software is useful. These are the ones I build for:", 16.5, MUTED, anchor="middle"))
    moments = [
        (storefront_icon, VOLT, ("A shop moving stock", "between branches"), "BUSINESS OS"),
        (book_icon, CYAN, ("A student coming back", "to a study session"), "LEARN · EDSYNC"),
        (gamepad_icon, MAGENTA, ("A game answering", "a player's choice"), "UNREAL PROTOTYPES"),
    ]
    for i, (icon, color, lines, label) in enumerate(moments):
        x, y, w, h = 36 + i * 388, 144, 352, 204
        d = chamfer(x, y, w, h, 18)
        b.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="4" filter="url(#soft)" class="lamp" style="animation-delay:{i * 3}s"/>')
        b.append(f'<path d="{d}" fill="{PANEL}" stroke="{color}" stroke-opacity=".55"/>')
        b.append(f'<path d="M{x + 1} {y + 18 + 44}V{y + 18}L{x + 18} {y + 1}H{x + 18 + 70}" fill="none" stroke="{color}" stroke-width="3"/>')
        b.append(f'<g transform="translate({x + 64} {y + 66})">{icon(color)}</g>')
        b.append(tag(x + w - 22, y + 22, label, color, size=11, height=22, mode="tint", anchor="end")[0])
        for k, line in enumerate(lines):
            b.append(txt(x + 28, y + 146 + k * 30, line, fit(line, 19, w - 56, "head-semi"), INK, style="head-semi"))
    closing = "Useful software for everyday work, learning and play, including in Cambodia."
    b.append(txt(W / 2, 394, closing, 17, VOLT, style="body-semi", anchor="middle"))
    half = width(closing, 17, "body-semi") / 2
    b.append(diamond(W / 2 - half - 18, 388, 4.5, MAGENTA) + diamond(W / 2 + half + 18, 388, 4.5, CYAN))
    return document(W, H, "".join(b), css=css, defs=defs, title="What drives me: software lives in the details",
                    desc="Three small moments I build for: a shop moving stock between branches (Business OS), a student "
                         "coming back to a study session (LEARN and EdSync), and a game answering a player's choice "
                         "(Unreal prototypes). Useful software for everyday work, learning and play, including in Cambodia.")


# ---------------------------------------------------------------- toolbox


TOOLBOX = [
    ("LANGUAGES", CYAN, ("TypeScript", "JavaScript", "Python", "C++", "C", "Java", "SQL")),
    ("FRONTEND & APPS", MAGENTA, ("React", "Next.js", "Vite", "Electron", "Tiptap", "PWA")),
    ("CLOUD & DATA", VOLT, ("Cloudflare Workers", "D1", "R2", "Queues", "KV", "Hono", "Supabase", "SQLite")),
    ("AI", VIOLET, ("Claude", "Codex", "Ollama", "Local speech (STT/TTS)", "AI provider APIs")),
    ("GAMES", ACID, ("Unreal Engine 5", "Blueprints", "C++ gameplay")),
    ("ALSO USED", ORANGE, ("Docker", "PostgreSQL", "Redis / BullMQ", "DuckDB", "Vercel", "Git", "pnpm", "Bun")),
]


def toolbox() -> str:
    W, top, row_h, line_h, size = 1200, 30, 58, 46, 14.5
    left, right = 250, 1170
    rows, y = [], top
    for title, color, items in TOOLBOX:  # lay out first, wrapping long rows
        x, placed = left, []
        for item in items:
            w = width(item, size, "body-semi") + 40
            if x + w > right:
                x, y = left, y + line_h
            placed.append((x, y, w, item))
            x += w + 9
        rows.append((title, color, placed, placed[0][1]))
        y += row_h
    H = y - row_h + 40 + top
    # a one-off power-on flicker that starts and ends fully lit, so a paused frame is complete
    css = ".on{animation:on 1.4s ease-out}@keyframes on{0%,100%{opacity:1}12%{opacity:.2}26%{opacity:1}38%{opacity:.45}52%{opacity:1}}"
    defs = textures() + glow("soft", W, H, 3)
    b = [panel(W, H, accent=CYAN, accent2=VOLT)]
    order = 0
    for title, color, placed, row_y in rows:
        b.append(f'<path d="{chamfer(30, row_y, 200, 40, 10)}" fill="{color}"/>')
        b.append(f'<rect x="44" y="{row_y + 16}" width="8" height="8" fill="{VOID}"/>')
        b.append(txt(62, row_y + 20 + cap("hud") * 15 / 2, title, 15, VOID, style="hud", tracking=.1))
        for x, y, w, item in placed:
            b.append(f'<g class="on" style="animation-delay:{order * .07:.2f}s">'
                     f'<path d="{chamfer(x, y + 2, w, 36, 9)}" fill="{PANEL_2}" stroke="{color}" stroke-opacity=".45"/>'
                     f'<rect x="{num(x + 14)}" y="{y + 17}" width="6" height="6" fill="{color}"/>'
                     + txt(x + 28, y + 20 + cap("body-semi") * size / 2, item, size, INK, style="body-semi") + "</g>")
            order += 1
    return document(W, H, "".join(b), css=css, defs=defs, title="Toolbox",
                    desc="; ".join(f"{title.title()}: {', '.join(items)}" for title, _, items in TOOLBOX))


# ---------------------------------------------------------------- timeline


MILESTONES = [
    ("FEB 2023", "Monash University", "CS studies · Australia", BLUE),
    ("JUL 2023", "Joined GitHub", "hello, world", MUTED),
    ("2024", "PolyU · Hong Kong", "transferred into CS", CYAN),
    ("MAR 2025", "Operating Systems", "group project in C", VIOLET),
    ("NOV 2025", "AInnovator hackathon", "Cathay Cargo Twin (team)", MAGENTA),
    ("FEB 2026", "AI Summary", "document Q&A app", ORANGE),
    ("MAR 2026", "Business OS", "retail POS begins", VOLT),
    ("MAY 2026", "LEARN · AllChess", "EdSync · Jarvis", CYAN),
    ("SEP 2026", "CodeAge · UrCut", "Unreal prototypes", MAGENTA),
    ("JUL 2027", "Graduation", "expected", ACID),
]


def timeline() -> str:
    W, H, axis = 1200, 336, 170
    now_index = 8
    xs = [100 + i * (1000 / (len(MILESTONES) - 1)) for i in range(len(MILESTONES))]
    css = (".ring{animation:ring 2.2s ease-out infinite;transform-box:fill-box;transform-origin:center}"
           "@keyframes ring{from{transform:scale(.5) rotate(45deg);opacity:1}to{transform:scale(2.6) rotate(45deg);opacity:0}}"
           ".pop{animation:pop .7s ease-out}@keyframes pop{0%,100%{opacity:1}25%{opacity:.25}50%{opacity:1}65%{opacity:.6}}")
    defs = (textures() + glow("soft", W, H, 4)
            + f'<linearGradient id="past" gradientUnits="userSpaceOnUse" x1="{xs[0]}" x2="{num(xs[now_index])}" y1="0" y2="0">'
            f'<stop offset="0" stop-color="{BLUE}"/><stop offset=".45" stop-color="{CYAN}"/><stop offset=".75" stop-color="{VOLT}"/>'
            f'<stop offset="1" stop-color="{MAGENTA}"/></linearGradient>')
    b = [panel(W, H, accent=BLUE, accent2=MAGENTA)]
    b.append(f'<path d="M{xs[0]} {axis}H{num(xs[now_index])}" stroke="url(#past)" stroke-width="3.5" filter="url(#soft)"/>')
    b.append(f'<path d="M{num(xs[now_index])} {axis}H{xs[-1]}" stroke="{DIM}" stroke-width="2.4" stroke-dasharray="5 7"/>')
    for i, ((date, title, sub, color), x) in enumerate(zip(MILESTONES, xs)):
        above = i % 2 == 0
        future = i > now_index
        stem = f"M{num(x)} {axis - 12}V{axis - 32}" if above else f"M{num(x)} {axis + 12}V{axis + 32}"
        b.append(f'<g class="pop" style="animation-delay:{i * .08:.2f}s"><path d="{stem}" stroke="{color}" stroke-opacity=".7"/>')
        b.append(f'<path d="M{num(x)} {axis - 10}L{num(x + 10)} {axis}L{num(x)} {axis + 10}L{num(x - 10)} {axis}Z" fill="{VOID}" '
                 f'stroke="{color}" stroke-width="2.5"' + (' stroke-dasharray="3 3"' if future else "") + "/>")
        b.append(diamond(x, axis, 4, color))
        base = axis - 98 if above else axis + 54
        b.append(txt(x, base, date, 12.5, color, style="hud", anchor="middle", tracking=.14))
        b.append(txt(x, base + 22, title, fit(title, 15, 200, "body-bold"), INK, style="body-bold", anchor="middle"))
        b.append(txt(x, base + 41, sub, 12.5, MUTED, anchor="middle") + "</g>")
    nx = xs[now_index]
    b.append(f'<rect x="{num(nx - 7)}" y="{axis - 7}" width="14" height="14" fill="none" stroke="{MAGENTA}" stroke-width="2" class="ring"/>')
    b.append(tag(nx, axis + 20, "YOU ARE HERE", MAGENTA, size=11, height=22, anchor="middle")[0])
    b.append(f'<g opacity="0"><rect x="-4" y="{axis - 4}" width="8" height="8" fill="#fff" filter="url(#soft)">'
             f'<animate attributeName="x" values="{xs[0] - 4};{num(nx - 4)}" dur="6s" repeatCount="indefinite"/></rect>'
             f'<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.08;.9;1" dur="6s" repeatCount="indefinite"/></g>')
    return document(W, H, "".join(b), css=css, defs=defs, title="The road so far",
                    desc="; ".join(f"{d}: {t} ({s})" for d, t, s, _ in MILESTONES))


# ---------------------------------------------------------------- section banners


SECTIONS = [
    ("about", "ABOUT ME", MAGENTA), ("now", "NOW BUILDING", ACID), ("projects", "FEATURED PROJECTS", VOLT),
    ("quests", "SIDE QUESTS", VIOLET), ("build", "HOW I BUILD", CYAN), ("drives", "WHAT DRIVES ME", ORANGE),
    ("toolbox", "TOOLBOX", BLUE), ("road", "THE ROAD SO FAR", MAGENTA), ("activity", "ACTIVITY", ACID),
    ("off", "OFF THE KEYBOARD", VOLT),
]


def section_banner(index: int, title: str, color: str) -> str:
    W, H = 1200, 64
    defs = textures() + f'<clipPath id="frame"><path d="{chamfer(0, 0, W, H, 14)}"/></clipPath>'
    number = f"{index:02d}"
    title_x, size = 122, 26
    end = title_x + width(title, size, "head", .04)
    rule_from, rule_to = end + 28, W - 110
    css = GLITCH_CSS + f".run{{animation:run 5s linear infinite}}@keyframes run{{to{{transform:translateX({num(rule_to - rule_from - 10)}px)}}}}"
    b = [f'<g clip-path="url(#frame)"><rect width="{W}" height="{H}" fill="{VOID}"/>'
         f'<rect width="{W}" height="{H}" fill="url(#grid)" opacity=".6"/><rect width="{W}" height="{H}" fill="url(#scan)"/>',
         f'<path d="M0 0H100L84 {H}H0Z" fill="{color}"/>',
         txt(46, 32 + cap("head") * 26 / 2, number, 26, VOID, style="head", anchor="middle"),
         glitch(f"t{number}", title_x, 32 + cap("head") * size / 2, title, size, INK, tracking=.04, shift=1.6,
                delay=index * .7)]
    if rule_to - rule_from > 40:
        b.append(f'<path d="M{num(rule_from)} 32H{rule_to}" stroke="{color}" stroke-opacity=".55" stroke-width="1.5"/>')
        b.append("".join(f'<path d="M{num(tx)} 28v8" stroke="{color}" stroke-opacity=".5"/>'
                         for tx in range(int(rule_from) + 20, rule_to, 40)))
        b.append(f'<g class="run"><rect x="{num(rule_from)}" y="29" width="10" height="6" fill="{color}"/></g>')
    b.append(f'<rect x="{W - 96}" y="22" width="26" height="20" fill="url(#hazard)"/>')
    b.append(txt(W - 22, 32 + cap("hud") * 12 / 2, f"SEC.{number}", 12, color, style="hud", anchor="end", tracking=.14))
    b.append("</g>" + f'<path d="{chamfer(.75, .75, W - 1.5, H - 1.5, 14)}" fill="none" stroke="{EDGE}" stroke-width="1.5"/>')
    return document(W, H, "".join(b), css=css, defs=defs, title=f"{index:02d} · {title.title()}", desc=f"Section {index}: {title.title()}")


# ---------------------------------------------------------------- buttons and footer


def globe_icon(color):
    return (f'<g fill="none" stroke="{color}" stroke-width="2"><circle r="10"/><ellipse rx="4.4" ry="10"/>'
            '<path d="M-10 0H10M-8.6-5H8.6M-8.6 5H8.6"/></g>')


def linkedin_icon(color, background):
    return (f'<rect x="-10" y="-10" width="20" height="20" rx="2" fill="{color}"/>'
            + txt(0, 5, "in", 14, background, style="hud", anchor="middle"))


def mail_icon(color):
    return (f'<g fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round"><rect x="-11" y="-8" width="22" height="16"/>'
            '<path d="M-10-6.5L0 1.5L10-6.5"/></g>')


BUTTONS = [("portfolio", "PORTFOLIO", VOLT, MAGENTA), ("linkedin", "LINKEDIN", CYAN, VIOLET), ("email", "EMAIL", MAGENTA, CYAN)]


def button(slug, label, color, shadow) -> str:
    W, H = 260, 64
    icon = {"portfolio": globe_icon(VOID), "linkedin": linkedin_icon(VOID, color), "email": mail_icon(VOID)}[slug]
    b = [f'<path d="{chamfer(10, 10, 244, 48, 13)}" fill="none" stroke="{shadow}" stroke-width="2"/>',
         f'<path d="{chamfer(4, 4, 244, 48, 13)}" fill="{color}"/>',
         f'<g transform="translate(34 28)">{icon}</g>',
         f'<path d="M56 16V40" stroke="{VOID}" stroke-opacity=".35"/>',
         txt(70, 28 + cap("hud") * 18 / 2, label, 18, VOID, style="hud", tracking=.16),
         f'<path d="M214 34L224 24M217 24H224V31" fill="none" stroke="{VOID}" stroke-width="2.2" stroke-linecap="square"/>']
    return document(W, H, "".join(b), title=label.title(), desc=f"{label.title()} link")


def footer() -> str:
    W, H, CUT = 1200, 300, 24
    rnd = random.Random(21)
    scene = scenery()
    scale = .45
    offset_x, base = (W - 1200 * scale) / 2, 272
    css = (SCENERY_CSS + RAIN_CSS
           + ".flick{animation:flick 7s linear infinite}@keyframes flick{0%,40%,42%,44%,80%,82%,100%{opacity:1}41%,43%,81%{opacity:.3}}"
           + ".tw{animation:tw 4s ease-in-out infinite}@keyframes tw{50%{opacity:.2}}")
    defs = (neon("np", MAGENTA, 2.2, 9, .9) + glow("soft", W, H, 2.4) + textures()
            + '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#04010C"/><stop offset=".6" stop-color="#150636"/>'
              '<stop offset=".9" stop-color="#4A0C50"/></linearGradient>'
            + f'<clipPath id="frame"><path d="{chamfer(0, 0, W, H, CUT)}"/></clipPath>')
    b = [f'<g clip-path="url(#frame)"><rect width="{W}" height="{H}" fill="url(#sky)"/>']
    for _ in range(60):
        b.append(f'<circle cx="{num(rnd.uniform(0, W))}" cy="{num(rnd.uniform(0, 250))}" r="{rnd.choice((.6, .9, 1.2))}" fill="#fff" '
                 f'class="tw" style="animation-delay:-{rnd.uniform(0, 4):.1f}s"/>')
    sign = "LET'S BUILD SOMETHING USEFUL"
    size = fit(sign, 32, 780, "head", .03)
    sign_w = width(sign, size, "head", .03)
    left = W / 2 - sign_w / 2 - 30
    b.append(f'<path d="M{num(left + 60)} 0V26M{num(W - left - 60)} 0V26" stroke="#3A2A70" stroke-width="1.5"/>')
    b.append(f'<path d="{chamfer(left, 26, sign_w + 60, 66, 14)}" fill="#0B0620" stroke="{MAGENTA}" '
             f'stroke-opacity=".85" stroke-width="1.8" filter="url(#np)"/>')
    lettering = txt(W / 2, 59 + cap("head") * size / 2, sign, size, "#FFE9F4", style="head", anchor="middle", tracking=.03,
                    attrs='filter="url(#np)"')
    b.append(f'<g class="flick">{lettering}</g>')
    b.append(txt(W / 2, 126, "Open to internships in software development, AI applications and game development", 16, MUTED, anchor="middle"))
    thanks = [("អរគុណ", "khmer", 20, VOLT), ("多謝", "han", 19, MAGENTA), ("THANKS FOR VISITING", "hud", 18, CYAN)]
    gap = 34
    total = sum(width(t, s, st, .08 if st == "hud" else 0) for t, st, s, _ in thanks) + gap * 2
    x = W / 2 - total / 2
    for i, (value, style, size, color) in enumerate(thanks):
        track = .08 if style == "hud" else 0
        b.append(txt(x, 164, value, size, color, style=style, tracking=track))
        x += width(value, size, style, track) + gap
        if i < 2:
            b.append(diamond(x - gap / 2, 157, 4, INK))
    b.append(f'<g transform="translate({num(offset_x)} {num(base - GROUND * scale)}) scale({scale})">'
             f'{scene["back"]}{scene["front"]}{scene["lights"]}</g>')
    b.append(f'<rect y="{base}" width="{W}" height="{H - base}" fill="#050010"/>')
    b.append(f'<g transform="translate({num(offset_x)} {num(base - GROUND * scale)}) scale({scale})" opacity=".8">{scene["reflections"]}</g>')
    b.append(f'<path d="M0 {base + .5}H{W}" stroke="{MAGENTA}" stroke-opacity=".4"/>')
    b.append(rain(rnd, W, H, 60))
    b.append("</g>" + frame(W, H, cut=CUT, accent=VOLT, accent2=MAGENTA))
    return document(W, H, "".join(b), css=css, defs=defs, title="Let's build something useful",
                    desc="Neon sign: Let's build something useful. Open to internships in software development, AI "
                         "applications and game development. Thank you in Khmer, Cantonese and English, above a small "
                         "Angkor Wat and Hong Kong skyline in the rain.")


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    save("hero.svg", hero())
    save("about-boarding-pass.svg", boarding_pass())
    save("now-departures.svg", departures())
    for index, project in enumerate(PROJECTS, 1):
        save(f"project-{project.slug}.svg", project_card(project, index))
    for quest in SIDE_QUESTS:
        save(f"quest-{quest.slug}.svg", side_quest(quest))
    save("how-i-build.svg", how_i_build())
    save("what-drives-me.svg", what_drives_me())
    save("toolbox.svg", toolbox())
    save("timeline.svg", timeline())
    for index, (slug, title, color) in enumerate(SECTIONS, 1):
        save(f"section-{slug}.svg", section_banner(index, title, color))
    for slug, label, color, shadow in BUTTONS:
        save(f"button-{slug}.svg", button(slug, label, color, shadow))
    save("footer.svg", footer())


if __name__ == "__main__":
    main()
