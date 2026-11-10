"""The v8 product-demo edit lists (main cut about 2:53, trailer about 1:00) from one storyboard table.

  python3 scripts/demo/film/make-edl8.py [<out dir>]            writes edl8.json, edl8-60.json, cards8.json
  python3 scripts/demo/film/make-edl8.py --table                prints the storyboard as a markdown table

v8 is built for clarity. One idea at a time, always full frame: no mosaics, no picture-in-picture, no split screens (the laptop
and phone share scene, one world on two devices, is the single exception). Five titled acts: Describe, Shape it, Prove it, Share it,
Go further. Every beat is a cause then an effect in one shot, with a plain sentence caption (a verb, no jargon) on a numbered plate.

Sources: the v7 captures in film7/ (kept where their pacing was good), the new captures in film8/ (see "needs" in the table),
world clips from the world-footage pipeline in film8/clips/<name>.mp4 (the table names the clip each beat wants; v7/v6 footage is
the fallback). Photoreal Blender shot: ~/.local/share/aether/demo/aether-blender-real-shot.mp4 (placed when it exists).
"""
import json
import os
import sys

D = os.path.expanduser('~/.local/share/aether/demo')
F6, F7, F8 = f'{D}/film6', f'{D}/film7', f'{D}/film8'
F2, F1, INTRO = f'{D}/film2/shots', f'{D}/film/shots', f'{D}/intro/shots'
BLENDER_REAL = f'{D}/aether-blender-real-shot.mp4'
BLENDER_REAL_SECONDS = 9.0
# the villa replay is rendered with locked exposure and reads a little dark and hazy next to the village one: about +0.3 stop
VILLA_EQ = 'eq=gamma=1.10:brightness=0.012:contrast=1.04'
BLENDER_EQ = 'eq=gamma=1.14:brightness=0.012:saturation=1.03'
# Photo to 3D. The pair is real and rights-clean: the example photo is CC0 (Markus Spiske, Wikimedia Commons; credit in
# apps/studio/src/showcase/manifest.ts) and the room is the saved run of the photo flow that was built from it (template
# photo-hotel-bedroom; the transcripts are in tests/fixtures/photo). The walk is an offline render of that world (film8/clips/
# photo-hotel-walk.mp4, from the player's spawn). PHOTO_TO_3D is the named slot for a live capture of the whole beat (a photo
# attached in the chat, the build, the walk): when that file exists it replaces the photo and the render. No live model is used.
PHOTO_SRC = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../tests/fixtures/photo/bedroom-cc0-hotel.jpg'))
PHOTO_WALK = f'{F8}/clips/photo-hotel-walk.mp4'
PHOTO_TO_3D = f'{D}/aether-photo-to-3d-live.mp4'
XF = 0.1  # the longest dissolve between two shots: three frames (the cards' fades are separate)
# lisbon-aerial: the top 24% is a hazy strip with upside-down trees; a 16:9 window of the rest, from the 4K file, one downscale
AERIAL_CROP = [0.12, 0.24, 0.76, 0.76]
ARCH_EQ = 'eq=contrast=1.16:saturation=1.1:gamma=0.92:brightness=-0.03'
ACTS = [('Describe', 'Type a world. Watch it appear.'), ('Shape it', 'Change it by hand, by words, by light.'), ('Prove it', 'A bot plays it. The checks run.'),
        ('Share it', 'One link. Any screen. Any kind of world.'), ('Go further', 'Characters, photoreal shots, a short film.')]


def have(p):
    return os.path.exists(os.path.expanduser(p))


def ev(take, what, base=F8):
    j = json.load(open(f'{base}/{take}/{take}.json'))
    for e in j['events']:
        if e['what'].startswith(what):
            return e['t'] / 1000.0
    raise KeyError(f'{take}: no event {what}')


def evx(take, what, base=F8):
    """ev(), or None when the take is missing (the beat is then left out and the table says why)."""
    try:
        return ev(take, what, base)
    except (FileNotFoundError, KeyError):
        return None


def evf(path, what):
    for e in json.load(open(path))['events']:
        if e['what'].startswith(what):
            return e['t'] / 1000.0
    raise KeyError(f'{path}: no event {what}')


def clipsrc(name, fallback):
    """A world clip from the world-footage pipeline when it has landed, else the older footage."""
    # the footage agent's names differ a little from the beat names; the 4K render (when there is one) is the source
    for nm in {'drone-lisbon': ['lisbon-aerial', 'lisbon-drone'], 'house-walk': ['casa-pool'], 'landscape': ['terraces-falls'], 'arch-cutaway': ['arch-cutaway'], 'quay': ['lisbon-quay'], 'ascent': ['m-ascent'], 'isles': ['m-lantern']}.get(name, [name]):
        for cand in (f'{F8}/clips/{nm}-4k.mp4', f'{F8}/clips/{nm}.mp4'):
            if have(cand):
                return cand
    return fallback


