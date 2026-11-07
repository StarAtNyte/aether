import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Story, storyDuration, validateWorld, type StoryInput } from '@aether/core';
import { worldIrHash } from '@aether/render';
import { actorPoses, alongPath, blendGrade, ease, pathLengths, shotAt, shotStarts, storyCast, storyFrame } from '../src/player/story';
import { groundPath } from '../src/player/story-runner';
import { experienceFor, keyAction, keyHint } from '../src/player/experience';
import { templatePublish } from '../src/showcase/publish';

const S: StoryInput = {
  shots: [
    { duration: 4, camera: { position: [0, 2, 10], target: [0, 1, 0], fov: 40 }, cameraTo: { position: [4, 2, 10], target: [0, 1, 0], fov: 30 }, ease: 'linear', title: 'Hello', transition: 'fade', transitionSeconds: 1, grade: { exposureEv: 0, gradientTop: '#000000', practicals: 0 }, gradeTo: { exposureEv: -1, gradientTop: '#ffffff', practicals: 1 } },
    { duration: 2, camera: { position: [1, 1, 1], target: [0, 0, 0] }, caption: 'A line', moves: [{ entity: 'girl', path: [[0, 0, 0], [10, 0, 0]], ease: 'linear', face: [10, 0, 10] }] },
    { duration: 2, camera: { position: [1, 1, 1], target: [0, 0, 0] }, track: 'girl', trackOffset: [0, 1, 0], hour: 19 },
  ],
  endCard: { title: 'The end' },
};
const story = Story.parse(S);
const starts = shotStarts(story);

describe('story timeline', () => {
  it('finds the shot at a time and the running time', () => {
    expect(starts).toEqual([0, 4, 6, 8]);
    expect(storyDuration(story)).toBe(8);
    expect(shotAt(starts, 0)).toBe(0);
    expect(shotAt(starts, 3.99)).toBe(0);
    expect(shotAt(starts, 4)).toBe(1);
    expect(shotAt(starts, 7.9)).toBe(2);
    expect(shotAt(starts, 8)).toBe(-1);
  });

  it('moves the camera between its poses and fades in', () => {
    const a = storyFrame(story, starts, 0);
    expect(a.camera.position).toEqual([0, 2, 10]);
    expect(a.fade.alpha).toBeCloseTo(1);
    expect(a.title).toBe('Hello');
    const b = storyFrame(story, starts, 2);
    expect(b.camera.position[0]).toBeCloseTo(2);
    expect(b.camera.fov).toBeCloseTo(35);
    expect(b.fade.alpha).toBe(0);
    // A held shot keeps the field of view the last shot ended on.
    expect(storyFrame(story, starts, 5).camera.fov).toBe(30);
  });

  it('blends the grade across a shot and carries it into the next', () => {
    const mid = storyFrame(story, starts, 2).grade;
    expect(mid.exposureEv).toBeCloseTo(-0.5);
    expect(mid.practicals).toBeCloseTo(0.5);
    expect(mid.gradientTop).toBe('#808080');
    expect(storyFrame(story, starts, 5).grade).toMatchObject({ exposureEv: -1, practicals: 1, gradientTop: '#ffffff' });
    expect(blendGrade({ bloom: 1 }, { bloom: 2, grain: 0.5 }, 0.5)).toEqual({ bloom: 1.5, grain: 0.5 });
  });

  it('shows captions inside their shot and the end card after the last', () => {
    expect(storyFrame(story, starts, 5).caption).toBe('A line');
    expect(storyFrame(story, starts, 1).caption).toBeNull();
    expect(storyFrame(story, starts, 7.5).hour).toBe(19);
    expect(storyFrame(story, starts, 7.5).fade.alpha).toBeGreaterThan(0.1);
    const end = storyFrame(story, starts, 9);
    expect(end.done).toBe(true);
    expect(end.fade.alpha).toBe(1);
  });

  it('carries people along their paths, faces the way they go, then turns to face a point', () => {
    expect(actorPoses(story, starts, 1).has('girl')).toBe(false);
    const p = actorPoses(story, starts, 5).get('girl')!;
    expect(p.position[0]).toBeCloseTo(5);
    // Yaw 0 faces −Z: walking toward +X is a quarter turn clockwise seen from above.
    expect(p.yaw).toBeCloseTo(-Math.PI / 2);
    const after = actorPoses(story, starts, 7).get('girl')!;
    expect(after.position).toEqual([10, 0, 0]);
    expect(Math.abs(after.yaw!)).toBeCloseTo(Math.PI);
    // A tracked shot aims at the person.
    expect(storyFrame(story, starts, 7, actorPoses(story, starts, 7)).camera.target).toEqual([10, 1, 0]);
  });

  it('measures paths and eases', () => {
    const path: Array<[number, number, number]> = [[0, 0, 0], [3, 4, 0], [3, 4, 5]];
    const l = pathLengths(path);
    expect(l).toEqual([0, 5, 10]);
    expect(alongPath(path, l, 0.75).point).toEqual([3, 4, 2.5]);
    expect(ease('inOut', 0.5)).toBeCloseTo(0.5);
    expect(ease('in', 2)).toBe(1);
  });

  it('lays a path on the ground in half-metre steps', () => {
    const laid = groundPath([[0, 5, 0], [2, 5, 0]], (x) => x * 0.5);
    expect(laid.length).toBe(5);
    expect(laid[4]).toEqual([2, 1, 0]);
    expect(groundPath([[0, 5, 0], [1, 5, 0]], () => null)[2]).toEqual([1, 5, 0]);
  });

  it('names the people a story moves', () => {
    expect(storyCast({ story, entities: { girl: { character: {} } } })).toEqual(['girl']);
    expect(storyCast({ story, entities: { girl: {} } })).toEqual([]);
  });
});

