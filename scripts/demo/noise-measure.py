#!/usr/bin/env python3
"""Temporal noise of smooth patches: mean |frame-to-frame difference| after removing each patch's own mean, in grey levels.

  python3 scripts/demo/noise-measure.py clip.mkv --patch sky=0.05,0.03,0.30,0.15 [--patch ...] [--frames 60] [--vf "filter"] [--scale 1920]

Patches are x,y,w,h as fractions of the frame (the clip is first scaled to --scale pixels wide, default 1920, with Lanczos, so a
4K master and a 1080p delivery clip read the same patch). A static or slowly moving smooth area should read at or below 0.6;
film grain, per-frame dither noise and unconverged shadow filtering read 2 and more. `--vf` applies an ffmpeg filter chain first
(to measure one finishing step at a time on a master).
"""
import subprocess
import sys

import numpy as np


def main():
    a = sys.argv[1:]
    clip = a[0]
    patches, frames, vf, scale = [], 60, None, 1920
    i = 1
    while i < len(a):
        if a[i] == '--patch':
            n, v = a[i + 1].split('=')
            patches.append((n, [float(x) for x in v.split(',')]))
            i += 2
        elif a[i] == '--frames':
            frames = int(a[i + 1]); i += 2
        elif a[i] == '--vf':
            vf = a[i + 1]; i += 2
        elif a[i] == '--scale':
            scale = int(a[i + 1]); i += 2
        else:
            i += 1
    w, h = scale, scale * 9 // 16
    chain = (vf + ',' if vf else '') + f'scale={w}:{h}:flags=lanczos,format=gray'
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', clip, '-frames:v', str(frames), '-vf', chain, '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    ims = []
    while True:
        b = p.stdout.read(w * h)
        if len(b) < w * h:
            break
        ims.append(np.frombuffer(b, np.uint8).astype(np.float32).reshape(h, w))
    p.wait()
    res = {}
    for name, (fx, fy, fw, fh) in patches:
        x0, y0, x1, y1 = int(fx * w), int(fy * h), int((fx + fw) * w), int((fy + fh) * h)
        P = np.array([im[y0:y1, x0:x1] for im in ims])
        P = P - P.mean(axis=(1, 2), keepdims=True)
        d = np.abs(np.diff(P, axis=0))
        res[name] = round(float(d.mean()), 3)
    print(clip.split('/')[-1], vf or 'raw', res)


if __name__ == '__main__':
    main()
