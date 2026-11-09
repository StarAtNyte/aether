"""The v7 product-demo edit lists (about 2:56 main cut, about 1:00 short cut) from one table of shots.

  python3 scripts/demo/film/make-edl7.py [<out dir>]

v7 changes against v6: no long dissolves between busy scenes (hard cuts, or dissolves of at most six frames), the capability
montage is three 2x2 mosaics of large tiles, the typed prompt is exactly the prompt of the first build replay, the studio takes
are re-recorded without blending, the architecture render is clear weather with no fog, and the Build locally chapter has a named
slot for the photoreal Blender shot (BLENDER_REAL below: when that file exists it replaces the turntable placeholder).
"""
import json
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
D = os.path.expanduser('~/.local/share/aether/demo')
F6, F7 = f'{D}/film6', f'{D}/film7'
F2, F1, INTRO = f'{D}/film2/shots', f'{D}/film/shots', f'{D}/intro/shots'
# The photoreal Blender shot (1080p, 24 fps, 10 to 15 s) another job renders: swap by dropping the file here.
BLENDER_REAL = f'{D}/aether-blender-real-shot.mp4'
BLENDER_REAL_SECONDS = 9.0
ARCH_EQ = 'eq=contrast=1.16:saturation=1.1:gamma=0.92:brightness=-0.03'
BUILD_DIR = {'village': 'village3', 'villa': 'villa2', 'valley': 'valley'}
CUT = 0.2  # the longest dissolve between two shots, seconds (six frames)
SHORT_CUT = 0.1


def ev(take, what):
    j = json.load(open(f'{F7}/{take}/{take}.json'))
    for e in j['events']:
        if e['what'].startswith(what):
            return e['t'] / 1000.0
    raise SystemExit(f'{take}: no event {what}')


def have(p):
    return os.path.exists(os.path.expanduser(p))


def ui(name, src, parts, cam, dur, xfade=CUT, frame=0.88, text=None, sfx='click', inset='tl'):
    s = {'name': name, 'src': src, 'mode': 'ui', 'parts': parts, 'cam': cam, 'dur': dur, 'xfade': xfade, 'frame': frame, 'sfx': sfx, 'insetPos': inset}
    if text:
        s['text'] = text
    return s


def clip(name, src, i, dur, xfade=CUT, text=None, sfx=None, **kw):
    s = {'name': name, 'src': src, 'in': i, 'dur': dur, 'xfade': xfade, **kw}
    if text is not None:
        s['text'] = text
    if sfx:
        s['sfx'] = sfx
    return s


def frames(name, pattern, start, dur, xfade=CUT, text=None, sfx=None, speed=1.0, eq=None):
    s = {'name': name, 'src': pattern, 'mode': 'frames', 'in': start, 'dur': dur, 'speed': speed, 'xfade': xfade, 'grade': False}
    if eq:
        s['eq'] = eq
    if text:
        s['text'] = text
    if sfx:
        s['sfx'] = sfx
    return s


def mosaic(name, tiles, dur, xfade=CUT, text=None, sfx='whoosh'):
    s = {'name': name, 'src': tiles[0]['src'], 'mode': 'mosaic', 'grid': [2, 2], 'tiles': tiles, 'dur': dur, 'xfade': xfade, 'sfx': sfx, 'labelSize': 38, 'gutter': 16, 'margin': 24}
    if text:
        s['text'] = text
    return s


def anime(name, a, b, xfade=SHORT_CUT, text=None, gain=1.0):
    s = {'name': name, 'src': f'{F6}/shots/two-whistles.mp4', 'mode': 'full', 'in': a, 'dur': round(b - a, 3), 'xfade': xfade, 'audio': gain, 'grade': False}
    if text:
        s['text'] = text
    return s


def tiles(take, specs, step=1.2):
    """specs: (event, offset, label, crop) -> mosaic tiles of one take, appearing one after another."""
    src = f'{F7}/{take}/{take}.mp4'
    out = []
    for i, (what, off, label, crop) in enumerate(specs):
        t = {'src': src, 'in': ev(take, what) + off, 'label': label, 'at': round(i * step * 0.5, 2)}
        if crop:
            t['crop'] = crop
        out.append(t)
    return out


