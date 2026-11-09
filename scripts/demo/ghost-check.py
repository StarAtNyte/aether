#!/usr/bin/env python3
"""Ghosting checks for the demo scripts and for a finished cut.

  python3 scripts/demo/ghost-check.py --scripts                    greps the edit scripts for frame-blending filters
  python3 scripts/demo/ghost-check.py cut.mp4 [--n 12] [--out sheet.jpg]
        samples frames from the moving-camera shots of a cut (the ones with the largest frame-to-frame change),
        writes a sheet of 100% crops (a 640x360 window of the full-size frame, taken where the picture has most detail) and the
        times they were taken at. There is no number for ghosting: look at the crops. A tree drawn as three faded copies, doubled
        wires or railings, or a soft smear on a moving shot means frames were blended across time.
"""
import os
import re
import subprocess
import sys

import numpy as np

BANNED = re.compile(r'(?<![-\w])(minterpolate|tblend|tmix|lagfun|framerate=|mpdecimate|blend=)')
HERE = os.path.dirname(os.path.abspath(__file__))


def scripts():
    bad = 0
    for root in (HERE, os.path.join(HERE, 'film')):
        for f in sorted(os.listdir(root)):
            if not f.endswith(('.py', '.ts')) or f == 'ghost-check.py':
                continue
            for i, line in enumerate(open(os.path.join(root, f), errors='ignore'), 1):
                if line.lstrip().startswith(('#', '//', '*')) or 'BANNED = re.compile' in line:
                    continue
                m = BANNED.search(line)
                if m:
                    print(f'{os.path.join(root, f)}:{i}: {m.group(1)}')
                    bad += 1
    print('no frame-blending filters in the scripts' if not bad else f'{bad} hit(s)')
    return bad


def probe_wh(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout.strip()
    w, h = out.split(',')
    return int(w), int(h)


def frame_at(path, t, w, h):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(h, w).astype(np.float32) if len(raw) == w * h else None


def cut(path, n, out):
    from PIL import Image
    w, h = probe_wh(path)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout)
    # coarse motion map: grey 160x90 frames at 5 per second
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-vf', 'fps=5,scale=160:90,format=gray', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    prev, motion = None, []
    while True:
        b = p.stdout.read(160 * 90)
        if len(b) < 160 * 90:
            break
        f = np.frombuffer(b, np.uint8).astype(np.float32)
        if prev is not None:
            motion.append(float(np.abs(f - prev).mean()))
        prev = f
    p.wait()
    motion = np.array(motion)
    # moving but not a cut: the top motion values below a cut threshold, spread over the film
    ok = np.where((motion > np.percentile(motion, 55)) & (motion < max(6.0, np.percentile(motion, 97))))[0]
    picks = ok[np.linspace(0, len(ok) - 1, n).astype(int)] if len(ok) >= n else ok
    tiles, rows = [], []
    for i in picks:
        t = (i + 1) / 5.0
        fs = [frame_at(path, t + k / 30.0, w, h) for k in (-1, 0, 1)]
        if any(f is None for f in fs):
            continue
        a, b, c = fs
        step = float(np.abs(c - a).mean())
        if step < 1.0:
            continue  # duplicate frames: nothing moved, nothing to judge
        # the crop window: where the frame has the most local detail
        gy, gx = np.gradient(b)
        e = np.hypot(gx, gy)
        ch, cw = 360 * h // 1080, 640 * w // 1920
        best, by, bx = -1, 0, 0
        for y in range(0, h - ch, ch // 2):
            for x in range(0, w - cw, cw // 2):
                v = e[y:y + ch, x:x + cw].mean()
                if v > best:
                    best, by, bx = v, y, x
        rgb = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', path, '-frames:v', '1', '-vf', f'crop={cw}:{ch}:{bx}:{by}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
        if len(rgb) == cw * ch * 3:
            tiles.append(Image.fromarray(np.frombuffer(rgb, np.uint8).reshape(ch, cw, 3)))
            rows.append(t)
    if not tiles:
        print('no moving shots found')
        return 1
    cols = 3
    sheet = Image.new('RGB', (cols * tiles[0].width, ((len(tiles) + cols - 1) // cols) * tiles[0].height))
    for k, im in enumerate(tiles):
        sheet.paste(im, ((k % cols) * im.width, (k // cols) * im.height))
    sheet.save(out, quality=92)
    print('crops at', ', '.join(f'{t:.1f} s' for t in rows))
    print('sheet', out)
    return 0


if __name__ == '__main__':
    a = sys.argv[1:]
    if '--scripts' in a:
        sys.exit(1 if scripts() else 0)
    n = int(a[a.index('--n') + 1]) if '--n' in a else 12
    out = a[a.index('--out') + 1] if '--out' in a else 'ghost-sheet.jpg'
    clip = [x for i, x in enumerate(a) if not x.startswith('--') and (i == 0 or a[i - 1] not in ('--n', '--out'))][0]
    sys.exit(cut(clip, n, out))
