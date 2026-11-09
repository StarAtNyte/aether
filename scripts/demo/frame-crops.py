#!/usr/bin/env python3
"""Side-by-side 100% (or magnified) crops of chosen frames from one or more clips, for defect and before/after stills.

  python3 scripts/demo/frame-crops.py out.png --crop x,y,w,h [--zoom 2] [--label] clipA.mkv:132,134 clipB.mkv:132,134

Each argument is `clip:frame[,frame...]`; one row per clip, one column per frame, the same crop everywhere (crop in the
clip's own pixels; clips of another size are scaled to the first clip's width first, so a 4K master and a 1080p legacy
frame show the same region).
"""
import subprocess
import sys

import numpy as np


def probe(path):
    o = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout.strip().split(',')
    return int(o[0]), int(o[1])


def frame(path, n, size):
    w, h = size
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'select=eq(n\\,{n}),scale={w}:{h}:flags=lanczos', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True)
    return np.frombuffer(p.stdout, np.uint8).reshape(h, w, 3)


def main():
    a = sys.argv[1:]
    out = a[0]
    crop = [int(v) for v in a[a.index('--crop') + 1].split(',')]
    zoom = int(a[a.index('--zoom') + 1]) if '--zoom' in a else 1
    specs = [x for x in a[1:] if ':' in x and not x.startswith('--')]
    base = probe(specs[0].rsplit(':', 1)[0])
    rows = []
    for s in specs:
        path, fr = s.rsplit(':', 1)
        tiles = []
        for n in fr.split(','):
            img = frame(path, int(n), base)
            x, y, w, h = crop
            c = img[y:y + h, x:x + w]
            if zoom > 1:
                c = np.kron(c, np.ones((zoom, zoom, 1), np.uint8))
            c = np.pad(c, ((0, 0), (0, 6), (0, 0)), constant_values=255)
            tiles.append(c)
        rows.append(np.hstack(tiles))
        rows[-1] = np.pad(rows[-1], ((0, 6), (0, 0), (0, 0)), constant_values=255)
    img = np.vstack(rows)
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{img.shape[1]}x{img.shape[0]}', '-i', '-', '-frames:v', '1', out], stdin=subprocess.PIPE)
    p.communicate(img.tobytes())


if __name__ == '__main__':
    main()
