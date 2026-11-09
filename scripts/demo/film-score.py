"""An original procedural bed for the product demo: a warm pad, a soft pulse, a plucked line, and sound design on the cuts
(UI clicks and whooshes), all synthesised here with numpy: no samples, no external music.

  python3 scripts/demo/film-score.py <edl.json> <out.wav> [--bpm 100]

Timing comes from the edit decision list: each segment's start (the crossfades taken into account) is where a click or a
whoosh lands. A segment's "sfx" key picks it: "whoosh" (a filtered noise sweep arriving on the cut), "click" (a short
tick, for UI takes), or nothing. The bed builds from a sparse opening to a steady pulse and resolves on the end card.
"""
import json
import sys

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000
edl = json.load(open(sys.argv[1]))
out = sys.argv[2]
bpm = float(sys.argv[sys.argv.index('--bpm') + 1]) if '--bpm' in sys.argv else 100.0
segs = edl['segments']
xf = [0.0] + [float(s.get('xfade', 0.6)) for s in segs[1:]]
starts, t = [], 0.0
for i, s in enumerate(segs):
    t -= xf[i]
    starts.append(t)
    t += float(s['dur'])
total = t + 1.0
N = int(total * SR)
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)


def mid(f):
    return 440.0 * 2 ** ((f - 69) / 12)


def lp(x, fc, order=2):
    return sosfilt(butter(order, fc, 'low', fs=SR, output='sos'), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc, 'high', fs=SR, output='sos'), x)


def put(buf, x, at, gain=1.0):
    i = int(at * SR)
    if i >= N or i + len(x) <= 0:
        return
    a = max(0, -i)
    j = min(len(x), N - i)
    buf[i + a:i + j] += x[a:j] * gain


beat = 60.0 / bpm
bar = 4 * beat
# four chords, a bar each pair: Dmaj7, Bm7, Gmaj7, A(sus), as midi notes
chords = [[50, 57, 61, 66], [47, 54, 57, 62], [43, 55, 59, 66], [45, 52, 57, 64]]
chord_len = 2 * bar

# the energy over the film: sparse for the hook, steady after, a calmer last stretch
end_card = starts[-1]
hook_end = starts[1] if len(starts) > 1 else 5.0


def energy(tt):
    if tt < hook_end - 1:
        return 0.0
    if tt >= end_card:
        return 0.0
    return 1.0


# pad: detuned saws through a slow lowpass, one swell per chord
def pad(notes, dur):
    n = int((dur + 1.5) * SR)
    tt = np.arange(n) / SR
    sig = np.zeros(n)
    for m in notes:
        f = mid(m)
        for det in (-0.07, 0.0, 0.07):
            ph = rng.random()
            sig += 2 * ((tt * f * 2 ** (det / 12) + ph) % 1.0) - 1
    sig = lp(sig, 900) / (len(notes) * 3)
    env = np.minimum(1, tt / 1.4) * np.minimum(1, np.maximum(0, (dur + 1.5 - tt) / 1.5))
    return sig * env


k = 0
tt0 = 0.0
while tt0 < total:
    c = chords[k % len(chords)]
    p = pad(c, chord_len)
    put(L, p, tt0, 0.30)
    put(R, np.roll(p, 47), tt0, 0.30)
    # sub bass on the root
    n = int((chord_len + 0.3) * SR)
    x = np.arange(n) / SR
    sub = np.sin(2 * np.pi * mid(c[0] - 12) * x) * np.minimum(1, x / 0.3) * np.minimum(1, (chord_len + 0.3 - x) / 0.3)
    put(L, sub, tt0, 0.22)
    put(R, sub, tt0, 0.22)
    tt0 += chord_len
    k += 1


# soft pulse: a muted low thump on each beat once the hook is over, a quiet tick on the off-beats
def thump():
    n = int(0.3 * SR)
    x = np.arange(n) / SR
    f = 52 + 70 * np.exp(-x * 35)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 11)


def tick():
    n = int(0.05 * SR)
    x = np.arange(n) / SR
    return hp(rng.standard_normal(n), 6500) * np.exp(-x * 90)


