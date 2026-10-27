"""
Text embeddings of the object vocabulary for the CLIP second-pass labeller (build-time only; the runtime needs only the vision tower).
  python3 -I scripts/build-clip-vocab.py <dir with text_model_uint8.onnx and tokenizer.json> > packages/agent/src/photo/perception/clip-vocab.json
Model: OpenAI CLIP ViT-B/32 (MIT), the Xenova ONNX export, uint8 text tower (pinned in docs/THIRD_PARTY.md). Each label is embedded as
"a photo of a <label>." and stored as int8 (x127 of the unit vector) in base64.
"""
import base64, json, sys
import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

GROUPS = """bed=bed|single bed|bunk bed|sofa bed|mattress;pillow=pillow|cushion;blanket=blanket|bedspread;towel;nightstand=nightstand|bedside table;dresser=dresser|chest of drawers;wardrobe=wardrobe|closet;cabinet=cabinet|sideboard;shelf=shelf|bookcase;desk;chair=chair|office chair|wooden chair|cane chair;armchair;sofa=sofa|couch;ottoman;stool;bench;table=table|dining table|coffee table|side table;tv stand;television=television|monitor;laptop;lamp=lamp|table lamp|floor lamp|desk lamp;wall light;ceiling light=ceiling light|chandelier;curtain=curtain|blinds;curtain rail;window=window|window frame|window sill;door=door|glass door|door frame;radiator;air conditioner;mirror;painting=painting|picture frame|poster;clock;rug=rug|carpet;plant=plant|potted plant;vase;book=book|magazine|paper;bag;backpack;luggage=luggage|suitcase;bottle;cup;box|basket;fan;heater;smoke detector;electrical outlet|light switch;fireplace;stairs;railing;bathtub;sink;toilet;shower;refrigerator;kitchen counter;stove;oven;microwave;coffee machine;trash can;shoes;clothes|jacket|hanger;candle;sculpture;piano;guitar;toy;wall;floor;ceiling;baseboard;beam|column;garden|tree|grass;sky;building;telephone|remote control;tray;kettle""".split(';')
LABELS = []  # (canonical, variant)
for g in GROUPS:
    canon, _, rest = g.partition('=')
    for v in ([canon] if not rest else rest.split('|')) if '=' in g else g.split('|'):
        LABELS.append((canon.split('|')[0], v.strip()))
d = sys.argv[1]
tok = Tokenizer.from_file(f'{d}/tokenizer.json')
tok.enable_truncation(max_length=77)
tok.enable_padding(length=77, pad_id=49407)
s = ort.InferenceSession(f'{d}/text_model_uint8.onnx')
out = []
for canon, l in LABELS:
    ids = np.array([tok.encode(f'a photo of a {l}.').ids], dtype=np.int64)
    e = s.run(None, {'input_ids': ids})[0][0].astype(np.float64)
    e /= np.linalg.norm(e)
    out.append({'label': canon, 'variant': l, 'emb': base64.b64encode(np.round(e * 127).astype(np.int8).tobytes()).decode()})
print(json.dumps({'model': 'openai/clip-vit-base-patch32 (Xenova ONNX uint8 text tower)', 'dim': 512, 'prompt': 'a photo of a {label}.', 'labels': out}, separators=(',', ':')))
