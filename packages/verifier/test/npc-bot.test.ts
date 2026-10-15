/**
 * An NPC world end to end: the playtest bot plays The Hollow Gate (earns gold,
 * talks to the shopkeeper, buys the key, passes the guard, leaves by the gate),
 * the win is sealed with the replay, and the standalone verifier re-checks both
 * the replay and the bot's run. One proof, one story.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { playtest, toProof } from '@aether/playtest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { botEvidenceFor, rerunBot } from '../src/bot';
import { main } from '../src/cli';
import { checkProof, createProof, type Proof } from '../src/index';
import { template } from './fixtures';

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aether-npc-bot-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  return main(args, { out: (t) => out.push(t), err: (t) => err.push(t) }).then((code) => ({ code, out: out.join('\n'), err: err.join('\n') }));
}

describe('an NPC world is verified by the bot, sealed and re-verified', () => {
  it('the bot talks to the shopkeeper, buys the key and wins', async () => {
    const world = template('hollow-gate');
    const report = await playtest(world, { trace: false });
    expect(report.status, report.summary).toBe('passed');
    const talk = report.objectives.find((o) => o.kind === 'talk');
    expect(talk?.status).toBe('done');
    expect(report.summary).toMatch(/talking to Mira/);
    expect(report.objectives.filter((o) => o.kind === 'collect').every((o) => o.status === 'done')).toBe(true);
  }, 120_000);

  it('seals the bot run with the replay and the verifier reproduces both', async () => {
    const world = template('hollow-gate');
    const bot = await botEvidenceFor(world);
    expect(bot.passed, bot.summary).toBe(true);
    const proof = await createProof(world, { playtest: bot.proof });
    expect(proof.claim.passed).toBe(true);
    expect(proof.playtest?.status).toBe('passed');
    expect(proof.replay.maxSeconds).toBeGreaterThanOrEqual(16);
    // Small enough to travel in a share link (the studio's cap is 16 KB of JSON).
    expect(JSON.stringify(proof).length).toBeLessThanOrEqual(16 * 1024);

    const replayOnly = await checkProof(proof, world);
    expect(replayOnly.status).toBe('verified');
    expect(replayOnly.botReproduced).toBe(false);
    expect(replayOnly.steps.find((s) => s.name === 'bot')?.result).toBe('skip');

    const full = await checkProof(proof, world, { playtest: rerunBot });
    expect(full.status).toBe('verified');
    expect(full.playable).toBe(true);
    expect(full.botReproduced).toBe(true);
    expect(full.steps.find((s) => s.name === 'bot')?.result).toBe('ok');
  }, 180_000);

  it('aether-verify seals the game and verifies it again (exit 0), re-playing the bot', async () => {
    const file = join(dir, 'hollow-gate.json');
    const proofFile = join(dir, 'proof.json');
    await writeFile(file, await readFile(new URL('../../../apps/studio/public/templates/worlds/hollow-gate.json', import.meta.url), 'utf8'));
    const sealed = await run(['seal', file, '--out', proofFile]);
    expect(sealed.code, sealed.err).toBe(0);
    expect(sealed.out).toMatch(/a bot played it to the win/);
    const checked = await run(['--json', proofFile]);
    expect(checked.code, checked.out).toBe(0);
    const j = JSON.parse(checked.out) as { status: string; playable: boolean; bot: { reproduced: boolean; kind: string } | null };
    expect(j.status).toBe('verified');
    expect(j.playable).toBe(true);
    expect(j.bot).toMatchObject({ reproduced: true, kind: 'game' });
    const skip = await run(['--json', '--no-bot', proofFile]);
    expect((JSON.parse(skip.out) as { bot: { reproduced: boolean } }).bot.reproduced).toBe(false);
  }, 240_000);

  it('editing the sealed bot run, or the shopkeeper afterwards, is caught', async () => {
    const world = template('hollow-gate');
    const bot = await botEvidenceFor(world);
    const proof = await createProof(world, { playtest: bot.proof });
    const forged = JSON.parse(JSON.stringify(proof)) as Proof;
    forged.playtest!.seconds = 3;
    expect((await checkProof(forged, world)).status).toBe('tampered');
    // Change what Mira sells after sealing: the sealed world no longer matches.
    const edited = structuredClone(world);
    const mira = Object.values(edited.entities).find((e) => e.npc?.role === 'shopkeeper');
    expect(mira?.npc?.dialogue).toBeDefined();
    mira!.npc!.dialogue!.nodes[mira!.npc!.dialogue!.start]!.text = 'Everything is free today.';
    expect((await checkProof(proof, edited)).status).toBe('world-mismatch');
  }, 180_000);

  it('a world where nobody can unlock the gate is not verified, and is not sealed as bot-won', async () => {
    const world = template('hollow-gate');
    const broken = structuredClone(world);
    for (const e of Object.values(broken.entities)) if (e.npc?.role === 'shopkeeper') delete e.npc.dialogue;
    const report = await playtest(broken, { trace: false });
    expect(report.status).not.toBe('passed');
    expect(report.findings.some((f) => f.code === 'door_locked' || f.code === 'talk_failed')).toBe(true);
    const proof = await createProof(broken, { playtest: toProof(report) });
    expect(proof.playtest).toBeUndefined();
  }, 180_000);
});
