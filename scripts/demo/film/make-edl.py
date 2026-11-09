"""The v3 edit decision lists (edl.json, edl-60.json) written from one table of shots, so the two cuts share their cameras.

  python3 scripts/demo/film/make-edl.py [<out dir>]

Studio takes are 3840x2160 screencasts (film-ui.ts): the "ui" segments pull a designed camera over them (see film-cut.py).
Camera keys are [output second, x, y, zoom]: x and y in the studio window's own 0..1 coordinates, zoom 1 = the window fills the
frame, below 1 = the whole window floating on its backdrop. At zoom 2 a 14 px interface label is 28 px on the 1080p frame.
"""
import json
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
D = '~/.local/share/aether/demo'
F2, F1, UI = f'{D}/film2/shots', f'{D}/film/shots', f'{D}/film2/ui'
INTRO = f'{D}/intro/shots'


def ui(name, src, parts, cam, dur, xfade=0.5, frame=0.88, text=None):
    s = {'name': name, 'src': (f'{D}/raw-live/generate.webm' if src == 'live' else f'{UI}/{src}.mp4'), 'mode': 'ui', 'parts': parts, 'cam': cam, 'dur': dur, 'xfade': xfade, 'frame': frame}
    if text:
        s['text'] = text
    return s


def clip(name, src, i, dur, xfade=0.6, text=None, **kw):
    s = {'name': name, 'src': src, 'in': i, 'dur': dur, 'xfade': xfade, **kw}
    if text is not None:
        s['text'] = text
    return s


