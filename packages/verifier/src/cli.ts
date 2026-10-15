/**
 * `aether-verify`: check a proof from the command line.
 *
 *   aether-verify proof.json            proof (with its world inside), or a game.json
 *   aether-verify build-dir/            a published build folder (reads game.json)
 *   aether-verify proof.json --world game.json
 *   aether-verify seal game.json --out proof.json [--key key.json]
 *   aether-verify keygen key.json
 *
 * Exit status: 0 verified, 1 not verified (tampered, mismatched, diverged,
 * invalid ...), 2 usage or unreadable input.
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkProof, describeClaim, type ProofCheck } from './check';
import { parseProofJson, splitBundle, stringifyBundle } from './embed';
import { evidenceSentence } from '@aether/playtest/proof';
import { PROOF_LIMITS } from './proof';
import { createProof, generateSigningKey, type SigningKeyPair } from './seal';

/** Where the CLI writes. */
export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

const HELP = `aether-verify - re-simulate a sealed Aether world and check its proof

Usage:
  aether-verify <proof.json | game.json | build-dir> [--world <file>] [--trust <publicKey>]... [--no-replay] [--no-bot] [--json]
  aether-verify seal <game.json | world.json> [--out proof.json] [--key key.json] [--seconds <n>] [--no-bot]
  aether-verify keygen <key.json>

A pass means an independent deterministic replay reproduced the claimed
outcome. A seal can also carry the playtest bot's winning run; checking it
re-plays the game with the bot (skip with --no-bot). It is not a formal proof
that the game is correct.
Exit status: 0 verified, 1 not verified, 2 usage error.
`;

async function readJson(path: string): Promise<unknown> {
  const info = await stat(path);
  if (info.isDirectory()) return readJson(join(path, 'game.json'));
  if (info.size > PROOF_LIMITS.MAX_BYTES * 2) throw new Error(`${path}: file is too large`);
  const v = parseProofJson(await readFile(path, 'utf8'));
  if (v === null) throw new Error(`${path}: not valid JSON (or over the size cap)`);
  return v;
}

/** The world inside a game manifest (`aether-game`) or a world export (`aether-world`); a bare world is itself. */
function worldOf(raw: unknown): unknown {
  const f = (raw as { format?: string } | null)?.format;
  return f === 'aether-game' || f === 'aether-world' ? (raw as { world: unknown }).world : raw;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, v === undefined ? 1 : 2);
  return v;
}

function flagAll(args: string[], name: string): string[] {
  const out: string[] = [];
  for (;;) {
    const v = flag(args, name);
    if (v === undefined) return out;
    out.push(v);
  }
}

function printCheck(c: ProofCheck, io: CliIo): void {
  const mark = (r: string): string => (r === 'ok' ? 'ok  ' : r === 'fail' ? 'FAIL' : '-   ');
  io.out(`${c.ok ? 'VERIFIED' : c.status === 'intact' ? 'INTACT' : 'NOT VERIFIED'} (${c.status})`);
  io.out(c.summary);
  for (const s of c.steps) io.out(`  ${mark(s.result)} ${s.name.padEnd(12)} ${s.detail}`);
  for (const d of c.differences.slice(0, 10)) io.out(`  ! ${d}`);
  if (c.proof) io.out(describeClaim(c.proof));
  if (c.playtest) io.out(`${evidenceSentence(c.playtest)}${c.botReproduced ? ' Re-played just now: it won again.' : ''}`);
  if (c.signature) io.out(`signed by key ${c.signature.keyId} (${c.signature.valid ? 'signature valid' : 'signature INVALID'}); the key is not tied to an identity`);
  io.out(`${c.ms} ms`);
}

/** Run the CLI; resolves to the exit status. */
export async function main(argv: string[], io: CliIo = { out: (t) => process.stdout.write(`${t}\n`), err: (t) => process.stderr.write(`${t}\n`) }): Promise<number> {
  const args = [...argv];
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    io.out(HELP);
    return args.length === 0 ? 2 : 0;
  }
  try {
    const cmd = args[0];
    if (cmd === 'keygen') {
      const path = args[1];
      if (!path) {
        io.err('keygen needs an output path');
        return 2;
      }
      const key = await generateSigningKey();
      await writeFile(path, JSON.stringify(key, null, 2), { mode: 0o600 });
      io.out(`wrote ${path} (keep it secret). Public key: ${key.publicKey}`);
      return 0;
    }
    if (cmd === 'seal') {
      args.shift();
      const out = flag(args, '--out') ?? 'proof.json';
      const keyPath = flag(args, '--key');
      const secondsFlag = flag(args, '--seconds');
      const file = args[0];
      if (!file) {
        io.err('seal needs a game.json or world file');
        return 2;
      }
      const raw = await readJson(file);
      const world = worldOf(raw);
      const key = keyPath ? ((await readJson(keyPath)) as SigningKeyPair) : undefined;
      const { validateWorld } = await import('@aether/core');
      const v = validateWorld(world);
      if (!v.ok) {
        io.err(`${file}: not a valid world`);
        return 2;
      }
      const noBot = args.includes('--no-bot');
      let bot: import('./bot').BotRun | null = null;
      if (!noBot) {
        bot = await (await import('./bot')).botEvidenceFor(v.world);
        if (!bot.passed) io.err(`note: the bot did not win it (${bot.summary}); sealing without bot evidence`);
      }
      const proof = await createProof(v.world, { ...(secondsFlag !== undefined && Number.isFinite(Number(secondsFlag)) ? { settings: { maxSeconds: Number(secondsFlag), traceHz: 12 } } : {}), ...(key ? { key } : {}), ...(bot?.passed ? { playtest: bot.proof } : {}) });
      await writeFile(out, stringifyBundle(proof, v.world));
      io.out(`sealed ${out}: ${describeClaim(proof)}${proof.playtest ? '; a bot played it to the win' : ''}${key ? '; signed' : '; unsigned'}`);
      return 0;
    }
    const json = args.includes('--json');
    const noReplay = args.includes('--no-replay');
    const noBot = args.includes('--no-bot');
    const trusted = flagAll(args, '--trust');
    const worldPath = flag(args, '--world');
    const file = args.find((a) => !a.startsWith('--'));
    if (!file) {
      io.err('missing proof file');
      return 2;
    }
    const bundle = splitBundle(await readJson(file));
    if (!bundle) {
      io.err(`${file}: no Aether proof found in this file`);
      return 2;
    }
    let world = bundle.world;
    if (worldPath) {
      const w = await readJson(worldPath);
      world = worldOf(w);
    }
    const sealedBot = typeof bundle.proof === 'object' && bundle.proof !== null && 'playtest' in bundle.proof;
    const rerun = sealedBot && !noBot && !noReplay ? (await import('./bot')).rerunBot : undefined;
    const check = await checkProof(bundle.proof, world, { replay: !noReplay, ...(rerun ? { playtest: rerun } : {}), ...(trusted.length > 0 ? { trustedKeys: trusted } : {}) });
    if (json) io.out(JSON.stringify({ status: check.status, ok: check.ok, playable: check.playable, summary: check.summary, steps: check.steps, signature: check.signature, differences: check.differences, bot: check.playtest ? { reproduced: check.botReproduced, kind: check.playtest.kind, seconds: check.playtest.seconds } : null, ms: check.ms }));
    else printCheck(check, io);
    return check.ok || check.status === 'intact' ? 0 : 1;
  } catch (e) {
    io.err(`aether-verify: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}
