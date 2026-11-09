"""The v5 product-demo edit lists (edl5.json about 75 s, edl5-30.json about 30 s) from one table of shots.

  python3 scripts/demo/film/make-edl5.py [<out dir>]

Flow: hook, Describe, Edit, Relight, Publish, Share (a laptop and a phone window on the same player), a quick run of world
kinds, Build locally (Blender), one short animated proof, the end card. Studio takes are 3840x2160 screencasts (film-ui.ts):
"ui" segments pull a designed camera over them (film-cut.py). Camera keys are [output second, x, y, zoom]; at zoom 2 a 14 px
interface label is 28 px on the 1080p frame. Speed ramps are the third number of each part: [in, out, speed].
"""
import json
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
D = '~/.local/share/aether/demo'
F2, F1, UI, UI5 = f'{D}/film2/shots', f'{D}/film/shots', f'{D}/film2/ui', f'{D}/film5/ui'
INTRO = f'{D}/intro/shots'


def ui(name, src, parts, cam, dur, xfade=0.5, frame=0.88, text=None, sfx='click'):
    s = {'name': name, 'src': (f'{D}/raw-live/generate.webm' if src == 'live' else src if src.endswith('.mp4') else f'{UI}/{src}.mp4'), 'mode': 'ui', 'parts': parts, 'cam': cam, 'dur': dur, 'xfade': xfade, 'frame': frame, 'sfx': sfx}
    if text:
        s['text'] = text
    return s


def clip(name, src, i, dur, xfade=0.4, text=None, sfx=None, **kw):
    s = {'name': name, 'src': src, 'in': i, 'dur': dur, 'xfade': xfade, **kw}
    if text is not None:
        s['text'] = text
    if sfx:
        s['sfx'] = sfx
    return s


def devices(name, dur, xfade, text):
    return {'name': name, 'src': f'{UI5}/dev-laptop.mp4', 'mode': 'devices', 'laptop': [f'{UI5}/dev-laptop.mp4', 53.0], 'phone': [f'{UI5}/dev-phone.mp4', 44.0], 'dur': dur, 'xfade': xfade, 'text': text, 'sfx': 'whoosh'}


def arch_segments():
    """The architecture beat: one editor take (a two-storey villa, the ArchBar driven by clicks, the camera orbiting). The take
    was painted at about 7 fps at 4K, so the segments are "smooth" (the painted frames blended to 30 fps) and the waits between the
    clicks are ramped. Camera: whole app, zoom on the bar as the menu opens, zoom on the house for the effect."""
    A = f'{D}/film5/arch-villa/arch.mp4'
    BAR = [0.47, 0.2, 2.3]
    HOUSE = [0.46, 0.5, 1.55]
    segs = [
        ui('a-walls', A, [[88.0, 92.4, 2.0]], [[0, 0.5, 0.5, 1.0], [1.1, 0.5, 0.5, 1.0], [1.9, *BAR], [2.2, *BAR]], 2.2, 0.4, text=[['st-arch', 0.2, 5.4]], sfx='whoosh'),
        ui('a-cut', A, [[92.4, 99.3, 6.0], [99.3, 102.3, 1.8]], [[0, *BAR], [1.0, *BAR], [1.5, *HOUSE], [2.8, *HOUSE]], 2.8, 0.15),
        ui('a-down', A, [[125.5, 127.5, 2.5], [127.5, 131.0, 1.6]], [[0, *BAR], [0.8, *BAR], [1.3, *HOUSE], [3.0, *HOUSE]], 3.0, 0.15, text=[['tag-walls-down', 0.9, 3.0]], sfx=None),
        ui('a-explode', A, [[172.5, 174.5, 2.5], [176.0, 184.0, 2.7]], [[0, *BAR], [0.8, *BAR], [1.3, 0.46, 0.5, 1.3], [3.7, 0.46, 0.5, 1.3]], 3.76, 0.15, text=[['tag-explode', 1.0, 3.6]], sfx=None),
        ui('a-floor', A, [[207.0, 213.0, 3.6]], [[0, 0.46, 0.5, 1.5], [1.6, 0.46, 0.5, 1.5]], 1.67, 0.15, text=[['tag-onefloor', 0.2, 1.7]], sfx=None),
        ui('a-plan', A, [[270.0, 281.0, 3.6]], [[0, 0.45, 0.55, 1.5], [1.8, 0.45, 0.55, 1.5], [2.6, 0.5, 0.5, 1.0], [3.05, 0.5, 0.5, 1.0]], 3.05, 0.15, text=[['tag-plan', 0.3, 2.9]], sfx=None),
    ]
    for g in segs:
        g['smooth'] = True
    return segs


