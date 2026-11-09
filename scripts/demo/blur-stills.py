#!/usr/bin/env python3
"""ffmpeg blurdetect mean for stills (or clips), at the 1920-wide delivery size.

  python3 scripts/demo/blur-stills.py a.png b.png ...     (lower is sharper; wider images are Lanczos-scaled to 1920 first)

blurdetect measures the average edge blur width in pixels; the v7 film measured 5.2, the target for world clips is well under 3.
"""
import subprocess
import sys


def blur(path):
    w = int(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout.strip())
    vf = ('scale=1920:-2:flags=lanczos,' if w > 1920 else '') + 'blurdetect'
    r = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-vf', vf, '-f', 'null', '-'], capture_output=True, text=True).stderr
    for line in r.splitlines():
        if 'blur mean' in line:
            return float(line.split('blur mean:')[1].split()[0])
    return float('nan')


for p in sys.argv[1:]:
    print(f'{blur(p):6.2f}  {p}')
