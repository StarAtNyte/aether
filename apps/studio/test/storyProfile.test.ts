import { describe, expect, it } from 'vitest';
import { profileForStartMode } from '@aether/render';
import { experienceFor } from '../src/player/experience';
import { playStartAfterStory } from '../src/player/story';
import { publishForKind, templatePublish } from '../src/showcase/publish';
import { templateGroup, templateBySlug } from '../src/lib/examples';

describe('the story publish kind', () => {
  it('plays the film first, then P plays and Tab explores', () => {
    expect(experienceFor('story', 'story', false, true)).toMatchObject({ kind: 'story', entry: 'story', explore: 'orbit' });
    expect(experienceFor(undefined, 'story', false, true)).toMatchObject({ kind: 'story' });
    // A story profile without a film falls back to a showcase.
    expect(experienceFor(undefined, 'story', false, false).kind).toBe('showcase');
  });

  it('is the kind of Cloudwatch Harbour and of story templates, listed under Stories', () => {
    expect(templatePublish('cloudwatch-harbour')).toEqual({ startMode: 'story', profile: 'story' });
    expect(publishForKind('story')).toEqual({ startMode: 'story', profile: 'story' });
    const t = templateBySlug('cloudwatch-harbour');
    expect(t && templateGroup(t)).toBe('story');
    expect(profileForStartMode('story')).toBe('story');
  });


  it('play after the film starts at playFrom, else where the followed person ends, else the spawn', () => {
    const cam = { position: [0, 2, 10] as [number, number, number], target: [0, 2, 0] as [number, number, number] };
    const tf = (p: [number, number, number]) => ({ position: p, rotation: [0, 0, 0] as [number, number, number] });
    const shot = (extra: Record<string, unknown> = {}) => ({ duration: 5, camera: cam, ease: 'inOut' as const, shake: 0, transition: 'cut' as const, transitionSeconds: 0.6, moves: [], ...extra });
    expect(playStartAfterStory({ story: { shots: [shot()], playFrom: { position: [1, 2, 3], yaw: 90 } }, entities: {} })).toEqual({ feet: [1, 2, 3], yawDeg: 90 });
    const walk = { entity: 'kaho', path: [[0, 0, 0], [4, 0, -6]] as Array<[number, number, number]>, start: 0, end: 1, ease: 'inOut' as const, orient: true };
    const got = playStartAfterStory({ story: { shots: [shot({ track: 'kaho', moves: [walk] })] }, entities: { kaho: { character: {}, transform: tf([9, 9, 9]) } } });
    expect(got?.feet).toEqual([4, 0, -6]);
    expect(got?.yawDeg).toBe(0);
    expect(playStartAfterStory({ story: { shots: [shot()] }, entities: {} })).toBeNull();
  });
});
