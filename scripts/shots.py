"""Crop and compress project images into card banners and thumbnails (assets/shots/).

Sources: the public portfolio's screenshots (sethy-pagna-portfolio.vercel.app) and the
Wreckabulary key art from its public repository.
Run with a Python that has Pillow:
    python scripts/shots.py <portfolio-assets-dir> <wreckabulary-key-art.jpg>
"""
import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "assets" / "shots"
BANNER = (900, 315)  # 1.5x the 600x210 card image area
THUMB = 300  # 2x the 150px mini-card thumbnail

# name -> (source file, top offset as a fraction of the height left over after cropping)
CROPS = {
    "business-os": ("business-os.png", 0.62),
    "learn": ("learn.png", 0.10),
    "allchess": ("allchess.png", 0.18),
    "edsync": ("edsync.png", 0.05),
    "codeage": ("codeage.png", 0.0),
    "khshop": ("khshop.png", 0.0),
    "sandline": ("sandline.png", 0.45),
    "living-kingdom": ("living-kingdom.png", 0.55),
}

# name -> (source key, file, horizontal centre of the square crop as a fraction of the width)
THUMBS = {
    "thumb-jarvis": ("portfolio", "jarvis-icon.png", 0.5),
    "thumb-khshop": ("portfolio", "khshop.png", 0.33),
    "thumb-wreckabulary": ("keyart", None, 0.28),
}


def banner(src: Path, top: float) -> Image.Image:
    image = Image.open(src).convert("RGB")
    width, height = image.size
    crop_height = round(width * BANNER[1] / BANNER[0])
    y = round((height - crop_height) * top)
    return image.crop((0, y, width, y + crop_height)).resize(BANNER, Image.LANCZOS)


def square(src: Path, centre: float) -> Image.Image:
    image = Image.open(src).convert("RGB")
    width, height = image.size
    side = min(width, height)
    x = min(max(round(width * centre - side / 2), 0), width - side)
    y = (height - side) // 2
    return image.crop((x, y, x + side, y + side)).resize((THUMB, THUMB), Image.LANCZOS)


def save(image: Image.Image, name: str) -> None:
    target = OUT / f"{name}.jpg"
    image.save(target, "JPEG", quality=76, optimize=True, progressive=True)
    print(f"{target.name}: {target.stat().st_size // 1024} KB")


def main(portfolio_dir: str, key_art: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (file, top) in CROPS.items():
        save(banner(Path(portfolio_dir) / file, top), name)
    sources = {"portfolio": Path(portfolio_dir), "keyart": Path(key_art)}
    for name, (key, file, centre) in THUMBS.items():
        save(square(sources[key] / file if file else sources[key], centre), name)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
