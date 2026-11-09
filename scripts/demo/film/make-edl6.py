"""The v6 product-demo edit list (about 2:55) from one table of shots.

  python3 scripts/demo/film/make-edl6.py [<out dir>]

Chapters: hook, Describe (typed prompt, three build replays rendered frame by frame, the recorded live session), Edit and
Relight, a capability montage (two mosaics of what else the editor does), Architecture (a frame-by-frame render of the
wall, storey and floor modes, then the plan in the studio), Publish and Share (the hub, the link opened on the live site on
a laptop and a phone), Any kind of world (the live Featured section, then drone and walk shots), Build locally (Blender), the
animated short as a chapter of its own, the end card. See docs/demo/PRODUCT-DEMO-PLAN.md.
"""
import json
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
D = os.path.expanduser('~/.local/share/aether/demo')
F6 = f'{D}/film6'
F2, F1, UI2, INTRO = f'{D}/film2/shots', f'{D}/film/shots', f'{D}/film2/ui', f'{D}/intro/shots'


def ev(take, what):
    """Seconds (on the take's mp4) of the first event whose text starts with `what`."""
    j = json.load(open(f'{F6}/{take}/{take}.json'))
    for e in j['events']:
        if e['what'].startswith(what):
            return e['t'] / 1000.0
    raise SystemExit(f'{take}: no event {what}')


def ui(name, src, parts, cam, dur, xfade=0.4, frame=0.88, text=None, sfx='click', inset='tl', smooth=False):
    s = {'name': name, 'src': (f'{D}/raw-live/generate.webm' if src == 'live' else src if src.endswith('.mp4') else f'{UI2}/{src}.mp4'), 'mode': 'ui', 'parts': parts, 'cam': cam, 'dur': dur, 'xfade': xfade, 'frame': frame, 'sfx': sfx, 'insetPos': inset}
    if text:
        s['text'] = text
    if smooth:
        s['smooth'] = True
    return s


def clip(name, src, i, dur, xfade=0.4, text=None, sfx=None, **kw):
    s = {'name': name, 'src': src, 'in': i, 'dur': dur, 'xfade': xfade, **kw}
    if text is not None:
        s['text'] = text
    if sfx:
        s['sfx'] = sfx
    return s


def frames(name, pattern, start, dur, xfade=0.3, text=None, sfx=None, speed=1.0):
    s = {'name': name, 'src': pattern, 'mode': 'frames', 'in': start, 'dur': dur, 'speed': speed, 'xfade': xfade, 'grade': False}
    if text:
        s['text'] = text
    if sfx:
        s['sfx'] = sfx
    return s


def mosaic(name, tiles, dur, xfade=0.4, text=None, grid=(3, 2), sfx='whoosh'):
    s = {'name': name, 'src': tiles[0]['src'], 'mode': 'mosaic', 'grid': list(grid), 'tiles': tiles, 'dur': dur, 'xfade': xfade, 'sfx': sfx}
    if text:
        s['text'] = text
    return s


def have(p):
    return os.path.exists(os.path.expanduser(p))


def anime(name, a, b, xfade=0.25, text=None, gain=1.0):
    s = {'name': name, 'src': f'{F6}/shots/two-whistles.mp4', 'mode': 'full', 'in': a, 'dur': round(b - a, 3), 'xfade': xfade, 'audio': gain, 'grade': False}
    if text:
        s['text'] = text
    return s


