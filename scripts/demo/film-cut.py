"""The edit of the product film: picture, typography, score and grade, assembled with ffmpeg from the takes.

  python3 scripts/demo/film-cut.py <edl.json> [--out <file.mp4>] [--work <dir>] [--sheet <contact.jpg>]

The edit decision list (JSON):
  {
    "fps": 30,
    "score": "<wav>",                      the procedural score (film-shots.ts --score)
    "scoreGain": 0.9,
    "duck": [[t0, t1, gain], ...],         score level changes over the cut (faded over 0.8 s)
    "cards": "<dir of PNG overlays>",      film-cards.py output
    "segments": [
      {"name": "cold", "src": "<file>", "in": 0, "dur": 8, "speed": 1,
       "mode": "full" | "window" | "image" | "frames" | "turntable",
       "push": [1.0, 1.05],                a slow push-in (scale from..to) over the segment
       "pan": [0, 0, 0, 0],                optional centre drift in output px (x0, y0, x1, y1)
       "focus": [cx, cy],                  for "window": the zoom's centre in the UI frame (0..1)
       "xfade": 0.8,                       crossfade into this segment (0: a cut)
       "audio": 0.0,                       keep the clip's own sound at this gain (the anime excerpt)
       "text": [["card-name", t0, t1], ...] overlays, seconds from the segment's start
      }, ...]
  }
Each segment is rendered once to a normalized 1920x1080 clip (cached by its settings), then the clips are joined with
crossfades, the overlays laid on with fades, the score mixed under the clips' own sound, and a fade to black at the end.
"""
import hashlib
import json
import os
import subprocess
import sys

A = sys.argv[1:]
EDL = json.load(open(A[0]))
opt = {A[i][2:]: A[i + 1] for i in range(1, len(A) - 1) if A[i].startswith('--')}
OUT = opt.get('out', os.path.expanduser('~/.local/share/aether/demo/aether-film-v1.mp4'))
WORK = opt.get('work', os.path.expanduser('~/.local/share/aether/demo/film/work'))
FPS = EDL.get('fps', 30)
W, H = 1920, 1080
os.makedirs(WORK, exist_ok=True)
BACKDROP = os.path.join(WORK, 'backdrop.png')


def ff(args):
    cmd = ['nice', '-n', '10', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + args
    r = subprocess.run(cmd)
    if r.returncode:
        raise SystemExit('ffmpeg failed: ' + ' '.join(cmd)[:2000])


def probe(f):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]).decode().strip())


def backdrop():
    """A deep blue-grey field with a soft light from the top, behind the UI windows."""
    if os.path.exists(BACKDROP):
        return
    from PIL import Image, ImageDraw, ImageFilter
    img = Image.new('RGB', (W, H), (12, 15, 22))
    glow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(glow).ellipse([W * 0.12, -H * 0.55, W * 0.88, H * 0.75], fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(220))
    tint = Image.new('RGB', (W, H), (44, 54, 74))
    img = Image.composite(tint, img, glow)
    img.save(BACKDROP)


def window_shadow(ww, wh):
    f = os.path.join(WORK, f'shadow-{ww}x{wh}.png')
    if os.path.exists(f):
        return f
    from PIL import Image, ImageDraw, ImageFilter
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    x0, y0 = (W - ww) // 2, (H - wh) // 2
    ImageDraw.Draw(img).rounded_rectangle([x0, y0 + 18, x0 + ww, y0 + wh + 18], 18, fill=(0, 0, 0, 170))
    img = img.filter(ImageFilter.GaussianBlur(34))
    img.save(f)
    return f


def window_mask(ww, wh):
    f = os.path.join(WORK, f'mask-{ww}x{wh}.png')
    if os.path.exists(f):
        return f
    from PIL import Image, ImageDraw
    img = Image.new('L', (ww, wh), 0)
    ImageDraw.Draw(img).rounded_rectangle([0, 0, ww - 1, wh - 1], 14, fill=255)
    img.save(f)
    return f


def push_filter(s, dur):
    """Scale from push[0] to push[1] (eased) about the centre plus a drift: on a 2x frame, cropped back to 1080p."""
    p0, p1 = s.get('push', [1.0, 1.0])
    pan = s.get('pan', [0, 0, 0, 0])
    if p0 == 1.0 and p1 == 1.0 and not any(pan):
        return ''
    e = f"(0.5-0.5*cos(PI*min(1,on/{max(1, round(dur * FPS))})))"
    z = f"({p0}+({p1}-{p0})*{e})"
    cx = f"(iw/2+2*({pan[0]}+({pan[2]}-{pan[0]})*{e}))"
    cy = f"(ih/2+2*({pan[1]}+({pan[3]}-{pan[1]})*{e}))"
    return f",scale={W * 2}:{H * 2}:flags=lanczos,zoompan=z='{z}':x='{cx}-iw/zoom/2':y='{cy}-ih/zoom/2':d=1:s={W}x{H}:fps={FPS}"


GRADE = 'eq=contrast=1.02:saturation=0.98'