def full():
    S = []
    S.append(clip('hook', f'{INTRO}/m-terraces-falls.mp4', 1.8, 5.5, 0, [['hook', 0.4, 5.1]]))
    # 1 Describe: the typed prompt is the first replay's prompt exactly
    if have(f'{F7}/describe/describe.mp4'):
        S.append(ui('gen-type', f'{F7}/describe/describe.mp4', [[ev('describe', 'typing') - 0.8, ev('describe', 'build pressed') - 0.1, 1.15]],
                    [[0, 0.5, 0.5, 1.0], [1.2, 0.5, 0.5, 1.0], [2.0, 0.5, 0.3, 1.65], [4.0, 0.5, 0.3, 1.65], [4.8, 0.5, 0.5, 1.0]], 5.2, CUT,
                    text=[['st-describe', 0.3, 4.9], ['note-offline', 0.3, 4.9]], sfx='whoosh', inset='br'))
    for key, name, start, dur, speed, tag in (('village', 'r-village', 10, 5.0, 0.7, 'tag-rv-village'), ('villa', 'r-villa', 10, 4.6, 0.8, 'tag-rv-villa')):
        if have(f'{F7}/build-{BUILD_DIR[key]}/f00000.jpg'):
            S.append(frames(name, f'{F7}/build-{BUILD_DIR[key]}/f%05d.jpg', start, dur, CUT, [[tag, 0.2, dur - 0.3], ['note-replay', 0.2, dur - 0.3]], 'whoosh', speed=speed))
    # 2 Edit, 3 Relight
    E = f'{F7}/edit/edit.mp4'
    if have(E):
        sel, fab, ts, te, ct = ev('edit', 'selected'), ev('edit', 'material Fabric'), ev('edit', 'time sweep start'), ev('edit', 'time sweep end'), ev('edit', 'chat typing')
        end = 48.0
        S.append(ui('e-select', E, [[sel - 3.1, sel + 2.9, 1.6]], [[0, 0.5, 0.5, 1.0], [1.3, 0.5, 0.5, 1.0], [2.2, 0.44, 0.5, 1.6], [3.7, 0.5, 0.5, 1.7]], 3.75, CUT, text=[['st-edit', 0.3, 3.5]], sfx='whoosh'))
        S.append(ui('e-material', E, [[fab - 1.9, fab + 6.1, 2.5]], [[0, 0.73, 0.64, 1.9], [3.2, 0.73, 0.66, 1.9]], 3.2, CUT))
        S.append(ui('e-chat', E, [[ct - 1.9, ct + 2.1, 1.5], [ct + 2.1, min(end, ct + 7.5), 2.0]], [[0, 0.2, 0.84, 2.1], [2.3, 0.2, 0.84, 2.1], [3.1, 0.25, 0.4, 2.0], [4.5, 0.25, 0.4, 2.0], [5.4, 0.5, 0.5, 1.0]], 5.0, CUT, text=[['note-offline', 0.3, 4.7]], inset='br'))
        S.append(ui('e-time', E, [[ts - 1.4, te + 1.2, 2.4]], [[0, 0.78, 0.3, 2.0], [3.6, 0.78, 0.3, 2.0], [4.4, 0.5, 0.5, 1.0], [5.5, 0.5, 0.5, 1.0]], 5.5, CUT, text=[['st-relight', 0.3, 5.2]], sfx='whoosh'))
    S.append(clip('sw-1', f'{F2}/sweep-penthouse.mp4', 0.4, 3.2, CUT, [['tag-relight', 0.4, 3.0]]))
    # capability montage: three 2x2 mosaics of large tiles
    Z = [0.0, 0.04, 0.34, 0.34]
    if have(f'{F7}/tour-game/tour-game.mp4'):
        m1 = tiles('tour-game', [('logic', 1.5, 'Rules', [0.0, 0.1, 0.3, 0.3]), ('checks', 6.0, 'Checks', [0.0, 0.1, 0.3, 0.3]), ('playability', 10.0, 'A bot plays it', [0.2, 0.0, 0.6, 0.6]), ('gizmos', 4.0, 'Move, rotate, scale', [0.2, 0.2, 0.55, 0.55])])
        for t in m1:
            t['smooth'] = False
        S.append(mosaic('m1', m1, 5.6, CUT, [['st-more', 0.4, 5.2]]) if False else mosaic('m1', m1, 5.2, CUT))
    m2 = []
    if have(f'{F7}/tour-land/tour-land.mp4'):
        m2 += tiles('tour-land', [('sculpt', 2.0, 'Sculpt terrain', None)])
    if have(f'{F7}/tour-game/tour-game.mp4'):
        m2 += tiles('tour-game', [('play', 1.0, 'Play it', None)])
    if have(f'{F7}/tour-publish/tour-publish.mp4'):
        m2 += tiles('tour-publish', [('palette', 2.0, 'Command palette', [0.28, 0.02, 0.5, 0.5]), ('hub-render', 1.5, 'Render a still', [0.62, 0.03, 0.38, 0.38])])
        for i, t in enumerate(m2):
            t['at'] = round(i * 0.6, 2)
        S.append(mosaic('m2', m2, 5.2, CUT))
        m3 = tiles('tour-publish', [('hub-video', 1.5, 'Make a video', [0.62, 0.03, 0.38, 0.38]), ('hub-model', 1.5, 'Export a 3D model', [0.62, 0.03, 0.38, 0.38]), ('hub-plan', 1.5, 'Floor plans', [0.62, 0.03, 0.38, 0.38]), ('hub-game', 1.5, 'A game to host', [0.62, 0.03, 0.38, 0.38])])
        for i, t in enumerate(m3):
            t['at'] = round(i * 0.6, 2)
        S.append(mosaic('m3', m3, 5.2, CUT))
    # 4 Architecture: the frame-by-frame render, then the studio's bar and plan
    if have(f'{F7}/arch-step/f00000.jpg'):
        n = len([f for f in os.listdir(f'{F7}/arch-step') if f.endswith('.jpg')])
        S.append(frames('a-step', f'{F7}/arch-step/f%05d.jpg', 0, round(n / 30 / 1.1, 2), CUT, [['st-arch', 0.3, 5.2], ['tag-walls-down', 6.0, 9.2], ['tag-explode', 9.6, 12.8], ['tag-onefloor', 13.2, 15.6]], 'whoosh', speed=1.1, eq=ARCH_EQ))
    A = f'{F7}/arch/arch.mp4'
    if have(A):
        S.append(ui('a-bar', A, [[ev('arch', 'cutaway') + 14.0, ev('arch', 'cutaway') + 17.0, 1.0]], [[0, 0.5, 0.5, 1.0], [0.4, 0.47, 0.2, 2.3], [3.0, 0.47, 0.2, 2.3]], 3.0, CUT))
        S.append(ui('a-plan', A, [[ev('arch', 'plan') + 4.6, ev('arch', 'plan') + 9.0, 1.0]], [[0, 0.5, 0.5, 1.0], [1.0, 0.5, 0.5, 1.0], [1.8, 0.42, 0.55, 1.7], [3.8, 0.42, 0.55, 1.7], [4.4, 0.5, 0.5, 1.0]], 4.4, CUT, text=[['tag-plan', 0.3, 4.1]]))
    # 5 Publish, 6 Share
    PU = f'{F7}/publish/publish.mp4'
    if have(PU):
        t0 = ev('publish', 'seal checks')
        S.append(ui('p-hub', PU, [[t0 - 3.0, t0 + 8.0, 2.0]], [[0, 0.5, 0.5, 1.0], [1.0, 0.5, 0.5, 1.0], [1.8, 0.8, 0.3, 2.1], [3.2, 0.8, 0.3, 2.1], [3.8, 0.8, 0.68, 2.1], [5.0, 0.8, 0.68, 2.1], [5.6, 0.5, 0.5, 1.0]], 5.7, CUT, text=[['st-publish', 0.3, 3.4], ['note-nothing', 3.7, 5.4]], sfx='whoosh'))
    if have(f'{F7}/devices/dev-laptop.mp4') and have(f'{F6}/devices/dev-phone.mp4'):
        u = 'aether-studio-lyart.vercel.app/play#w=D7L3Zki…'
        j = json.load(open(f'{F7}/devices/dev-laptop.json'))
        lt = [e['t'] for e in j['events'] if e['what'].startswith('laptop: hero')][0] / 1000.0
        jp = json.load(open(f'{F6}/devices/dev-phone.json'))
        pt = [e['t'] for e in jp['events'] if e['what'].startswith('phone: hero')][0] / 1000.0
        dv = lambda name, a, b, dur, xf, text, sfx: {'name': name, 'src': f'{F7}/devices/dev-laptop.mp4', 'mode': 'devices', 'laptop': [f'{F7}/devices/dev-laptop.mp4', a], 'phone': [f'{F6}/devices/dev-phone.mp4', b], 'url': u, 'dur': dur, 'xfade': xf, 'text': text, 'sfx': sfx}
        S.append(dv('devices', lt + 0.1, pt + 0.1, 2.6, CUT, [['st-share', 0.3, 5.6], ['dev', 0.3, 5.6], ['note-live-site', 0.3, 5.6]], 'whoosh'))
        # the second half of the share beat: the same link opened to the living room (the v6 laptop capture; the v7 laptop tour
        # sits on a bad bedroom view there)
        jl6 = json.load(open(f'{F6}/devices/dev-laptop.json'))
        lt6 = [e['t'] for e in jl6['events'] if e['what'].startswith('laptop: hero')][0] / 1000.0
        d2 = dv('devices2', lt6 + 9.3, pt + 9.2, 3.2, SHORT_CUT, [], None)
        d2['laptop'][0] = f'{F6}/devices/dev-laptop.mp4'
        S.append(d2)
    # any kind of world: the live Featured section, then drone and walk shots
    if have(f'{F7}/livehome/livehome.mp4'):
        S.append({'name': 'featured', 'src': f'{F7}/livehome/livehome.mp4', 'mode': 'browser', 'url': 'aether-studio-lyart.vercel.app', 'in': ev('livehome', 'featured') + 1.0, 'dur': 5.0, 'xfade': CUT, 'text': [['st-worlds', 0.3, 4.7], ['tag-feat', 0.3, 4.7]], 'sfx': 'whoosh'})
    S.append(clip('k-drone', f'{F1}/lisbon-drone.mp4', 0.5, 6.0, CUT, [['tag-drone', 0.2, 5.6]], 'whoosh'))
    S.append(clip('k-falls', f'{INTRO}/m-terraces-falls.mp4', 9.0, 6.0, CUT, [['tag-land', 0.2, 5.6]]))
    S.append(clip('k-ascent', f'{INTRO}/m-ascent.mp4', 1.0, 5.0, CUT, [['tag-ascent', 0.2, 4.6]]))
    S.append(clip('k-colony', f'{F1}/kepler-domes.mp4', 0.5, 4.0, CUT, [['tag-colony', 0.2, 3.7]]))
    S.append(clip('k-isles', f'{INTRO}/m-lantern.mp4', 2.0, 3.8, CUT, [['tag-isles', 0.2, 3.5]]))
    S.append(clip('k-house', f'{F1}/casa-pool.mp4', 1.0, 3.4, CUT, [['tag-walk', 0.2, 3.1]]))
    G = f'{F7}/tour-game/tour-game.mp4'
    S.append(clip('k-game', f'{D}/film2/ui/play.mp4', 1.0, 3.5, CUT, [['tag-game', 0.2, 3.2]]) if False else ui('k-game', f'{D}/film2/ui/play.mp4', [[1.0, 4.5, 1.0]], [[0, 0.5, 0.5, 1.0]], 3.5, CUT, 1.0, [['tag-game', 0.2, 3.2]], sfx=None))
    S.append(clip('k-quay', f'{F1}/lisbon-quay.mp4', 0.5, 5.0, CUT, [['tag-walk', 0.2, 4.7]]))
    # build locally: the named Blender slot (photoreal shot when it exists, the character turntable until then)
    if have(BLENDER_REAL):
        S.append({'name': 'blender-real', 'src': BLENDER_REAL, 'mode': 'full', 'in': 0.5, 'dur': BLENDER_REAL_SECONDS, 'xfade': CUT, 'grade': False, 'text': [['st-local', 0.3, BLENDER_REAL_SECONDS - 0.4], ['note-local', 0.3, BLENDER_REAL_SECONDS - 0.4]], 'sfx': 'whoosh'})
    S.append({'name': 'bl-sheet', 'src': f'{D}/film2/tt-mio/f%04d.png', 'mode': 'turntable', 'beside': f'{D}/film2/mio/sheet.png', 'dur': 6.0, 'speed': 1.1, 'xfade': CUT, 'text': [['tag-sheet', 0.3, 5.7], ['note-local', 0.3, 5.7]], 'sfx': 'whoosh'})
    # the animated short: a chapter with the film's own sound; no stair-descent close-up
    if have(f'{F6}/shots/two-whistles.mp4'):
        S += [
            anime('f-lookout', 0.5, 5.5, CUT, [['st-film', 0.4, 4.6]]),
            anime('f-title', 17.4, 21.4),
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


def short():
    """A one-minute cut from the same shots."""
    S = [clip('hook', f'{INTRO}/m-terraces-falls.mp4', 1.8, 3.5, 0, [['hook', 0.3, 3.2]])]
    if have(f'{F7}/describe/describe.mp4'):
        S.append(ui('gen-type', f'{F7}/describe/describe.mp4', [[ev('describe', 'typing') - 0.8, ev('describe', 'build pressed') - 0.1, 1.5]], [[0, 0.5, 0.5, 1.0], [0.8, 0.5, 0.3, 1.65], [3.0, 0.5, 0.3, 1.65]], 3.3, CUT, text=[['st-describe', 0.2, 3.1], ['note-offline', 0.2, 3.1]], sfx='whoosh', inset='br'))
    if have(f'{F7}/build-village3/f00000.jpg'):
        S.append(frames('r-village', f'{F7}/build-village3/f%05d.jpg', 10, 4.0, CUT, [['tag-rv-village', 0.2, 3.7], ['note-replay', 0.2, 3.7]], 'whoosh', speed=0.85))
    if have(f'{F7}/build-villa2/f00000.jpg'):
        S.append(frames('r-villa', f'{F7}/build-villa2/f%05d.jpg', 10, 3.6, CUT, [['tag-rv-villa', 0.2, 3.3], ['note-replay', 0.2, 3.3]], 'whoosh', speed=1.0))
    E = f'{F7}/edit/edit.mp4'
    if have(E):
        S.append(ui('e-material', E, [[ev('edit', 'material Fabric') - 1.9, ev('edit', 'material Fabric') + 6.1, 3.0]], [[0, 0.73, 0.64, 1.9], [2.7, 0.73, 0.66, 1.9]], 2.8, CUT, text=[['st-edit', 0.2, 2.6]], sfx='whoosh'))
        S.append(ui('e-time', E, [[ev('edit', 'time sweep start') - 1.4, ev('edit', 'time sweep end') + 1.2, 3.2]], [[0, 0.78, 0.3, 2.0], [3.0, 0.78, 0.3, 2.0]], 4.0, CUT, text=[['st-relight', 0.2, 3.8]], sfx='whoosh'))
    if have(f'{F7}/tour-game/tour-game.mp4'):
        m1 = tiles('tour-game', [('logic', 1.5, 'Rules', [0.0, 0.1, 0.3, 0.3]), ('checks', 6.0, 'Checks', [0.0, 0.1, 0.3, 0.3]), ('playability', 10.0, 'A bot plays it', [0.2, 0.0, 0.6, 0.6]), ('gizmos', 4.0, 'Move, rotate, scale', [0.2, 0.2, 0.55, 0.55])])
        S.append(mosaic('m1', m1, 4.4, CUT))
    if have(f'{F7}/arch-step/f00000.jpg'):
        S.append(frames('a-step', f'{F7}/arch-step/f%05d.jpg', 45, 6.0, CUT, [['st-arch', 0.2, 5.8]], 'whoosh', speed=2.0, eq=ARCH_EQ))
    PU = f'{F7}/publish/publish.mp4'
    if have(PU):
        t0 = ev('publish', 'seal checks')
        S.append(ui('p-hub', PU, [[t0 - 1.5, t0 + 6.0, 2.0]], [[0, 0.5, 0.5, 1.0], [0.6, 0.8, 0.3, 2.1], [1.8, 0.8, 0.3, 2.1], [2.4, 0.8, 0.68, 2.1], [3.4, 0.8, 0.68, 2.1]], 3.5, CUT, text=[['st-publish', 0.2, 3.3]], sfx='whoosh'))
    if have(f'{F7}/devices/dev-laptop.mp4'):
        j = json.load(open(f'{F7}/devices/dev-laptop.json'))
        lt = [e['t'] for e in j['events'] if e['what'].startswith('laptop: hero')][0] / 1000.0
        jp = json.load(open(f'{F6}/devices/dev-phone.json'))
        pt = [e['t'] for e in jp['events'] if e['what'].startswith('phone: hero')][0] / 1000.0
        S.append({'name': 'devices', 'src': f'{F7}/devices/dev-laptop.mp4', 'mode': 'devices', 'laptop': [f'{F7}/devices/dev-laptop.mp4', lt + 0.3], 'phone': [f'{F6}/devices/dev-phone.mp4', pt + 0.3], 'url': 'aether-studio-lyart.vercel.app/play#w=D7L3Zki…', 'dur': 3.4, 'xfade': CUT, 'text': [['st-share', 0.2, 3.2], ['dev', 0.2, 3.2], ['note-live-site', 0.2, 3.2]], 'sfx': 'whoosh'})
    S += [
        clip('k-drone', f'{F1}/lisbon-drone.mp4', 0.5, 3.0, CUT, [['tag-drone', 0.2, 2.8]], 'whoosh'),
        clip('k-falls', f'{INTRO}/m-terraces-falls.mp4', 9.0, 3.0, CUT, [['tag-land', 0.2, 2.8]]),
        clip('k-colony', f'{F1}/kepler-domes.mp4', 0.5, 2.6, CUT, [['tag-colony', 0.2, 2.4]]),
        clip('k-ascent', f'{INTRO}/m-ascent.mp4', 1.0, 2.8, CUT, [['tag-ascent', 0.2, 2.6]]),
        anime('f-lookout', 0.5, 3.5, CUT, [['tag-film', 0.2, 2.8]]),
        anime('f-whistle', 41.8, 44.8),
        anime('f-end', 88.0, 91.0),
        {'name': 'end', 'src': f'{F6}/cards/end.png', 'mode': 'image', 'dur': 3.0, 'xfade': 0.6, 'grade': False},
    ]
    return S


def write(name, segs, score_name):
    xf = [0.0] + [float(s.get('xfade', CUT)) for s in segs[1:]]
    total = sum(float(s['dur']) for s in segs) - sum(xf)
    duck, t = [], 0.0
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
    json.dump({'fps': 30, 'score': f'{F7}/{score_name}', 'scoreGain': 0.9, 'duck': merged, 'cards': f'{F6}/cards', 'fonts': f'{F6}/fonts', 'segments': segs}, open(os.path.join(OUT, name), 'w'), indent=1)
    print(name, round(total, 1), 's', len(segs), 'segments')


write('edl7.json', full(), 'edl7.wav')
write('edl7-60.json', short(), 'edl7-60.wav')
