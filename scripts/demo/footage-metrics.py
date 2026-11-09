#!/usr/bin/env python3
"""Objective flicker, pop and crawl metrics for world footage (a master from render-clean.ts or any clip).

  python3 scripts/demo/footage-metrics.py clip.mkv [more ...] [--region name=x,y,w,h ...] [--json out.json] [--frames clip.frames.json]

Per clip (decoded to grey; 960x540 for the flicker measures, full size for the edge measure):
  luma_resid_rms / max   the mean luma's departure from a straight line through its neighbours (|L[i] - (L[i-1]+L[i+1])/2|,
                         grey levels): exposure pops, shadow-map refreshes, bloom or fade flashes. Smooth camera motion gives ~0.
  block_resid_med / p95  the same per 30x30-px block (median over blocks: global pulsing; 95th percentile: local shimmer,
                         moving shadow edges, foliage, specular sparkle), at the worst frame and over the whole clip.
  spike_count / ratio    frame-to-frame difference D[i] against the median of its +-6 neighbours: a frame that changes
                         more than 1.6x its neighbours is a pop (LOD or cell swap, history reset); the worst ratio.
  edge_crawl             rms of the second temporal difference of the Laplacian (thin-line energy), over its rms: how much
                         edges and thin lines swim from frame to frame beyond smooth motion (aliasing crawl).
  grain_hf               mean |Laplacian| (the clip's fine detail and noise; drops when supersampling removes aliasing).
And from the frames log (render-clean.ts): tier changes, ladder levels, adaptive scale range, eye EV range and largest step,
sun-map draws per frame, frame time.
"""
import json
import subprocess
import sys

import numpy as np

W, H = 960, 540
B = 30


def probe_size(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout.strip().split(',')
    return int(out[0]), int(out[1])


def grey_frames(path, w, h):
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'scale={w}:{h}:flags=area,format=gray', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    n = w * h
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).astype(np.float32)
    p.wait()


def lap(img):
    return 4 * img[1:-1, 1:-1] - img[:-2, 1:-1] - img[2:, 1:-1] - img[1:-1, :-2] - img[1:-1, 2:]


