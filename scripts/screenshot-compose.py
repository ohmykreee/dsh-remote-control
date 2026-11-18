#!/usr/bin/env python3
"""Compose real-device dark/light screen captures into README images.

Input files are produced by `screenshot-device.sh` (or any other tool that
captures the whole device screen, never a headless browser viewport):

    <input>/<prefix>dark-home.png
    <input>/<prefix>light-home.png
    ... sessions / music / performance / quickqa / answer

Each page is blended diagonally: the dark theme above the
top-right-to-bottom-left diagonal, the light theme below it.

Output groups (two pages side by side, transparent gap between them):

    <output>/overview.png   home + sessions
    <output>/media.png      music + performance
    <output>/quickqa.png    quick input + completed answer
    <output>/pages/<page>.png   individual diagonal composites
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

GROUPS = {
    "overview": ("home", "sessions"),
    "media": ("music", "performance"),
    "quickqa": ("quickqa", "answer"),
}
PAGES = tuple(dict.fromkeys(page for pair in GROUPS.values() for page in pair))


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
    parser.add_argument("--output", required=True, help="directory for the grouped composites and pages/")
    parser.add_argument("--prefix", default="", help="input filename prefix, e.g. en-")
    parser.add_argument("--gap", type=int, default=24, help="transparent gap between grouped pages")
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

    for name, pair in GROUPS.items():
        left = tiles[pair[0]]
        right = tiles[pair[1]]
        width, height = left.size
        group = Image.new("RGBA", (width * 2 + args.gap, height), (0, 0, 0, 0))
        group.paste(left, (0, 0))
        group.paste(right, (width + args.gap, 0))
        group.save(target / f"{name}.png", optimize=True)
        print(f"wrote {target / f'{name}.png'} ({group.width}x{group.height})")

    print(f"wrote {pages_dir}/{{{','.join(PAGES)}}}.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
