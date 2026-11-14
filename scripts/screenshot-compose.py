#!/usr/bin/env python3
"""Compose real-device dark/light screen captures into README images.

Input files are produced by `screenshot-device.sh` (or any other tool that
captures the whole device screen, never a headless browser viewport):

    <input>/<prefix>dark-home.png
    <input>/<prefix>light-home.png
    ... sessions / music / performance / question

Output:

    <output>/pages/<page>.png   diagonal per-page composite
    <output>/overview.png       2x2 overview with transparent gaps
    <output>/question.png       diagonal question composite

Every composite keeps the dark theme above the top-right-to-bottom-left
diagonal and the light theme below it.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

PAGES = ("home", "sessions", "music", "performance", "question")
OVERVIEW = ("home", "sessions", "music", "performance")


def diagonal(dark_path: Path, light_path: Path) -> Image.Image:
    dark = Image.open(dark_path).convert("RGB")
    light = Image.open(light_path).convert("RGB")
    if dark.size != light.size:
        raise SystemExit(f"size mismatch: {dark_path} is {dark.size}, {light_path} is {light.size}")

    width, height = dark.size
    scale = 4
    mask = Image.new("L", (width * scale, height * scale), 0)
    ImageDraw.Draw(mask).polygon(
        [(0, 0), (width * scale, 0), (0, height * scale)],
        fill=255,
    )
    mask = mask.resize((width, height), Image.Resampling.LANCZOS)
    return Image.composite(dark, light, mask)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", required=True, help="directory containing dark-*.png / light-*.png")
    parser.add_argument("--output", required=True, help="directory for overview.png, question.png and pages/")
    parser.add_argument("--prefix", default="", help="input filename prefix, e.g. en-")
    parser.add_argument("--gap", type=int, default=24, help="transparent gap between overview tiles")
    args = parser.parse_args()

    source = Path(args.input)
    target = Path(args.output)
    pages_dir = target / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    def composite(page: str) -> Image.Image:
        dark = source / f"{args.prefix}dark-{page}.png"
        light = source / f"{args.prefix}light-{page}.png"
        if not dark.is_file() or not light.is_file():
            raise SystemExit(f"missing capture for {page}: {dark} / {light}")
        image = diagonal(dark, light)
        image.save(pages_dir / f"{page}.png", optimize=True)
        return image

    tiles = {page: composite(page) for page in PAGES}

    width, height = tiles["home"].size
    overview = Image.new("RGBA", (width * 2 + args.gap, height * 2 + args.gap), (0, 0, 0, 0))
    overview.paste(tiles["home"], (0, 0))
    overview.paste(tiles["sessions"], (width + args.gap, 0))
    overview.paste(tiles["music"], (0, height + args.gap))
    overview.paste(tiles["performance"], (width + args.gap, height + args.gap))
    overview.save(target / "overview.png", optimize=True)

    tiles["question"].convert("RGBA").save(target / "question.png", optimize=True)
    print(f"wrote {target / 'overview.png'} ({overview.width}x{overview.height})")
    print(f"wrote {target / 'question.png'}")
    print(f"wrote {pages_dir}/{{{','.join(PAGES)}}}.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