describe('story start mode', () => {
  it('opens a story world on its film, and falls back to a showcase without one', () => {
    expect(experienceFor('story', 'showcase', false, true)).toMatchObject({ kind: 'story', entry: 'story', explore: 'orbit' });
    expect(experienceFor('story', 'showcase', false, false)).toMatchObject({ kind: 'showcase' });
    expect(templatePublish('cloudwatch-harbour')).toEqual({ startMode: 'story', profile: 'showcase' });
  });

  it('skips, plays and explores from the story', () => {
    const exp = experienceFor('story', 'showcase', false, true);
    const k = (code: string) => ({ code, key: code });
    expect(keyAction(k('Space'), 'story', exp)).toBe('skip');
    expect(keyAction(k('Escape'), 'story', exp)).toBe('skip');
    expect(keyAction(k('KeyP'), 'story', exp)).toBe('play');
    expect(keyAction(k('Tab'), 'story', exp)).toBe('explore');
    expect(keyAction(k('KeyO'), 'story', exp)).toBe('explore');
    expect(keyHint('story', exp)).toContain('skip');
  });

  it('keeps the story out of the IR hash (it changes no geometry)', async () => {
    const w = validateWorld({ version: 1, entities: {} });
    if (!w.ok) throw new Error('invalid');
    expect(await worldIrHash({ ...w.world, story })).toBe(await worldIrHash(w.world));
  });
});

describe('Cloudwatch Harbour', () => {
  const doc = JSON.parse(readFileSync(join(__dirname, '../public/templates/worlds/cloudwatch-harbour.json'), 'utf8')) as { world: unknown };
  const v = validateWorld(doc.world);
  it('carries a valid story of 60-120 s whose moved entities exist or are optional pieces', () => {
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const w = v.world;
    expect(w.startMode).toBe('story');
    const d = storyDuration(w.story!);
    expect(d).toBeGreaterThanOrEqual(60);
    expect(d).toBeLessThanOrEqual(120);
    for (const s of w.story!.shots) for (const m of s.moves) expect(Object.hasOwn(w.entities, m.entity) || m.entity === 'cw-train').toBe(true);
    expect(w.entities['cw-kaho']?.character?.body).toBe('kaho');
  });

  it('gives play solid ground: static triangle meshes under the spawn and the lookout', () => {
    if (!v.ok) return;
    const solid = Object.values(v.world.entities).filter((e) => e.physics?.collider === 'trimesh').map((e) => e.id);
    expect(solid).toEqual(expect.arrayContaining(['cw-terrain', 'cw-infra', 'cw-town']));
    expect(v.world.player.spawn[1]).toBeGreaterThan(1);
  });
});
