import { describe, expect, it, vi } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';
import { materialReferenceTextures, prepareCompileTextures } from '../src/gpu/compile-textures';
function fixture() {
  const state = { compiled: true }, data = new WeakMap<object, { initialized?: boolean; version?: number }>();
  const build = vi.fn(async () => state);
  const renderer = { _nodes: { getForRenderAsync: build }, _textures: { get: (t: object) => data.get(t) ?? {} },
    initTexture: vi.fn((t: { version: number }) => { data.set(t, { initialized: true, version: t.version }); }) };
  const tasks: Array<{ job: () => void; resolve(): void; reject(e: unknown): void }> = [];
  const preparation = prepareCompileTextures(renderer as unknown as WebGPURenderer, job => new Promise<void>((resolve, reject) => tasks.push({ job, resolve, reject })));
  const object = (textures: unknown[]) => ({ getBindings: () => [{ bindings: textures.map(texture => ({ isSampledTexture: true, texture })) }] });
  const run = (textures: unknown[]) => (renderer._nodes.getForRenderAsync as unknown as (o: unknown) => Promise<unknown>)(object(textures));
  const flush = () => { const task = tasks.shift()!; try { task.job(); task.resolve(); } catch (e) { task.reject(e); } };
  return { state, data, build, renderer, preparation, tasks, run, flush };
}
const texture = () => ({ version: 1, image: { complete: true }, source: { dataReady: true } });
async function queued(f: ReturnType<typeof fixture>, count = 1) { await vi.waitFor(() => expect(f.tasks).toHaveLength(count)); }

describe('texture preparation before native async compilation bindings', () => {
  it('uploads each material map in a separate scheduled job and preserves native builder results', async () => {
    const f = fixture(), a = texture(), b = texture(), done = f.run([a, b]);
    await queued(f);expect(f.renderer.initTexture).not.toHaveBeenCalled();
    f.flush();await queued(f);expect(f.renderer.initTexture.mock.calls).toEqual([[a]]);
    f.flush();expect(await done).toBe(f.state);expect(f.renderer.initTexture.mock.calls).toEqual([[a], [b]]);f.preparation.dispose();
  });
  it('leaves target, dynamic, unavailable and already uploaded textures to the native path', async () => {
    const f = fixture(), cached = texture();f.data.set(cached, { initialized: true, version: 1 });
    await f.run([cached, { ...texture(), version: 0 }, { ...texture(), image: undefined }, { ...texture(), image: { complete: false } },
      { ...texture(), source: { dataReady: false } }, ...['isRenderTargetTexture', 'isDepthTexture', 'isFramebufferTexture', 'isVideoTexture', 'isStorageTexture', 'isExternalTexture', 'isHTMLTexture'].map(key => ({ ...texture(), [key]: true }))]);
    expect(f.tasks).toHaveLength(0);expect(f.renderer.initTexture).not.toHaveBeenCalled();f.preparation.dispose();
  });
  it('rechecks readiness and shared texture versions when the scheduled task runs', async () => {
    const f = fixture(), a = texture(), done = f.run([a]);await queued(f);a.source.dataReady = false;f.flush();await done;
    expect(f.renderer.initTexture).not.toHaveBeenCalled();a.source.dataReady = true;
    const first = f.run([a]), second = f.run([a]);await queued(f, 2);f.flush();f.flush();await Promise.all([first, second]);
    expect(f.renderer.initTexture).toHaveBeenCalledOnce();a.version++;
    const changed = f.run([a]);await queued(f);f.flush();await changed;expect(f.renderer.initTexture).toHaveBeenCalledTimes(2);f.preparation.dispose();
  });
  it('cancels queued uploads on disposal and restores the original native hook', async () => {
    const f = fixture(), result = f.run([texture()]).catch(e => e.name);await queued(f);
    f.preparation.dispose();f.preparation.dispose();expect(f.renderer._nodes.getForRenderAsync).toBe(f.build);
    f.flush();expect(await result).toBe('AbortError');expect(f.renderer.initTexture).not.toHaveBeenCalled();
  });
  it('does not resume upload work when the renderer is disposed during node building', async () => {
    let release!: () => void;
    const renderer = { _nodes: { getForRenderAsync: vi.fn(() => new Promise<void>(r => { release = r; })) }, _textures: { get: () => ({}) }, initTexture: vi.fn() };
    const preparation = prepareCompileTextures(renderer as unknown as WebGPURenderer);
    const result = (renderer._nodes.getForRenderAsync as unknown as (o: unknown) => Promise<unknown>)({ getBindings: () => { throw new Error('must not inspect bindings after disposal'); } }).catch(e => e.name);
    preparation.dispose();release();expect(await result).toBe('AbortError');expect(renderer.initTexture).not.toHaveBeenCalled();
  });
});

describe('material references shared by shader states',()=>{
 it('prepares the current material map even when sampled bindings still point at another material',async()=>{
  const actual={...texture(),isTexture:true},stale=texture(),material={map:actual};
  const reference={isMaterialReferenceNode:true,uniformType:'texture',material:null,reference:{map:stale},getValueFromReference:(m:{map:unknown})=>m.map};
  const state={updateNodes:[reference]},uploaded:unknown[]=[],data=new WeakMap<object,{initialized:boolean;version:number}>();
  data.set(stale,{initialized:true,version:1});
  const renderer={_nodes:{getForRenderAsync:async()=>state},_textures:{get:(t:object)=>data.get(t)??{}},initTexture:(t:typeof actual)=>{uploaded.push(t);data.set(t,{initialized:true,version:t.version});}};
  const preparation=prepareCompileTextures(renderer as unknown as WebGPURenderer,async job=>{job();});
  await(renderer._nodes.getForRenderAsync as unknown as (o:unknown)=>Promise<unknown>)({material,getBindings:()=>[{bindings:[{isSampledTexture:true,texture:stale}]}]});
  expect(uploaded).toEqual([actual]);expect(reference.reference.map).toBe(stale);preparation.dispose();
 });
});

it('resolves fixed nested material references and excludes non-texture or dynamic references',()=>{
 const value={...texture(),isTexture:true},fixed={nested:{map:value}};
 const state={updateNodes:[
  {isMaterialReferenceNode:true,uniformType:'texture',material:fixed,getValueFromReference:(m:typeof fixed)=>m.nested.map},
  {isMaterialReferenceNode:true,uniformType:'float',getValueFromReference:()=>{throw new Error('not a texture');}},
  {isMaterialReferenceNode:false,uniformType:'texture',getValueFromReference:()=>{throw new Error('not a material reference');}},
  {isMaterialReferenceNode:true,uniformType:'texture',getValueFromReference:()=>({...texture(),isTexture:true,isRenderTargetTexture:true})},
 ]};
 expect(materialReferenceTextures(state,{})).toEqual([value]);
});
