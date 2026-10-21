/**
 * Studio side of the game feel: landing intensity, footstep puffs, controller rumble, the reduce-motion setting of
 * the studio and of published games, and the effect action in the visual rule editor.
 */
import { describe, expect, it } from 'vitest';
import { Action } from '@aether/core';
import { footstepEffect, landingIntensity, LANDING_MIN_SPEED } from '../src/engine/feel';
import { GamepadPoller, type PadLike } from '../src/engine/gamepad';
import { defaultSettings, loadSettings, type SettingsStorage } from '../src/player/settings';
import { DEFAULT_SETTINGS, loadSettings as loadStudioSettings } from '../src/lib/storage';
import { ACTION_FIELDS, defaultAction } from '../src/lib/ruleFields';
import { formatAction } from '../src/lib/ruleFormat';

describe('landing and footsteps', () => {
  it('a step is not a landing; harder falls land harder, up to 2', () => {
    expect(landingIntensity(-1)).toBe(0);
    expect(landingIntensity(-(LANDING_MIN_SPEED - 0.1))).toBe(0);
    expect(landingIntensity(-6)).toBeGreaterThan(0);
    expect(landingIntensity(-12)).toBeGreaterThan(landingIntensity(-6));
    expect(landingIntensity(-100)).toBe(2);
    expect(landingIntensity(Number.NaN)).toBe(0);
  });

  it('soft ground puffs, water splashes, indoor floors stay clean', () => {
    expect(footstepEffect('sand', 5)?.vfx).toBe('footstep');
    expect(footstepEffect('water', 5)?.vfx).toBe('splash');
    expect(footstepEffect('wood', 5)).toBeNull();
    expect(footstepEffect('fabric', 5)).toBeNull();
    expect(footstepEffect('sand', 9)!.scale).toBeGreaterThan(footstepEffect('sand', 2)!.scale);
  });
});

describe('controller rumble', () => {
  it('buzzes the pad in use when it has motors, spaced out, and never throws', async () => {
    const effects: Array<{ type: string; strong: number; duration: number }> = [];
    const pad: PadLike = {
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
      vibrationActuator: {
        playEffect: (type, p) => {
          effects.push({ type, strong: p.strongMagnitude, duration: p.duration });
          return Promise.resolve('complete');
        },
      },
    };
    const poller = new GamepadPoller(() => [pad]);
    expect(poller.rumble(0.5, 100, 0)).toBe(false); // no pad read yet
    poller.markConnected();
    poller.poll();
    expect(poller.rumble(0.5, 100, 1000)).toBe(true);
    expect(poller.rumble(0.9, 100, 1010)).toBe(false); // too soon
    expect(poller.rumble(2, 5000, 2000)).toBe(true);
    expect(effects).toEqual([
      { type: 'dual-rumble', strong: 0.5, duration: 100 },
      { type: 'dual-rumble', strong: 1, duration: 1000 },
    ]);
    const silent = new GamepadPoller(() => [{ ...pad, vibrationActuator: null }]);
    silent.markConnected();
    silent.poll();
    expect(silent.rumble(1, 100, 5000)).toBe(false);
    poller.dispose();
    silent.dispose();
  });
});

class MemStorage implements SettingsStorage {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

describe('reduce motion', () => {
  it('published games: follows the system by default, is remembered, bad values fall back', () => {
    expect(defaultSettings().reduceMotion).toBe(false);
    expect(defaultSettings(8, true).reduceMotion).toBe(true);
    const st = new MemStorage();
    st.setItem('aether.player.settings.v1', JSON.stringify({ reduceMotion: true }));
    expect(loadSettings(st, defaultSettings()).reduceMotion).toBe(true);
    st.setItem('aether.player.settings.v1', JSON.stringify({ reduceMotion: 'yes' }));
    expect(loadSettings(st, defaultSettings()).reduceMotion).toBe(false);
  });

  it('studio: off by default, a boolean from storage only', () => {
    expect(DEFAULT_SETTINGS.reduceMotion).toBe(false);
    const mem = (v: unknown) => ({ getItem: () => JSON.stringify(v), setItem: () => undefined, removeItem: () => undefined });
    expect(loadStudioSettings(mem({ reduceMotion: true })).reduceMotion).toBe(true);
    expect(loadStudioSettings(mem({ reduceMotion: 1 })).reduceMotion).toBe(false);
  });
});

describe('rule editor', () => {
  it('offers the effect action with its fields, a valid default and a readable card', () => {
    expect(ACTION_FIELDS.effect.map((f) => f.key)).toEqual(['vfx', 'at', 'feel']);
    const a = defaultAction('effect');
    expect(Action.safeParse(a).success).toBe(true);
    expect(formatAction(Action.parse({ do: 'effect', vfx: 'sparks', at: 'anvil', feel: 'hit' }))).toBe('EFFECT sparks (hit) at anvil');
  });
});
