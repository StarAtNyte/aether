#!/usr/bin/env python3
"""Add (or refresh) one clip's entry in <out>/clips/manifest.json: files, size, length, render settings and key metrics.

  python3 scripts/demo/film8-manifest.py <out> <clip> <master size> <sub-frames>
"""
import datetime
import json
import os
import subprocess
import sys

out, clip, size, sub = sys.argv[1:5]
man_path = os.path.join(out, 'clips', 'manifest.json')
man = json.load(open(man_path)) if os.path.exists(man_path) else {'clips': {}}
f = os.path.join(out, 'clips', clip + '.mp4')
probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,duration', '-of', 'json', f], capture_output=True, text=True).stdout
s = json.loads(probe)['streams'][0]
entry = {
    'file': clip + '.mp4',
    'file4k': clip + '-4k.mp4',
    'width': s['width'],
    'height': s['height'],
    'fps': s['r_frame_rate'],
    'frames': int(s.get('nb_frames') or 0),
    'seconds': round(float(s.get('duration') or 0), 3),
    'master_size': size,
    'subframes': int(sub),
    'rendered': datetime.datetime.now().isoformat(timespec='minutes'),
}
mp = os.path.join(out, 'clips', clip + '.metrics.json')
if os.path.exists(mp):
    m = json.load(open(mp))[0]
    entry['metrics'] = {k: m[k] for k in ('luma_resid_max', 'block_resid_p95_max', 'spike_count', 'spike_ratio_max', 'blurdetect_mean') if k in m}
man['clips'][clip] = entry
json.dump(man, open(man_path, 'w'), indent=1)
print(json.dumps(entry))
