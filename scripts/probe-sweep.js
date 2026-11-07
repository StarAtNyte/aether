// A walk-speed sweep for scripts/first-picture-probe.ts (PROBE_EVAL=scripts/probe-sweep.js): the camera moves at 6 m/s
// (a run) from the opening view out along `__SWEEP` (XZ points, default: Lisbon Hills' quay, east and west ends) at its
// height, looking where it goes, for at most 40 s. Reports frame times, frames over 50 ms, cell streaming's steps and
// the slow frames that ended within 150 ms after one of them, and memory at the end.
(async () => {
  const r = window.__aether.simulation.renderer;
  r.stopTour?.();
  const cam = r.camera;
  const y = cam.position.y;
  const path = (window.__SWEEP ?? [[60, 140], [130, 60], [-130, 60], [-60, 150], [0, 230], [-7, 3]]).map(([x, z]) => [x, z]);
  let px = cam.position.x, pz = cam.position.z;
  const speed = 6;
  const dts = [], slow = [];
  const t0 = performance.now();
  let last = t0;
  for (const [tx, tz] of path) {
    while (performance.now() - t0 < 40_000) {
      const dx = tx - px, dz = tz - pz, d = Math.hypot(dx, dz);
      if (d < 0.5) break;
      const ts = await new Promise((res) => requestAnimationFrame(res));
      const step = Math.min(d, (speed * (ts - last)) / 1000);
      px += (dx / d) * step; pz += (dz / d) * step;
      // Yaw: the renderer's convention (atan2 of the backward vector), level pitch looking slightly down.
      r.setCameraPose(px, y, pz, Math.atan2(-dx, -dz), -0.15);
      dts.push(ts - last);
      if (ts - last > 50 && dts.length > 1) slow.push([Math.round(ts), Math.round(ts - last)]);
      last = ts;
    }
  }
  dts.shift();
  const s = [...dts].sort((a, b) => a - b);
  const q = (p) => Math.round((s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0) * 10) / 10;
  const st = window.__aetherStreaming?.() ?? null;
  const steps = st ? st.events.filter((e) => e[0] >= t0) : [];
  const near = slow.filter(([ts, dt]) => steps.some((e) => e[0] >= ts - dt - 5 && e[0] <= ts + 150));
  const mem = r.renderer.info.memory;
  return {
    seconds: Math.round((performance.now() - t0) / 100) / 10, frames: dts.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), over50: slow.length,
    streaming: st ? { ...st, events: undefined, steps: steps.length, stepsLog: steps.map((e) => `${Math.round(e[0] - t0)} ${e[1]} ${e[2]}ms`).join(', '), slowNearStreaming: near.map(([ts, dt]) => `${Math.round(ts - t0)}+${dt}`).join(' ') } : null,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
    gpuMB: Math.round((mem.attributesSize + mem.indexAttributesSize + mem.texturesSize) / 1048576),
  };
})()
