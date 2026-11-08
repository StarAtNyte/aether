/**
 * Skirt against legs in the real player: the legs' skin measured against the skirt on the CPU, from the skinned
 * positions the runtime draws (the clip, the foot IK on stairs and slopes, the pelvis drop, the springs), every
 * `--every` ms through the world's film and through a play-mode walk up a path.
 *
 *   STATIC_DIR=<dist> GEN_GPU=intel npx tsx scripts/characters/skirt-probe.ts --out=<dir> [--slug=cloudwatch-harbour]
 *       [--cook=0] [--film] [--play] [--path=x,y,z;x,y,z;...] [--every=150] [--shots=12,13,15]
 *
 * The measure is the character QA's (scripts/blender/character/qa.py): a thigh vertex the skirt covers at rest (a ray
 * from the thigh bone out through it meets the skirt) counts as through when, in the pose, the skirt lies between the
 * bone and the vertex (the leg crossed the cloth); a thigh that leaves under the hem is not through. Skirt vertices are
 * those weighted to the `Skirt_*` bones, thigh vertices those mostly on a `Thigh` bone and on no skirt bone.
 * Writes report.json (per sampled frame: share, depth; worst per shot and over the climb) and screenshots of the worst
 * frames (`worst-*.png`) and of the climb.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import * as env from '../../tests/e2e/support/env';

const args = process.argv.slice(2);
const arg = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = resolve(arg('out') ?? 'probe-out/skirt');
const slug = arg('slug') ?? 'cloudwatch-harbour';
const cook = arg('cook') ?? '0';
const every = Number(arg('every') ?? '150');
const onlyShots = arg('shots')?.split(',').map(Number) ?? null;
mkdirSync(out, { recursive: true });
const T0 = Date.now();
const log = (s: string): void => void process.stdout.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}\n`);

/** Installed in the page: window.__skirtMeasure(rig) -> { share, depthMm, covered, through } | null. */
const PROBE = `(() => {
  function prep(mesh) {
    const g = mesh.geometry;
    const pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const bones = mesh.skeleton.bones;
    const skirtB = new Set(), thighL = new Set(), thighR = new Set();
    bones.forEach((b, i) => {
      if (/^Skirt/i.test(b.name)) skirtB.add(i);
      if (/L_Thigh$/.test(b.name)) thighL.add(i);
      if (/R_Thigh$/.test(b.name)) thighR.add(i);
    });
    const n = pos.count;
    const tw = g.attributes._toon;
    const skirt = [], legs = [];
    const isSkirt = new Uint8Array(n);
    for (let v = 0; v < n; v++) {
      let ws = 0, wl = 0, wr = 0;
      for (let k = 0; k < 4; k++) {
        const j = si.getComponent(v, k), w = sw.getComponent(v, k);
        if (skirtB.has(j)) ws += w;
        if (thighL.has(j)) wl += w;
        if (thighR.has(j)) wr += w;
      }
      // cloth: the pipeline's flag (_toon.w, the vertices the toon vertex stage clears off the legs), else the skirt bones
      if (tw ? tw.getW(v) > 0.5 : ws > 0.05) { skirt.push(v); isSkirt[v] = 1; }
      else if (wl > 0.6 || wr > 0.6) legs.push([v, wl > wr ? 0 : 1]);
    }
    const idx = g.index;
    const tris = [];
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
      if (isSkirt[a] && isSkirt[b] && isSkirt[c]) tris.push(a, b, c);
    }
    const Th = [0, 1].map((s) => bones.find((b) => (s ? /R_Thigh$/ : /L_Thigh$/).test(b.name)));
    const Ca = [0, 1].map((s) => bones.find((b) => (s ? /R_Calf$/ : /L_Calf$/).test(b.name)));
    const M = mesh.matrixWorld.constructor;
    const V = mesh.position.constructor;
    // Bind pose: positions as stored, bones at their bind (inverse of the bone inverses, in the mesh's bind space).
    const bindPos = (bone) => new V().setFromMatrixPosition(new M().copy(mesh.skeleton.boneInverses[bones.indexOf(bone)]).invert());
    const restSeg = [0, 1].map((s) => [bindPos(Th[s]).applyMatrix4(mesh.bindMatrixInverse), bindPos(Ca[s]).applyMatrix4(mesh.bindMatrixInverse)]);
    const P = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) { P[v * 3] = pos.getX(v); P[v * 3 + 1] = pos.getY(v); P[v * 3 + 2] = pos.getZ(v); }
    const st = { mesh, skirt, legs, tris, Th, Ca, V, M, P, covered: null };
    // (not the band just above the hem: a leg there leaves under the lifting hem, it does not cross the cloth)
    let hemY = Infinity;
    for (const v of skirt) hemY = Math.min(hemY, P[v * 3 + 1]);
    st.covered = legs.filter(([v, s]) => P[v * 3 + 1] > hemY + 0.03 && cast(st, P, v, restSeg[s][0], restSeg[s][1]) !== null && cast(st, P, v, restSeg[s][0], restSeg[s][1]).outside);
    return st;
  }
  function closest(px, py, pz, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const l2 = abx * abx + aby * aby + abz * abz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * abx + (py - a.y) * aby + (pz - a.z) * abz) / l2)) : 0;
    return [a.x + abx * t, a.y + aby * t, a.z + abz * t];
  }
  // From the bone axis out through vertex v: the nearest skirt hit; outside = it lies beyond the vertex.
  function cast(st, P, v, a, b) {
    const px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
    const o = closest(px, py, pz, a, b);
    let dx = px - o[0], dy = py - o[1], dz = pz - o[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-5) return null;
    dx /= L; dy /= L; dz /= L;
    let best = Infinity;
    const T = st.tris;
    for (let i = 0; i < T.length; i += 3) {
      const a0 = T[i] * 3, b0 = T[i + 1] * 3, c0 = T[i + 2] * 3;
      const e1x = P[b0] - P[a0], e1y = P[b0 + 1] - P[a0 + 1], e1z = P[b0 + 2] - P[a0 + 2];
      const e2x = P[c0] - P[a0], e2y = P[c0 + 1] - P[a0 + 1], e2z = P[c0 + 2] - P[a0 + 2];
      const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (det > -1e-9 && det < 1e-9) continue;
      const f = 1 / det;
      const sx = o[0] - P[a0], sy = o[1] - P[a0 + 1], sz = o[2] - P[a0 + 2];
      const u = f * (sx * hx + sy * hy + sz * hz);
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const w = f * (dx * qx + dy * qy + dz * qz);
      if (w < 0 || u + w > 1) continue;
      const t = f * (e2x * qx + e2y * qy + e2z * qz);
      if (t > 1e-4 && t < best) best = t;
    }
    if (best > L + 0.25) return null;
    return { outside: best >= L - 0.002, depth: L - best, L, hit: [o[0] + dx * best, o[1] + dy * best, o[2] + dz * best] };
  }
  window.__skirtMeasure = function (rig) {
    let mesh = null;
    rig.root.traverse((o) => { if (!mesh && o.isSkinnedMesh && !/outline/i.test(o.name) && o.visible !== false) mesh = o; });
    if (!mesh) return null;
    const st = mesh.userData.__skirtProbe || (mesh.userData.__skirtProbe = prep(mesh));
    if (!st.covered.length) return { covered: 0 };
    const v = new st.V();
    const P = st.P;
    // The toon vertex stage's push of the cloth out of the posed leg capsules (packages/render/src/characters/cloth-clear.ts).
    const caps = [];
    if (!window.__skirtRaw) {
      let o = mesh, data = null;
      while (o && !data) { data = o.userData.toonLegs || null; o = o.parent; }
      if (data) {
        const m = new st.M().copy(mesh.matrixWorld).invert().multiply(data.scene.matrixWorld);
        const sx = new st.V().setFromMatrixColumn(m, 0).length();
        for (let c = 0; c < data.count; c++) {
          const A = data.v[c * 2], B = data.v[c * 2 + 1];
          caps.push([new st.V(A.x, A.y, A.z).applyMatrix4(m), new st.V(B.x, B.y, B.z).applyMatrix4(m), A.w * sx]);
        }
      }
    }
    for (const i of st.skirt) {
      mesh.getVertexPosition(i, v);
      for (const [a, b, r] of caps) {
        const q = closest(v.x, v.y, v.z, a, b);
        const dx = v.x - q[0], dy = v.y - q[1], dz = v.z - q[2];
        const l = Math.hypot(dx, dy, dz);
        if (l < r) {
          // as cloth-clear.ts: the nearest way out, never toward the body's axis
          const L = Math.max(l, 1e-4);
          if (dx * v.x + dz * v.z >= 0) { const k = (r - L) / L; v.x += dx * k; v.y += dy * k; v.z += dz * k; }
        }
      }
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    }
    for (const [i] of st.covered) { mesh.getVertexPosition(i, v); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z; }
    const inv = new st.M().copy(mesh.matrixWorld).invert();
    const seg = [0, 1].map((s) => [new st.V().setFromMatrixPosition(st.Th[s].matrixWorld).applyMatrix4(inv), new st.V().setFromMatrixPosition(st.Ca[s].matrixWorld).applyMatrix4(inv)]);
    let through = 0, depth = 0;
    const where = [];
    const g0 = mesh.geometry.attributes.position;
    for (const [i, s] of st.covered) {
      const h = cast(st, P, i, seg[s][0], seg[s][1]);
      if (h && !h.outside) {
        through++;
        depth = Math.max(depth, h.depth);
        if (where.length < 12) { const hp = h.hit; const dc = caps.map(([a, b, r]) => { const q = closest(hp[0], hp[1], hp[2], a, b); return +(Math.hypot(hp[0] - q[0], hp[1] - q[1], hp[2] - q[2]) - r).toFixed(3); }); where.push([+g0.getX(i).toFixed(3), +g0.getY(i).toFixed(3), +g0.getZ(i).toFixed(3), Math.round(h.depth * 1000), Math.round(h.L * 1000), dc]); }
      }
    }
    // Restore the bind positions for the next rest-relative cast.
    const g = mesh.geometry.attributes.position;
    for (const i of st.skirt) { P[i * 3] = g.getX(i); P[i * 3 + 1] = g.getY(i); P[i * 3 + 2] = g.getZ(i); }
    return { where, covered: st.covered.length, through, share: Math.round((through / st.covered.length) * 1000) / 1000, depthMm: Math.round(depth * 10000) / 10, clip: rig.clipName, state: rig.state };
  };
})()`;