# ------------------------------------------------------------------------------------------------------------------ segment makers
# the most a take may be zoomed in the cut: the device scale it was recorded at (1.5 for a 2880 px take), never above 1.05x for scale 1
ZOOM_CAP = {'edit': 1.05, 'arch': 1.05, 'publish': 1.05, 'modes': 1.05, 'tour-game': 1.5, 'tour-hub': 1.5, 'describe': 1.5, 'livehome': 1.5}
_STALLS = {}


def stalls(src):
    """[(start, end)] seconds of a take where no frame was painted for over 600 ms (the take's frames.json)."""
    if src in _STALLS:
        return _STALLS[src]
    out = []
    fj = src.rsplit('.', 1)[0] + '.frames.json'
    if os.path.exists(fj):
        t = 0.0
        for g in json.load(open(fj))['gapsMs']:
            if g > 600:
                out.append((t / 1000.0, (t + g) / 1000.0))
            t += g
    _STALLS[src] = out
    return out


def cut_stalls(src, parts):
    res = []
    for a, b, sp in parts:
        cur = a
        for (x, y) in stalls(src):
            if y <= cur or x >= b:
                continue
            if x > cur:
                res.append([cur, x, sp])
            cur = max(cur, y)
        if cur < b:
            res.append([cur, b, sp])
    return res


def capz(cam, maxz):
    """No zoom beyond what the take's pixels carry (never scale a UI take up by more than 1.05x)."""
    return [[c[0], c[1], c[2], min(c[3], maxz)] for c in cam]


def ui(name, src, parts, cam, dur, text=None, sfx='click', inset='tl', xfade=XF):
    parts = cut_stalls(src, parts) if os.path.exists(src) else parts
    cam = capz(cam, ZOOM_CAP.get(os.path.basename(os.path.dirname(src)), 1.5))
    s = {'name': name, 'src': src, 'mode': 'ui', 'parts': parts, 'cam': cam, 'dur': dur, 'xfade': xfade, 'frame': 0.88, 'sfx': sfx, 'insetPos': inset}
    if text:
        s['text'] = text
    return s


def clip(name, src, i, dur, text=None, sfx=None, xfade=XF, eq=None, cropf=None):
    s = {'name': name, 'src': src, 'in': i, 'dur': dur, 'xfade': xfade}
    if cropf:
        s['cropf'] = cropf
    if eq:
        s['eq'] = eq
    if text:
        s['text'] = text
    if sfx:
        s['sfx'] = sfx
    return s


def frames(name, pattern, start, dur, text=None, sfx=None, speed=1.0, eq=None, post=None, xfade=XF):
    s = {'name': name, 'src': pattern, 'mode': 'frames', 'in': start, 'dur': dur, 'speed': speed, 'xfade': xfade, 'grade': False}
    for k, v in (('eq', eq), ('post', post), ('text', text), ('sfx', sfx)):
        if v:
            s[k] = v
    return s


def anime(name, a, b, text=None, xfade=XF):
    s = {'name': name, 'src': f'{F6}/shots/two-whistles.mp4', 'mode': 'full', 'in': a, 'dur': round(b - a, 3), 'xfade': xfade, 'audio': 1.0, 'grade': False}
    if text:
        s['text'] = text
    return s


# ------------------------------------------------------------------------------------------------------------------ the storyboard
BEATS = []      # table rows: act, beat id, caption, seconds, source, status, needs
CARDS = {}      # card name -> card spec
SEGS = []       # the main cut, in order
TRAILER = []    # (segment, trailer seconds or None)


def caption_card(act, bid, n, text):
    name = f'c-{bid}'
    CARDS[name] = {'kind': 'cap', 'num': n, 'text': text}
    return name


def add(act, bid, n, caption, seg, source, status, needs='', trailer=None):
    """One beat: the segment is built by the caller with the caption card already attached."""
    if seg is None:
        BEATS.append((act, bid, caption, 0, source, 'LEFT OUT: ' + status, needs))
        return
    SEGS.append(seg)
    BEATS.append((act, bid, caption, seg['dur'], source, status, needs))
    if trailer:
        TRAILER.append((bid, trailer))


def with_text(seg, card, notes=(), t0=0.25):
    d = seg['dur']
    seg['text'] = [[card, t0, d - 0.15]] + [[nc, t0, d - 0.15] for nc in notes]
    return seg