def segment(s):
    # the cache key: the segment's settings and its source file's time (a retaken source renders again)
    srcf = os.path.expanduser(s['src'])
    stamp = os.path.getmtime(srcf) if os.path.exists(srcf) else 0
    key = hashlib.sha1(json.dumps({**{k: v for k, v in s.items() if k not in ('text', 'xfade')}, '_t': stamp}, sort_keys=True).encode()).hexdigest()[:10]
    out = os.path.join(WORK, f"seg-{s['name']}-{key}.mp4")
    if os.path.exists(out):
        return out
    mode, dur, speed = s.get('mode', 'full'), float(s['dur']), float(s.get('speed', 1))
    src = os.path.expanduser(s['src'])
    grade = s.get('grade', mode in ('full', 'frames'))
    g = (',' + GRADE) if grade else ''
    pf = push_filter(s, dur)
    aud = s.get('audio', 0)
    if mode == 'image':
        inputs = ['-loop', '1', '-framerate', str(FPS), '-t', str(dur), '-i', src]
        vf = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x0c0f16,setsar=1,format=yuv420p{pf}{g},trim=duration={dur}[v]"
    elif mode == 'frames':
        inputs = ['-framerate', str(s.get('srcFps', FPS) * speed), '-start_number', str(int(s.get('in', 0))), '-i', src]
        vf = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={FPS},format=yuv420p{pf}{g},trim=duration={dur}[v]"
    elif mode == 'turntable':
        # transparent frames over the backdrop, beside an optional still (the concept sheet) on the left
        backdrop()
        inputs = ['-loop', '1', '-framerate', str(FPS), '-t', str(dur), '-i', BACKDROP, '-framerate', str(FPS * speed), '-i', src]
        side = s.get('beside') and os.path.expanduser(s['beside'])
        if side:
            inputs += ['-loop', '1', '-framerate', str(FPS), '-t', str(dur), '-i', side]
            vf = (f"[1:v]scale=1000:1000[tt];[2:v]scale=1000:-1[sh];[0:v][sh]overlay=x=60:y=(H-h)/2[b];"
                  f"[b][tt]overlay=x=900:y=40:shortest=1,format=yuv420p{pf},trim=duration={dur}[v]")
        else:
            vf = f"[1:v]scale=1040:1040[tt];[0:v][tt]overlay=x=(W-w)/2:y=20:shortest=1,format=yuv420p{pf},trim=duration={dur}[v]"
    elif mode == 'window':
        backdrop()
        ww, wh = s.get('win', [1632, 918])
        sh, mk = window_shadow(ww, wh), window_mask(ww, wh)
        inputs = ['-ss', str(s.get('in', 0)), '-i', src, '-loop', '1', '-i', BACKDROP, '-loop', '1', '-i', sh, '-loop', '1', '-i', mk]
        fx = f"setpts=(PTS-STARTPTS)/{speed}," if speed != 1 else 'setpts=PTS-STARTPTS,'
        crop = s.get('crop')
        cf = f"crop={crop[2]}:{crop[3]}:{crop[0]}:{crop[1]}," if crop else ''
        vf = (f"[0:v]{fx}{cf}scale={ww}:{wh}:flags=lanczos,fps={FPS},format=rgba[ui];[3:v]format=gray,scale={ww}:{wh}[m];[ui][m]alphamerge[uim];"
              f"[1:v][2:v]overlay[bd];[bd][uim]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,format=yuv420p{pf},trim=duration={dur}[v]")
    else:
        inputs = ['-ss', str(s.get('in', 0)), '-i', src]
        fx = f"setpts=(PTS-STARTPTS)/{speed}," if speed != 1 else 'setpts=PTS-STARTPTS,'
        vf = f"[0:v]{fx}scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H},setsar=1,fps={FPS},format=yuv420p{pf}{g},trim=duration={dur}[v]"
    af = []
    if aud and mode == 'full':
        af = ['-filter_complex', vf + f";[0:a]asetpts=PTS-STARTPTS,atrim=duration={dur},volume={aud},aresample=48000,aformat=channel_layouts=stereo[a]", '-map', '[v]', '-map', '[a]']
    else:
        af = ['-filter_complex', vf + f";anullsrc=r=48000:cl=stereo,atrim=duration={dur}[a]", '-map', '[v]', '-map', '[a]']
    ff(inputs + af + ['-t', str(dur), '-r', str(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', out.replace('.mp4', '.mov')])
    os.replace(out.replace('.mp4', '.mov'), out)
    return out


def main():
    segs = EDL['segments']
    files = []
    for s in segs:
        files.append(segment(s))
        print(f"  {s['name']}: {probe(files[-1]):.2f} s", flush=True)
    # 1. picture and the clips' own sound, joined with crossfades: each clip's body and each crossfade rendered as its
    # own piece, then the pieces concatenated in order (one input open at a time: memory stays flat).
    xf = [0.0] + [max(1 / FPS, float(s.get('xfade', 0.6))) for s in segs[1:]]
    starts, t = [], 0.0
    for i, s in enumerate(segs):
        t -= xf[i]
        starts.append(t)
        t += float(s['dur'])
    total = t
    enc = ['-r', str(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-ar', '48000']
    pieces = []
    for i, (s, f) in enumerate(zip(segs, files)):
        d = float(s['dur'])
        a, b = xf[i], d - (xf[i + 1] if i + 1 < len(segs) else 0)
        body = os.path.join(WORK, f"body-{i:02d}-{os.path.basename(f)[:-4]}-{a:.3f}-{b:.3f}.mov")
        if not os.path.exists(body):
            ff(['-i', f, '-filter_complex', f"[0:v]trim={a:.4f}:{b:.4f},setpts=PTS-STARTPTS[v];[0:a]atrim={a:.4f}:{b:.4f},asetpts=PTS-STARTPTS[a]", '-map', '[v]', '-map', '[a]'] + enc + [body])
        pieces.append(body)
        if i + 1 < len(segs):
            x = xf[i + 1]
            g = files[i + 1]
            tr = os.path.join(WORK, f"xf-{i:02d}-{os.path.basename(f)[:-4]}-{os.path.basename(g)[:-4]}-{x:.3f}.mov")
            if not os.path.exists(tr):
                ff(['-i', f, '-i', g, '-filter_complex',
                    f"[0:v]trim={d - x:.4f}:{d:.4f},setpts=PTS-STARTPTS[a0];[1:v]trim=0:{x:.4f},setpts=PTS-STARTPTS[b0];[a0][b0]xfade=transition=fade:duration={x:.4f}:offset=0[v];"
                    f"[0:a]atrim={d - x:.4f}:{d:.4f},asetpts=PTS-STARTPTS[aa];[1:a]atrim=0:{x:.4f},asetpts=PTS-STARTPTS[ba];[aa][ba]acrossfade=d={x:.4f}:c1=tri:c2=tri[a]",
                    '-map', '[v]', '-map', '[a]'] + enc + [tr])
            pieces.append(tr)
    joined = os.path.join(WORK, 'joined.mov')
    lst = os.path.join(WORK, 'pieces.txt')
    open(lst, 'w').write(''.join(f"file '{p}'\n" for p in pieces))
    ff(['-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined])
    inputs, chain, achain = ['-i', joined], [], []
    prev_v, prev_a = '[0:v]', '[0:a]'
    # 2. overlays
    ov = []
    k = 1
    cards = os.path.expanduser(EDL.get('cards', ''))
    for s, st in zip(segs, starts):
        for (name, a, b) in s.get('text', []):
            inputs += ['-loop', '1', '-framerate', str(FPS), '-t', f'{total:.3f}', '-i', os.path.join(cards, f'{name}.png')]
            t0, t1 = st + a, st + b
            ov.append((k, t0, t1))
            k += 1
    v = prev_v
    for j, (idx, t0, t1) in enumerate(ov):
        chain.append(f"[{idx}:v]format=rgba,fade=t=in:st={t0:.3f}:d=0.7:alpha=1,fade=t=out:st={t1 - 0.7:.3f}:d=0.7:alpha=1[o{j}]")
        chain.append(f"{v}[o{j}]overlay=enable='between(t,{t0:.3f},{t1:.3f})'[w{j}]")
        v = f'[w{j}]'
    chain.append(f"{v}fade=t=in:st=0:d=1.2,fade=t=out:st={total - 2.0:.3f}:d=2.0,format=yuv420p[vout]")
    # 3. the score, ducked, under the clips' own sound
    sidx = k
    inputs += ['-i', os.path.expanduser(EDL['score'])]
    vol = [f"{EDL.get('scoreGain', 0.9)}"]
    expr = str(EDL.get('scoreGain', 0.9))
    for (t0, t1, gnum) in EDL.get('duck', []):
        # piecewise: ramp into gnum over 0.8 s at t0, back over 0.8 s at t1
        r = f"(clip((t-{t0})/0.8,0,1)-clip((t-{t1})/0.8,0,1))"
        expr = f"({expr})*(1-{r}*(1-{gnum}))"
    chain.append(f"[{sidx}:a]atrim=duration={total:.3f},volume='{expr}':eval=frame[sc]")
    chain.append(f"{prev_a}[sc]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,afade=t=in:st=0:d=1.0,afade=t=out:st={total - 3.5:.3f}:d=3.5[aout]")
    graph = os.path.join(WORK, 'graph.txt')
    open(graph, 'w').write(';\n'.join(chain + achain))
    ff(inputs + ['-filter_complex_script', graph, '-map', '[vout]', '-map', '[aout]', '-t', f'{total:.3f}', '-r', str(FPS),
                 '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-maxrate', '40M', '-bufsize', '80M',
                 '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart', OUT])
    print(f'wrote {OUT} ({probe(OUT):.1f} s)')
    print('starts', json.dumps([[s['name'], round(st, 2)] for s, st in zip(segs, starts)]))
    if opt.get('sheet'):
        dur = probe(OUT)
        step = dur / 40
        ff(['-i', OUT, '-vf', f"fps=1/{step:.3f},scale=384:-1,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='%{{pts\\:hms}}':x=8:y=8:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.5,tile=5x8", '-frames:v', '1', '-q:v', '3', opt['sheet']])
        print('sheet', opt['sheet'])


main()
