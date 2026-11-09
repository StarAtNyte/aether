#!/usr/bin/env python3
"""Flicker, pop and pacing check for demo clips (or the final cut).

  python3 scripts/demo/flicker-check.py clip.mp4 [more.mp4 ...] [--fps 30] [--json out.json]

Decodes each clip to 320x180 grey and reports, per clip:
  - frame gaps from the container timestamps (max, 99th percentile; a gap over 50 ms at 30 fps is a stutter);
  - black frames (mean luma under 4) and duplicate frames (difference near zero while the neighbours move);
  - difference spikes (a frame-to-frame difference over 4x the rolling median and over 6 grey levels: a cut, a pop, a flash);
  - luminance flicker (the mean luma jumping up then back, two steps of more than 3 grey levels in opposite directions:
    shadow-map refresh, exposure pop, bloom flash);
  - high-frequency energy: the share of the luma signal's variance above 5 Hz in the static pixels (shimmer).
Exit status 1 when any clip has a stutter, black frame or flicker finding; spikes at known cuts are listed, not failed.
"""
import json
import subprocess
import sys

import numpy as np

W, H = 320, 180


def probe_times(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout
    t = sorted(float(x) for x in out.split() if x.strip())
    return np.array(t)


def frames(path):
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={W}:{H}:flags=area,format=gray', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    n = W * H
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).astype(np.float32)
    p.wait()


def check(path, fps=30.0):
    t = probe_times(path)
    gaps = np.diff(t) * 1000 if len(t) > 1 else np.array([0.0])
    luma, diffs = [], []
    prev = None
    statics = None
    stack = []
    for f in frames(path):
        luma.append(f.mean())
        if prev is not None:
            diffs.append(float(np.abs(f - prev).mean()))
        prev = f
        if len(stack) < 600:
            stack.append(f[::7])
    luma = np.array(luma)
    d = np.array(diffs) if diffs else np.zeros(1)
    res = {'clip': path, 'frames': len(luma), 'seconds': round(len(luma) / fps, 2)}
    res['gap_max_ms'] = round(float(gaps.max()), 1)
    res['gap_p99_ms'] = round(float(np.percentile(gaps, 99)), 1)
    res['stutters'] = int((gaps > 50).sum())
    res['black'] = [int(i) for i in np.where(luma < 4)[0]][:12]
    med = float(np.median(d))
    res['duplicates'] = int((d < 0.02).sum()) if med > 0.3 else 0
    k = 15
    roll = np.array([np.median(d[max(0, i - k):i + k + 1]) for i in range(len(d))])
    res['spikes'] = [int(i) + 1 for i in np.where((d > 4 * np.maximum(roll, 0.3)) & (d > 6))[0]][:20]
    dl = np.diff(luma) if len(luma) > 1 else np.zeros(1)
    fl = [int(i) + 1 for i in range(len(dl) - 1) if abs(dl[i]) > 3 and abs(dl[i + 1]) > 3 and dl[i] * dl[i + 1] < 0]
    res['luma_flicker'] = fl[:20]
    if len(stack) > 40:
        a = np.stack(stack)
        stat = a.std(axis=0) < 6
        if stat.sum() > 50:
            sig = a[:, stat].mean(axis=1)
            sig = sig - sig.mean()
            spec = np.abs(np.fft.rfft(sig * np.hanning(len(sig)))) ** 2
            fr = np.fft.rfftfreq(len(sig), 1 / fps)
            tot = spec[1:].sum() or 1
            res['hf_share_static'] = round(float(spec[fr > 5].sum() / tot), 3)
    res['ok'] = res['stutters'] == 0 and not res['black'] and not res['luma_flicker']
    return res


def main():
    args = sys.argv[1:]
    out = None
    fps = 30.0
    clips = []
    i = 0
    while i < len(args):
        if args[i] == '--json':
            out = args[i + 1]
            i += 2
        elif args[i] == '--fps':
            fps = float(args[i + 1])
            i += 2
        else:
            clips.append(args[i])
            i += 1
    results = [check(c, fps) for c in clips]
    for r in results:
        print(('OK   ' if r['ok'] else 'FAIL ') + json.dumps(r))
    if out:
        json.dump(results, open(out, 'w'), indent=1)
    sys.exit(0 if all(r['ok'] for r in results) else 1)


main()
