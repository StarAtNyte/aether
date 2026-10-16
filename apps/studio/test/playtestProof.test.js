import { describe, expect, it } from 'vitest';
import { createWorld } from '@aether/core';
import { EVIDENCE_LIMITS, evidenceSentence, evidenceTrace, hashWorld, playtest, toProof } from '@aether/playtest';
import { checkProof, createProof } from '@aether/verifier';
import { rerunBot } from '@aether/verifier/bot';
import { decodeShare, encodeShare } from '../src/publish/share';
import { gameJson, parseGameManifest } from '../src/publish/manifest';
import { badgeOf, clock, isStale, nextSpeed, objectiveStatusText } from '../src/lib/playtestView';
import { botEvidence, claimedPlayable } from '../src/player/ProofBadge';
import { playtestKindOf, reportViews } from '../src/engine/playtest/controller';
function coinGame(extra = {}) {
    const entities = {};
    for (const [i, x] of [3, -3].entries()) {
        entities[`coin-${i}`] = {
            id: `coin-${i}`,
            shape: { kind: 'primitive', primitive: 'sphere', size: [0.5, 0.5, 0.5] },
            transform: { position: [x, 1, 0] },
            behaviors: [{ type: 'collectible', params: { scoreKey: 'score', value: 1 } }],
        };
    }
    return createWorld({
        ...extra,
        name: 'Coin test',
        entities,
        state: { score: 0 },
        player: { mode: 'thirdPerson', spawn: [0, 0.5, 0], moveSpeed: 6, jumpSpeed: 6 },
        rules: [{ id: 'win', when: { on: 'state', key: 'score', op: '>=', value: 2 }, then: [{ do: 'win', text: 'done' }], once: true }],
    });
}
const base = (over = {}) => ({
    status: 'idle',
    kind: 'game',
    head: null,
    progress: null,
    sentence: '',
    repairs: [],
    findings: [],
    objectives: [],
    seconds: 0,
    ms: 0,
    replay: false,
    proven: false,
    worker: false,
    ...over,
});
describe('the bot\'s run travels inside the sealed replay proof', () => {
    it('seals the winning run with the replay, and a share link carries both', async () => {
        const world = coinGame();
        const report = await playtest(world);
        expect(report.status).toBe('passed');
        const bot = toProof(report);
        const proof = await createProof(world, { playtest: bot });
        expect(proof.playtest?.status).toBe('passed');
        expect(proof.playtest?.worldHash).toBe(bot.worldHash);
        expect((proof.playtest?.trace?.frames ?? 0) <= EVIDENCE_LIMITS.MAX_FRAMES).toBe(true);
        const enc = await encodeShare(world, { title: 'Coins' }, proof);
        expect(enc.sealed).toBe(true);
        const dec = await decodeShare(enc.value);
        expect(dec.ok).toBe(true);
        if (!dec.ok)
            return;
        // The decoded world hashes to the same gameplay hash (the link round trip keeps gameplay intact).
        expect(hashWorld(dec.payload.world)).toBe(bot.worldHash);
        const ev = botEvidence(dec.payload.proof);
        expect(ev?.status).toBe('passed');
        expect(evidenceTrace(ev)?.frames).toBe(proof.playtest?.trace?.frames);
        const check = await checkProof(dec.payload.proof, dec.payload.world, { playtest: rerunBot });
        expect(check.status).toBe('verified');
        expect(check.botReproduced).toBe(true);
        expect(check.playable).toBe(true);
    }, 120_000);
    it('a failed or stale bot run is never sealed in', async () => {
        const world = coinGame();
        const bot = toProof(await playtest(world));
        await expect(createProof(coinGame({ seed: 99 }), { playtest: bot })).rejects.toThrow(/another version/);
        const plain = await createProof(world, { playtest: { ...bot, status: 'failed' } });
        expect(plain.playtest).toBeUndefined();
    }, 120_000);
    it('editing the sealed bot run is caught as tampering', async () => {
        const world = coinGame();
        const proof = await createProof(world, { playtest: toProof(await playtest(world)) });
        const edited = JSON.parse(JSON.stringify(proof));
        edited.playtest.seconds = 1;
        expect((await checkProof(edited, world)).status).toBe('tampered');
    }, 120_000);
    it('game.json round-trips the sealed proof', async () => {
        const world = coinGame();
        const proof = await createProof(world, { playtest: toProof(await playtest(world)) });
        const game = { title: 'Coins', description: '', author: '', controls: '', music: null, world, proof };
        const parsed = parseGameManifest(JSON.parse(gameJson(game)));
        expect(parsed.ok).toBe(true);
        if (parsed.ok)
            expect(botEvidence(parsed.game.proof)?.worldHash).toBe(proof.playtest?.worldHash);
    }, 120_000);
});
describe('the controller helpers', () => {
    it('walks buildings and plays everything else', () => {
        expect(playtestKindOf(coinGame())).toBe('game');
        const house = coinGame();
        house.entities['coin-0'].arch = { role: 'building' };
        expect(playtestKindOf(house)).toBe('walkthrough');
    });
    it('turns a report into compact views: errors first, bounded, notes dropped', async () => {
        const report = await playtest(createWorld({ entities: { c: { id: 'c', shape: { kind: 'primitive', primitive: 'box', size: [1, 1, 1] }, transform: { position: [0, 30, 0] }, behaviors: [{ type: 'collectible', params: {} }] } }, rules: [{ id: 'w', when: { on: 'state', key: 'score', op: '>=', value: 1 }, then: [{ do: 'win', text: 'x' }] }], state: { score: 0 } }));
        expect(report.status).toBe('failed');
        const { findings, objectives } = reportViews(report);
        expect(findings[0]?.severity).toBe('error');
        expect(findings.length).toBeLessThanOrEqual(12);
        expect(objectives.some((o) => o.status !== 'done')).toBe(true);
        expect(findings.every((f) => f.severity !== 'info' || f.code === 'fell')).toBe(true);
    }, 60_000);
});
describe('the Verified badge is green only for a real pass on this world', () => {
    const passed = base({ status: 'passed', head: 7, proven: true, sentence: 'Verified playable: the bot won in 20 s.' });
    it('shows verified for a proven pass on the current history entry', () => {
        const b = badgeOf(passed, 7);
        expect(b).toMatchObject({ tone: 'ok', verified: true, text: 'Verified playable' });
    });
    it('is never green when the world moved on, the run was not proven, or it failed', () => {
        expect(badgeOf(passed, 8).verified).toBe(false);
        expect(isStale(passed, 8)).toBe(true);
        expect(badgeOf({ ...passed, proven: false }, 7).verified).toBe(false);
        for (const status of ['failed', 'inconclusive', 'unsupported', 'error', 'running', 'idle']) {
            const b = badgeOf(base({ status, head: 7, proven: true, progress: { fraction: 0.4, note: 'walking', seconds: 1, round: 0 } }), 7);
            expect(b.verified, status).toBe(false);
            expect(b.tone, status).not.toBe('ok');
        }
    });
    it('speaks honestly in the failure and walkthrough states', () => {
        expect(badgeOf(base({ status: 'failed', head: 1, sentence: 'Could not verify: the key is unreachable.' }), 1)).toMatchObject({ tone: 'bad', text: 'Could not verify' });
        expect(badgeOf({ ...passed, kind: 'walkthrough' }, 7).text).toBe('Verified walkable');
        expect(badgeOf(base({ status: 'running', progress: { fraction: 0.5, note: 'x', seconds: 0, round: 1 } }), 1).text).toMatch(/Re-checking… 50%/);
    });
    it('formats replay times and cycles the speed', () => {
        expect(clock(65.4)).toBe('1:05');
        expect(clock(-3)).toBe('0:00');
        expect(nextSpeed(1)).toBe(2);
        expect(nextSpeed(8)).toBe(0.5);
        expect(objectiveStatusText('done', 41)).toBe('done at 0:41');
        expect(objectiveStatusText('unreachable')).toBe('cannot be reached');
    });
    it('the player badge reads the bot run out of the proof, and ignores junk', async () => {
        const world = coinGame();
        const proof = await createProof(world, { playtest: toProof(await playtest(world)) });
        expect(botEvidence(proof)?.kind).toBe('game');
        expect(evidenceSentence(botEvidence(proof))).toMatch(/^A bot played it to the win in \d+ s/);
        expect(botEvidence({ ...proof, playtest: { v: 1, junk: true } })).toBeNull();
        expect(botEvidence(null)).toBeNull();
        expect(botEvidence({})).toBeNull();
        expect(claimedPlayable(proof)).toBe(true);
    }, 120_000);
});
