from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
SVG_PATH = ASSETS / "app_icon.svg"
PNG_PATH = ASSETS / "app_icon.png"
ICO_PATH = ASSETS / "app_icon.ico"
ICNS_PATH = ASSETS / "app_icon.icns"


def draw_icon(size: int) -> Image.Image:
    scale = size / 1024
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def box(values: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
        return tuple(round(value * scale) for value in values)

    def point(values: tuple[int, int]) -> tuple[int, int]:
        return tuple(round(value * scale) for value in values)

    def points(values: list[tuple[int, int]]) -> list[tuple[int, int]]:
        return [point(value) for value in values]

    draw.rounded_rectangle(box((96, 96, 928, 928)), radius=round(190 * scale), fill="#0f766e")
    draw.rounded_rectangle(box((146, 150, 878, 874)), radius=round(150 * scale), outline="#d8a82f", width=round(18 * scale))

    draw.rounded_rectangle(box((246, 190, 682, 800)), radius=round(52 * scale), fill="#ffffff")
    draw.polygon(points([(600, 190), (682, 272), (600, 272)]), fill="#d8f3ee")
    draw.line(points([(600, 190), (600, 272), (682, 272)]), fill="#b5d9d2", width=round(12 * scale))

    for y in (350, 438, 526, 614):
        draw.line(points([(306, y), (622, y)]), fill="#c9d6d8", width=round(14 * scale))
    for x in (410, 522):
        draw.line(points([(x, 318), (x, 668)]), fill="#e0e7e8", width=round(10 * scale))

    draw.rounded_rectangle(box((316, 318, 378, 668)), radius=round(12 * scale), fill="#e6f5f1")
    draw.rounded_rectangle(box((306, 706, 540, 742)), radius=round(18 * scale), fill="#d8a82f")

    draw.line(points([(650, 448), (790, 448)]), fill="#d8a82f", width=round(44 * scale))
    draw.polygon(points([(790, 382), (902, 448), (790, 514)]), fill="#d8a82f")

    draw.rounded_rectangle(box((574, 594, 850, 792)), radius=round(56 * scale), fill="#f7fbfa")
    draw.line(points([(628, 694), (700, 760), (804, 636)]), fill="#0f766e", width=round(42 * scale))

    return image


def write_svg() -> None:
    SVG_PATH.write_text(
        """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect x="96" y="96" width="832" height="832" rx="190" fill="#0f766e"/>
  <rect x="146" y="150" width="732" height="724" rx="150" fill="none" stroke="#d8a82f" stroke-width="18"/>
  <rect x="246" y="190" width="436" height="610" rx="52" fill="#fff"/>
  <path d="M600 190v82h82z" fill="#d8f3ee"/>
  <path d="M600 190v82h82" fill="none" stroke="#b5d9d2" stroke-width="12"/>
  <path d="M306 350h316M306 438h316M306 526h316M306 614h316" stroke="#c9d6d8" stroke-width="14" stroke-linecap="round"/>
  <path d="M410 318v350M522 318v350" stroke="#e0e7e8" stroke-width="10" stroke-linecap="round"/>
  <rect x="316" y="318" width="62" height="350" rx="12" fill="#e6f5f1"/>
  <rect x="306" y="706" width="234" height="36" rx="18" fill="#d8a82f"/>
  <path d="M650 448h140" stroke="#d8a82f" stroke-width="44" stroke-linecap="round"/>
  <path d="M790 382l112 66-112 66z" fill="#d8a82f"/>
  <rect x="574" y="594" width="276" height="198" rx="56" fill="#f7fbfa"/>
  <path d="M628 694l72 66 104-124" fill="none" stroke="#0f766e" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
""",
        encoding="utf-8",
    )


def write_icns() -> None:
    iconset = ASSETS / "app_icon.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir(parents=True)

    sizes = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }
    for filename, size in sizes.items():
        draw_icon(size).save(iconset / filename)

    iconutil = shutil.which("iconutil")
    if iconutil:
        subprocess.run([iconutil, "-c", "icns", str(iconset), "-o", str(ICNS_PATH)], check=True)
    else:
        draw_icon(1024).save(ICNS_PATH, format="ICNS")
    shutil.rmtree(iconset)


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    write_svg()
    draw_icon(1024).save(PNG_PATH)
    draw_icon(1024).save(
        ICO_PATH,
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    write_icns()


if __name__ == "__main__":
    main()