def act_card(i):
    word, sub = ACTS[i - 1]
    CARDS[f'act{i}'] = {'kind': 'act', 'text': word, 'sub': sub, 'idx': i, 'total': 5}
    SEGS.append({'name': f'act{i}', 'src': f'{F8}/cards/act{i}.png', 'mode': 'image', 'dur': 1.3, 'xfade': XF, 'grade': False, 'sfx': 'whoosh'})
    BEATS.append((f'Act {i}', f'act{i}', f'(title card) {word}: {sub}', 1.3, 'card', 'new', ''))
    TRAILER.append((f'act{i}', 1.0))


def build():
    CARDS['hook'] = {'kind': 'hook', 'text': 'Describe a world.', 'sub': 'Aether builds it, lights it and publishes it.'}
    CARDS['end'] = {'kind': 'end', 'text': 'Aether', 'sub': 'Describe it. Shape it. Share it.', 'url': 'aether-studio-lyart.vercel.app'}
    for k, t in (('note-offline', 'Offline planner, no model call'), ('note-replay', 'Build replay, frame by frame'), ('note-local', 'Local run, Blender'),
                 ('note-live-site', 'Captured from the live site'), ('note-photo', 'Example photo: Markus Spiske, CC0'), ('note-photo-run', 'Saved run of the photo flow, no model call now'), ('note-nothing', 'Real link, nothing uploaded'), ('note-film', 'Animated short, made with Aether')):
        CARDS[k] = {'kind': 'note', 'text': t}
    CARDS['dev'] = {'kind': 'devlabels', 'x1': 763, 'x2': 1554, 'y': 90, 't1': 'Laptop', 't2': 'Phone'}

    # ---- hook
    hook = clip('hook', clipsrc('hook', f'{INTRO}/m-terraces-falls.mp4'), 1.8, 5.5, [['hook', 0.4, 5.1]], xfade=0)
    SEGS.append(hook)
    BEATS.append(('Hook', 'hook', 'Describe a world. Aether builds it, lights it and publishes it.', 5.5, 'film8/clips/hook (fallback: v7 terraces shot)', 'world clip', 'world-footage pipeline'))
    TRAILER.append(('hook', 3.8))

    # ---- Act 1: Describe
    act_card(1)
    n = 0
    D1 = f'{F8}/describe/describe.mp4'
    if have(D1):
        n += 1
        c = caption_card(1, 'a1b1', n, 'Type the world you want, in plain words.')
        s = ui('a1b1', D1, [[ev('describe', 'typing') - 0.8, ev('describe', 'build pressed') - 0.1, 1.15]],
               [[0, 0.5, 0.5, 1.0], [1.2, 0.5, 0.5, 1.0], [2.0, 0.5, 0.3, 1.65], [4.0, 0.5, 0.3, 1.65], [4.8, 0.5, 0.5, 1.0]], 5.2, inset='br', sfx='whoosh')
        add('Act 1', 'a1b1', n, 'Type the world you want, in plain words.', with_text(s, c, ['note-offline']), 'film7/describe (full app, then zoom to the box)', 'v7 capture good (0% of gaps over 50 ms)')
    for key, bid, dur, speed, cap in (('village', 'a1b2', 5.2, 0.7, 'The AI builds it step by step: the land and the market first, then the houses.'),
                                       ('villa', 'a1b3', 4.8, 0.8, 'A house builds the same way: floors, then stairs, then the garden.')):
        d = {'village': 'village3', 'villa': 'villa2'}[key]
        if have(f'{F7}/build-{d}/f00000.jpg') or clipsrc({'village': 'village-market', 'villa': 'villa-pool'}[key], None):
            n += 1
            c = caption_card(1, bid, n, cap)
            # the footage agent's clean replays (offline render from the planner's real patches, one moment per frame, no blending)
            clean = {'village': 'village-market', 'villa': 'villa-pool'}[key]
            cp = clipsrc(clean, None)
            if cp:
                s = clip(bid, cp, 1.2 if key == 'village' else 1.0, 3.8 if key == 'village' else 3.1, sfx='whoosh', eq=None if key == 'village' else VILLA_EQ)
            else:
                s = frames(bid, f'{F7}/build-{d}/f%05d.jpg', 10, dur, speed=speed, sfx='whoosh')
            add('Act 1', bid, n, cap, with_text(s, c, ['note-replay']), f'film7/build-{d} (offline render, fixed clock)', 'v7 render good; re-render if the world pipeline offers better', trailer=4.5 if key == 'villa' else None)

    # ---- photo to 3D (still Act 1: another way to start)
    n += 1
    cap = 'Start from a photo: the AI rebuilds the room in 3D.'
    c = caption_card(1, 'a1b4', n, cap)
    if have(PHOTO_TO_3D):
        add('Act 1', 'a1b4', n, cap, with_text({'name': 'a1b4', 'src': PHOTO_TO_3D, 'mode': 'full', 'in': 0.0, 'dur': 9.0, 'xfade': XF, 'grade': False, 'sfx': 'whoosh'}, c),
            'aether-photo-to-3d-live.mp4 (live capture, PHOTO_TO_3D slot)', 'live capture', '')
    elif have(PHOTO_SRC) and have(PHOTO_WALK):
        ph = {'name': 'a1b4a', 'src': PHOTO_SRC, 'mode': 'image', 'dur': 2.2, 'xfade': XF, 'grade': False, 'sfx': 'whoosh', 'text': [[c, 0.2, 2.05], ['note-photo', 0.2, 2.05]]}
        wk = clip('a1b4b', PHOTO_WALK, 0.2, 3.6, [[c, 0.2, 3.45], ['note-photo-run', 0.2, 3.45]])
        SEGS.extend([ph, wk])
        BEATS.append(('Act 1', 'a1b4', cap + ' (the photo, then the room walked)', 7.2, 'tests/fixtures/photo/bedroom-cc0-hotel.jpg (CC0) + offline render of template photo-hotel-bedroom', 'NEW render (the saved run built from that photo)', 'film-shots.ts: scout photo-hotel-bedroom, one 5 s walk from the spawn'))
    else:
        BEATS.append(('Act 1', 'a1b4', cap, 0, 'photo (CC0) + film8/clips/photo-hotel-walk.mp4', 'LEFT OUT until the walk is rendered', 'film-shots.ts photo-hotel'))

    # ---- Act 2: Shape it
    act_card(2)
    n = 0
    E = f'{F8}/edit/edit.mp4'
    if have(E):
        sel, fab, ts, te, ct = (ev('edit', k) for k in ('selected', 'material Fabric', 'time sweep start', 'time sweep end', 'chat typing'))
        n += 1
        c = caption_card(2, 'a2b1', n, 'Click a piece, then drag it where you want it.')
        add('Act 2', 'a2b1', n, 'Click a piece, then drag it where you want it.', with_text(ui('a2b1', E, [[sel + 0.4, sel + 7.4, 1.4]], [[0, 0.5, 0.5, 1.0], [1.0, 0.45, 0.5, 1.5], [4.0, 0.5, 0.5, 1.6]], 5.0), c),
            'film7/edit (select, move gizmo)', 'RE-RECORD: gaps 3-6% over 50 ms; the click shows a wall brightness jump', 'edit scene, quiet machine')
        n += 1
        # the capture has a 3-frame dark pop at fab + 5.9 s (the app re-lights when the material changes): skipped, 0.17 s of source
        c = caption_card(2, 'a2b2', n, 'Swap its material with one click.')
        add('Act 2', 'a2b2', n, 'Swap its material with one click.', with_text(ui('a2b2', E, [[fab - 1.2, fab + 5.86, 2.4], [fab + 6.03, fab + 8.2, 2.4]], [[0, 0.73, 0.64, 1.9], [3.83, 0.73, 0.66, 1.9]], 3.83), c),
            'film7/edit (material presets)', 'RE-RECORD with the edit take (5.8% over 50 ms)', 'edit scene')
        n += 1
        c = caption_card(2, 'a2b3', n, 'Or just ask: "make the sofa dark green".')
        add('Act 2', 'a2b3', n, 'Or just ask: "make the sofa dark green".', with_text(ui('a2b3', E, [[ct - 1.2, ct + 3.4, 1.4], [ct + 3.4, min(ct + 8.4, 48.0), 1.6]],
            [[0, 0.2, 0.84, 2.0], [2.4, 0.2, 0.84, 2.0], [3.2, 0.5, 0.5, 1.0], [5.4, 0.5, 0.5, 1.0]], 5.6, inset='br'), c, ['note-offline']),
            'film7/edit (chat typed, result, Undo)', 'RE-RECORD: this stretch was 16% over 50 ms; hold the result a full second', 'edit scene', trailer=4.5)
        n += 1
        c = caption_card(2, 'a2b4', n, 'Drag the sun: the light changes at once, with nothing re-baked.')
        add('Act 2', 'a2b4', n, 'Drag the sun: the light changes at once, with nothing re-baked.', with_text(ui('a2b4', E, [[ts - 1.0, ts - 1.0 + 2.2 * 2.6, 2.6]], [[0, 0.78, 0.3, 2.0], [2.2, 0.78, 0.3, 2.0]], 2.2), c),
            'film7/edit (the slider, 2.2 s)', 'RE-RECORD with the edit take', 'edit scene', trailer=2.2)
        # the result: the footage agent's four-hour relight of one camera push-in (hard cuts inside the clip at 4.7, 9.7 and 14.7 s)
        sweep = clipsrc('sweep-penthouse', f'{F8}/clips/sweep-penthouse.mp4')
        for k, (sid, t0) in enumerate((('a2b4s1', 0.6), ('a2b4s2', 5.3), ('a2b4s3', 10.3), ('a2b4s4', 15.3))):
            add('Act 2', sid, n, 'Drag the sun: the light changes at once, with nothing re-baked.', clip(sid, sweep, t0, 3.0, xfade=1 / 30), 'film8/clips/sweep-penthouse (four times of day)', 'world clip', 'world-footage pipeline', trailer=1.8 if k == 2 else None)
    # the footage agent's architecture cutaway (one 9 s render: roof and walls, the cutaway, walls down, floors apart, one floor), cut in three beats;
    # it is dark and green at golden hour: a light lift of about a quarter stop
    ARCHC = clipsrc('arch-cutaway', f'{F8}/clips/arch-cutaway.mp4')
    ARCHC_EQ = 'eq=gamma=1.10:brightness=0.01'
    if have(ARCHC):
        for bid, a, d, cap, tr in (('a2b5', 0.0, 3.6, 'Cut a building open to see its rooms.', 3.5), ('a2b6', 3.6, 1.6, 'Or take every wall down.', None),
                                   ('a2b7', 5.2, 3.8, 'Pull the floors apart to see each storey.', None)):
            n += 1
            c = caption_card(2, bid, n, cap)
            add('Act 2', bid, n, cap, with_text(clip(bid, ARCHC, a, d, sfx='whoosh' if bid == 'a2b5' else None, xfade=XF if bid == 'a2b5' else 1 / 30, eq=ARCHC_EQ), c),
                'film8/clips/arch-cutaway (clean render)', 'world clip', '', trailer=tr)
    A = f'{F8}/arch/arch.mp4'
    if have(A) and evx('arch', 'plan'):
        n += 1
        c = caption_card(2, 'a2b8', n, 'Switch to the floor plan, with the area of every room.')
        add('Act 2', 'a2b8', n, 'Switch to the floor plan, with the area of every room.', with_text(ui('a2b8', A, [[ev('arch', 'plan') + 4.6, ev('arch', 'plan') + 9.0, 1.0]],
            [[0, 0.5, 0.5, 1.0], [1.0, 0.5, 0.5, 1.0], [1.8, 0.42, 0.55, 1.7], [3.8, 0.42, 0.55, 1.7], [4.4, 0.5, 0.5, 1.0]], 4.4), c), 'film7/arch (plan view)', 'v7 capture good (1% over 50 ms)')

    # ---- Act 3: Prove it
    act_card(3)
    n = 0
    G = f'{F8}/tour-game/tour-game.mp4'
    pb, ver = evx('tour-game', 'playability'), evx('tour-game', 'verified')
    if have(G) and pb:
        n += 1
        c = caption_card(3, 'a3b1', n, 'Press one button: a bot plays your game to prove it can be won.')
        end = ver if ver else pb + 9.0
        add('Act 3', 'a3b1', n, 'Press one button: a bot plays your game to prove it can be won.',
            with_text(ui('a3b1', G, [[pb - 1.0, pb + 2.0, 1.0], [pb + 2.0, end - 1.0, 4.0], [end - 1.0, end + 2.0, 1.0]], [[0, 0.5, 0.5, 1.0], [1.2, 0.8, 0.12, 2.0], [3.6, 0.5, 0.45, 1.3], [6.0, 0.5, 0.45, 1.3]], 6.0, sfx='whoosh'), c),
            'film7/tour-game (click, the bot runs sped up, "Verified playable")', 'RE-RECORD: the take needs a "verified" mark and the result held 1 s', 'tour --kind=game (adds a verified mark)', trailer=5.0)
        n += 1
        c = caption_card(3, 'a3b2', n, "Run the world's own tests: one clear badge says they pass.")
        gc = ev('tour-game', 'checks')
        add('Act 3', 'a3b2', n, "Run the world's own tests: one clear badge says they pass.", with_text(ui('a3b2', G, [[gc - 0.6, gc + 6.0, 1.6]], [[0, 0.5, 0.5, 1.0], [1.0, 0.18, 0.3, 1.9], [3.0, 0.5, 0.5, 1.0]], 4.1), c),
            'film7/tour-game (Checks)', 'v7 capture acceptable', '')
        n += 1
        c = caption_card(3, 'a3b3', n, 'Game rules read like sentences: when the timer ends, you lose.')
        gl = ev('tour-game', 'logic')
        add('Act 3', 'a3b3', n, 'Game rules read like sentences: when the timer ends, you lose.', with_text(ui('a3b3', G, [[gl + 0.4, gl + 4.2, 1.0]], [[0, 0.5, 0.5, 1.0], [0.8, 0.14, 0.3, 2.0], [3.6, 0.14, 0.3, 2.0]], 3.8), c),
            'film7/tour-game (Logic panel)', 'v7 capture acceptable', '')

    # ---- Act 4: Share it
    act_card(4)
    n = 0
    H = f'{F8}/tour-hub/tour-hub.mp4'
    if have(H):
        n += 1
        c = caption_card(4, 'a4b1', n, 'Pick what to make: a game, a video, a picture, a 3D model or a floor plan.')
        hp = [[ev('tour-hub', f'hub-{k}', F8) - 0.3, ev('tour-hub', f'hub-{k}', F8) + 1.3, 1.0] for k in ('game', 'video', 'render', 'model', 'plan')]
        add('Act 4', 'a4b1', n, 'Pick what to make: a game, a video, a picture, a 3D model or a floor plan.', with_text(ui('a4b1', H, hp, [[0, 0.5, 0.5, 1.0], [0.4, 0.8, 0.3, 1.5], [8.0, 0.8, 0.3, 1.5]], 8.0, sfx='whoosh'), c),
            'film8/tour-hub (new: pointer clicks each target)', 'NEW capture', 'tour --kind=hub')
    else:
        BEATS.append(('Act 4', 'a4b1', 'Pick what to make: a game, a video, a picture, a 3D model or a floor plan.', 0, 'film8/tour-hub', 'LEFT OUT until captured', 'tour --kind=hub'))
    P = f'{F8}/publish/publish.mp4'
    if have(P):
        n += 1
        t0 = ev('publish', 'seal checks')
        c = caption_card(4, 'a4b2', n, 'One click makes a link that carries the whole world.')
        add('Act 4', 'a4b2', n, 'One click makes a link that carries the whole world.', with_text(ui('a4b2', P, [[t0 - 3.0, t0 + 8.0, 2.2]], [[0, 0.5, 0.5, 1.0], [1.0, 0.5, 0.5, 1.0], [1.8, 0.8, 0.3, 2.1], [3.2, 0.8, 0.3, 2.1], [3.8, 0.8, 0.68, 2.1], [5.0, 0.8, 0.68, 2.1]], 5.0), c, ['note-nothing']),
            'film7/publish (link made with the Player address set to the live site)', 'v7 capture good (1.5% over 50 ms)', '', trailer=None)
    DL, DP = f'{F8}/devices/dev-laptop.mp4', f'{F8}/devices/dev-phone.mp4'
    if have(DL) and have(DP):
        n += 1
        c = caption_card(4, 'a4b3', n, 'Open it anywhere: the same world on a laptop and a phone.')
        u = 'aether-studio-lyart.vercel.app/play#w=D7L3Zki…'
        lt, pt = evf(f'{F8}/devices/dev-laptop.json', 'laptop: hero'), evf(f'{F8}/devices/dev-phone.json', 'phone: hero')
        seg = {'name': 'a4b3', 'src': DL, 'mode': 'devices', 'laptop': [DL, lt + 0.1], 'phone': [DP, pt + 0.1], 'url': u, 'dur': 5.6, 'xfade': XF, 'sfx': 'whoosh'}
        seg['text'] = [[c, 0.25, 5.4], ['dev', 0.25, 5.4], ['note-live-site', 0.25, 5.4]]
        add('Act 4', 'a4b3', n, 'Open it anywhere: the same world on a laptop and a phone.', seg, 'film8/devices (the share link opened on the live site)', 'NEW capture (v7 phone encode failed; encode fixed)', 'devices scene, scale 1.5', trailer=5.0)
    else:
        BEATS.append(('Act 4', 'a4b3', 'Open it anywhere: the same world on a laptop and a phone.', 0, 'film8/devices', 'LEFT OUT until captured', 'devices scene'))
    LH = f'{F8}/livehome/livehome.mp4'
    if have(LH):
        n += 1
        c = caption_card(4, 'a4b4', n, 'Published worlds open in their own mode, and any of them can be remixed.')
        seg = {'name': 'a4b4', 'src': LH, 'mode': 'browser', 'url': 'aether-studio-lyart.vercel.app', 'in': ev('livehome', 'featured') + 1.0, 'dur': 5.5, 'xfade': XF, 'sfx': 'whoosh'}
        add('Act 4', 'a4b4', n, 'Published worlds open in their own mode, and any of them can be remixed.', with_text(seg, c, ['note-live-site']), 'film7/livehome (live site, Featured)', 'v7 capture good (0% over 50 ms)')
    MD = f'{F8}/modes/modes.mp4'
    if have(MD) and evx('modes', 'drone button pressed'):
        n += 1
        c = caption_card(4, 'a4b4d', n, 'Press Drone: the camera lifts off and flies over the city.')
        pr = ev('modes', 'drone button pressed')
        sg = ui('a4b4d', MD, [[pr + 0.0, pr + 2.2, 1.0]], [[0, 0.5, 0.5, 1.0]], 2.2, sfx='whoosh')
        sg['text'] = [[c, 0.25, 2.05]]
        add('Act 4', 'a4b4d', n, 'Press Drone: the camera lifts off and flies over the city.', sg, 'film8/modes (real take: the Drone button and the click, 2.2 s at 1:1, then the clean flight clip)', 'NEW capture (12% of gaps over 50 ms and blocky at 100%; used for the click only; re-record at scale 1.5 when the machine is quiet)', 'modes --clickDrone=1 --scale=1.5', trailer=2.2)
    for bid, name, fb, i0, dur, cap, tr in (('a4b5', 'drone-lisbon', f'{F1}/lisbon-drone.mp4', 0.2, 5.0, 'Fly over a whole city by drone.', 4.5), ('a4b6', 'house-walk', f'{F1}/casa-pool.mp4', 1.0, 4.2, 'Walk through a house, at any time of day.', 2.3),
                                           ('a4b7a', 'ascent', f'{F8}/clips/m-ascent.mp4', 0.2, 6.0, 'Or descend over a sanctuary at dusk.', None),
                                           ('a4b7', 'landscape', f'{INTRO}/m-terraces-falls.mp4', 0.4, 5.0, 'Or float over a landscape at golden hour.', 3.0)):
        n += 1
        c = caption_card(4, bid, n, cap)
        add('Act 4', bid, n, cap, with_text(clip(bid, clipsrc(name, fb), i0, dur, sfx='whoosh' if bid == 'a4b5' else None, cropf=AERIAL_CROP if (bid == 'a4b5' and 'lisbon-aerial' in clipsrc(name, fb)) else None), c), f'film8/clips/{name} (fallback v6/v7 footage)', 'world clip', 'world-footage pipeline', trailer=tr)
    BEATS.append(('Act 4', 'a4b8', 'Play a game as a character.', 0, 'film8/clips/game-play', 'LEFT OUT until a clean clip exists (the game tour take shows the game for the bot beat)', ''))

    # ---- Act 5: Go further
    act_card(5)
    n = 0
    n += 1
    c = caption_card(5, 'a5b1', n, 'Describe a character: Blender builds it on your computer, front, side and back.')
    add('Act 5', 'a5b1', n, 'Describe a character: Blender builds it on your computer, front, side and back.',
        with_text({'name': 'a5b1', 'src': f'{D}/film2/tt-mio/f%04d.png', 'mode': 'turntable', 'beside': f'{D}/film2/mio/sheet.png', 'dur': 6.5, 'speed': 1.1, 'xfade': XF, 'sfx': 'whoosh'}, c, ['note-local']), 'film2/tt-mio + sheet', 'existing', '', trailer=3.5)
    if have(BLENDER_REAL):
        n += 1
        c = caption_card(5, 'a5b2', n, 'And it renders a photoreal shot of it, locally.')
        add('Act 5', 'a5b2', n, 'And it renders a photoreal shot of it, locally.', with_text({'name': 'a5b2', 'src': BLENDER_REAL, 'mode': 'full', 'in': 0.5, 'dur': BLENDER_REAL_SECONDS, 'xfade': XF, 'grade': False, 'eq': BLENDER_EQ, 'sfx': 'whoosh'}, c, ['note-local']),
            'aether-blender-real-shot.mp4', 'pending: another job is rendering it', '')
    else:
        BEATS.append(('Act 5', 'a5b2', 'And it renders a photoreal shot of it, locally.', 0, 'aether-blender-real-shot.mp4', 'LEFT OUT until the file lands', ''))
    if have(LH) and evx('livehome', 'film card'):
        n += 1
        c = caption_card(5, 'a5b2f', n, 'Finished films sit on the home page: this one is a Blender render.')
        fc = ev('livehome', 'film card')
        seg = {'name': 'a5b2f', 'src': LH, 'mode': 'browser', 'url': 'aether-studio-lyart.vercel.app', 'in': fc - 1.0, 'dur': 3.9, 'xfade': XF, 'sfx': 'whoosh'}
        add('Act 5', 'a5b2f', n, 'Finished films sit on the home page: this one is a Blender render.', with_text(seg, c, ['note-live-site']), 'film8/livehome (live site: the Stories film card, click, the film plays)', 'NEW capture (live site, 3.1% of gaps over 50 ms)', '')
    if have(f'{F6}/shots/two-whistles.mp4'):
        n += 1
        # no face is readable in any frame: the title, the train on the viaduct, the crossing signal, the lamps,
        # the sunset over the town from behind (checked at 1.5 s steps, and at 0.4 s steps on the ranges used)
        c1 = caption_card(5, 'a5b3', n, 'An animated short, made with Aether.')
        c3 = caption_card(5, 'a5b3k', n, 'Two whistles from the cape: the promise kept.')
        films = [anime('a5b3a', 18.5, 21.0, [[c1, 0.2, 2.3]]), anime('a5b3b', 59.0, 61.4), anime('a5b3c', 35.8, 36.9),
                 anime('a5b3e', 73.0, 76.2, [[c3, 0.2, 3.0]]), anime('a5b3f', 90.2, 92.7)]
        for sg in films:
            SEGS.append(sg)
        BEATS.append(('Act 5', 'a5b3', 'An animated short, made with Aether. / Two whistles from the cape: the promise kept. (face-free: title, train, signal, lookout, sunset from behind)', sum(sg['dur'] for sg in films), 'film6/shots/two-whistles (face-free stretches only; the face-free Cloudwatch re-render replaces them when it lands)', 'existing, face-free cut', ''))
        TRAILER.append(('a5b3', 7.7))
    n += 1
    c = caption_card(5, 'a5b4', n, 'And more: sculpt terrain, write game rules, search every command.')
    add('Act 5', 'a5b4', n, 'And more: sculpt terrain, write game rules, search every command.', with_text(clip('a5b4', clipsrc('isles', f'{INTRO}/m-lantern.mp4'), 1.5, 3.2, cropf=[0.06, 0.12, 0.88, 0.88]), c), 'film8/clips/isles (one calm shot)', 'world clip', '')
    SEGS.append({'name': 'end', 'src': f'{F8}/cards/end.png', 'mode': 'image', 'dur': 5.0, 'xfade': 0.8, 'grade': False})
    BEATS.append(('End', 'end', 'Aether. Describe it. Shape it. Share it.', 5.0, 'card', 'existing style', ''))


