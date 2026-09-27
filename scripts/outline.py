"""Turn text into SVG outlines, so the artwork looks the same on every device.

Shared by build_assets.py and stats.py. Text is shaped with HarfBuzz (needed for Khmer), and every
glyph is defined once per SVG document in a 1000-unit em, then placed with <use>. That keeps
text-heavy images small. Call glyph_defs() when the document is assembled, after all text().
"""
from __future__ import annotations

import os
from functools import cache
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

BUNDLED = Path(__file__).resolve().parent / "fonts"  # OFL fonts, committed with their licences
SYSTEM = Path(os.environ.get("PROFILE_FONTS_DIR", "C:/Windows/Fonts"))  # Khmer and Chinese: local builds only
EM = 1000

# style: (font file, variation settings, fallback style for characters the font lacks)
STYLES = {
    "head": (BUNDLED / "Unbounded-VF.ttf", {"wght": 800}, "hud"),  # headlines
    "head-semi": (BUNDLED / "Unbounded-VF.ttf", {"wght": 600}, "hud"),
    "hud": (BUNDLED / "ChakraPetch-Bold.ttf", None, None),  # labels, tags, codes
    "hud-semi": (BUNDLED / "ChakraPetch-SemiBold.ttf", None, None),
    "body": (BUNDLED / "Sora-VF.ttf", {"wght": 500}, "hud-semi"),  # running text
    "body-semi": (BUNDLED / "Sora-VF.ttf", {"wght": 600}, "hud-semi"),
    "body-bold": (BUNDLED / "Sora-VF.ttf", {"wght": 700}, "hud"),
    "khmer": (SYSTEM / "KhmerUIb.ttf", None, None),
    "han": (SYSTEM / "msyhbd.ttc", None, None),
}


def num(value: float) -> str:
    text = f"{value:.1f}"
    return text[:-2] if text.endswith(".0") else text


class Face:
    def __init__(self, style: str):
        path, variations, self.fallback = STYLES[style]
        self.key = "g" + "abcdefghijklmnopqrstuvwxyz"[list(STYLES).index(style)]
        face = hb.Face(hb.Blob.from_file_path(str(path)), 0)
        self.font = hb.Font(face)
        if variations:
            self.font.set_variations(variations)
        self.upem = face.upem
        ttfont = TTFont(str(path), fontNumber=0)
        self.glyphs = ttfont.getGlyphSet(location=variations) if variations else ttfont.getGlyphSet()
        self.order = ttfont.getGlyphOrder()
        self.cmap = ttfont.getBestCmap()
        self.cap = ttfont["OS/2"].sCapHeight / self.upem


@cache
def face(style: str) -> Face:
    return Face(style)


def runs(text: str, style: str) -> list[tuple[str, str]]:
    """Split text into (style, run) pieces, using the fallback chain for missing characters."""
    out: list[tuple[str, str]] = []
    for char in text:
        pick = style
        while ord(char) not in face(pick).cmap:
            pick = face(pick).fallback
            if pick is None:
                raise ValueError(f"no font for {char!r} in {text!r} ({style})")
        if out and out[-1][0] == pick:
            out[-1] = (pick, out[-1][1] + char)
        else:
            out.append((pick, char))
    return out


@cache
def layout(text: str, style: str, tracking: float = 0.0) -> tuple[tuple, float]:
    """((face, glyph id, x, y) in em units, advance width in em units)."""
    placed, cursor, tracked = [], 0.0, False
    for run_style, run in runs(text, style):
        font = face(run_style)
        buffer = hb.Buffer()
        buffer.add_str(run)
        buffer.guess_segment_properties()
        hb.shape(font.font, buffer, {})
        k = EM / font.upem
        for info, pos in zip(buffer.glyph_infos, buffer.glyph_positions):
            placed.append((font, info.codepoint, cursor + pos.x_offset * k, pos.y_offset * k))
            cursor += pos.x_advance * k
            if pos.x_advance and tracking:
                cursor += tracking * EM
                tracked = True
    return tuple(placed), cursor - (tracking * EM if tracked else 0)


_paths: dict[str, str] = {}
_used: dict[str, None] = {}  # glyphs placed in the document being built (an ordered set)


def _glyph(font: Face, gid: int) -> str | None:
    ref = f"{font.key}{gid}"
    if ref not in _paths:
        pen = SVGPathPen(font.glyphs, ntos=lambda v: str(round(v)))
        k = EM / font.upem
        font.glyphs[font.order[gid]].draw(TransformPen(pen, (k, 0, 0, -k, 0, 0)))
        _paths[ref] = pen.getCommands()
    return ref if _paths[ref] else None


def width(text: str, size: float, style: str = "body", tracking: float = 0.0) -> float:
    return layout(text, style, tracking)[1] * size / EM


def cap(style: str) -> float:
    """Cap height as a fraction of the font size (for centring text vertically)."""
    return face(style).cap


def fit(text: str, size: float, max_width: float, style: str = "body", tracking: float = 0.0) -> float:
    """The largest size up to `size` at which the text fits in max_width."""
    return min(size, size * max_width / max(width(text, size, style, tracking), 1e-6))


def wrap(text: str, size: float, max_width: float, style: str = "body") -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if line and width(trial, size, style) > max_width:
            lines.append(line)
            line = word
        else:
            line = trial
    return lines + [line] if line else lines


def text(value: str, size: float, x: float, y: float, *, style: str = "body", fill: str | None = None,
         anchor: str = "start", tracking: float = 0.0, attrs: str = "") -> str:
    """A group of glyph <use>s with its baseline at y. Put transform animations on a wrapper."""
    placed, advance = layout(value, style, tracking)
    scale = size / EM
    x0 = x - {"start": 0, "middle": 0.5, "end": 1}[anchor] * advance * scale
    uses = []
    for font, gid, gx, gy in placed:
        ref = _glyph(font, gid)
        if ref:
            _used[ref] = None
            pos = (f' x="{round(gx)}"' if round(gx) else "") + (f' y="{-round(gy)}"' if round(gy) else "")
            uses.append(f'<use xlink:href="#{ref}"{pos}/>')
    paint = f' fill="{fill}"' if fill else ""
    extra = f" {attrs}" if attrs else ""
    return f'<g transform="translate({num(x0)} {num(y)}) scale({scale:.5g})"{paint}{extra}>{"".join(uses)}</g>'


def glyph_defs() -> str:
    """Definitions for every glyph used since the last call; resets for the next document."""
    out = "".join(f'<path id="{ref}" d="{_paths[ref]}"/>' for ref in _used)
    _used.clear()
    return out
