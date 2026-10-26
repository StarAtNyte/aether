/** Real WebGL resolution decisions under controlled CPU-only and mixed CPU/GPU pressure. Requires Vite. */
import { chromium, firefox } from 'playwright';

const name = process.env.AETHER_BENCH_BROWSER ?? 'chromium';
const base = process.env.AETHER_BENCH_URL ?? 'http://127.0.0.1:5177';
const root = '/@fs' + process.cwd() + '/';
const browser = await (name === 'firefox' ? firefox.launch() : chromium.launch({
  args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'],
}));
try {
  const page = await browser.newPage();
  await page.route('**/gpu-resolution-probe', r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>GPU resolution</title>'}));
  await page.goto(base + '/gpu-resolution-probe');
  const result = await page.evaluate(async ({ root }) => {
    const canvas = document.createElement('canvas'); document.body.append(canvas);
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
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const {gpuFrameCost}=await import(root + 'packages/render/src/gpu/frame-cost.ts');
    const {AdaptiveResolution}=await import(root + 'packages/render/src/view/adaptive-resolution.ts');
    const cases=[];
    for(const [label,iterations,cpuMs,useGpu] of [['CPU delay baseline',1,25,false],['CPU delay GPU-aware',1,25,true],['CPU and GPU overload GPU-aware',1000,25,true]]){
      canvas.width=960;canvas.height=540;gl.viewport(0,0,960,540);gl.uniform1i(steps,iterations);
      const cost=gpuFrameCost({gl}),adaptive=new AdaptiveResolution(),start=performance.now();
      let last=start,minScale=1,frames=0,samples=0,lastGpu;
      while(performance.now()-start<4500){
        await frame();const now=performance.now(),dt=(now-last)/1000;last=now;
        if(useGpu)cost.begin(canvas.width,canvas.height,program);
        gl.drawArrays(gl.TRIANGLES,0,3);
        if(useGpu)cost.end(true); gl.flush();
        const busy=performance.now();while(performance.now()-busy<cpuMs){}
        const gpu=useGpu?cost.seconds:undefined;if(gpu!==undefined){samples++;lastGpu=gpu;}
        if(adaptive.record(dt,frames>0,gpu)){canvas.width=Math.round(960*adaptive.scale);canvas.height=Math.round(540*adaptive.scale);gl.viewport(0,0,canvas.width,canvas.height);}
        minScale=Math.min(minScale,adaptive.scale);frames++;
      }
      cases.push({label,frames,scale:adaptive.scale,minScale,samples,lastGpu});cost.dispose();
    }
    const error = gl.getError();
    gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${error}`);
    return { supported: true, error, cases };
  }, { root });
  console.log(JSON.stringify({ browser: name, result }, null, 2));
} finally { await browser.close(); }
