"""Lay the frames of each action in a motion-strips folder out as one strip (usage: motion-montage.py <dir> [scale])."""
import glob
import os
import sys
from PIL import Image

d = sys.argv[1]
scale = float(sys.argv[2]) if len(sys.argv) > 2 else 0.45
actions = sorted({os.path.basename(f).rsplit('-', 1)[0] for f in glob.glob(os.path.join(d, '*-[0-9][0-9].png'))})
for a in actions:
    files = sorted(glob.glob(os.path.join(d, f'{a}-[0-9][0-9].png')))
    ims = [Image.open(f).convert('RGB') for f in files]
    w, h = int(ims[0].width * scale), int(ims[0].height * scale)
    cols = min(len(ims), 8)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (w * cols, h * rows))
    for i, im in enumerate(ims):
        sheet.paste(im.resize((w, h)), ((i % cols) * w, (i // cols) * h))
    sheet.save(os.path.join(d, f'strip-{a}.png'))
    print(a, len(ims))
