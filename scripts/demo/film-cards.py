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


def pill(img, x0, y0, x1, y1):
    """A dark translucent rounded plate under quiet type, so it reads over the pale studio as over a film."""
    plate = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle([x0, y0, x1, y1], (y1 - y0) // 2, fill=(9, 12, 19, 150))
    return Image.alpha_composite(plate, img)


for name, c in cards.items():
    k, text, sub = c['kind'], c.get('text'), c.get('sub')
    if k == 'chapter':
        # a single quiet word, low left, widely tracked capitals
        img = render([((112, 968), text.upper(), font(500, 30), (255, 255, 255, 235), 9, 'l')], blur=16, alpha=150)
        wd = ImageDraw.Draw(Image.new('RGBA', (1, 1))).textlength(text.upper(), font=font(500, 30)) + 9 * len(text)
        img = pill(img, 112 - 34, 968 - 54, 112 + wd + 26, 968 + 26)
    elif k == 'lower':
        layers = [((112, 958 if sub else 978), text, font(500, 40), (255, 255, 255, 245), 1, 'l')]
        if sub:
            layers.append(((112, 1008), sub, font(400, 28), (255, 255, 255, 190), 1, 'l'))
        img = render(layers, blur=14, alpha=140)
    elif k == 'note':
        # right-aligned top right: measure, then place
        d = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
        wdt = sum(d.textlength(ch, font=font(400, 28)) for ch in text) + (len(text) - 1)
        img = render([((W - 112 - wdt, 92), text, font(400, 28), (255, 255, 255, 230), 1, 'l')], blur=10, alpha=140)
        img = pill(img, W - 112 - wdt - 30, 92 - 44, W - 112 + 30, 92 + 22)
    elif k == 'title':
        layers = [((W // 2, 566), text, font(600, 132), (255, 255, 255, 255), 6, 'm')]
        if sub:
            layers.append(((W // 2, 640), sub, font(300, 40), (255, 255, 255, 220), 2, 'm'))
        img = render(layers, blur=24, alpha=150)
    elif k == 'hook':
        # the opening promise: two lines, sentence case, centred low over the shot
        layers = [((W // 2, 838), text, font(600, 92), (255, 255, 255, 255), 0, 'm')]
        if sub:
            layers.append(((W // 2, 916), sub, font(400, 44), (255, 255, 255, 235), 0, 'm'))
        img = render(layers, blur=26, alpha=190)
        # a soft dark rise from the bottom edge so the line reads over a bright sky
        sc = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        sd = ImageDraw.Draw(sc)
        for y in range(560, H):
            sd.line([(0, y), (W, y)], fill=(6, 9, 15, int(150 * ((y - 560) / (H - 560)) ** 1.5)))
        img = Image.alpha_composite(sc, img)
    elif k == 'step':
        # a numbered step of the product's flow: the verb big, one plain sentence under it, on a dark plate low left
        d = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
        fv, fs = font(600, 60), font(400, 32)
        wv = d.textlength(text, font=fv)
        ws = d.textlength(sub, font=fs) if sub else 0
        x0, y1 = 96, 1000
        y0 = y1 - (170 if sub else 112)
        num = c.get('num', '')
        tx = x0 + (124 if num else 44)
        x1 = tx + max(wv, ws) + 44
        plate = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        pd = ImageDraw.Draw(plate)
        pd.rounded_rectangle([x0, y0, x1, y1], 28, fill=(9, 12, 19, 196))
        if num:
            pd.ellipse([x0 + 28, y0 + 28, x0 + 100, y0 + 100], fill=(255, 255, 255, 235))
            pd.text((x0 + 64, y0 + 66), num, font=font(600, 40), fill=(9, 12, 19, 255), anchor='mm')
        pd.text((tx, y0 + 78), text, font=fv, fill=(255, 255, 255, 255), anchor='ls')
        if sub:
            pd.text((tx, y0 + 130), sub, font=fs, fill=(255, 255, 255, 205), anchor='ls')
        sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle([x0, y0 + 8, x1, y1 + 8], 28, fill=(0, 0, 0, 120))
        img = Image.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)), plate)
    elif k == 'cap':
        # v8 caption: one plain sentence, 44 px, on a dark plate low left with a step number; two lines when it is long
        d = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
        f = font(500, 44)
        words, lines, cur = text.split(), [], ''
        for w_ in words:
            trial = (cur + ' ' + w_).strip()
            if d.textlength(trial, font=f) > 1500 and cur:
                lines.append(cur)
                cur = w_
            else:
                cur = trial
        lines.append(cur)
        num = c.get('num', '')
        tw = max(d.textlength(l_, font=f) for l_ in lines)
        x0, y1 = 72, 1012
        lh_ = 58
        y0 = y1 - (len(lines) * lh_ + 44)
        tx = x0 + (112 if num else 40)
        x1 = tx + tw + 44
        plate = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        pd = ImageDraw.Draw(plate)
        pd.rounded_rectangle([x0, y0, x1, y1], 30, fill=(9, 12, 19, 205))
        if num:
            cy = (y0 + y1) // 2
            pd.ellipse([x0 + 24, cy - 32, x0 + 88, cy + 32], fill=(255, 255, 255, 240))
            pd.text((x0 + 56, cy + 2), str(num), font=font(600, 38), fill=(9, 12, 19, 255), anchor='mm')
        for i_, l_ in enumerate(lines):
            pd.text((tx, y0 + 22 + (i_ + 1) * lh_ - 14), l_, font=f, fill=(255, 255, 255, 255), anchor='ls')
        sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle([x0, y0 + 8, x1, y1 + 8], 30, fill=(0, 0, 0, 120))
        img = Image.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)), plate)
    elif k == 'act':
        # v8 act title: an opaque card, the act's word large, one line under it, five dots for the five acts
        bg = Image.new('RGB', (W, H), (12, 15, 22))
        glow = Image.new('L', (W, H), 0)
        ImageDraw.Draw(glow).ellipse([W * 0.2, -H * 0.5, W * 0.8, H * 0.7], fill=255)
        bg = Image.composite(Image.new('RGB', (W, H), (44, 54, 74)), bg, glow.filter(ImageFilter.GaussianBlur(200))).convert('RGBA')
        img = Image.alpha_composite(bg, render([((W // 2, 560), text, font(600, 190), (255, 255, 255, 255), 2, 'm'), ((W // 2, 650), sub, font(400, 50), (255, 255, 255, 225), 0, 'm')], blur=20, alpha=120))
        n_, cur_ = int(c.get('total', 5)), int(c.get('idx', 1))
        lay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        x_start = W // 2 - (n_ - 1) * 28
        for i_ in range(n_):
            cx = x_start + i_ * 56
            d.ellipse([cx - 9, 790 - 9, cx + 9, 790 + 9], fill=(255, 255, 255, 255 if i_ + 1 == cur_ else 70))
        d.text((W // 2, 740), f'Act {cur_} of {n_}', font=font(400, 32), fill=(255, 255, 255, 170), anchor='mm')
        img = Image.alpha_composite(img, lay)
    elif k == 'tag':
        # a plain label for a shot, bottom left, on a small plate
        d = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
        f = font(500, 36)
        wd = d.textlength(text, font=f)
        x0, y1 = 96, 996
        plate = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        pd = ImageDraw.Draw(plate)
        pd.rounded_rectangle([x0, y1 - 78, x0 + wd + 56, y1], 39, fill=(9, 12, 19, 190))
        pd.text((x0 + 28, y1 - 24), text, font=f, fill=(255, 255, 255, 250), anchor='ls')
        img = plate
    elif k == 'devlabels':
        # two captions under the split screen's windows
        f = font(500, 34)
        img = render([((c['x1'], c['y']), c['t1'], f, (255, 255, 255, 235), 0, 'm'), ((c['x2'], c['y']), c['t2'], f, (255, 255, 255, 235), 0, 'm')], blur=10, alpha=140)
    elif k == 'end':
        # the end card: an opaque plate with the name, the promise and the address
        from PIL import ImageChops
        bg = Image.new('RGB', (W, H), (12, 15, 22))
        glow = Image.new('L', (W, H), 0)
        ImageDraw.Draw(glow).ellipse([W * 0.2, -H * 0.5, W * 0.8, H * 0.7], fill=255)
        bg = Image.composite(Image.new('RGB', (W, H), (44, 54, 74)), bg, glow.filter(ImageFilter.GaussianBlur(200))).convert('RGBA')
        layers = [((W // 2, 470), text, font(600, 150), (255, 255, 255, 255), 2, 'm'), ((W // 2, 560), sub, font(400, 46), (255, 255, 255, 225), 0, 'm')]
        img = Image.alpha_composite(bg, render(layers, blur=20, alpha=120))
        d = ImageDraw.Draw(img)
        fu = font(500, 52)
        wu = d.textlength(c['url'], font=fu)
        d.rounded_rectangle([W // 2 - wu / 2 - 44, 650, W // 2 + wu / 2 + 44, 752], 51, fill=(255, 255, 255, 245))
        d.text((W // 2, 716), c['url'], font=fu, fill=(12, 15, 22, 255), anchor='ms')
    else:
        raise SystemExit(f'unknown kind {k}')
    img.save(os.path.join(OUT, f'{name}.png'))
print('cards', len(cards))
