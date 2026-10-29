/** Probe: how well does the model read the horizontal field of view from a self-test photo (no EXIF)? Key from the private file, never printed. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const key = readFileSync(join(homedir(), '.config/aether/anthropic.key'), 'utf8').trim();
const root = join(homedir(), '.local/share/aether/qa/selftest');
const wide = process.argv.includes('--hint');
for (const w of readdirSync(root).sort()) {
  if (!statSync(join(root, w)).isDirectory()) continue;
  for (const p of readdirSync(join(root, w)).sort()) {
    const dir = join(root, w, p);
    const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as { camera: { hfov: number } };
    const img = readFileSync(join(dir, 'photo.jpg')).toString('base64');
    const q = wide
      ? 'Estimate the lens of this interior photo: HORIZONTAL field of view in degrees. Look at how much stretching/bowing there is at the picture edges, how much of the side walls, floor and ceiling shows at once, and how close the camera is to the far wall. Typical: phone main camera 65-75, phone ultra-wide or wide-angle interior lens 85-110, tele 40-55. Reply with a final line of the form FOV: number.'
      : 'Estimate the HORIZONTAL field of view of this interior photo in degrees (phone 65-75, wide interior lens 85-100). Reply with a final line of the form FOV: number.';
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 2500, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } }, { type: 'text', text: q }] }] }) });
    const j = (await r.json()) as { content?: Array<{ text?: string }>; usage?: { input_tokens: number; output_tokens: number } };
    console.log(`${w}/${p} true ${truth.camera.hfov.toFixed(0)} model ${j.content?.filter((c) => c.text).map((c) => c.text).join(" ").replace(/\s+/g, " ").slice(-40)} tok ${j.usage?.input_tokens}/${j.usage?.output_tokens}`);
  }
}