def analyse(path, log_path=None, regions=()):
    fw, fh = probe_size(path)
    res = {'clip': path, 'size': [fw, fh]}
    luma, blocks, diffs = [], [], []
    prev = None
    for f in grey_frames(path, W, H):
        img = f.reshape(H, W)
        luma.append(float(img.mean()))
        blocks.append(img.reshape(H // B, B, W // B, B).mean(axis=(1, 3)))
        if prev is not None:
            diffs.append(float(np.abs(f - prev).mean()))
        prev = f
    L = np.array(luma)
    res['frames'] = len(L)
    r = np.abs(L[1:-1] - (L[:-2] + L[2:]) / 2) if len(L) > 2 else np.zeros(1)
    res['luma_resid_rms'] = round(float(np.sqrt((r ** 2).mean())), 4)
    res['luma_resid_max'] = round(float(r.max()), 4)
    res['luma_resid_worst_frame'] = int(r.argmax()) + 1
    Bk = np.array(blocks)
    if len(Bk) > 2:
        br = np.abs(Bk[1:-1] - (Bk[:-2] + Bk[2:]) / 2)
        res['block_resid_med'] = round(float(np.median(br)), 4)
        res['block_resid_p95'] = round(float(np.percentile(br, 95)), 4)
        res['block_resid_p99'] = round(float(np.percentile(br, 99)), 4)
        per = np.percentile(br.reshape(len(br), -1), 95, axis=1)
        res['block_resid_p95_worst_frame'] = int(per.argmax()) + 1
        res['block_resid_p95_max'] = round(float(per.max()), 4)
    D = np.array(diffs) if diffs else np.zeros(1)
    spikes = []
    for i in range(len(D)):
        nb = np.concatenate([D[max(0, i - 6):i], D[i + 1:i + 7]])
        if len(nb) and np.median(nb) > 1e-3:
            ratio = D[i] / np.median(nb)
            if ratio > 1.6:
                spikes.append((i + 1, round(float(ratio), 2)))
    res['spike_count'] = len(spikes)
    res['spike_ratio_max'] = max([s[1] for s in spikes], default=1.0)
    res['spike_frames'] = spikes[:12]
    res['diff_mean'] = round(float(D.mean()), 3)
    # Edge crawl at full size.
    laps = []
    hf = []
    for f in grey_frames(path, fw, fh):
        lp = lap(f.reshape(fh, fw))
        hf.append(float(np.abs(lp).mean()))
        laps.append(lp[::2, ::2].copy())
    if len(laps) > 2:
        num = [float(np.sqrt(((laps[i - 1] + laps[i + 1] - 2 * laps[i]) ** 2).mean())) for i in range(1, len(laps) - 1)]
        den = float(np.sqrt(np.mean([(x ** 2).mean() for x in laps])))
        res['edge_crawl'] = round(float(np.mean(num)) / max(den, 1e-6), 4)
    res['grain_hf'] = round(float(np.mean(hf)), 3)
    bd = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-vf', 'blurdetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
    for line in bd.splitlines():
        if 'blur mean' in line:
            try:
                res['blurdetect_mean'] = round(float(line.split('blur mean:')[1].split()[0]), 2)
            except (ValueError, IndexError):
                pass
    for name, (rx, ry, rw, rh) in regions:
        # A named region (full-size pixels): water, glass, a static wall. Mean-luma stability and per-pixel shimmer.
        p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-vf', f'crop={rw}:{rh}:{rx}:{ry},format=gray', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
        ims = []
        while True:
            b = p.stdout.read(rw * rh)
            if len(b) < rw * rh:
                break
            ims.append(np.frombuffer(b, np.uint8).astype(np.float32))
        p.wait()
        A = np.array(ims)
        m = A.mean(axis=1)
        if len(A) > 2:
            d2 = A[:-2] + A[2:] - 2 * A[1:-1]
            rr = np.abs(m[1:-1] - (m[:-2] + m[2:]) / 2)
            res[f'{name}_luma_resid_rms'] = round(float(np.sqrt((rr ** 2).mean())), 4)
            res[f'{name}_luma_resid_max'] = round(float(rr.max()), 4)
            res[f'{name}_shimmer'] = round(float(np.sqrt((d2 ** 2).mean()) / max(A.std(), 1e-6)), 4)
            res[f'{name}_luma_range'] = round(float(m.max() - m.min()), 3)
    if log_path:
        fl = json.load(open(log_path))['frames']
        if fl:
            tiers = [f['tier'] for f in fl]
            ev = np.array([f['eyeEv'] for f in fl])
            sd = np.diff(np.array([f['sunDraws'] for f in fl]))
            res['tier_changes'] = int(sum(1 for a, b in zip(tiers, tiers[1:]) if a != b))
            res['tiers'] = sorted(set(tiers))
            res['ladder_levels'] = sorted(set(f['ladder'] for f in fl))
            res['adaptive_scale'] = [round(min(f['scale'] for f in fl), 3), round(max(f['scale'] for f in fl), 3)]
            res['eye_ev_range'] = [round(float(ev.min()), 3), round(float(ev.max()), 3)]
            res['eye_ev_max_step'] = round(float(np.abs(np.diff(ev)).max()), 4) if len(ev) > 1 else 0
            res['sun_draws_per_frame'] = round(float(sd.mean()), 2) if len(sd) else 0
            res['ms_per_frame_mean'] = round(float(np.mean([f['ms'] for f in fl])), 0)
            res['ms_per_frame_max'] = round(float(np.max([f['ms'] for f in fl])), 0)
    return res


def main():
    args = sys.argv[1:]
    out = None
    logs = {}
    regions = []
    clips = []
    i = 0
    while i < len(args):
        if args[i] == '--json':
            out = args[i + 1]
            i += 2
        elif args[i] == '--region':
            n, v = args[i + 1].split('=')
            regions.append((n, tuple(int(x) for x in v.split(','))))
            i += 2
        elif args[i] == '--frames':
            logs[len(clips) - 1] = args[i + 1]
            i += 2
        else:
            clips.append(args[i])
            i += 1
    results = []
    for k, c in enumerate(clips):
        lp = logs.get(k) or c.rsplit('.', 1)[0] + '.frames.json'
        try:
            open(lp).close()
        except OSError:
            lp = None
        r = analyse(c, lp, regions)
        results.append(r)
        print(json.dumps(r))
    if out:
        json.dump(results, open(out, 'w'), indent=1)


if __name__ == '__main__':
    main()
