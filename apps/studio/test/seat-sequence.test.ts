import { describe, expect, it } from 'vitest';
import { seatPose } from '../src/engine/interaction';
import { DOWN_TIME, SeatSequence, UP_TIME } from '../src/engine/seat-sequence';

function run(seq: SeatSequence, seconds: number): ReturnType<SeatSequence['update']> {
  let f = seq.update(0);
  for (let t = 0; t < seconds; t += 1 / 60) f = seq.update(1 / 60);
  return f;
}

describe('seat poses', () => {
  it('a sofa seats on the cushions with the pelvis toward the backrest and an approach point in front', () => {
    const p = seatPose('sofa', [0, 0, 0], 0, [0.3, 0, 2], { width: 2.2, depth: 0.95, height: 0.85 });
    expect(p?.top).toBeCloseTo(0.42, 5);
    expect(p?.floor[1]).toBe(0);
    expect(p?.feet[2]).toBeLessThan(0);
    expect(p?.stand[2]).toBeGreaterThan(0.8);
    expect(p?.yawDeg).toBeCloseTo(180, 5);
  });

  it('a bar stool follows its own height, a bed is sat on at the nearest side edge facing out', () => {
    expect(seatPose('bar-stool', [0, 0, 0], 0, [0, 0, 1], { width: 0.4, depth: 0.4, height: 0.76 })?.top).toBeCloseTo(0.76, 5);
    const bed = seatPose('bed', [0, 0, 0], 0, [-3, 0, 0.2], { width: 1.6, depth: 2.1, height: 0.6 });
    expect(bed).not.toBeNull();
    // Left of the bed: sits on the left edge, faces −X (yaw −90 + 180 = 90 means looking toward −X in camera terms).
    expect(bed?.feet[0]).toBeLessThan(-0.4);
    expect(bed?.stand[0]).toBeLessThan(bed?.feet[0] ?? 0);
    expect(bed?.top).toBeGreaterThan(0.4);
    // The stand point is on the floor and clear of the bed.
    expect(bed?.stand[1]).toBeCloseTo(0.02, 5);
    expect(Math.abs(bed?.stand[0] ?? 0)).toBeGreaterThan(0.8);
  });

  it('a stool and a bench are seats too', () => {
    expect(seatPose('stool', [0, 0, 0], 0, [0, 0, 1])).not.toBeNull();
    expect(seatPose('bench', [0, 0, 0], 0, [0, 0, 1], 1.6)).not.toBeNull();
  });
});

describe('seat sequence', () => {
  const pose = seatPose('armchair', [2, 0, 2], 0, [2, 0, 4.5], { width: 0.9, depth: 0.9, height: 0.85 });
  if (!pose) throw new Error('no pose');

  it('walks to the approach point, turns, lowers onto the seat, stays, rises and steps out', () => {
    const seq = new SeatSequence(pose, [2, 0, 4.5]);
    expect(seq.update(0).phase).toBe('approach');
    const walked = run(seq, 1);
    expect(['approach', 'turn']).toContain(walked.phase);
    const turned = run(seq, 0.6);
    expect(turned.phase).toBe('down');
    expect(turned.yawDeg).toBeCloseTo(pose.yawDeg, 5);
    const mid = run(seq, DOWN_TIME * 0.5);
    expect(mid.sitting).toBe(true);
    const seated = run(seq, DOWN_TIME);
    expect(seated.phase).toBe('seated');
    expect(seated.position[0]).toBeCloseTo(pose.floor[0], 5);
    expect(seated.position[2]).toBeCloseTo(pose.floor[2], 5);
    expect(seated.blend).toBe(1);
    seq.standUp();
    const up = run(seq, UP_TIME * 0.5);
    expect(up.phase).toBe('up');
    expect(up.sitting).toBe(false);
    const done = run(seq, UP_TIME);
    expect(seq.finished).toBe(true);
    expect(done.position[2]).toBeCloseTo(pose.stand[2], 5);
  });

  it('the body never leaves the floor plane and moves smoothly (no teleport between frames)', () => {
    const seq = new SeatSequence(pose, [3, 0, 5]);
    let last = seq.update(0).position;
    let worst = 0;
    for (let i = 0; i < 60 * 4; i++) {
      const f = seq.update(1 / 60);
      expect(f.position[1]).toBe(0);
      worst = Math.max(worst, Math.hypot(f.position[0] - last[0], f.position[2] - last[2]));
      last = f.position;
    }
    // Walking pace: well under 4 m/s at 60 Hz.
    expect(worst).toBeLessThan(4 / 60);
  });

  it('asking to stand while lowering waits for the lowering, and asking before sitting cancels', () => {
    const a = new SeatSequence(pose, [2, 0, 4.5]);
    run(a, 1.4);
    a.standUp();
    run(a, DOWN_TIME + UP_TIME + 0.2);
    expect(a.finished).toBe(true);
    const b = new SeatSequence(pose, [2, 0, 5.5]);
    b.standUp();
    expect(b.finished).toBe(true);
  });
});
