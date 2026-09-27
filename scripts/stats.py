#!/usr/bin/env python3
"""Draw the live activity graphics (dist/stats.svg, dist/skyline.svg) from public GitHub data.

    GITHUB_TOKEN=... python scripts/stats.py [output-dir] [login]

Needs fonttools and uharfbuzz (text is outlined with the bundled fonts, see outline.py). Languages
come from public, non-fork repositories and are weighted by the square root of each repository's
code size, so one very large repository cannot drown out the rest. The skyline draws one tower per
week of the contribution calendar, on a linear scale.
"""
from __future__ import annotations

import json
import math
import os
import random
import sys
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

from outline import cap, glyph_defs, num, text, width

QUERY = """
query($login: String!) {
  user(login: $login) {
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 100) {
      totalCount
      nodes { languages(first: 12, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name } } } }
    }
    contributionsCollection {
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
}
"""

# same palette as build_assets.py
VOID, PANEL, EDGE, LINE = "#08031A", "#130A30", "#3B2A7C", "#241659"
INK, MUTED, DIM = "#F6F3FF", "#C4BAEC", "#9187CC"
VOLT, MAGENTA, CYAN, VIOLET, ACID, ORANGE, BLUE, LIME = (
    "#FCEE0A", "#FF2E88", "#19E6FF", "#A974FF", "#3CFFA4", "#FF8A1F", "#4F8DFF", "#C4FF3D")
LANGUAGE_COLORS = {"TypeScript": CYAN, "JavaScript": VOLT, "Python": BLUE, "C++": VIOLET, "C": ORANGE, "Java": MAGENTA,
                   "C#": ACID, "SQL": LIME}
IGNORED = {"HTML", "CSS", "SCSS", "Batchfile", "PowerShell", "Shell", "Makefile", "Dockerfile", "TeX",
           "BibTeX Style", "Go Template", "Procfile", "Jupyter Notebook"}
RENAMED = {"PLpgSQL": "SQL", "TSQL": "SQL"}
MONTHS = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split()