def arch30():
    A = f'{D}/film5/arch-villa/arch.mp4'
    BAR, HOUSE = [0.47, 0.2, 2.3], [0.46, 0.5, 1.55]
    g = ui('a30', A, [[92.0, 99.3, 7.0], [99.3, 101.8, 1.8], [126.5, 127.5, 2.0], [127.5, 130.0, 1.5]],
           [[0, *BAR], [0.9, *BAR], [1.3, *HOUSE], [2.3, *HOUSE], [2.5, *BAR], [3.0, *BAR], [3.4, *HOUSE], [4.6, *HOUSE]], 4.6, 0.3, text=[['st-arch', 0.2, 4.3]], sfx='whoosh')
    g['smooth'] = True
    return g


def full():
    return [
        clip('hook', f'{INTRO}/m-terraces-falls.mp4', 1.8, 5.0, 0, [['hook', 0.4, 4.7]]),
        # 1 Describe: every take opens on the whole app (z 1 = the window fills the frame), zooms to the part that matters, and
        # eases back out. The typed prompt and the built world (offline planner, labelled), then the recorded live AI session
        # shown whole, uncropped
        ui('gen-type', 'describe', [[2.6, 8.6, 1.3]], [[0, 0.5, 0.5, 1.0], [1.2, 0.5, 0.5, 1.0], [2.0, 0.392, 0.23, 2.7], [3.7, 0.392, 0.23, 2.7], [4.5, 0.5, 0.5, 1.0]], 4.6, 0.5, text=[['st-describe', 0.3, 4.4]], sfx='whoosh'),
        ui('gen-build', 'describe', [[8.6, 12.0, 2.0], [12.0, 40.0, 18.0], [40.0, 43.5, 1.0]], [[0, 0.5, 0.5, 1.0], [6.8, 0.5, 0.5, 1.04]], 6.8, 0.25, text=[['note-offline', 0.3, 6.5]]),
        ui('gen-live', 'live', [[9.0, 15.0, 4.0], [15.0, 60.0, 30.0], [60.0, 190.0, 80.0], [190.0, 193.0, 2.5]], [[0, 0.5, 0.5, 1.0]], 4.3, 0.2, 1.0, text=[['note-live', 0.3, 4.6]]),
        # 2 Edit: select and move, swap a material, ask for a change (offline planner), 3 Relight
        ui('e-select', 'edit', [[1.6, 7.6, 1.6]], [[0, 0.5, 0.5, 1.0], [1.3, 0.5, 0.5, 1.0], [2.2, 0.44, 0.5, 1.6], [3.7, 0.5, 0.5, 1.7]], 3.75, 0.6, text=[['st-edit', 0.3, 3.5]], sfx='whoosh'),
        ui('e-material', 'edit', [[13.2, 21.2, 2.5]], [[0, 0.73, 0.64, 1.9], [3.2, 0.73, 0.66, 1.9]], 3.2, 0.3),
        ui('e-chat', 'edit', [[40.0, 44.0, 1.5], [44.0, 49.4, 2.0]], [[0, 0.2, 0.84, 2.1], [2.3, 0.2, 0.84, 2.1], [3.1, 0.25, 0.4, 2.0], [4.5, 0.25, 0.4, 2.0], [5.4, 0.5, 0.5, 1.0]], 5.4, 0.3, text=[['note-offline', 0.3, 5.0]]),
        ui('e-time', 'edit', [[26.4, 39.6, 2.4]], [[0, 0.78, 0.3, 2.0], [3.6, 0.78, 0.3, 2.0], [4.4, 0.5, 0.5, 1.0], [5.5, 0.5, 0.5, 1.0]], 5.5, 0.4, text=[['st-relight', 0.3, 5.2]], sfx='whoosh'),
        clip('sw-1', f'{F2}/sweep-penthouse.mp4', 0.4, 3.2, 0.6, [['tag-relight', 0.4, 3.0]]),
        *arch_segments(),
        # 4 Publish, 5 Share
        ui('p-hub', 'publish', [[5.4, 22.0, 2.6]], [[0, 0.5, 0.5, 1.0], [1.3, 0.5, 0.5, 1.0], [2.2, 0.8, 0.3, 2.1], [3.6, 0.8, 0.3, 2.1], [4.2, 0.8, 0.68, 2.1], [5.5, 0.8, 0.68, 2.1], [6.3, 0.5, 0.5, 1.0]], 6.38, 0.5, text=[['st-publish', 0.3, 3.4], ['note-nothing', 3.7, 5.3]], sfx='whoosh'),
        devices('devices', 6.2, 0.6, [['st-share', 0.4, 5.8], ['dev', 0.4, 5.8]]),
        # any kind of world: one or two seconds each, labelled with its kind
        clip('k-house', f'{F1}/casa-pool.mp4', 1.0, 2.2, 0.5, [['tag-house', 0.2, 2.0]], 'whoosh'),
        clip('k-city', f'{F1}/lisbon-drone.mp4', 1.0, 2.0, 0.2, [['tag-city', 0.2, 1.8]]),
        ui('k-game', 'play', [[1.0, 3.0, 1.0]], [[0, 0.5, 0.5, 1.0]], 2.0, 0.2, 1.0, [['tag-game', 0.2, 1.8]], sfx=None),
        clip('k-space', f'{F1}/kepler-domes.mp4', 0.8, 2.0, 0.2, [['tag-space', 0.2, 1.8]]),
        # build locally: a character from a brief, then in the world
        {'name': 'bl-sheet', 'src': f'{D}/film2/tt-mio/f%04d.png', 'mode': 'turntable', 'beside': f'{D}/film2/mio/sheet.png', 'dur': 4.8, 'speed': 1.1, 'xfade': 0.5, 'text': [['st-local', 0.3, 4.5], ['note-local', 0.3, 4.5]], 'sfx': 'whoosh'},
        # one short animated proof
        clip('film', f'{F2}/cw-open.mp4', 0.5, 5.5, 0.5, [['tag-film', 0.3, 5.2]], 'whoosh'),
        {'name': 'end', 'src': f'{D}/film5/cards/end.png', 'mode': 'image', 'dur': 5.0, 'xfade': 0.8, 'grade': False},
    ]