def full():
    return [
        clip('cold-cw', f'{F2}/cw-open.mp4', 0, 9.5, xfade=0.6),
        clip('cold-terraces', f'{INTRO}/m-terraces-falls.mp4', 1.8, 5.5, xfade=0.2),
        # Describe: a fresh 4K take of the prompt typed and built by the offline planner (labelled), then the recorded live AI
        # session (1280x720: never faked, shown cropped in on the prompt, the build log and the result)
        # Describe v4: the 4K offline-planner take, every frame a whole composition (the prompt box centred and complete, then the
        # whole studio window), then the recorded 1280x720 live session at 1.2x on a dark plate: no zoom past its native sharpness
        ui('gen-type', 'describe', [[3.3, 8.6, 1.0]], [[0, 0.5, 0.5, 0.92], [0.4, 0.5, 0.5, 0.92], [1.9, 0.392, 0.23, 2.7]], 5.3, 0.25, text=[['ch-describe', 0.5, 3.6]]),
        ui('gen-build', 'describe', [[8.6, 12.0, 2.0], [12.0, 40.0, 12.0], [40.0, 45.0, 1.0]], [[0, 0.5, 0.5, 0.95], [9.03, 0.5, 0.5, 1.05]], 9.03, 0.2, text=[['note-offline', 0.4, 8.6]]),
        ui('gen-live', 'live', [[6.0, 15.0, 2.2], [15.0, 60.0, 18.0], [60.0, 190.0, 45.0], [190.0, 200.0, 5.0]], [[0, 0.5, 0.5, 0.8], [11.5, 0.5, 0.5, 0.84]], 11.49, 0.12, 0.8, text=[['note-live', 0.4, 11.0]]),
        clip('m-lisbon', f'{F1}/lisbon-quay.mp4', 0.5, 4.6, 0.12, [['ch-worlds', 0.6, 2.8], ['lt-lisbon', 3.0, 4.3]]),
        clip('m-lisbon2', f'{F1}/lisbon-drone.mp4', 1, 3.6, 0.3),
        clip('m-kepler', f'{F1}/kepler-domes.mp4', 0.5, 4.6, 0.25, [['lt-kepler', 0.6, 4.0]]),
        clip('m-falls', f'{INTRO}/m-falls.mp4', 1, 4.4, 0.6, [['lt-sanctuary', 0.6, 3.8]]),
        clip('m-highland', f'{F1}/highland-dawn.mp4', 1, 4.4, 0.6, [['lt-highland', 0.6, 3.8]]),
        # Edit: the sofa and its gizmo, a material swatch, the chat and its answer, the time-of-day slider
        ui('e-select', 'edit', [[1.6, 13.6, 1.5]], [[0, 0.42, 0.5, 1.5], [3.0, 0.45, 0.48, 1.7], [8.0, 0.5, 0.5, 1.7]], 8.0, 0.8, text=[['ch-edit', 0.5, 3.6]]),
        ui('e-material', 'edit', [[13.2, 24.6, 1.6]], [[0, 0.73, 0.64, 1.9], [7.1, 0.73, 0.66, 1.9]], 7.1, 0.5),
        ui('e-chat', 'edit', [[40.0, 44.0, 1.0], [44.0, 49.4, 1.0]], [[0, 0.2, 0.84, 2.1], [3.6, 0.2, 0.84, 2.1], [4.6, 0.25, 0.4, 2.0], [8.0, 0.25, 0.4, 2.0], [9.4, 0.5, 0.5, 1.0]], 9.4, 0.5, text=[['note-offline', 0.4, 9.0]]),
        ui('e-time', 'edit', [[26.4, 39.6, 1.9]], [[0, 0.78, 0.3, 2.0], [4.4, 0.78, 0.3, 2.0], [5.8, 0.5, 0.5, 1.0]], 6.9, 0.5),
        clip('sw-1', f'{F2}/sweep-penthouse.mp4', 0.4, 4.2, 0.8, [['lt-relight', 0.6, 11.0]]),
        clip('sw-2', f'{F2}/sweep-penthouse.mp4', 10.4, 3.8, 1.6),
        clip('sw-3', f'{F2}/sweep-penthouse.mp4', 15.5, 4.2, 1.6),
        # Publish: the hub's quality pass, the replay seal and the link, then the published world
        ui('p-hub', 'publish', [[6.0, 22.0, 1.45]], [[0, 0.5, 0.5, 0.9], [1.3, 0.5, 0.5, 0.9], [2.5, 0.8, 0.3, 2.1], [4.8, 0.8, 0.3, 2.1], [5.8, 0.8, 0.68, 2.1], [10.8, 0.8, 0.68, 2.1]], 11.0, 0.8, text=[['ch-publish', 0.5, 3.6], ['lt-pub-note', 5.5, 10.4]]),
        ui('p-player', 'publish', [[70.2, 73.8, 1.0]], [[0, 0.5, 0.5, 1.0]], 3.6, 0.8, 1.0),
        ui('p-time', 'publish', [[86.2, 97.0, 2.4]], [[0, 0.5, 0.5, 1.0], [0.8, 0.5, 0.8, 2.3], [3.4, 0.5, 0.8, 2.3], [4.2, 0.5, 0.5, 1.0]], 4.5, 0.5, 1.0),
        ui('p-doll', 'publish', [[104.6, 108.6, 1.0]], [[0, 0.5, 0.5, 1.0]], 4.0, 0.5, 1.0),
        ui('p-city', 'modes', [[68.0, 75.6, 1.7]], [[0, 0.5, 0.5, 1.0]], 4.5, 0.6, 1.0),
        ui('play-hike', 'play', [[0.4, 4.6, 1.0]], [[0, 0.5, 0.5, 1.0]], 4.2, 0.7, 1.0, [['ch-play', 0.6, 3.6]]),
        clip('play-outpost', f'{INTRO}/outpost.mp4', 3, 4.6, 0.5),
        {'name': 'bl-sheet', 'src': f'{D}/film2/tt-mio/f%04d.png', 'mode': 'turntable', 'beside': f'{D}/film2/mio/sheet.png', 'dur': 8.2, 'speed': 1.1, 'xfade': 0.9, 'text': [['ch-blender', 0.6, 3.6], ['note-local', 0.6, 7.6], ['lt-sheet', 4.0, 7.6]]},
        {'name': 'bl-kit', 'src': f'{D}/film/orbit-shop/f%04d.png', 'mode': 'frames', 'dur': 6.0, 'push': [1.0, 1.03], 'xfade': 0.9, 'text': [['lt-kit', 0.5, 5.5]]},
        clip('bl-walk', f'{F2}/mio-walk.mp4', 0.5, 5.2, 0.8, [['lt-inworld', 0.5, 4.5]]),
        clip('bl-shop', f'{F2}/cw-shop.mp4', 0, 5.0, 1.0),
        clip('film-a', f'{F2}/two-whistles.mp4', 0.2, 6, 1.2, [['ch-film', 0.8, 4.4]], audio=1.0),
        clip('film-b', f'{F2}/two-whistles.mp4', 36.4, 16.2, 0.8, [['lt-film', 10.5, 15.2]], audio=1.0),
        clip('close', f'{F2}/cw-close.mp4', 0, 10.5, 1.4, [['title', 4.8, 10.5]]),
    ]


