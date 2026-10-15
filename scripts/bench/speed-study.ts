/**
 * Verification speed: how fast the headless physics proof runs relative to
 * real time, what a fork costs, and whether a fork replays exactly.
 */
import type { WorldDoc } from '@aether/core';
import { PhysicsWorld, type VerifyReport } from '@aether/physics';
import { median, realtimeMultiple, round } from './metrics';
import { runVerify } from './world-eval';

/** Fixed step of the simulation (the studio's rate). */
const DT = 1 / 60;

/** Speed numbers of one world. */
export interface SpeedRow {
  id: string;
  bodies: number;
  /** Median wall time of the full proof (diagnostics, tests, rules), ms. */
  verifyMs: number;
  /** Simulated seconds the proof covered. */
  verifySimSeconds: number;
  /** Simulated seconds per wall second during the proof. */
  verifyRealtime: number;
  /** Raw physics throughput: simulated seconds per wall second for plain stepping (no rules). */
  stepRealtime: number;
  /** Median cost of a create from the document, ms. */
  createMs: number;
  /** Median cost of a fork of a running world (snapshot + restore), ms. */
  forkMs: number;
  /** Snapshot size, bytes. */
  snapshotBytes: number;
  /** Forks per second at that cost. */
  forksPerSecond: number;
  /** Largest position difference between a fork and the original after 5 s (m); 0 = exact replay. */
  forkDriftM: number;
}

function movingIds(world: WorldDoc, pw: PhysicsWorld): string[] {
  return Object.values(world.entities).filter((e) => pw.has(e.id) && e.physics?.body === 'dynamic').map((e) => e.id);
}

/** Measure one world. `repeats` timings are taken and the median reported. */
export async function speedOf(id: string, world: WorldDoc, repeats = 5): Promise<SpeedRow> {
  const verifyMs: number[] = [];
  let sim = 0;
  for (let i = 0; i < repeats; i++) {
    const t0 = performance.now();
    const r = (await runVerify(world)).report as VerifyReport;
    verifyMs.push(performance.now() - t0);
    sim = r.simulatedSeconds;
  }

  const createMs: number[] = [];
  const forkMs: number[] = [];
  let bodies = 0;
  let snapshotBytes = 0;
  let stepRealtime = 0;
  let forkDriftM = 0;
  for (let i = 0; i < repeats; i++) {
    const t0 = performance.now();
    const pw = await PhysicsWorld.create(world, { fixedDt: DT });
    createMs.push(performance.now() - t0);
    try {
      bodies = pw.stats().bodies;
      const s0 = performance.now();
      for (let k = 0; k < 60; k++) pw.stepFixed();
      if (i === 0) stepRealtime = realtimeMultiple(1, performance.now() - s0);
      const f0 = performance.now();
      const fork = await pw.fork();
      forkMs.push(performance.now() - f0);
      if (i === 0) {
        snapshotBytes = pw.snapshot().byteLength;
        // Replay: the fork and the original run 5 s side by side and must agree.
        const ids = movingIds(world, pw).slice(0, 200);
        for (let k = 0; k < 300; k++) {
          pw.stepFixed();
          fork.stepFixed();
        }
        for (const eid of ids) {
          const a = pw.getState(eid)?.position;
          const b = fork.getState(eid)?.position;
          if (a && b) forkDriftM = Math.max(forkDriftM, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
        }
        // Throughput over a longer run (10 s) is steadier than the first second.
        const l0 = performance.now();
        for (let k = 0; k < 600; k++) fork.stepFixed();
        stepRealtime = realtimeMultiple(10, performance.now() - l0);
      }
      fork.dispose();
    } finally {
      pw.dispose();
    }
  }
  const fm = median(forkMs);
  return {
    id,
    bodies,
    verifyMs: round(median(verifyMs), 1),
    verifySimSeconds: round(sim, 1),
    verifyRealtime: round(realtimeMultiple(sim, median(verifyMs)), 0),
    stepRealtime: round(stepRealtime, 0),
    createMs: round(median(createMs), 2),
    forkMs: round(fm, 2),
    snapshotBytes,
    forksPerSecond: fm > 0 ? round(1000 / fm, 0) : 0,
    forkDriftM: Math.round(forkDriftM * 1e6) / 1e6,
  };
}