def short():
    return [
        clip('hook', f'{INTRO}/m-terraces-falls.mp4', 1.8, 3.0, 0, [['hook', 0.3, 2.8]]),
        ui('gen-type', 'describe', [[3.3, 8.6, 2.0]], [[0, 0.5, 0.5, 1.0], [0.5, 0.5, 0.5, 1.0], [1.2, 0.392, 0.23, 2.7]], 2.65, 0.4, text=[['st-describe', 0.2, 2.5]], sfx='whoosh'),
        ui('gen-build', 'describe', [[8.6, 11.0, 2.0], [11.0, 40.0, 24.0], [40.0, 41.5, 1.0]], [[0, 0.5, 0.5, 1.0], [3.9, 0.5, 0.5, 1.04]], 3.9, 0.25, text=[['note-offline', 0.2, 4.1]]),
        ui('e-material', 'edit', [[13.2, 21.2, 3.0]], [[0, 0.73, 0.64, 1.9], [2.7, 0.73, 0.66, 1.9]], 2.67, 0.4, text=[['st-edit', 0.2, 2.5]], sfx='whoosh'),
        ui('e-time', 'edit', [[26.4, 39.6, 3.2]], [[0, 0.78, 0.3, 2.0], [3.0, 0.78, 0.3, 2.0], [4.1, 0.5, 0.5, 1.0]], 4.13, 0.4, text=[['st-relight', 0.2, 4.0]], sfx='whoosh'),
        arch30(),
        ui('p-hub', 'publish', [[8.8, 19.6, 3.4]], [[0, 0.5, 0.5, 1.0], [0.6, 0.5, 0.5, 1.0], [1.2, 0.8, 0.3, 2.1], [1.9, 0.8, 0.3, 2.1], [2.3, 0.8, 0.68, 2.1], [3.2, 0.8, 0.68, 2.1]], 3.18, 0.4, text=[['st-publish', 0.2, 3.0]], sfx='whoosh'),
        devices('devices', 3.6, 0.5, [['st-share', 0.3, 3.3], ['dev', 0.3, 3.3]]),
        clip('k-city', f'{F1}/lisbon-drone.mp4', 1.0, 1.5, 0.3, [['tag-city', 0.15, 1.4]], 'whoosh'),
        ui('k-game', 'play', [[1.0, 2.5, 1.0]], [[0, 0.5, 0.5, 1.0]], 1.5, 0.15, 1.0, [['tag-game', 0.15, 1.4]], sfx=None),
        clip('film', f'{F2}/cw-open.mp4', 0.5, 2.6, 0.3, [['tag-film', 0.2, 2.4]]),
        {'name': 'end', 'src': f'{D}/film5/cards/end.png', 'mode': 'image', 'dur': 3.0, 'xfade': 0.6, 'grade': False},
    ]


for name, segs in (('edl5.json', full()), ('edl5-30.json', short())):
    xf = [0.0] + [float(s.get('xfade', 0.6)) for s in segs[1:]]
    total = sum(float(s['dur']) for s in segs) - sum(xf)
    json.dump({'fps': 30, 'score': f'{D}/film5/' + name.replace('.json', '.wav'), 'scoreGain': 0.9, 'duck': [], 'cards': f'{D}/film5/cards', 'segments': segs}, open(os.path.join(OUT, name), 'w'), indent=1)
    print(name, round(total, 1), 's')