type Sample = { t: number; who: string; shot?: number; share?: number; depthMm?: number; covered?: number; clip?: string; state?: string; pos?: number[] };

const server = await env.startServer(() => undefined);
const browser = await chromium.launch({ executablePath: env.findChrome(), args: [...env.CHROME_ARGS], headless: env.HEADLESS });
const report: Record<string, unknown> = { slug, cook };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  if (process.env['GEN_GPU'] === 'intel') await page.addInitScript({ content: 'delete Navigator.prototype.gpu; try { delete navigator.gpu; } catch {}' });
  await page.addInitScript({ content: "try { localStorage.setItem('aether.player.mute', '1'); } catch {}" });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
  await page.goto(`${server.url}/play.html#t=${slug}&cook=${cook}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { __aetherCook?: { ready: boolean } }).__aetherCook?.ready === true, null, { timeout: 200_000, polling: 250 });
  await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase === 'story', null, { timeout: 90_000, polling: 250 });
  await page.evaluate(PROBE);
  if (args.includes('--raw')) await page.evaluate('window.__skirtRaw = true');
  const gate = await page.evaluate('window.__aetherPlayer.storyGate || false');
  if (gate) {
    await page.click('[data-testid="pl-story-watch"]');
    await page.waitForTimeout(1500);
  }
  const measure = (ids: string[]): Promise<Array<Sample | null>> =>
    page.evaluate(`(() => { const p = window.__aetherPlayer; const r = p.simulation.renderer; return ${JSON.stringify(ids)}.map((id) => { const g = id === 'player' ? r.playerRig() : r.characterRig(id); if (!g) return null; const m = window.__skirtMeasure(g); return m ? { who: id, ...m } : null; }); })()`) as Promise<Array<Sample | null>>;
  const worst: Record<string, { share: number; depthMm: number; at: string }> = {};
  const note = async (key: string, s: Sample, tag: string): Promise<void> => {
    const w = worst[key];
    if ((s.share ?? 0) > (w?.share ?? -1)) {
      worst[key] = { share: s.share ?? 0, depthMm: s.depthMm ?? 0, at: tag };
      if ((s.share ?? 0) > 0) await page.screenshot({ path: join(out, `worst-${key}.png`) });
    }
  };
  if (args.includes('--film')) {
    const shots = (await page.evaluate('window.__aetherPlayer.world.story.shots.map((s) => s.duration)')) as number[];
    const starts: number[] = [];
    shots.reduce((t, d) => (starts.push(t), t + d), 0);
    const film: Sample[] = [];
    for (let k = 0; k < shots.length; k++) {
      if (onlyShots && !onlyShots.includes(k + 1)) continue;
      await page.evaluate(`window.__aetherPlayer.playStory(${starts[k]! + 0.05})`);
      const t1 = Date.now() + shots[k]! * 1000;
      while (Date.now() < t1 - 100) {
        await page.waitForTimeout(every);
        const time = (await page.evaluate('window.__aetherPlayer.story ? window.__aetherPlayer.story.time : -1')) as number;
        for (const s of await measure(['cw-kaho', 'cw-mio'])) {
          if (!s || !s.covered) continue;
          const row = { ...s, t: Math.round(time * 100) / 100, shot: k + 1 };
          film.push(row);
          await note(`film-s${String(k + 1).padStart(2, '0')}-${s.who}`, row, `t=${row.t}`);
        }
      }
      log(`shot ${k + 1}: ${Object.entries(worst).filter(([key]) => key.startsWith(`film-s${String(k + 1).padStart(2, '0')}`)).map(([key, w]) => `${key} ${w.share}`).join(', ')}`);
    }
    report['film'] = { samples: film.length, through: film.filter((s) => (s.share ?? 0) > 0).length, worst: Math.max(0, ...film.map((s) => s.share ?? 0)) };
    report['filmSamples'] = film;
  }
  if (args.includes('--play')) {
    // Skip to play mode, put the player at the path's first point and walk it (W, the camera turned along each leg).
    await page.keyboard.press('KeyP');
    await page.waitForFunction(() => (window as unknown as { __aetherPlayer?: { phase: string } }).__aetherPlayer?.phase === 'playing', null, { timeout: 60_000, polling: 250 });
    await page.waitForTimeout(1500);
    const path = (arg('path') ?? '0,0,14;0,0,-40').split(';').map((p) => p.split(',').map(Number));
    const id = ((await page.evaluate('(() => { const s = window.__aetherPlayer.simulation.session; return s && s.avatarId ? s.avatarId : null; })()')) as string | null) ?? 'player';
    log(`avatar ${id}`);
    const play: Sample[] = [];
    for (let leg = 0; leg + 1 < path.length; leg++) {
      const [ax, ay, az] = path[leg]!;
      const [bx, , bz] = path[leg + 1]!;
      const yaw = (Math.atan2(-(bx! - ax!), -(bz! - az!)) * 180) / Math.PI;
      if (leg === 0) {
        const floor = (await page.evaluate(`(() => { const r = window.__aetherPlayer.simulation.renderer; const h = r.raycastWorld([${ax}, ${(ay ?? 0) + 60}, ${az}], [0, -1, 0], 200, new Set(${JSON.stringify(id ? [id] : [])})); return h ? h.point[1] : 0; })()`)) as number;
        await page.evaluate(`window.__aetherPlayer.simulation.placePlayer([${ax}, ${floor + 0.05}, ${az}], ${yaw})`);
        await page.waitForTimeout(1200);
      } else await page.evaluate(`window.__aetherPlayer.simulation.placePlayer(window.__aetherPlayer.simulation.playerPosition, ${yaw})`);
      const dist = Math.hypot(bx! - ax!, bz! - az!);
      const run = args.includes('--run');
      if (run) await page.keyboard.down('ShiftLeft');
      await page.keyboard.down('KeyW');
      const t1 = Date.now() + (dist / (run ? 4.5 : 1.4)) * 1000;
      let k = 0;
      while (Date.now() < t1) {
        await page.waitForTimeout(every);
        const pos = (await page.evaluate('(window.__aetherPlayer.simulation.playerPosition || []).map((v) => Math.round(v * 100) / 100)')) as number[];
        for (const s of await measure(id ? [id] : [])) {
          if (!s || !s.covered) continue;
          const row = { ...s, t: (Date.now() - T0) / 1000, pos };
          play.push(row);
          await note('play', row, `pos=${pos.join(',')}`);
        }
        if (k++ % 20 === 0) await page.screenshot({ path: join(out, `play-${leg}-${k}.png`) });
      }
      await page.keyboard.up('KeyW');
      if (run) await page.keyboard.up('ShiftLeft');
    }
    report['play'] = { samples: play.length, through: play.filter((s) => (s.share ?? 0) > 0).length, worst: Math.max(0, ...play.map((s) => s.share ?? 0)), climbed: play.length ? [play[0]!.pos, play[play.length - 1]!.pos] : null };
    report['playSamples'] = play;
  }
  report['worst'] = worst;
  report['errors'] = errors.slice(0, 30);
  log(`worst: ${JSON.stringify(worst)}`);
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  await browser.close();
  await server.stop();
}