def trailer():
    """One beat per act and the best shots: act cards at 1.0 s, the beats at the seconds the table names."""
    want = dict(TRAILER)
    out = []
    for s in SEGS:
        nm = s['name']
        key = nm if nm in want else None
        if nm.startswith('a5b3') and 'a5b3' in want and nm in ('a5b3a', 'a5b3b', 'a5b3e'):
            key = 'a5b3'
        if key is None:
            continue
        t = dict(s)
        d = want[key] if nm in want else {'a5b3a': 2.5, 'a5b3b': 2.4, 'a5b3e': 2.8}[nm]
        d = min(d, s['dur'])
        t['dur'] = d
        if nm.startswith('act'):
            t['dur'] = 1.0
        if 'text' in t:
            t['text'] = [[x[0], x[1], max(x[1] + 1.0, d - 0.15)] for x in t['text']]
        if t.get('mode') == 'ui':
            t['parts'] = s['parts']
        out.append(t)
    out.append({'name': 'end', 'src': f'{F8}/cards/end.png', 'mode': 'image', 'dur': 4.0, 'xfade': 0.6, 'grade': False})
    return out


def hard_cuts_at_acts(segs):
    """An act title is a clean hard cut in and out: no dissolve joins it to the scenes around it."""
    for i, sg in enumerate(segs):
        if sg['name'].startswith('act') or (i > 0 and segs[i - 1]['name'].startswith('act')):
            sg['xfade'] = 1 / 30
    return segs


def write(name, segs, score):
    segs = hard_cuts_at_acts(segs)
    xf = [0.0] + [float(s.get('xfade', XF)) for s in segs[1:]]
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
    if '--table' not in sys.argv:
        json.dump({'fps': 30, 'score': f'{F8}/{score}', 'scoreGain': 0.9, 'duck': merged, 'cards': f'{F8}/cards', 'fonts': f'{F6}/fonts', 'segments': segs}, open(os.path.join(OUT, name), 'w'), indent=1)
    print(name, round(total, 1), 's', len(segs), 'segments')


build()
args = [a for a in sys.argv[1:] if not a.startswith('--')]
OUT = args[0] if args else F8
os.makedirs(OUT, exist_ok=True)
if '--table' in sys.argv:
    print('| Act | Beat | Caption | s | Source | Status | Needs |\n|---|---|---|---|---|---|---|')
    for r in BEATS:
        print('| ' + ' | '.join(str(x).replace('|', '/') for x in r) + ' |')
else:
    json.dump(CARDS, open(os.path.join(OUT, 'cards8.json'), 'w'), indent=1)
write('edl8.json', SEGS, 'edl8.wav')
write('edl8-60.json', trailer(), 'edl8-60.wav')