th, tk = thump(), tick()
b = 0
while b * beat < end_card + 2:
    tb = b * beat
    if energy(tb) > 0:
        put(L, th, tb, 0.30 if b % 4 == 0 else 0.20)
        put(R, th, tb, 0.30 if b % 4 == 0 else 0.20)
        put(L, tk, tb + beat / 2, 0.05)
        put(R, tk, tb + beat / 2, 0.05)
    b += 1


# plucked line: an eighth-note arpeggio of the chord tones, sparser in the hook
def pluck(f, dur=0.7):
    n = int(dur * SR)
    x = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * x) + 0.35 * np.sin(2 * np.pi * 2 * f * x) * np.exp(-x * 14) + 0.12 * np.sin(2 * np.pi * 3 * f * x) * np.exp(-x * 20)
    return s * np.exp(-x * 6.5) * np.minimum(1, x / 0.004)


pattern = [0, 2, 3, 2, 1, 3, 2, 3]
step = beat / 2
i = 0
while i * step < total - 1:
    tt = i * step
    c = chords[int(tt // chord_len) % len(chords)]
    note = c[pattern[i % len(pattern)]] + 12
    en = energy(tt)
    if tt < end_card + 1.5 and (en > 0 or i % 2 == 0) and not (tt >= end_card and i % 2):
        g = 0.12 if en > 0 else 0.07
        pk = pluck(mid(note))
        pan = 0.5 + 0.35 * np.sin(i * 0.9)
        put(L, pk, tt, g * (1 - pan) * 1.6)
        put(R, pk, tt, g * pan * 1.6)
    i += 1

# sound design on the cuts
def whoosh(dur=0.45):
    n = int(dur * SR)
    x = np.arange(n) / SR
    nz = rng.standard_normal(n)
    # a bandpass swept up while it swells, then gone on the cut
    out_ = np.zeros(n)
    blocks = 24
    bs = n // blocks
    for j in range(blocks):
        fc = 400 * (2 ** (j / blocks * 4.0))
        seg = nz[j * bs:(j + 1) * bs]
        sos = butter(2, [fc, min(fc * 1.8, 18000)], 'band', fs=SR, output='sos')
        out_[j * bs:(j + 1) * bs] = sosfilt(sos, seg)
    env = (x / dur) ** 2.0 * np.exp(-((x / dur) ** 8) * 0.0)
    env = env * np.minimum(1, (dur - x) / 0.05)
    return out_ * env


def click():
    n = int(0.06 * SR)
    x = np.arange(n) / SR
    s = np.sin(2 * np.pi * 1800 * x) * np.exp(-x * 160) + 0.4 * hp(rng.standard_normal(n), 3000) * np.exp(-x * 220)
    return s


wh, ck = whoosh(), click()
for s, st in zip(segs, starts):
    kind = s.get('sfx')
    if kind == 'whoosh':
        put(L, wh, st - 0.38, 0.55)
        put(R, wh, st - 0.38, 0.55)
    elif kind == 'click':
        put(L, ck, st + 0.35, 0.55)
        put(R, ck, st + 0.35, 0.55)
for ct in edl.get('clicks', []):
    put(L, ck, ct, 0.5)
    put(R, ck, ct, 0.5)

# a small room: a decaying noise impulse, mixed in under the dry signal
ir_n = int(1.6 * SR)
x = np.arange(ir_n) / SR
ir = lp(rng.standard_normal(ir_n), 5000) * np.exp(-x * 3.2)
ir /= np.sqrt((ir ** 2).sum())
wetL = fftconvolve(L, ir)[:N]
wetR = fftconvolve(R, ir[::-1])[:N]
L = L * 0.78 + wetL * 0.35
R = R * 0.78 + wetR * 0.35
y = np.stack([hp(L, 30), hp(R, 30)], 1)
y /= np.abs(y).max() * 1.05
import wave

pcm = (y * 32767).astype('<i2')
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('score', round(total, 1), 's ->', out)
