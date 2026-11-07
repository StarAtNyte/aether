import { describe, expect, it } from 'vitest';
import { profileForStartMode } from '@aether/render';
import { experienceFor } from '../src/player/experience';
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

});
