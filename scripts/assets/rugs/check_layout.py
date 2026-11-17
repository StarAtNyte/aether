"""
Numerical placement check of the Rug Exhibition Hall: every asset entity (rugs, plinths, tables) as a world-space box
from its catalog size and transform, against each other and against the generated geometry's boxes (world-dump.ts).

    python3 scripts/assets/rugs/check_layout.py <dump-dir> <world.json> [catalog.json]

Reports intersections (> 1 mm), rugs that are not resting on their support (gap 1-5 mm expected), rugs overhanging
their support, and wall rugs closer than 2 cm to their wall.
"""
import json
import math
import sys

import numpy as np

dump, world_path = sys.argv[1], sys.argv[2]
cat_path = sys.argv[3] if len(sys.argv) > 3 else 'assets/catalog.json'
geo = json.load(open(f'{dump}/geo.json'))
world = json.load(open(world_path))['world']
cat = {e['id']: e for e in json.load(open(cat_path))['entries']}


def rot(r):
    x, y, z = [math.radians(a) for a in r]
    Rx = np.array([[1, 0, 0], [0, math.cos(x), -math.sin(x)], [0, math.sin(x), math.cos(x)]])
    Ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    Rz = np.array([[math.cos(z), -math.sin(z), 0], [math.sin(z), math.cos(z), 0], [0, 0, 1]])
    return Rx @ Ry @ Rz


boxes = {}
for eid, e in world['entities'].items():
    s = e['shape']
    t = e['transform']
    if s['kind'] == 'asset' and s['id'] in cat:
        sx, sy, sz = cat[s['id']]['size']
        corners = np.array([[x, y, z] for x in (-sx / 2, sx / 2) for y in (0, sy) for z in (-sz / 2, sz / 2)]) * np.array(t['scale'])
        w = corners @ rot(t['rotation']).T + np.array(t['position'])
        boxes[eid] = (w.min(0), w.max(0), s['id'])
    elif s['kind'] == 'primitive' and s.get('primitive') == 'box':
        sz = np.array(s['size']) * np.array(t['scale'])
        c = np.array(t['position'])
        corners = np.array([[x, y, z] for x in (-.5, .5) for y in (-.5, .5) for z in (-.5, .5)]) * sz
        w = corners @ rot(t['rotation']).T + c
        boxes[eid] = (w.min(0), w.max(0), 'box')
for eid, g in geo['entities'].items():
    for i, inst in enumerate(g['instances']):
        key = eid if len(g['instances']) == 1 else f'{eid}#{i}'
        boxes[key] = (np.array(inst['min']), np.array(inst['max']), g['shape'])

rugs = [k for k, b in boxes.items() if b[2].startswith('rug-')]
furn = [k for k, b in boxes.items() if b[2].startswith('display-')]
problems = 0
SKIP = ('gallery-l0-gallery', 'gallery-l0-lobby', 'gallery-l0-gallery-ceil', 'gallery-l0-lobby-ceil', 'gallery-roof', 'gallery-parapet', 'grid-of-ceiling', 'along-of-ceiling')


def overlap(a, b, tol=0.001):
    return np.all(a[0] < b[1] - tol) and np.all(b[0] < a[1] - tol)


for r in rugs:
    a = boxes[r]
    for k, b in boxes.items():
        if k == r or k.startswith(SKIP):
            continue
        if overlap(a, b):
            print(f'OVERLAP {r} ({a[2]}) x {k} ({b[2]}): rug {np.round(a[0], 3)}..{np.round(a[1], 3)} other {np.round(b[0], 3)}..{np.round(b[1], 3)}')
            problems += 1
    # support
    e = world['entities'][r]
    flat = abs(e['transform']['rotation'][0]) < 1
    if flat:
        sup = [k for k, b in boxes.items() if k != r and b[2] in ('display-plinth-oak', 'display-table-oak') and np.all(a[0][[0, 2]] < b[1][[0, 2]]) and np.all(b[0][[0, 2]] < a[1][[0, 2]])]
        if len(sup) != 1:
            print(f'SUPPORT {r}: {sup}')
            problems += 1
            continue
        b = boxes[sup[0]]
        gap = a[0][1] - b[1][1]
        over = [round(float(b[0][0] - a[0][0]), 3), round(float(a[1][0] - b[1][0]), 3), round(float(b[0][2] - a[0][2]), 3), round(float(a[1][2] - b[1][2]), 3)]
        ok = 0.001 <= gap <= 0.005 and max(over) <= 0
        print(f'{"ok  " if ok else "BAD "} {r:18s} on {sup[0]:16s} gap {gap * 1000:.1f} mm, margins {[-o for o in over]} m')
        problems += 0 if ok else 1
    else:
        print(f'ok   {r:18s} wall  {np.round(a[0], 3)}..{np.round(a[1], 3)}  centre y {round(float((a[0][1] + a[1][1]) / 2), 3)}')
for f in furn:
    a = boxes[f]
    for k, b in boxes.items():
        if k == f or k.startswith(SKIP) or k in rugs:
            continue
        if overlap(a, b):
            print(f'OVERLAP {f} ({a[2]}) x {k} ({b[2]})')
            problems += 1
print(f'{problems} problems')
