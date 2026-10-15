import { describe, expect, it } from 'vitest';
import { selfRepair } from '../src';
import { playtest } from '../src';
import { mockApply } from '../../agent/test/helpers';

/** Games built by the offline planner from plain prompts: the bot must win every one of them. */
describe('the offline planner builds games the bot can win', () => {
  for (const prompt of ['make a coin collecting game', 'make a sky parkour obstacle course', 'a locked vault with a key and a door']) {
    it(`"${prompt}"`, async () => {
      const { result } = await mockApply(prompt);
      const r = await playtest(result.world);
      expect(r.status, r.summary).toBe('passed');
      expect(r.won).toBe(true);
      expect(r.objectives.filter((o) => o.required).every((o) => o.status === 'done')).toBe(true);
    }, 90_000);
  }

  it('the vault is solved in order: key, then door, then treasure', async () => {
    const { result } = await mockApply('a locked vault with a key and a door');
    const r = await playtest(result.world);
    const kinds = (r.trace?.events ?? []).map((e) => e.kind);
    const iKey = kinds.indexOf('pickup');
    const iDoor = kinds.indexOf('door');
    const iGoal = kinds.findIndex((k) => k === 'goal');
    expect(iKey).toBeGreaterThanOrEqual(0);
    expect(iDoor).toBeGreaterThan(iKey);
    expect(iGoal).toBeGreaterThan(iDoor);
  }, 90_000);
});

describe('breaking a planner game by prompt is caught and repaired', () => {
  it('"remove a coin" leaves the win target above the coins that exist', async () => {
    const built = (await mockApply('make a coin collecting game')).result.world;
    const broken = (await mockApply('remove a coin', built)).result.world;
    expect(Object.keys(broken.entities).length).toBe(Object.keys(built.entities).length - 1);
    const before = await playtest(broken, { trace: false });
    expect(before.status).toBe('failed');
    expect(before.findings.find((f) => f.code === 'unwinnable')?.message).toMatch(/only 7 can ever be collected/);
    const fixed = await selfRepair(broken);
    expect(fixed.passed, fixed.sentence).toBe(true);
    expect(fixed.sentence).toBe('I fixed a problem so it can be won: lowered the win target from 8 to 7, because only 7 pickups can ever be collected.');
  }, 120_000);

  it('"remove the key" leaves a door nothing can unlock', async () => {
    const built = (await mockApply('a locked vault with a key and a door')).result.world;
    const broken = (await mockApply('remove the key', built)).result.world;
    const before = await playtest(broken, { trace: false });
    expect(before.status).toBe('failed');
    const door = before.findings.find((f) => f.code === 'door_locked');
    expect(door?.message).toMatch(/nothing in the game ever sets it/);
    const fixed = await selfRepair(broken);
    expect(fixed.passed, fixed.sentence).toBe(true);
    expect(fixed.applied[0]?.sentence).toMatch(/open when you walk up to it/);
  }, 120_000);

  it('"remove all the coins" cannot be repaired by guessing: it stays reported', async () => {
    const built = (await mockApply('make a coin collecting game')).result.world;
    const broken = (await mockApply('remove all the coins', built)).result.world;
    const r = await selfRepair(broken, { maxRounds: 2 });
    expect(r.passed).toBe(false);
    expect(r.applied).toHaveLength(0);
    expect(r.sentence).toMatch(/^Could not verify/);
  }, 120_000);
});
