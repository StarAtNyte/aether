"""The brief (packages/agent/src/bridge/blender-protocol.ts CharacterBriefSchema) as the pipeline's build spec.

Every field is optional except id, name and style; missing ones get defaults from the style, age and gender. Colours
are words (`chestnut`, `navy`, `pale mint`) or hex (`#644946`), the hex winning when both are given.
"""
import json

from common import colour

BUILDS = {'slim': -1, 'average': 0, 'sturdy': 1}


def load(path):
    with open(path) as f:
        return json.load(f)


def spec_of(brief):
    style = brief.get('style', 'anime')
    anime = style == 'anime'
    gender = brief.get('gender', 'female')
    male = gender == 'male'
    age = float(brief.get('age', 16 if anime else 35))
    build = BUILDS.get(brief.get('build', 'average'), 0)
    H = float(brief.get('height_m', (1.54 if not male else 1.68) if age < 18 else (1.62 if not male else 1.74)))
    ratio = float(brief.get('head_ratio', 6.5 if anime else 7.4))
    old = max(0.0, (age - 55) / 30)
    spec = {
        'id': brief['id'],
        'name': brief.get('name', brief['id']),
        'style': style,
        'gender': 'male' if male else 'female',
        'age': age,
        'old': old,
        'build': build,
        'height': H,
        'ratio': ratio,
        'head_h': H / ratio,
        # hip joint height over the height: long anime legs, a little shorter with age
        'leg': (0.535 if anime else 0.515) - 0.01 * old,
        # shoulder joint half-width and hip joint half-width in head heights
        'shoulder': (0.6 if male else (0.47 if style == 'anime' else 0.52)) + 0.04 * build,
        'hip_w': (0.36 if male else 0.37) + 0.02 * build,
        'arm': 1.0,
        # body girth multiplier
        'girth': 1.0 + 0.12 * build + (0.08 if male else 0) + 0.06 * old,
        'skin': colour(brief.get('skin'), '#f6c8ac'),
        'eyes': colour(brief.get('eyes'), '#593d35'),
        'eye_shape': 'droopy' if 'droop' in str(brief.get('eyes', '')).lower() or 'gentle' in str(brief.get('eyes', '')).lower() else 'round',
        'beauty_mark': 'beauty mark' in json.dumps(brief).lower(),
        'hair': normal_hair(brief.get('hair') or {}),
        'outfit': [normal_item(o) for o in brief.get('outfit') or []],
        'hair_style': brief.get('hair_style', 'painted' if anime else 'clumps'),
        'face_style': brief.get('face_style', 'painted' if anime else 'sculpted'),
        'notes': brief.get('notes', ''),
        'install': bool(brief.get('install', False)),
        'expressions': brief.get('expressions', ['smile', 'sad', 'surprised', 'teary', 'blink', 'mouth_open', 'determined']),
        'clips': brief.get('clips', ['look_up', 'hand_to_chest', 'run_stop', 'two_fingers']),
        'look': brief.get('look') or brief.get('notes', '')[:200] or brief.get('name'),
        'revision_notes': brief.get('revision_notes', ''),
    }
    spec['line'] = colour(brief.get('line_colour'), '#383430')
    return spec


def normal_hair(h):
    style = str(h.get('style', 'bob')).lower()
    for k in ('bob', 'long', 'ponytail', 'short', 'bald'):
        if k in style:
            style = k
            break
    else:
        style = 'bob'
    acc = h.get('accessories') or []
    if isinstance(acc, (str, dict)):
        acc = [acc]
    accs = []
    for a in acc:
        if isinstance(a, str):
            accs.append({'item': a})
        else:
            accs.append(dict(a))
    return {
        'style': style,
        'colour': colour(h.get('colour'), '#644946'),
        'length': float(h.get('length', {'bob': 0.24, 'long': 0.62, 'ponytail': 0.4, 'short': 0.08, 'bald': 0}[style])) if not isinstance(h.get('length'), str) else {'chin': 0.24, 'shoulder': 0.36, 'mid-back': 0.62, 'waist': 0.8, 'short': 0.08}.get(h.get('length'), 0.3),
        'parting': str(h.get('parting', 'side')).lower(),
        'volume': float(h.get('volume', 1.0)),
        'fringe': h.get('fringe', True),
        'accessories': accs,
        'beard': h.get('beard'),
        'grey': float(h.get('grey', 0)),
    }


def normal_item(o):
    o = dict(o)
    o['item'] = str(o.get('item', '')).lower()
    o['rgb'] = colour(o.get('colour'), '#808080')
    if 'line_colour' in o:
        o['line_rgb'] = colour(o['line_colour'])
    return o


def item(spec, *names):
    for o in spec['outfit']:
        for n in names:
            if n in o['item']:
                return o
    return None
