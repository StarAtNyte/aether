#!/usr/bin/env python3
"""Paint-time gap statistics of screencast takes (film-ui.ts writes <scene>.frames.json next to each take).

  python3 scripts/demo/take-gaps.py take.frames.json [more ...]
  python3 scripts/demo/take-gaps.py take.frames.json --range 4.0 11.0     (only the stretch the edit uses, seconds of the take)

Prints the median, 95th and 99th percentile and the maximum gap in ms, the share of gaps over 50 ms, and the same for the
active gaps (waits over 400 ms are idle time, nothing moved).
"""
import json
import sys

import numpy as np

args = sys.argv[1:]
accept = '--accept' in args
args = [a for a in args if a != '--accept']
rng = None
if '--range' in args:
    i = args.index('--range')
    rng = (float(args[i + 1]), float(args[i + 2]))
    args = args[:i] + args[i + 3:]
for f in args:
    g = np.array(json.load(open(f))['gapsMs'], dtype=float)
    if rng:
        t = np.cumsum(g) / 1000.0
        g = g[(t >= rng[0]) & (t <= rng[1])]
    a = g[g <= 400]
    verdict = ''
    if accept:
        # a UI take is accepted when the median gap is at most 40 ms and under 5% of the (active) gaps exceed 50 ms
        ok = np.median(a) <= 40 and 100 * (a > 50).mean() < 5
        verdict = '  ' + ('ACCEPT' if ok else 'REJECT')
    print(f"{f}{' ' + str(rng) if rng else ''}{verdict}: n={len(g)} median={np.median(g):.0f} p95={np.percentile(g, 95):.0f} p99={np.percentile(g, 99):.0f} max={g.max():.0f} over50={100 * (g > 50).mean():.1f}% | active: median={np.median(a):.0f} p95={np.percentile(a, 95):.0f} over50={100 * (a > 50).mean():.1f}%")
