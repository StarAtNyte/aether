"""Procedural ambient bed for a vignette: room tone, distant rain, a wall clock, a simmering kettle, a few birds outside.
No samples, no external audio: everything is synthesised with numpy/scipy, then a short room reverb is applied.

  python3 scripts/blender/vignette/audio.py out.wav [seconds=10] [seed=4]
"""
import sys
import wave

import numpy as np
from scipy import signal

SR = 48000


def noise(n, rng):
    return rng.standard_normal(n)


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, "low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(signal.butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def env_slow(n, rng, rate=0.4, depth=0.35):
    t = np.arange(n) / SR
    return 1.0 - depth + depth * (0.5 + 0.5 * np.sin(2 * np.pi * rate * t + rng.uniform(0, 6.28)))


def build(sec=10.0, seed=4):
    rng = np.random.default_rng(seed)
    n = int(sec * SR)
    t = np.arange(n) / SR
    L = np.zeros(n)
    R = np.zeros(n)

    # room tone: low brown-ish rumble plus a faint mains hum
    brown = lp(np.cumsum(noise(n, rng)), 180) * 1.0
    brown /= np.max(np.abs(brown)) + 1e-9
    room = 0.05 * brown + 0.004 * np.sin(2 * np.pi * 50 * t) + 0.0025 * np.sin(2 * np.pi * 100 * t)
    L += room
    R += room

    # distant rain on the roof and the leaves: band-limited hiss with slow gusts and sparse drips
    rain = bp(noise(n, rng), 1500, 7000) * 0.05 * env_slow(n, rng, 0.23, 0.4)
    rain2 = bp(noise(n, rng), 1500, 7000) * 0.05 * env_slow(n, rng, 0.19, 0.4)
    L += rain
    R += rain2
    for _ in range(int(sec * 5)):
        i = rng.integers(0, n - 2000)
        d = np.exp(-np.arange(1500) / rng.uniform(40, 120)) * np.sin(2 * np.pi * rng.uniform(1800, 4200) * np.arange(1500) / SR)
        a = rng.uniform(0.004, 0.012)
        p = rng.uniform(0.2, 0.8)
        L[i:i + 1500] += d * a * (1 - p)
        R[i:i + 1500] += d * a * p

    # wall clock, one tick a second, tick and tock alternate in pitch; panned slightly left, a touch of wood resonance
    for k in range(int(sec) + 1):
        i = int((0.35 + k) * SR)
        if i + 4000 > n:
            break
        m = 3000
        tt = np.arange(m) / SR
        f = 1900 if k % 2 == 0 else 1500
        tick = (np.exp(-tt / 0.0016) * rng.standard_normal(m) * 0.6 + np.exp(-tt / 0.012) * np.sin(2 * np.pi * f * tt) * 0.5)
        tick = bp(tick, 700, 5500)
        a = 0.09
        L[i:i + m] += tick * a * 0.75
        R[i:i + m] += tick * a * 0.35

    # kettle on a stove: bubbling simmer that builds, with the faintest rising steam whistle at the end
    bub = np.zeros(n)
    rate = np.linspace(8, 55, n)
    for i in np.where(rng.random(n) < rate / SR)[0]:
        m = 1800
        if i + m > n:
            continue
        tt = np.arange(m) / SR
        f0 = rng.uniform(250, 900)
        bub[i:i + m] += np.exp(-tt / rng.uniform(0.004, 0.012)) * np.sin(2 * np.pi * (f0 + 600 * np.exp(-tt / 0.01)) * tt) * rng.uniform(0.2, 1.0)
    bub = bp(bub, 200, 2500)
    simmer = bp(noise(n, rng), 300, 1800) * np.linspace(0.004, 0.02, n)
    kettle = (bub * 0.12 + simmer)
    whistle = np.sin(2 * np.pi * (2850 + 25 * np.sin(2 * np.pi * 5.5 * t)) * t) * np.clip((t - sec * 0.55) / (sec * 0.45), 0, 1) ** 2.0 * 0.006
    whistle *= (0.6 + 0.4 * bp(noise(n, rng), 30, 200))
    L += kettle * 0.5 + whistle * 0.5
    R += kettle * 1.0 + whistle * 1.0

    # birds in the garden: short frequency-swept chirps in small phrases, panned toward the window side
    def chirp(f0, f1, dur, shape=2.0):
        m = int(dur * SR)
        tt = np.linspace(0, 1, m)
        f = f0 + (f1 - f0) * tt ** shape
        ph = 2 * np.pi * np.cumsum(f) / SR
        e = np.sin(np.pi * tt) ** 1.5
        return np.sin(ph + 0.4 * np.sin(2 * np.pi * 38 * tt)) * e

    birds = np.zeros(n)
    t0 = 0.8
    while t0 < sec - 0.6:
        phrase = rng.integers(2, 6)
        base = rng.uniform(3000, 5200)
        x = t0
        for _ in range(phrase):
            c = chirp(base * rng.uniform(0.9, 1.1), base * rng.uniform(0.7, 1.5), rng.uniform(0.05, 0.12))
            i = int(x * SR)
            if i + len(c) < n:
                birds[i:i + len(c)] += c * rng.uniform(0.5, 1.0)
            x += rng.uniform(0.09, 0.2)
        t0 += rng.uniform(1.4, 3.2)
    birds = lp(birds, 7000) * 0.035
    pan = 0.7
    L += birds * (1 - pan)
    R += birds * pan

    # short room reverb on everything (decaying noise impulse), mixed in lightly
    ir_n = int(0.45 * SR)
    ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / (0.11 * SR))
    ir = lp(ir, 5000)
    ir /= np.sqrt(np.sum(ir ** 2))
    wetL = signal.fftconvolve(L, ir)[:n]
    wetR = signal.fftconvolve(R, ir[::-1])[:n]
    L = 0.75 * L + 0.25 * wetL
    R = 0.75 * R + 0.25 * wetR

    fade = np.minimum(1.0, np.minimum(t / 0.8, (sec - t) / 1.2))
    L *= fade
    R *= fade
    peak = max(np.max(np.abs(L)), np.max(np.abs(R)))
    g = 0.5 / peak
    return np.stack([L * g, R * g], axis=1)


def write(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    out = sys.argv[1]
    sec = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
    seed = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    write(out, build(sec, seed))
    print("wrote", out)
