/** Distinguish CPU contention from GPU pixel cost before changing adaptive quality. */
import { chromium, firefox } from 'playwright';

const name = process.env.AETHER_BENCH_BROWSER ?? 'chromium';
const browser = await (name === 'firefox' ? firefox.launch() : chromium.launch({
  args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'],
}));
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 540;
    const gl = canvas.getContext('webgl2', { antialias: false });
    if (!gl) return { supported: false, reason: 'WebGL2 unavailable' };
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return { supported: false, reason: 'GPU timer extension unavailable' };
    const shader = (type, source) => {
      const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`);
    const fragment = shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float; uniform int steps; out vec4 color;
      void main(){vec3 v=vec3(gl_FragCoord.xy*.003,.7);
        for(int i=0;i<steps;i++)v=sin(v.yzx*1.01+v.zxy*.83+float(i)*.001);
        color=vec4(v*.5+.5,1.);}`);
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const steps = gl.getUniformLocation(program, 'steps');
    const median = a => a.sort((a, b) => a - b)[a.length >> 1];
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const cases = [];
    for (const [label, iterations, cpuMs, scale] of [
      ['cheap', 1, 0, 1], ['CPU contention', 1, 25, 1],
      ['GPU load', 100, 0, 1], ['GPU load half scale', 100, 0, .5],
    ]) {
      canvas.width = Math.round(960 * scale); canvas.height = Math.round(540 * scale);
      gl.viewport(0, 0, canvas.width, canvas.height); gl.uniform1i(steps, iterations);
      const gpu = [], cpu = [];
      let disjoint = 0;
      for (let i = 0; i < 14; i++) {
        await frame();
        gl.getParameter(ext.GPU_DISJOINT_EXT);
        const q = gl.createQuery(), start = performance.now();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.endQuery(ext.TIME_ELAPSED_EXT);
        const busy = performance.now(); while (performance.now() - busy < cpuMs) { /* controlled CPU contention */ }
        const submissionMs = performance.now() - start;
        const deadline = performance.now() + 5000;
        // Never request QUERY_RESULT until the browser reports availability.
        while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
          if (performance.now() > deadline) { gl.deleteQuery(q); throw new Error('GPU query timed out'); }
          await frame();
        }
        if (gl.getParameter(ext.GPU_DISJOINT_EXT)) disjoint++;
        else if (i >= 4) {
          const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
          if (!Number.isFinite(ms) || ms < 0) throw new Error('Invalid GPU duration');
          gpu.push(ms); cpu.push(submissionMs);
        }
        gl.deleteQuery(q);
      }
      cases.push({ label, scale, samples: gpu.length, disjoint, gpuMs: gpu.length ? median(gpu) : null, cpuSubmissionMs: cpu.length ? median(cpu) : null });
    }
    const error = gl.getError();
    gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${error}`);
    return { supported: true, error, cases };
  });
  console.log(JSON.stringify({ browser: name, result }, null, 2));
} finally { await browser.close(); }
