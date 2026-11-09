#!/usr/bin/env python3
"""Per-10-second table of ffmpeg's blurdetect score (every 30th frame) for one or two cuts.

  python3 scripts/demo/blur-table.py new.mp4 [old.mp4]

blurdetect is dominated by scene content (a photoreal reference scores 6.4), so it is a relative check only: the new cut's mean
should be at least 0.5 lower than the old one's and no segment above the old worst. Judge sharpness by eye at 100% crops.
"""
import re
import subprocess
import sys

import numpy as np


def scores(path):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-vf', "select='not(mod(n,30))',blurdetect=block_pct=80:high=0.12:low=0.06,metadata=print:key=lavfi.blur", '-an', '-f', 'null', '-'], capture_output=True, text=True).stderr
    t, v = [], []
    cur = None
    for line in out.splitlines():
        m = re.search(r'pts_time:([\d.]+)', line)
        if m:
            cur = float(m.group(1))
        m = re.search(r'lavfi\.blur=([\d.]+)', line)
        if m and cur is not None:
            t.append(cur)
            v.append(float(m.group(1)))
    return np.array(t), np.array(v)


def table(path):
    t, v = scores(path)
    rows = []
    for a in range(0, int(t.max()) + 1, 10):
        sel = v[(t >= a) & (t < a + 10)]
        if len(sel):
            rows.append((a, float(sel.mean())))
    return rows, float(v.mean())


a = table(sys.argv[1])
b = table(sys.argv[2]) if len(sys.argv) > 2 else None
print(f"{'segment':>10} {'new':>6}" + (f" {'old':>6}" if b else ''))
for i, (s, m) in enumerate(a[0]):
    print(f'{s:4d}-{s + 10:<4d}  {m:6.2f}' + (f'  {b[0][i][1]:6.2f}' if b and i < len(b[0]) else ''))
print(f"{'mean':>10} {a[1]:6.2f}" + (f' {b[1]:6.2f}' if b else ''))
print(f"worst segment new {max(m for _, m in a[0]):.2f}" + (f', old {max(m for _, m in b[0]):.2f}' if b else ''))
