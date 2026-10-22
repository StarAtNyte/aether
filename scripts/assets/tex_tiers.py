"""Texture tiers for the interior model build (run as `python3 -I tex_tiers.py jobs.json`).

jobs.json: {"jobs": [{"src": path, "dst": path, "side": int, "quality": int}], "colors": [src,...]}
Writes every `dst` (JPEG, or PNG when the source carries real transparency) resized so the longest
side is at most `side`, and prints {"colors": {src: {"rgb": [r,g,b], "names": [..]}}} on stdout for
the base-colour images listed in `colors` and for plain colours in `factors` ({key: [r,g,b]}).
"""
import json, os, sys
from PIL import Image

NAMED = {
    "white": (235, 235, 230), "black": (28, 28, 30), "grey": (128, 128, 128), "silver": (180, 182, 186),
    "beige": (214, 196, 160), "cream": (240, 228, 200), "tan": (186, 148, 104), "brown": (112, 74, 44),
    "dark-brown": (62, 40, 26), "red": (172, 38, 34), "orange": (206, 106, 36), "yellow": (222, 190, 60),
    "gold": (190, 150, 62), "green": (74, 120, 58), "olive": (110, 112, 60), "teal": (50, 120, 118),
    "blue": (52, 84, 156), "navy": (28, 40, 84), "purple": (110, 64, 128), "pink": (206, 130, 150),
}


def name_of(rgb):
    best, bd = "grey", 1e18
    for n, c in NAMED.items():
        d = sum((a - b) ** 2 for a, b in zip(rgb, c))
        if d < bd:
            best, bd = n, d
    return best


def has_alpha(im):
    if im.mode not in ("RGBA", "LA", "P"):
        return False
    a = im.convert("RGBA").getchannel("A")
    return a.getextrema()[0] < 250


def resize(job):
    im = Image.open(job["src"])
    alpha = has_alpha(im)
    im = im.convert("RGBA" if alpha else "RGB")
    s = min(1.0, job["side"] / max(im.size))
    if s < 1.0:
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    os.makedirs(os.path.dirname(job["dst"]), exist_ok=True)
    if alpha:
        im.save(job["dst"], "PNG", optimize=True)
    else:
        im.save(job["dst"], "JPEG", quality=job.get("quality", 80), optimize=True, progressive=False)


def colours(path):
    im = Image.open(path).convert("RGB")
    im.thumbnail((64, 64))
    q = im.quantize(colors=5, method=Image.MEDIANCUT)
    pal = q.getpalette()[:15]
    counts = sorted(q.getcolors(), reverse=True)
    out, seen = [], []
    for n, idx in counts:
        rgb = tuple(pal[idx * 3: idx * 3 + 3])
        nm = name_of(rgb)
        out.append((n, rgb, nm))
    top = out[0]
    names = []
    for n, rgb, nm in out:
        if nm not in names and n >= 0.12 * sum(c for c, _ in counts):
            names.append(nm)
    return {"rgb": list(top[1]), "names": names[:3] or [top[2]]}


def main():
    spec = json.load(open(sys.argv[1]))
    for j in spec.get("jobs", []):
        if not os.path.exists(j["dst"]):
            resize(j)
    res = {}
    for c in spec.get("colors", []):
        res[c] = colours(c)
    for k, rgb in spec.get("factors", {}).items():
        res[k] = {"rgb": rgb, "names": [name_of(rgb)]}
    print(json.dumps({"colors": res}))


main()
