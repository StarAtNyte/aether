"""Typography for the product film: transparent 1920x1080 PNG overlays (Inter, the studio's own font), soft shadowed,
set small and quiet: a chapter word, a lower third (a name and an optional line), a corner note, the title card.

  python3 scripts/demo/film-cards.py <cards.json> <out dir> <fonts dir>

cards.json: {"<name>": {"kind": "chapter" | "lower" | "note" | "title", "text": "...", "sub": "..."}}
Fonts: Inter-<weight>-<14|32>.ttf in <fonts dir> (Inter is OFL).
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
cards = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
FONTS = sys.argv[3]
os.makedirs(OUT, exist_ok=True)


def font(weight, size):
    return ImageFont.truetype(os.path.join(FONTS, f'Inter-{weight}-{32 if size >= 40 else 14}.ttf'), size)


def tracked(draw, xy, text, f, fill, track, anchor_x='l'):
    """Text with letter spacing (px), left- or centre-anchored on the baseline."""
    widths = [draw.textlength(c, font=f) for c in text]
    total = sum(widths) + track * (len(text) - 1)
    x = xy[0] - (total / 2 if anchor_x == 'm' else 0)
    for c, w in zip(text, widths):
        draw.text((x, xy[1]), c, font=f, fill=fill, anchor='ls')
        x += w + track
    return total


def render(layers, blur=12, alpha=120):
    base = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    db, ds = ImageDraw.Draw(base), ImageDraw.Draw(sh)
    for (xy, text, f, fill, track, ax) in layers:
        tracked(ds, (xy[0], xy[1] + 2), text, f, (0, 0, 0, alpha), track, ax)
        tracked(db, xy, text, f, fill, track, ax)
    return Image.alpha_composite(sh.filter(ImageFilter.GaussianBlur(blur)), base)


for name, c in cards.items():
    k, text, sub = c['kind'], c['text'], c.get('sub')
    if k == 'chapter':
        # a single quiet word, low left, widely tracked capitals
        img = render([((112, 968), text.upper(), font(500, 30), (255, 255, 255, 235), 9, 'l')], blur=16, alpha=150)
    elif k == 'lower':
        layers = [((112, 958 if sub else 978), text, font(500, 40), (255, 255, 255, 245), 1, 'l')]
        if sub:
            layers.append(((112, 1000), sub, font(400, 24), (255, 255, 255, 190), 1, 'l'))
        img = render(layers, blur=14, alpha=140)
    elif k == 'note':
        # right-aligned top right: measure, then place
        d = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
        wdt = sum(d.textlength(ch, font=font(400, 22)) for ch in text) + (len(text) - 1)
        img = render([((W - 112 - wdt, 92), text, font(400, 22), (255, 255, 255, 200), 1, 'l')], blur=10, alpha=140)
    elif k == 'title':
        layers = [((W // 2, 566), text, font(600, 132), (255, 255, 255, 255), 6, 'm')]
        if sub:
            layers.append(((W // 2, 640), sub, font(300, 40), (255, 255, 255, 220), 2, 'm'))
        img = render(layers, blur=24, alpha=150)
    else:
        raise SystemExit(f'unknown kind {k}')
    img.save(os.path.join(OUT, f'{name}.png'))
print('cards', len(cards))