def short():
    return [
        clip('cold-cw-60', f'{F2}/cw-open.mp4', 0, 5.2, xfade=0.6),
        ui('gen-type-60', 'describe', [[3.5, 8.6, 1.4]], [[0, 0.5, 0.5, 0.92], [0.3, 0.5, 0.5, 0.92], [1.4, 0.392, 0.23, 2.7]], 3.64, 0.25, text=[['ch-describe', 0.4, 3.0]]),
        ui('gen-build-60', 'describe', [[8.6, 12.0, 3.0], [12.0, 40.0, 20.0], [40.0, 43.0, 1.0]], [[0, 0.5, 0.5, 0.95], [5.5, 0.5, 0.5, 1.05]], 5.53, 0.3, text=[['note-offline', 0.3, 5.2]]),
        clip('m-lisbon-60', f'{F1}/lisbon-quay.mp4', 0.5, 3.0, 0.4, [['lt-lisbon', 0.5, 2.8]]),
        clip('m-kepler-60', f'{F1}/kepler-domes.mp4', 0.5, 2.8, 0.25, [['lt-kepler', 0.5, 2.6]]),
        ui('e-select-60', 'edit', [[3.0, 9.0, 1.6]], [[0, 0.45, 0.5, 1.6], [3.5, 0.48, 0.5, 1.8]], 3.5, 0.5, text=[['ch-edit', 0.4, 3.2]]),
        ui('e-material-60', 'edit', [[14.0, 21.2, 2.0]], [[0, 0.73, 0.64, 1.9], [3.6, 0.73, 0.66, 1.9]], 3.6, 0.4),
        ui('e-chat-60', 'edit', [[44.0, 48.2, 1.0]], [[0, 0.25, 0.4, 2.0], [2.8, 0.25, 0.4, 2.0], [4.2, 0.5, 0.5, 1.0]], 4.2, 0.4, text=[['note-offline', 0.3, 4.0]]),
        clip('sw-1-60', f'{F2}/sweep-penthouse.mp4', 0.4, 2.8, 0.6, [['lt-relight', 0.4, 6.2]]),
        clip('sw-3-60', f'{F2}/sweep-penthouse.mp4', 15.5, 3.2, 1.3),
        ui('p-hub-60', 'publish', [[8.8, 19.6, 2.1]], [[0, 0.8, 0.3, 2.1], [1.5, 0.8, 0.3, 2.1], [2.2, 0.8, 0.68, 2.1], [5.2, 0.8, 0.68, 2.1]], 5.2, 0.5, text=[['ch-publish', 0.4, 3.2]]),
        ui('p-doll-60', 'publish', [[104.6, 107.6, 1.0]], [[0, 0.5, 0.5, 1.0]], 3.0, 0.5, 1.0),
        clip('play-outpost-60', f'{INTRO}/outpost.mp4', 3, 3.2, 0.6, [['ch-play', 0.4, 3.0]]),
        {'name': 'bl-sheet-60', 'src': f'{D}/film2/tt-mio/f%04d.png', 'mode': 'turntable', 'beside': f'{D}/film2/mio/sheet.png', 'dur': 4.6, 'speed': 1.1, 'xfade': 0.7, 'text': [['ch-blender', 0.5, 3.4], ['note-local', 0.5, 4.6]]},
        clip('bl-walk-60', f'{F2}/mio-walk.mp4', 0.5, 3.4, 0.7),
        clip('film-b-60', f'{F2}/two-whistles.mp4', 36.4, 6.6, 0.7, [['lt-film', 2.8, 6.2]], audio=1.0),
        clip('close-60', f'{F2}/cw-close.mp4', 0, 6.0, 0.7, [['title', 2.5, 6.0]]),
    ]


def build(segs, score, gain, duck_names):
    xf = [0.0] + [float(s.get('xfade', 0.6)) for s in segs[1:]]
    t, starts = 0.0, {}
    for i, s in enumerate(segs):
        t -= xf[i]
        starts[s['name']] = t
        t += float(s['dur'])
    a, b = duck_names
    duck = [[round(starts[a] - 0.4, 2), round(starts[b] + 0.5, 2), 0.0]]
    return {'fps': 30, 'score': score, 'scoreGain': gain, 'duck': duck, 'cards': f'{D}/film2/cards', 'segments': segs}, t


for name, segs, score, ducks in (('edl.json', full(), f'{F1}/score.wav', ('film-a', 'close')), ('edl-60.json', short(), f'{F1}/score-60.wav', ('film-b-60', 'close-60'))):
    e, total = build(segs, score, 0.85, ducks)
    json.dump(e, open(os.path.join(OUT, name), 'w'), indent=1)
    print(name, round(total, 1), 's')
