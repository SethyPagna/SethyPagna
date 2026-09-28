#!/usr/bin/env python3
"""Subset the Chinese font to the characters this site uses (fonts/han.woff2).

    python tools/fonts.py <NotoSansSC[wght].ttf>

Get the font from https://github.com/google/fonts/tree/main/ofl/notosanssc (SIL OFL).
Re-run after adding Chinese text. Needs fonttools and brotli.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = [ROOT / "index.html", *sorted((ROOT / "js").glob("*.js"))]

chars = set()
for path in FILES:
    chars.update(re.findall(r"[⺀-鿿豈-﫿　-〿＀-￯]", path.read_text(encoding="utf-8")))
text = "".join(sorted(chars))
print(f"{len(chars)} characters: {text}")
subprocess.run(["pyftsubset", sys.argv[1], f"--text={text}", "--flavor=woff2", "--layout-features=*",
                f"--output-file={ROOT / 'fonts' / 'han.woff2'}"], check=True)