def segments():
    S = []
    # hook
    S.append(clip('hook', f'{INTRO}/m-terraces-falls.mp4', 1.8, 6.0, 0, [['hook', 0.4, 5.6]]))
    # 1 Describe: typed prompt (offline planner), three real builds replayed frame by frame, the recorded live session
    S.append(ui('gen-type', 'describe', [[2.6, 9.2, 1.3]], [[0, 0.5, 0.5, 1.0], [1.2, 0.5, 0.5, 1.0], [2.0, 0.5, 0.3, 1.65], [4.2, 0.5, 0.3, 1.65], [5.0, 0.5, 0.5, 1.0]], 5.1, 0.5, text=[['st-describe', 0.3, 4.9], ['note-offline', 0.3, 4.9]], sfx='whoosh', inset='br', smooth=True))
    if have(f'{F6}/build-villa/f00000.jpg'):
        S.append(frames('r-villa', f'{F6}/build-villa/f%05d.jpg', 4, 4.0, 0.4, [['tag-replay1', 0.2, 3.7], ['note-replay', 0.2, 3.7]], 'whoosh'))
    if have(f'{F6}/build-village/f00000.jpg'):
        S.append(frames('r-village', f'{F6}/build-village/f%05d.jpg', 10, 4.6, 0.3, [['tag-replay3', 0.2, 4.3], ['note-replay', 0.2, 4.3]], speed=0.7))
    if have(f'{F6}/build-land/f00000.jpg'):
        S.append(frames('r-land', f'{F6}/build-land/f%05d.jpg', 14, 3.4, 0.3, [['tag-replay2', 0.2, 3.1], ['note-replay', 0.2, 3.1]], speed=0.8))
    # 2 Edit, 3 Relight
    S.append(ui('e-select', 'edit', [[1.6, 7.6, 1.6]], [[0, 0.5, 0.5, 1.0], [1.3, 0.5, 0.5, 1.0], [2.2, 0.44, 0.5, 1.6], [3.7, 0.5, 0.5, 1.7]], 3.75, 0.5, text=[['st-edit', 0.3, 3.5]], sfx='whoosh', smooth=True))
    S.append(ui('e-material', 'edit', [[13.2, 21.2, 2.5]], [[0, 0.73, 0.64, 1.9], [3.2, 0.73, 0.66, 1.9]], 3.2, 0.3, smooth=True))
    S.append(ui('e-chat', 'edit', [[40.0, 44.0, 1.5], [44.0, 49.4, 2.0]], [[0, 0.2, 0.84, 2.1], [2.3, 0.2, 0.84, 2.1], [3.1, 0.25, 0.4, 2.0], [4.5, 0.25, 0.4, 2.0], [5.4, 0.5, 0.5, 1.0]], 5.4, 0.3, text=[['note-offline', 0.3, 5.0]], inset='br', smooth=True))
    S.append(ui('e-time', 'edit', [[26.4, 39.6, 2.4]], [[0, 0.78, 0.3, 2.0], [3.6, 0.78, 0.3, 2.0], [4.4, 0.5, 0.5, 1.0], [5.5, 0.5, 0.5, 1.0]], 5.5, 0.4, text=[['st-relight', 0.3, 5.2]], sfx='whoosh', smooth=True))
    S.append(clip('sw-1', f'{F2}/sweep-penthouse.mp4', 0.4, 3.2, 0.6, [['tag-relight', 0.4, 3.0]]))
    # capability montage: what else the editor does, two mosaics of real captures
    if have(f'{F6}/tour-game/tour-game.mp4'):
        G = f'{F6}/tour-game/tour-game.mp4'
        L = f'{F6}/tour-land/tour-land.mp4'
        gl, gc, gp, gg, gy = ev('tour-game', 'logic'), ev('tour-game', 'checks'), ev('tour-game', 'playability'), ev('tour-game', 'gizmos'), ev('tour-game', 'play')
        t1 = [
            {'src': G, 'in': gl + 1.5, 'label': 'Rules', 'crop': [0.0, 0.04, 0.45, 0.45], 'at': 0.0},
            {'src': G, 'in': gc + 6.0, 'label': 'Checks', 'crop': [0.0, 0.04, 0.45, 0.45], 'at': 0.35},
            {'src': G, 'in': gp + 10.0, 'label': 'A bot plays it', 'crop': [0.2, 0.0, 0.6, 0.6], 'at': 0.7},
            {'src': G, 'in': gg + 4.0, 'label': 'Move, rotate, scale', 'crop': [0.2, 0.2, 0.55, 0.55], 'at': 1.05},
            {'src': G, 'in': gy + 1.0, 'label': 'Play it', 'at': 1.4},
        ]
        if have(L):
            t1.append({'src': L, 'in': ev('tour-land', 'sculpt') + 1.5, 'label': 'Sculpt terrain', 'at': 1.75})
        else:
            t1.append({'src': G, 'in': ev('tour-game', 'objects') + 1.0, 'label': 'Outliner', 'crop': [0.0, 0.04, 0.45, 0.45], 'at': 1.75})
        for t_ in t1:
            t_['smooth'] = True
        S.append(mosaic('m1', t1, 9.0, 0.5))
    if have(f'{F6}/tour-publish/tour-publish.mp4'):
        P = f'{F6}/tour-publish/tour-publish.mp4'
        t2 = [
            {'src': P, 'in': ev('tour-publish', 'hub-render') + 1.5, 'label': 'Render a still', 'crop': [0.62, 0.03, 0.38, 0.38], 'at': 0.0},
            {'src': P, 'in': ev('tour-publish', 'hub-video') + 1.5, 'label': 'Make a video', 'crop': [0.62, 0.03, 0.38, 0.38], 'at': 0.35},
            {'src': P, 'in': ev('tour-publish', 'hub-model') + 1.5, 'label': 'Export a 3D model', 'crop': [0.62, 0.03, 0.38, 0.38], 'at': 0.7},
            {'src': P, 'in': ev('tour-publish', 'hub-plan') + 1.5, 'label': 'Floor plans', 'crop': [0.62, 0.03, 0.38, 0.38], 'at': 1.05},
            {'src': P, 'in': ev('tour-publish', 'hub-game') + 1.5, 'label': 'A game you can host', 'crop': [0.62, 0.03, 0.38, 0.38], 'at': 1.4},
            {'src': P, 'in': ev('tour-publish', 'palette') + 2.0, 'label': 'Command palette', 'crop': [0.28, 0.02, 0.5, 0.5], 'at': 1.75},
        ]
        for t_ in t2:
            t_['smooth'] = True
        S.append(mosaic('m2', t2, 8.0, 0.4))
    # 4 Architecture
    if have(f'{F6}/arch-step2/f00000.jpg'):
        n = len([f for f in os.listdir(f'{F6}/arch-step2') if f.endswith('.jpg')])
        S.append(frames('a-step', f'{F6}/arch-step2/f%05d.jpg', 0, round(n / 30 / 1.15, 2), 0.5, [['st-arch', 0.3, 5.2], ['tag-walls-down', 6.0, 9.2], ['tag-explode', 9.6, 12.8], ['tag-onefloor', 13.2, 15.4]], 'whoosh', speed=1.15))
    A = f'{F6}/arch/arch.mp4'
    if have(A):
        S.append(ui('a-bar', A, [[ev('arch', 'cutaway') + 14.0, ev('arch', 'cutaway') + 18.0, 1.0]], [[0, 0.5, 0.5, 1.0], [0.5, 0.47, 0.2, 2.3], [3.0, 0.47, 0.2, 2.3]], 3.0, 0.4, smooth=True))
        S.append(ui('a-plan', A, [[322.0, 328.5, 1.0]], [[0, 0.5, 0.5, 1.0], [1.2, 0.5, 0.5, 1.0], [2.2, 0.42, 0.55, 1.7], [4.4, 0.42, 0.55, 1.7], [5.2, 0.5, 0.5, 1.0]], 5.0, 0.4, text=[['tag-plan', 0.3, 4.6]], smooth=True))
    # 5 Publish, 6 Share
    PU = f'{F6}/publish/publish.mp4'
    if have(PU):
        S.append(ui('p-hub', PU, [[ev('publish', 'seal checks') - 3.0, ev('publish', 'seal checks') + 8.0, 2.0]], [[0, 0.5, 0.5, 1.0], [1.0, 0.5, 0.5, 1.0], [1.8, 0.8, 0.3, 2.1], [3.2, 0.8, 0.3, 2.1], [3.8, 0.8, 0.68, 2.1], [5.0, 0.8, 0.68, 2.1], [5.6, 0.5, 0.5, 1.0]], 5.7, 0.5, text=[['st-publish', 0.3, 3.4], ['note-nothing', 3.7, 5.4]], sfx='whoosh', smooth=True))
    if have(f'{F6}/devices/dev-laptop.mp4'):
        u = 'aether-studio-lyart.vercel.app/play#w=D7L3Zki…'
        dv = lambda name, lt, pt, dur, xf, text, sfx: {'name': name, 'src': f'{F6}/devices/dev-laptop.mp4', 'mode': 'devices', 'laptop': [f'{F6}/devices/dev-laptop.mp4', lt], 'phone': [f'{F6}/devices/dev-phone.mp4', pt], 'url': u, 'dur': dur, 'xfade': xf, 'text': text, 'sfx': sfx}
        S.append(dv('devices', 121.6, 87.6, 3.2, 0.5, [['st-share', 0.4, 5.4], ['dev', 0.4, 5.4], ['note-live-site', 0.4, 5.4]], 'whoosh'))
        S.append(dv('devices2', 131.2, 97.0, 2.2, 0.2, [], None))
    # any kind of world: the live Featured section, then drone and walk shots
    if have(f'{F6}/livehome/livehome.mp4'):
        S.append({'name': 'featured', 'src': f'{F6}/livehome/livehome.mp4', 'mode': 'browser', 'url': 'aether-studio-lyart.vercel.app', 'in': ev('livehome', 'featured') + 1.0, 'dur': 5.0, 'xfade': 0.5, 'text': [['st-worlds', 0.3, 4.7], ['tag-feat', 0.3, 4.7]], 'sfx': 'whoosh'})
    S.append(clip('k-drone', f'{F1}/lisbon-drone.mp4', 0.5, 6.0, 0.5, [['tag-drone', 0.2, 5.6]], 'whoosh'))
    S.append(clip('k-falls', f'{INTRO}/m-terraces-falls.mp4', 9.0, 6.0, 0.5, [['tag-land', 0.2, 5.6]]))
    S.append(clip('k-ascent', f'{INTRO}/m-ascent.mp4', 1.0, 5.0, 0.5, [['tag-ascent', 0.2, 4.6]]))
    S.append(clip('k-colony', f'{F1}/kepler-domes.mp4', 0.5, 3.8, 0.4, [['tag-colony', 0.2, 3.5]]))
    S.append(clip('k-isles', f'{INTRO}/m-lantern.mp4', 2.0, 3.8, 0.4, [['tag-isles', 0.2, 3.5]]))
    S.append(clip('k-house', f'{F1}/casa-pool.mp4', 1.0, 3.4, 0.4, [['tag-walk', 0.2, 3.1]]))
    S.append(clip('k-highland', f'{F1}/highland-dawn.mp4', 1.0, 4.0, 0.4, [['tag-land', 0.2, 3.7]]))
    S.append(clip('k-village', f'{INTRO}/m-linden.mp4', 3.0, 4.0, 0.4))
    S.append(ui('k-game', 'play', [[1.0, 4.5, 1.0]], [[0, 0.5, 0.5, 1.0]], 3.5, 0.3, 1.0, [['tag-game', 0.2, 3.2]], sfx=None))
    S.append(clip('k-quay', f'{F1}/lisbon-quay.mp4', 0.5, 4.0, 0.4, [['tag-walk', 0.2, 3.7]]))
    # build locally: a character from a brief (sheet, Blender turntable), then a house, then in the world
    S.append({'name': 'bl-sheet', 'src': f'{D}/film2/tt-mio/f%04d.png', 'mode': 'turntable', 'beside': f'{D}/film2/mio/sheet.png', 'dur': 4.8, 'speed': 1.1, 'xfade': 0.5, 'text': [['st-local', 0.3, 4.5], ['note-local', 0.3, 4.5]], 'sfx': 'whoosh'})
    S.append({'name': 'bl-kit', 'src': f'{D}/film/orbit-shop/f%04d.png', 'mode': 'frames', 'dur': 3.0, 'xfade': 0.4, 'text': [['tag-blhouse', 0.2, 2.8], ['note-local', 0.2, 2.8]]})
    # the animated short: a chapter, with the film's own sound
    if have(f'{F6}/shots/two-whistles.mp4'):
        S += [
            anime('f-lookout', 0.5, 5.5, 0.6, [['st-film', 0.4, 4.6]]),
            anime('f-title', 17.4, 21.4, 0.3),
            anime('f-train', 28.2, 31.5),
            anime('f-run', 32.3, 36.3, text=[['tag-film', 0.3, 3.7]]),
            anime('f-cross', 36.8, 40.8),
            anime('f-whistle', 41.8, 45.4),
            anime('f-viaduct', 56.8, 60.3),
            anime('f-path', 61.2, 64.2),
            anime('f-town', 68.0, 70.4),
            anime('f-end', 87.0, 92.5),
        ]
    S.append({'name': 'end', 'src': f'{F6}/cards/end.png', 'mode': 'image', 'dur': 5.0, 'xfade': 0.8, 'grade': False})
    return S


segs = segments()
xf = [0.0] + [float(s.get('xfade', 0.6)) for s in segs[1:]]
total = sum(float(s['dur']) for s in segs) - sum(xf)
duck = []
t = 0.0
for s, x in zip(segs, xf):
    t -= x
    if s.get('audio'):
        duck.append([round(t + 0.1, 2), round(t + float(s['dur']) - 0.1, 2), 0.22])
    t += float(s['dur'])
merged = []
for d in duck:
    if merged and d[0] - merged[-1][1] < 1.0:
        merged[-1][1] = d[1]
    else:
        merged.append(d)
duck = merged
json.dump({'fps': 30, 'score': f'{F6}/edl6.wav', 'scoreGain': 0.9, 'duck': duck, 'cards': f'{F6}/cards', 'fonts': f'{F6}/fonts', 'segments': segs}, open(os.path.join(OUT, 'edl6.json'), 'w'), indent=1)
print('edl6.json', round(total, 1), 's', len(segs), 'segments')
