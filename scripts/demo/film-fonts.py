#!/usr/bin/env python3
"""Static Inter instances (SIL OFL 1.1) for film-cards.py, cut from the studio's own variable font.

  python3 scripts/demo/film-fonts.py <out dir>      writes Inter-<weight>-<14|32>.ttf
"""
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../apps/studio/public/fonts/inter-var-latin.woff2')
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for opsz in (14, 32):
    for w in (300, 400, 500, 600):
        f = TTFont(SRC)
        axes = {a.axisTag: a for a in f['fvar'].axes}
        loc = {'wght': w}
        if 'opsz' in axes:
            loc['opsz'] = opsz
        g = instancer.instantiateVariableFont(f, loc)
        g.flavor = None
        g.save(os.path.join(out, f'Inter-{w}-{opsz}.ttf'))
print('fonts ok')
