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
       "mode": "full" | "window" | "ui" | "image" | "frames" | "turntable",
       "push": [1.0, 1.05],                a slow push-in (scale from..to) over the segment
       "pan": [0, 0, 0, 0],                optional centre drift in output px (x0, y0, x1, y1)
       "focus": [cx, cy],                  for "window": the zoom's centre in the UI frame (0..1)
       "xfade": 0.8,                       crossfade into this segment (0: a cut)
       "audio": 0.0,                       keep the clip's own sound at this gain (the anime excerpt)
       "cam": [[t, fx, fy, z], ...]        for "ui": the designed camera over a 3840x2160 studio take: at output second t the view
                                           is centred on (fx, fy) in the studio window's own 0..1 coordinates, z times the window's
                                           width (z 1 = the window fills the frame, 0.9 = the whole window floating on the backdrop
                                           with its shadow); eased between keys, so each key is a rest
       "parts": [[in, out, speed], ...]    for "ui": the take's stretches in order, each at its own speed (the speed ramps)
       "frame": 0.88                       for "ui": the window's size on the backdrop at z 0.88
       "text": [["card-name", t0, t1], ...] overlays, seconds from the segment's start
      }, ...]
  }
Each segment is rendered once to a normalized 1920x1080 clip (cached by its settings), then the clips are joined with
crossfades, the overlays laid on with fades, the score mixed under the clips' own sound, and a fade to black at the end.
"""
import hashlib
import json
import re
import os
import subprocess
import sys

A = sys.argv[1:]
EDL = json.load(open(A[0]))
opt = {A[i][2:]: A[i + 1] for i in range(1, len(A) - 1) if A[i].startswith('--')}
OUT = opt.get('out', os.path.expanduser('~/.local/share/aether/demo/aether-film-v3.mp4'))
WORK = opt.get('work', os.path.expanduser('~/.local/share/aether/demo/film/work'))
FPS = EDL.get('fps', 30)
W, H = 1920, 1080
os.makedirs(WORK, exist_ok=True)
BACKDROP = os.path.join(WORK, 'backdrop.png')


# Frames are never blended across time (no minterpolate, tblend, tmix, the framerate filter or mpdecimate retiming): a low-fps take is
# re-recorded or dropped, speed ramps drop or repeat whole frames. The only blends are the short dissolves between two shots (xfade).
BANNED = re.compile(r'(?<![-\w])(minterpolate|tblend|tmix|lagfun|framerate=|mpdecimate|blend=)')


def ff(args):
    hit = BANNED.search(' '.join(str(a) for a in args))
    if hit:
        raise SystemExit(f'refusing a frame-blending filter: {hit.group(1)}')
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


def ui_assets(cw, ch, uw, uh):
    """The studio window's stage: a deep blue-grey field with a soft top light and the window's soft shadow, and the
    window's rounded mask."""
    bg, mk = os.path.join(WORK, f'uibg-{cw}x{ch}-{uw}x{uh}.png'), os.path.join(WORK, f'uimask-{uw}x{uh}.png')
    if os.path.exists(bg) and os.path.exists(mk):
        return bg, mk
    from PIL import Image, ImageDraw, ImageFilter
    img = Image.new('RGB', (cw, ch), (12, 15, 22))
    glow = Image.new('L', (cw, ch), 0)
    ImageDraw.Draw(glow).ellipse([cw * 0.12, -ch * 0.55, cw * 0.88, ch * 0.75], fill=255)
    img = Image.composite(Image.new('RGB', (cw, ch), (44, 54, 74)), img, glow.filter(ImageFilter.GaussianBlur(cw // 9)))
    sh = Image.new('L', (cw, ch), 0)
    x0, y0 = (cw - uw) // 2, (ch - uh) // 2
    ImageDraw.Draw(sh).rounded_rectangle([x0, y0 + ch // 60, x0 + uw, y0 + uh + ch // 60], cw // 120, fill=190)
    sh = sh.filter(ImageFilter.GaussianBlur(cw // 55))
    img = Image.composite(Image.new('RGB', (cw, ch), (0, 0, 0)), img, sh)
    img.save(bg)
    m = Image.new('L', (uw, uh), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, uw - 1, uh - 1], cw // 140 if uw < cw else 0, fill=255)
    m.save(mk)
    return bg, mk


def pw(keys, scale=1.0, add=0.0):
    """An ffmpeg expression of output time t (`T`): the keys [(t, v), ...] joined with eased (cosine) steps."""
    keys = sorted(keys)
    expr = f'{keys[-1][1] * scale + add:.5f}'
    for (ta, va), (tb, vb) in reversed(list(zip(keys, keys[1:]))):
        e = f'(0.5-0.5*cos(PI*clip((T-{ta})/{max(0.001, tb - ta)},0,1)))'
        expr = f'if(lt(T,{tb}),({va * scale + add:.5f}+({(vb - va) * scale:.5f})*{e}),{expr})'
    return expr


GRADE = 'eq=contrast=1.02:saturation=0.98'


def segment(s):
    # the cache key: the segment's settings and its source file's time (a retaken source renders again)
    srcf = os.path.expanduser(s['src'])
    stamp = os.path.getmtime(srcf) if os.path.exists(srcf) else 0
    key = hashlib.sha1(json.dumps({**{k: v for k, v in s.items() if k not in ('text', 'xfade', 'sfx')}, '_t': stamp}, sort_keys=True).encode()).hexdigest()[:10]
    out = os.path.join(WORK, f"seg-{s['name']}-{key}.mp4")
    if os.path.exists(out):
        return out
    mode, dur, speed = s.get('mode', 'full'), float(s['dur']), float(s.get('speed', 1))
    src = os.path.expanduser(s['src'])
    grade = s.get('grade', mode in ('full', 'frames'))
    g = (',' + GRADE) if grade else ''
    if s.get('eq'):
        g = ',' + s['eq']
    pf = push_filter(s, dur)
    aud = s.get('audio', 0)
    if mode == 'image':
        inputs = ['-loop', '1', '-framerate', str(FPS), '-t', str(dur), '-i', src]
        vf = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=0x0c0f16,setsar=1,format=yuv420p{pf}{g},trim=duration={dur}[v]"
    elif mode == 'frames':
        inputs = ['-framerate', str(s.get('srcFps', FPS) * speed), '-start_number', str(int(s.get('in', 0))), '-i', src]
        vf = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={FPS},{s.get('post', '')}format=yuv420p{pf}{g},trim=duration={dur}[v]"
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
    elif mode == 'ui':
        # a 4K studio take composed onto the stage (rounded, with a soft shadow), then a designed camera over it
        cw, ch = W * 2, H * 2
        fr = float(s.get('frame', 0.88))
        uw, uh = int(cw * fr) // 2 * 2, int(ch * fr) // 2 * 2
        bg, mk = ui_assets(cw, ch, uw, uh)
        parts = s.get('parts') or [[s.get('in', 0), s.get('in', 0) + dur * speed, speed]]
        cams = s.get('cam') or [[0, 0.5, 0.5, 1.0]]
        # a view that fills the window never looks past its edge: the centre is held that far in
        cl = []
        for (ct, fx, fy, z) in cams:
            if z >= 1:
                fx, fy = min(max(fx, 0.5 / z), 1 - 0.5 / z), min(max(fy, 0.5 / z), 1 - 0.5 / z)
            cl.append([ct, fx, fy, z])
        cams = cl
        T = f'(on/{FPS})'
        zc = pw([(c[0], c[3]) for c in cams], 1 / fr).replace('T', T)
        # the centre in canvas fractions: the window is centred on the canvas
        cx = pw([(c[0], c[1]) for c in cams], fr, 0.5 * (1 - fr)).replace('T', T)
        cy = pw([(c[0], c[2]) for c in cams], fr, 0.5 * (1 - fr)).replace('T', T)
        # each part is its own seeked input: with one shared input the concat would buffer the other parts' 4K frames
        n = len(parts)
        sel = ''.join(f"[{i}:v]setpts=(PTS-STARTPTS)/{sp},fps={FPS}[p{i}];" for i, (a, b, sp) in enumerate(parts))
        cat = ''.join(f'[p{i}]' for i in range(n)) + f'concat=n={n}:v=1:a=0[src];'
        inputs = []
        for (a, b, sp) in parts:
            inputs += ['-ss', str(a), '-t', str(b - a), '-i', src]
        inputs += ['-loop', '1', '-framerate', str(FPS), '-i', bg, '-loop', '1', '-framerate', str(FPS), '-i', mk]
        # a small whole-window thumbnail in the corner while the camera is zoomed in (so the viewer always knows where they are)
        spans, inside, prev = [], False, None
        for (ct, fx, fy, z) in cams:
            if not inside and z >= 1.4:
                spans.append([prev[0] if prev else ct, None])
                inside = True
            elif inside and z < 1.4:
                spans[-1][1] = prev[0] + 0.5 * (ct - prev[0])
                inside = False
            prev = (ct, z)
        if inside:
            spans[-1][1] = dur
        spans = [(a_, b_) for a_, b_ in spans if b_ - a_ > 1.0] if s.get('inset', True) else []
        thumbs, th_chain = '', ''
        if spans:
            k_ = len(spans)
            th_chain = f"[srcB]scale=440:248:flags=lanczos,drawbox=0:0:iw:ih:color=white@0.85:t=3,format=rgba,split={k_}" + ''.join(f'[tz{i}]' for i in range(k_)) + ';'
            for i, (a_, b_) in enumerate(spans):
                th_chain += f"[tz{i}]fade=t=in:st={a_:.3f}:d=0.4:alpha=1,fade=t=out:st={b_ - 0.4:.3f}:d=0.4:alpha=1[tf{i}];"
        base = f"[{n}:v][uim]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1:format=auto,format=yuv420p,zoompan=z='{zc}':x='({cx})*iw-iw/zoom/2':y='({cy})*ih-ih/zoom/2':d=1:s={W}x{H}:fps={FPS},unsharp=5:5:0.45:5:5:0"
        ov = ''
        cur = '[zm]'
        ipos = {'tl': (40, 40), 'tr': (W - 480, 40), 'bl': (40, H - 288), 'br': (W - 480, H - 288)}[s.get('insetPos', 'tl')]
        for i, (a_, b_) in enumerate(spans):
            ov += f"{cur}[tf{i}]overlay=x={ipos[0]}:y={ipos[1]}:enable='between(t,{a_:.3f},{b_:.3f})'[zo{i}];"
            cur = f'[zo{i}]'
        vf = (sel + cat + f"{"[src]split=2[srcA][srcB];[srcA]" if spans else "[src]"}scale={uw}:{uh}:flags=lanczos,format=rgba[ui];[{n + 1}:v]format=gray,scale={uw}:{uh}[m];[ui][m]alphamerge[uim];"
              + th_chain + base + "[zm];" + ov + f"{cur}trim=duration={dur}[v]")
    elif mode == 'devices':
        # a laptop-sized and a phone-sized capture of the same player side by side on the stage, each rounded with a soft shadow
        lw, lh, pw_, ph = 1120, 700, 323, 700
        gap = 70
        lx, ly = (W - (lw + gap + pw_)) // 2, 110
        px, py = lx + lw + gap, ly
        stage = os.path.join(WORK, 'devstage.png')
        if not os.path.exists(stage):
            from PIL import Image, ImageDraw, ImageFilter
            img = Image.open(backdrop() or BACKDROP).convert('RGB')
            sh = Image.new('L', (W, H), 0)
            d = ImageDraw.Draw(sh)
            d.rounded_rectangle([lx, ly + 16, lx + lw, ly + lh + 16], 16, fill=200)
            d.rounded_rectangle([px - 8, py + 16, px + pw_ + 8, py + ph + 24], 36, fill=200)
            img = Image.composite(Image.new('RGB', (W, H), (0, 0, 0)), img, sh.filter(ImageFilter.GaussianBlur(30)))
            d2 = ImageDraw.Draw(img)
            d2.rounded_rectangle([px - 8, py - 8, px + pw_ + 8, py + ph + 8], 36, fill=(26, 29, 36))
            img.save(stage)
            for nm, (w_, h_, r_) in (('lap', (lw, lh, 14)), ('pho', (pw_, ph, 28))):
                m = Image.new('L', (w_, h_), 0)
                ImageDraw.Draw(m).rounded_rectangle([0, 0, w_ - 1, h_ - 1], r_, fill=255)
                m.save(os.path.join(WORK, f'devmask-{nm}.png'))
        (lf, li), (pf_, pi) = s['laptop'], s['phone']
        inputs = ['-loop', '1', '-framerate', str(FPS), '-i', stage, '-ss', str(li), '-t', str(dur), '-i', os.path.expanduser(lf), '-ss', str(pi), '-t', str(dur), '-i', os.path.expanduser(pf_),
                  '-loop', '1', '-framerate', str(FPS), '-i', os.path.join(WORK, 'devmask-lap.png'), '-loop', '1', '-framerate', str(FPS), '-i', os.path.join(WORK, 'devmask-pho.png')]
        lap_in = f"[1:v]setpts=PTS-STARTPTS,scale={lw}:{lh}:flags=lanczos,fps={FPS},format=rgba[l];[3:v]format=gray[ml];[l][ml]alphamerge[lm];"
        if s.get('url'):
            # the laptop window gets a browser toolbar with the address of the page that was captured
            from PIL import Image, ImageDraw, ImageFont
            bar_h = 52
            chrome = os.path.join(WORK, f"devchrome-{hashlib.sha1(s['url'].encode()).hexdigest()[:10]}.png")
            if not os.path.exists(chrome):
                fdir = EDL.get('fonts', '')
                im = Image.new('RGBA', (lw, lh), (0, 0, 0, 0))
                d = ImageDraw.Draw(im)
                d.rectangle([0, 0, lw, bar_h], fill=(34, 36, 42, 255))
                for k_, col in enumerate(((255, 96, 92), (255, 189, 68), (0, 202, 78))):
                    d.ellipse([18 + k_ * 26, bar_h // 2 - 7, 18 + k_ * 26 + 14, bar_h // 2 + 7], fill=col)
                f = ImageFont.truetype(os.path.join(fdir, 'Inter-400-14.ttf'), 28)
                d.rounded_rectangle([130, 7, lw - 24, bar_h - 7], (bar_h - 14) // 2, fill=(20, 21, 26, 255))
                d.text((130 + 28, bar_h // 2 + 10), s['url'], font=f, fill=(232, 234, 240, 255), anchor='ls')
                im.save(chrome)
            inputs += ['-loop', '1', '-framerate', str(FPS), '-i', chrome]
            lap_in = f"[1:v]setpts=PTS-STARTPTS,scale={lw}:{lh}:flags=lanczos,fps={FPS},format=rgba[l0];[l0][5:v]overlay=0:0:format=auto[l];[3:v]format=gray[ml];[l][ml]alphamerge[lm];"
        vf = (lap_in +
              f"[2:v]setpts=PTS-STARTPTS,scale={pw_}:{ph}:flags=lanczos,fps={FPS},format=rgba[p];[4:v]format=gray[mp];[p][mp]alphamerge[pm];"
              f"[0:v][lm]overlay=x={lx}:y={ly}:shortest=1[a];[a][pm]overlay=x={px}:y={py}:shortest=1,format=yuv420p,trim=duration={dur}[v]")
    elif mode == 'mosaic':
        # a grid of tiles playing at once on the stage: each tile is a clip (optionally a cropped part of it) in a rounded frame
        # with a short label, appearing one after another (tile["at"], seconds)
        from PIL import Image, ImageDraw, ImageFont
        backdrop()
        cols, rows = s['grid']
        tiles = s['tiles']
        gut, mar = int(s.get('gutter', 18)), int(s.get('margin', 30))
        tw = (W - 2 * mar - gut * (cols - 1)) // cols // 2 * 2
        th = (H - 2 * mar - gut * (rows - 1)) // rows // 2 * 2
        fdir = EDL.get('fonts', os.path.join(os.path.dirname(os.path.abspath(EDL.get('cards', ''))), 'fonts'))
        fsize = int(s.get('labelSize', 30))
        font = ImageFont.truetype(os.path.join(fdir, 'Inter-500-14.ttf'), fsize)
        mk = os.path.join(WORK, f'tilemask-{tw}x{th}.png')
        if not os.path.exists(mk):
            m = Image.new('L', (tw, th), 0)
            ImageDraw.Draw(m).rounded_rectangle([0, 0, tw - 1, th - 1], 16, fill=255)
            m.save(mk)
        inputs = ['-loop', '1', '-framerate', str(FPS), '-t', str(dur), '-i', BACKDROP]
        chains, last = [], '[0:v]'
        for i, t in enumerate(tiles):
            r, c = t.get('cell', divmod(i, cols))
            lab = os.path.join(WORK, f"tilelab-{hashlib.sha1((t['label'] + str(tw) + str(th) + str(fsize)).encode()).hexdigest()[:10]}.png")
            if not os.path.exists(lab):
                im = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
                d = ImageDraw.Draw(im)
                wd = d.textlength(t['label'], font=font)
                d.rounded_rectangle([14, th - 14 - fsize - 24, 14 + wd + 36, th - 14], (fsize + 24) // 2, fill=(9, 12, 19, 205))
                d.text((14 + 18, th - 14 - 12), t['label'], font=font, fill=(255, 255, 255, 250), anchor='ls')
                im.save(lab)
            sp_ = os.path.expanduser(t['src'])
            if sp_.lower().endswith(('.png', '.jpg', '.jpeg')):
                inputs += ['-loop', '1', '-framerate', str(FPS), '-t', str(dur), '-i', sp_]
            else:
                inputs += ['-ss', str(t.get('in', 0)), '-t', str(dur * float(t.get('speed', 1)) + 1), '-i', sp_]
            inputs += ['-loop', '1', '-framerate', str(FPS), '-t', str(dur), '-i', lab, '-loop', '1', '-framerate', str(FPS), '-t', str(dur), '-i', mk]
            vi, li, mi = 1 + 3 * i, 2 + 3 * i, 3 + 3 * i
            crop = t.get('crop')
            cf = f"crop=iw*{crop[2]}:ih*{crop[3]}:iw*{crop[0]}:ih*{crop[1]}," if crop else ''
            sp = float(t.get('speed', 1))
            at = float(t.get('at', 0))
            x, y = mar + c * (tw + gut), mar + r * (th + gut)
            chains.append(
                f"[{vi}:v]setpts=(PTS-STARTPTS)/{sp},fps={FPS},tpad=stop_mode=clone:stop_duration={dur},{cf}scale={tw}:{th}:force_original_aspect_ratio=increase:flags=lanczos,crop={tw}:{th},setsar=1,format=rgba[t{i}];"
                f"[{li}:v]format=rgba[l{i}];[t{i}][l{i}]overlay=0:0:format=auto[tl{i}];[{mi}:v]format=gray[g{i}];[tl{i}][g{i}]alphamerge,fade=t=in:st={at}:d=0.35:alpha=1[f{i}];"
                f"{last}[f{i}]overlay=x={x}:y={y}:format=auto[o{i}];")
            last = f'[o{i}]'
        vf = ''.join(chains) + f"{last}format=yuv420p,trim=duration={dur}[v]"
    elif mode == 'browser':
        # a page capture in a browser window on the stage: toolbar with the real address (s["url"], the address of the page captured)
        from PIL import Image, ImageDraw, ImageFont
        backdrop()
        ww = int(s.get('width', 1680))
        bar = 64
        ch_ = int(ww * 9 / 16) // 2 * 2
        wh = ch_ + bar
        sh, mk = window_shadow(ww, wh), window_mask(ww, wh)
        fdir = EDL.get('fonts', os.path.join(os.path.dirname(os.path.abspath(EDL.get('cards', ''))), 'fonts'))
        chrome = os.path.join(WORK, f"chrome-{hashlib.sha1((s['url'] + str(ww)).encode()).hexdigest()[:10]}.png")
        if not os.path.exists(chrome):
            im = Image.new('RGBA', (ww, bar), (34, 36, 42, 255))
            d = ImageDraw.Draw(im)
            for k, col in enumerate(((255, 96, 92), (255, 189, 68), (0, 202, 78))):
                d.ellipse([22 + k * 30, bar // 2 - 8, 22 + k * 30 + 16, bar // 2 + 8], fill=col)
            f = ImageFont.truetype(os.path.join(fdir, 'Inter-400-14.ttf'), 28)
            x0, x1 = 160, ww - 60
            d.rounded_rectangle([x0, 9, x1, bar - 9], (bar - 18) // 2, fill=(20, 21, 26, 255))
            d.rounded_rectangle([x0 + 20, 25, x0 + 34, 38], 3, outline=(170, 175, 185, 255), width=2)
            d.arc([x0 + 22, 18, x0 + 32, 31], 180, 360, fill=(170, 175, 185, 255), width=2)
            d.text((x0 + 52, bar // 2 + 10), s['url'], font=f, fill=(232, 234, 240, 255), anchor='ls')
            im.save(chrome)
        inputs = ['-ss', str(s.get('in', 0)), '-i', src, '-loop', '1', '-i', BACKDROP, '-loop', '1', '-i', sh, '-loop', '1', '-i', mk, '-loop', '1', '-i', chrome]
        fx = f"setpts=(PTS-STARTPTS)/{speed}," if speed != 1 else 'setpts=PTS-STARTPTS,'
        vf = (f"[0:v]{fx}scale={ww}:{ch_}:flags=lanczos,fps={FPS},pad={ww}:{wh}:0:{bar}:color=black,format=rgba[ui0];[ui0][4:v]overlay=0:0:format=auto[ui1];[3:v]format=gray,scale={ww}:{wh}[m];[ui1][m]alphamerge[uim];"
              f"[1:v][2:v]overlay[bd];[bd][uim]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1,format=yuv420p,trim=duration={dur}[v]")
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
        # a short eased rise on the way in (cubic out) and a small drop on the way out, with the fade
        pin, pout = f"clip((t-{t0:.3f})/0.7,0,1)", f"clip((t-{t1 - 0.7:.3f})/0.7,0,1)"
        yexp = f"26*pow(1-{pin},3)+14*pow({pout},2)"
        chain.append(f"{v}[o{j}]overlay=x=0:y='{yexp}':enable='between(t,{t0:.3f},{t1:.3f})'[w{j}]")
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
                 '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-maxrate', '40M', '-bufsize', '80M',
                 '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart', OUT])
    print(f'wrote {OUT} ({probe(OUT):.1f} s)')
    print('starts', json.dumps([[s['name'], round(st, 2)] for s, st in zip(segs, starts)]))
    if opt.get('sheet'):
        dur = probe(OUT)
        step = dur / 40
        ff(['-i', OUT, '-vf', f"fps=1/{step:.3f},scale=384:-1,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='%{{pts\\:hms}}':x=8:y=8:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.5,tile=5x8", '-frames:v', '1', '-q:v', '3', opt['sheet']])
        print('sheet', opt['sheet'])


main()
