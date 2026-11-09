#!/usr/bin/env python3
"""Paint-time gap statistics of screencast takes (film-ui.ts writes <scene>.frames.json next to each take).

  python3 scripts/demo/take-gaps.py take.frames.json [more ...]

Prints the median, 95th and 99th percentile and the maximum gap in ms, and the share of gaps over 50 ms. A take with
steady motion should sit at about 33 ms or under; long gaps are waits (nothing moved) unless the picture was moving.
"""
import json
import sys

import numpy as np

for f in sys.argv[1:]:
    g = np.array(json.load(open(f))['gapsMs'], dtype=float)
    print(f"{f}: n={len(g)} median={np.median(g):.0f} p95={np.percentile(g, 95):.0f} p99={np.percentile(g, 99):.0f} max={g.max():.0f} over50={100 * (g > 50).mean():.1f}%")
