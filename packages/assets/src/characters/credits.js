import { CAST } from './library';
/** Copyright and permission notice of Microsoft Rocketbox (MIT). */
export const ROCKETBOX_NOTICE = `MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;
/** The credit line for the people of a world. `ids` are the cast ids it uses (all when omitted). */
export function characterCredit(ids) {
    const used = ids && ids.length > 0 ? CAST.filter((c) => ids.includes(c.id)) : CAST;
    return {
        source: 'Microsoft Rocketbox avatars and animations',
        author: 'Microsoft (Rocketbox Libraries), © 2020 Microsoft',
        licence: 'MIT',
        licenceUrl: 'https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md',
        url: 'https://github.com/microsoft/Microsoft-Rocketbox',
        assets: used.map((c) => `${c.id} (${c.look})`).sort(),
    };
}
