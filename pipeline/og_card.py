"""Build the 1200x630 social card, site/public/og-image.png.

    python pipeline/og_card.py

Run by hand when the branding or the headline figure changes enough to matter, not on every
deploy: social platforms cache a card for weeks, so its one figure carries a month and year.
Follows WPR's card convention: the press seal, the WPR name and tagline, the tool's name in
the system's display face, one line of subhead, no screenshots of the tool. Fonts are the
house faces (Fraunces, Public Sans, JetBrains Mono), downloaded from Google Fonts' repository
at run time into a cache folder, so the card never falls back to a system serif.
"""

import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "public" / "og-image.png"
BADGE = ROOT / "site" / "public" / "wpr-badge.jpg"
CACHE = Path.home() / ".cache" / "wpr-fonts"

FONTS = {
    "fraunces": "https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf",
    "publicsans": "https://github.com/google/fonts/raw/main/ofl/publicsans/PublicSans%5Bwght%5D.ttf",
    "jetbrains": "https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
}

CREAM, INK, INK_SOFT = "#F6F2E9", "#1F2421", "#55594F"
TEAL, TEAL_DEEP, LINE = "#3A867C", "#2C6B62", "#D9D3C4"
W, H, M = 1200, 630, 80
MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."]


def font_file(key: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{key}.ttf"
    if not path.exists():
        req = urllib.request.Request(FONTS[key], headers={"User-Agent": "WPR-WatchLedger/1.0"})
        path.write_bytes(urllib.request.urlopen(req, timeout=60).read())
    return path


def face(key: str, size: int, **axes) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(font_file(key)), size)
    if axes:
        names = [a["name"].decode() if isinstance(a["name"], bytes) else a["name"] for a in f.get_variation_axes()]
        defaults = {n: a["default"] for n, a in zip(names, f.get_variation_axes())}
        f.set_variation_by_axes([axes.get(n.lower(), axes.get(n, defaults[n])) for n in names])
    return f


def tracked(draw, xy, text, font, fill, spacing):
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + spacing
    return x


def wrap(draw, text, font, width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=font) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + [line]


def main() -> None:
    agencies = json.loads((ROOT / "data" / "agencies.json").read_text(encoding="utf-8"))["agencies"]
    network = [a for a in agencies if a["in_network"]]
    publish = sum(1 for a in network if a["portal"])
    if not network or not BADGE.exists():
        sys.exit("og_card: need data/agencies.json and site/public/wpr-badge.jpg")

    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 10], fill=TEAL_DEEP)

    # The flag: seal, wordmark, tagline, then the newspaper's thick-over-thin rule.
    seal = Image.open(BADGE).convert("RGB").resize((76, 76), Image.LANCZOS)
    mask = Image.new("L", (76 * 4, 76 * 4), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, 76 * 4 - 1, 76 * 4 - 1], fill=255)
    img.paste(seal, (M, 44), mask.resize((76, 76), Image.LANCZOS))
    d.ellipse([M, 44, M + 75, 44 + 75], outline=LINE, width=2)
    wordmark = face("fraunces", 38, opsz=72, wght=650)
    x = M + 76 + 18
    d.text((x, 52), "Wausau Pilot ", font=wordmark, fill=INK)
    x += d.textlength("Wausau Pilot ", font=wordmark)
    amp = face("fraunces", 38, opsz=72, wght=500)
    d.text((x, 52), "&", font=amp, fill=TEAL_DEEP)
    x += d.textlength("& ", font=amp)
    d.text((x, 52), "Review", font=wordmark, fill=INK)
    tracked(d, (M + 76 + 20, 100), "WHERE LOCALS LOOK FIRST FOR NEWS", face("publicsans", 14, wght=500), INK_SOFT, 3.6)
    d.rectangle([M, 140, W - M, 144], fill=INK)
    d.rectangle([M, 148, W - M, 149], fill=INK)

    tracked(d, (M, 172), "A NEWSROOM DATA PROJECT", face("jetbrains", 20, wght=500), TEAL_DEEP, 2.5)
    d.text((M - 4, 196), "The Watch Ledger", font=face("fraunces", 112, opsz=144, wght=800), fill=INK)

    sub = ("Every community-mapped plate-reader camera in Wisconsin, every agency in the "
           "Flock network, and which ones let the public see how it is used.")
    sub_font = face("publicsans", 29, wght=400)
    y = 340
    for line in wrap(d, sub, sub_font, W - 2 * M):
        d.text((M, y), line, font=sub_font, fill=INK)
        y += 40

    # The signature tick bar, from the current data: one mark per agency in the network.
    rows = 2
    per_row = -(-len(network) // rows)
    pitch = (W - 2 * M) / per_row
    tw, th, top = max(2.0, pitch * 0.62), 30, 462
    order = sorted(network, key=lambda a: (a["portal"] is None, a["name"]))
    for i, a in enumerate(order):
        r, c = divmod(i, per_row)
        x0, y0 = M + c * pitch, top + r * (th + 8)
        if a["portal"]:
            d.rectangle([x0, y0, x0 + tw, y0 + th], fill=TEAL, outline=TEAL_DEEP)
        else:
            d.rectangle([x0, y0, x0 + tw, y0 + th], outline="#A3A69C", width=1)
    today = date.today()
    caption = (f"Each mark is one agency in the sharing network. {publish} of {len(network)} publish "
               f"usage data. {MONTHS[today.month - 1]} {today.year}.")
    d.text((M, top + rows * (th + 8) + 14), caption, font=face("jetbrains", 17, wght=400), fill=INK_SOFT)

    img.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)}: {publish} of {len(network)} publish, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
