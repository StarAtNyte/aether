/**
 * Attribution for the people: Microsoft Rocketbox (MIT), and the third-party models some cast bodies are converted
 * from (`CastFile.credit`: VRM avatars under the VRM Public License, `bodyCredits`). The MIT licence
 * asks that the copyright and permission notice travel with the assets, so
 * the notice text is shipped here and shown by the credits panel and the
 * exported package credits.
 */
import type { Credit } from '../credits';
import { CAST } from './library';

/** Copyright and permission notice of Microsoft Rocketbox (MIT). */
export const ROCKETBOX_NOTICE = `MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

/** The credit line for the people of a world. `ids` are the cast ids it uses (all when omitted). */
export function characterCredit(ids?: readonly string[]): Credit {
  const used = ids && ids.length > 0 ? CAST.filter((c) => ids.includes(c.id)) : CAST;
  // The project's own bodies are not Rocketbox work; they move with Rocketbox's motion set, which is credited here.
  const own = used.filter((c) => c.style === 'toon');
  const ownWork = own.filter((c) => !c.credit);
  const rocketbox = used.filter((c) => c.style !== 'toon');
  return {
    source: 'Microsoft Rocketbox avatars and animations',
    author: 'Microsoft (Rocketbox Libraries), © 2020 Microsoft',
    licence: 'MIT',
    licenceUrl: 'https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md',
    url: 'https://github.com/microsoft/Microsoft-Rocketbox',
    assets: [...rocketbox.map((c) => `${c.id} (${c.look})`), ...(own.length > 0 ? [`${own[0]?.gender ?? 'female'} motion set (animating ${own.map((c) => c.id).join(', ')}${ownWork.length === own.length ? ", this project's own bodies, MIT" : ''})`] : [])].sort(),
  };
}

/** What the VRM Public License 1.0 grants, as the converted models' licence flags set it (full text at the URL). */
export const VRM_LICENCE_SUMMARY =
  'VRM Public License 1.0 (https://vrm.dev/licenses/1.0/): the model\'s own licence flags allow redistribution, modification and redistribution of the modified model, and commercial use by individuals and corporations; avatar use by everyone. The model stays the work of its author.';

/**
 * Credits for cast bodies converted from someone else's model (`CastFile.credit`), one per source and author, naming the
 * bodies made from it. `ids` are the cast ids a world uses (all when omitted).
 */
export function bodyCredits(ids?: readonly string[]): Credit[] {
  const used = ids && ids.length > 0 ? CAST.filter((c) => ids.includes(c.id)) : CAST;
  const groups = new Map<string, Credit>();
  for (const c of used) {
    if (!c.credit) continue;
    const base = c.credit.source.replace(/, recoloured$/, '');
    const key = `${base}|${c.credit.author}`;
    const g = groups.get(key) ?? { source: base, author: c.credit.author, licence: c.credit.licence, licenceUrl: c.credit.licenceUrl, url: c.credit.url, assets: [] };
    g.assets.push(`${c.id} (${c.credit.source === base ? 'converted' : 'recoloured and converted'} by this project: ${c.look})`);
    if (c.credit.line) g.line = g.line ? `${g.line}; ${c.credit.line}` : c.credit.line;
    groups.set(key, g);
  }
  for (const g of groups.values()) if (/^VRM Public License/.test(g.licence)) g.line = `${g.line ?? g.source}. ${VRM_LICENCE_SUMMARY}`;
  return [...groups.values()];
}