def fetch(login: str) -> dict:
    request = urllib.request.Request(
        "https://api.github.com/graphql",
        data=json.dumps({"query": QUERY, "variables": {"login": login}}).encode(),
        headers={"Authorization": f"bearer {os.environ['GITHUB_TOKEN']}", "Content-Type": "application/json",
                 "User-Agent": f"{login}-profile-stats"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if payload.get("errors"):
        raise RuntimeError(payload["errors"])
    return payload["data"]["user"]


def streaks(days: list[tuple[date, int]]) -> tuple[int, int]:
    """(current, longest) runs of days with at least one contribution."""
    longest = run = 0
    for _, count in days:
        run = run + 1 if count else 0
        longest = max(longest, run)
    current = 0
    tail = days[:-1] if days and days[-1][1] == 0 else days  # today may simply not have started yet
    for _, count in reversed(tail):
        if not count:
            break
        current += 1
    return current, longest


def languages(user: dict, top: int = 6) -> list[tuple[str, float]]:
    scores: dict[str, float] = defaultdict(float)
    for repo in user["repositories"]["nodes"]:
        for edge in repo["languages"]["edges"]:
            name = RENAMED.get(edge["node"]["name"], edge["node"]["name"])
            if name not in IGNORED:
                scores[name] += math.sqrt(edge["size"])
    total = sum(scores.values()) or 1
    ranked = sorted(scores.items(), key=lambda item: -item[1])
    shares = [(name, score / total) for name, score in ranked[:top]]
    rest = 1 - sum(share for _, share in shares)
    return shares + ([("Other", rest)] if rest > 0.005 else [])


def chamfer(x, y, w, h, cut=14) -> str:
    """Rectangle with the top-left and bottom-right corners cut."""
    return (f"M{num(x + cut)} {num(y)}H{num(x + w)}V{num(y + h - cut)}L{num(x + w - cut)} {num(y + h)}"
            f"H{num(x)}V{num(y + cut)}Z")


def panel(w, h, accent, accent2) -> str:
    d = chamfer(.75, .75, w - 1.5, h - 1.5, 22)
    return (f'<path d="{d}" fill="{VOID}"/><path d="{d}" fill="url(#grid)" opacity=".7"/><path d="{d}" fill="url(#scan)"/>'
            f'<path d="{d}" fill="none" stroke="{EDGE}" stroke-width="1.5"/>'
            f'<path d="M2 112V23.2L23.2 2H112" fill="none" stroke="{accent}" stroke-width="3"/>'
            f'<path d="M{w - 2} {h - 112}V{h - 23.2}L{w - 23.2} {h - 2}H{w - 112}" fill="none" stroke="{accent2}" stroke-width="3"/>')


TEXTURES = (f'<pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">'
            f'<path d="M32 .5H.5V32" fill="none" stroke="{LINE}"/><rect x="-1" y="-1" width="3" height="3" fill="{EDGE}"/></pattern>'
            '<pattern id="scan" width="8" height="4" patternUnits="userSpaceOnUse"><rect width="8" height="1.3" fill="#000" opacity=".28"/></pattern>')
# a soft band of light for the passing sweeps (language bar, skyline scanner)
SHEEN = ('<linearGradient id="sheen" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/>'
         '<stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>')


def label(x, y, value, size, fill, style="hud", anchor="start", tracking=0.0, attrs="") -> str:
    return text(str(value), size, x, y, style=style, fill=fill, anchor=anchor, tracking=tracking, attrs=attrs)


def document(w, h, body, *, title, desc, css, defs) -> str:
    css += "@media (prefers-reduced-motion:reduce){*{animation:none!important}}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}" height="{h}" '
            f'viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">{escape(title)}</title>'
            f'<desc id="desc">{escape(desc)}</desc><style><![CDATA[{css}]]></style><defs>{defs}{glyph_defs()}</defs>{body}</svg>\n')


def weeks_of(user: dict) -> list[list[tuple[date, int]]]:
    """The calendar ends on the user's local 'today', which can be a day ahead of UTC."""
    calendar = user["contributionsCollection"]["contributionCalendar"]
    return [[(date.fromisoformat(d["date"]), d["contributionCount"]) for d in w["contributionDays"]] for w in calendar["weeks"]]


def render_stats(user: dict, today: date) -> str:
    calendar = user["contributionsCollection"]["contributionCalendar"]
    days = [day for week in weeks_of(user) for day in week]
    current, longest = streaks(days)
    active = sum(1 for _, c in days if c)
    best = max((c for _, c in days), default=0)
    W, H = 1200, 290

    out = [panel(W, H, ACID, CYAN)]
    out.append(label(40, 56, "CONTRIBUTIONS · LAST 12 MONTHS", 12.5, DIM, tracking=.2))
    out.append(label(38, 130, f"{calendar['totalContributions']:,}", 62, VOLT, style="head", attrs='filter="url(#glow)"'))
    tiles = (("ACTIVE DAYS", f"{active}", INK), ("CURRENT STREAK", f"{current} d", CYAN),
             ("LONGEST STREAK", f"{longest} d", INK), ("BEST DAY", f"{best}", MAGENTA))
    for i, (name, value, color) in enumerate(tiles):
        x = 40 + i * 138
        out.append(f'<path d="{chamfer(x, 154, 128, 66, 10)}" fill="{PANEL}" stroke="{EDGE}"/>'
                   f'<rect x="{x}" y="164" width="3" height="46" fill="{color}"/>')
        out.append(label(x + 14, 176, name, 10.5, DIM, tracking=.14))
        out.append(label(x + 14, 206, value, 21, color, style="head"))
    out.append(label(40, 258, f"{user['repositories']['totalCount']} PUBLIC REPOS · UPDATED {today.isoformat()} (UTC)", 11.5, DIM,
                     tracking=.14))

    out.append(f'<path d="M616 36V254" stroke="{EDGE}"/>')
    out.append(label(656, 56, "TOP LANGUAGES · PUBLIC REPOS", 12.5, DIM, tracking=.2))
    shares = languages(user)
    x, bar_w = 656.0, 504.0
    out.append(f'<clipPath id="bar"><path d="{chamfer(656, 74, bar_w, 18, 6)}"/></clipPath><g clip-path="url(#bar)">')
    for name, share in shares:
        out.append(f'<rect x="{x:.1f}" y="74" width="{share * bar_w + .5:.1f}" height="18" fill="{LANGUAGE_COLORS.get(name, DIM)}"/>')
        x += share * bar_w
    out.append(f'<rect x="{656 - 90}" y="74" width="90" height="18" fill="url(#sheen)" class="sheen"/></g>')  # rests outside the clip
    for i, (name, share) in enumerate(shares):
        col, row = divmod(i, 4)
        lx, ly = 656 + col * 262, 130 + row * 38
        out.append(f'<rect x="{lx}" y="{ly - 11}" width="11" height="11" fill="{LANGUAGE_COLORS.get(name, DIM)}"/>')
        out.append(label(lx + 22, ly, name, 16, INK, style="body-semi"))
        out.append(label(lx + 236, ly, f"{share * 100:.1f}%", 15, MUTED, anchor="end"))

    css = f".sheen{{animation:sheen 6s ease-in-out infinite}}@keyframes sheen{{60%,to{{transform:translateX({bar_w + 90:.0f}px)}}}}"
    defs = (TEXTURES + f'<filter id="glow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="4" result="b"/>'
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' + SHEEN)
    summary = (f"{calendar['totalContributions']:,} contributions in the last 12 months; {active} active days; current streak "
               f"{current} days; longest streak {longest} days; best day {best}. Top languages in public repositories: "
               + ", ".join(f"{name} {share * 100:.0f}%" for name, share in shares) + ".")
    return document(W, H, "".join(out), title="GitHub activity", desc=summary, css=css, defs=defs)


def render_skyline(user: dict, today: date) -> str:
    """Contribution city: one tower per calendar week, height on a linear scale."""
    weeks = [(days[0][0], sum(c for _, c in days)) for days in weeks_of(user) if days]
    W, H = 1200, 370
    left, right, ground, tall = 70, 1160, 296, 160
    slot = (right - left) / len(weeks)
    bw = max(4.0, slot - 4)
    peak_i = max(range(len(weeks)), key=lambda i: weeks[i][1])
    peak = weeks[peak_i][1] or 1
    rnd = random.Random(len(weeks))

    out = [panel(W, H, MAGENTA, VOLT)]
    out.append(label(40, 50, "CONTRIBUTION CITY", 21, INK, style="head", tracking=.02))
    out.append(label(40, 74, "One tower per week over the last 12 months. Taller tower, more contributions.", 14, MUTED, style="body"))
    for value in (peak, peak / 2):
        y = ground - tall * value / peak
        out.append(f'<path d="M{left - 6} {num(y)}H{right}" stroke="{EDGE}" stroke-dasharray="3 5"/>')
        out.append(label(left - 12, y + 4, f"{round(value):,}", 11, DIM, anchor="end"))
    out.append(label(left - 12, ground + 4, "0", 11, DIM, anchor="end"))

    towers, lights, shapes = [], [], []
    for i, (start, count) in enumerate(weeks):
        x = left + i * slot + (slot - bw) / 2
        if not count:
            towers.append(f'<rect x="{num(x)}" y="{ground - 2}" width="{num(bw)}" height="2" fill="{EDGE}"/>')
            continue
        h = max(3.0, tall * count / peak)
        top = ground - h
        shape = f'x="{num(x)}" y="{num(top)}" width="{num(bw)}" height="{num(h)}"'
        shapes.append(f"<rect {shape}/>")
        towers.append(f'<rect {shape} fill="url(#tower)"/><rect x="{num(x)}" y="{num(top)}" width="{num(bw)}" height="2" fill="#fff" opacity=".7"/>')
        for wy in range(int(top) + 6, ground - 4, 7):  # windows; a few lit ones twinkle
            for wx in (x + bw * .25 - 1, x + bw * .75 - 1):
                lit = rnd.random() < .18
                twinkle = f' class="tw" style="animation-delay:{rnd.uniform(.5, 4):.1f}s"' if lit and rnd.random() < .3 else ""
                lights.append(f'<rect x="{num(wx)}" y="{wy}" width="2.2" height="3" fill="{"#fff" if lit else VOID}" '
                              f'opacity="{".85" if lit else ".45"}"{twinkle}/>')
    out.append("".join(towers) + f'<g>{"".join(lights)}</g>')
    # a scanner beam sweeps across the towers; it rests left of the city, outside the clip
    out.append(f'<clipPath id="city">{"".join(shapes)}</clipPath><g clip-path="url(#city)">'
               f'<rect x="{left - 90}" y="{ground - tall - 4}" width="90" height="{tall + 4}" fill="url(#sheen)" class="scan"/></g>')

    # peak and current week: pointers above the towers, explained by the legend in the header
    px = left + peak_i * slot + slot / 2
    ptop = ground - tall
    out.append(f'<path d="M{num(px)} {num(ptop)}v-12" stroke="{INK}" stroke-width="1.5"/>'
               f'<circle cx="{num(px)}" cy="{num(ptop - 13)}" r="2.6" fill="#FF3B5C" class="beacon"/>'
               + pointer(px, ptop - 20, VOLT))
    last = len(weeks) - 1
    legend_x = right
    if last != peak_i:
        lx = left + last * slot + slot / 2
        ltop = ground - max(3.0, tall * weeks[last][1] / peak) if weeks[last][1] else ground - 2
        out.append(pointer(lx, ltop - 6, CYAN))
        this_week, w = tag(legend_x, 34, f"THIS WEEK · {weeks[last][1]:,}", CYAN, solid=False)
        out.append(this_week)
        legend_x -= w + 10
    peak_text = f"PEAK WEEK · {weeks[peak_i][1]:,} · FROM {weeks[peak_i][0].day} {MONTHS[weeks[peak_i][0].month - 1]}"
    out.append(tag(legend_x, 34, peak_text, VOLT)[0])

    # street and month names
    out.append(f'<rect x="{left - 6}" y="{ground}" width="{right - left + 6}" height="10" fill="{PANEL}"/>'
               f'<path d="M{left - 6} {ground + .5}H{right}" stroke="url(#street)" stroke-width="1.6"/>'
               f'<path d="M{left} {ground + 5}H{right}" stroke="{VOLT}" stroke-opacity=".5" stroke-dasharray="8 8" class="drive"/>')
    previous = None
    for i, (start, _) in enumerate(weeks):
        if start.month != previous and i:
            x = left + i * slot
            name = MONTHS[start.month - 1] + (f" {start.year}" if start.month == 1 else "")
            out.append(f'<path d="M{num(x)} {ground + 12}v6" stroke="{DIM}"/>' + label(x + 4, ground + 30, name, 11, DIM, tracking=.12))
        previous = start.month
    total = sum(c for _, c in weeks)
    out.append(label(right, H - 22, f"{total:,} CONTRIBUTIONS · {len(weeks)} WEEKS · UPDATED {today.isoformat()} (UTC)", 11.5,
                     DIM, anchor="end", tracking=.14))

    css = (f".scan{{animation:scan 7s ease-in-out infinite}}@keyframes scan{{65%,to{{transform:translateX({right - left + 90}px)}}}}"
           ".tw{animation:tw 3.4s steps(1) infinite}@keyframes tw{50%{opacity:.12}}"
           ".beacon{animation:beacon 1.6s steps(1) infinite}@keyframes beacon{50%{opacity:.15}}"
           ".drive{animation:drive 1.5s linear infinite}@keyframes drive{to{stroke-dashoffset:-16}}")
    defs = (TEXTURES
            + f'<linearGradient id="tower" gradientUnits="userSpaceOnUse" x1="0" y1="{ground}" x2="0" y2="{ground - tall}">'
            f'<stop offset="0" stop-color="{VIOLET}"/><stop offset=".45" stop-color="{MAGENTA}"/><stop offset=".8" stop-color="{ORANGE}"/>'
            f'<stop offset="1" stop-color="{VOLT}"/></linearGradient>'
            f'<linearGradient id="street" x1="0" x2="1"><stop offset="0" stop-color="{MAGENTA}"/><stop offset="1" stop-color="{CYAN}"/></linearGradient>'
            + SHEEN)
    summary = (f"Contribution city: {len(weeks)} towers, one per week, height proportional to that week's contributions "
               f"({total:,} in total). Busiest week began {weeks[peak_i][0].isoformat()} with {weeks[peak_i][1]:,}; "
               f"this week so far: {weeks[last][1]:,}.")
    return document(W, H, "".join(out), title="Contribution city: one tower per week", desc=summary, css=css, defs=defs)


def tag(right_x, y, value, color, *, solid=True) -> tuple[str, float]:
    """Right-aligned chamfered legend tag; returns (svg, width)."""
    size, height = 11.5, 24
    w = width(value, size, "hud", .08) + 38
    x = right_x - w
    shape = f'fill="{color}"' if solid else f'fill="{VOID}" stroke="{color}"'
    ink = VOID if solid else color
    return (f'<path d="{chamfer(x, y, w, height, 7)}" {shape}/>' + pointer(x + 14, y + 8, ink, 5)
            + label(x + 26, y + height / 2 + cap("hud") * size / 2, value, size, ink, tracking=.08)), w


def pointer(x, tip_y, color, size=7) -> str:
    """Small downward triangle whose tip is at (x, tip_y)."""
    return f'<path d="M{num(x - size)} {num(tip_y - size * 1.3)}H{num(x + size)}L{num(x)} {num(tip_y)}Z" fill="{color}"/>'


def main() -> None:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "dist")
    login = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("GITHUB_REPOSITORY_OWNER", "SethyPagna")
    out_dir.mkdir(parents=True, exist_ok=True)
    user, today = fetch(login), datetime.now(timezone.utc).date()
    for name, svg in (("stats.svg", render_stats(user, today)), ("skyline.svg", render_skyline(user, today))):
        (out_dir / name).write_text(svg, encoding="utf-8", newline="\n")
        print(f"wrote {out_dir / name} ({len(svg) // 1024} KB)")


if __name__ == "__main__":
    main()
