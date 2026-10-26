import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebGPURenderer } from 'three/webgpu';
import { deferRenderPreparation } from '../src/gpu/render-preparation';
function fixture() {
  const drawRange={start:0,count:3}, object={geometry:{drawRange}};
  const material: { version: number; side: number; [key:string]:unknown }={version:0,side:2};
  const source={version:0};
  let lights: unknown[]=['sun'];
  const lightNode={getLights:()=>lights,setLights:(value:unknown[])=>{lights=value;}};
  const state={target:'screen' as unknown,output:null as unknown,mrt:null as unknown,face:0,mip:0};
  const builds: unknown[]=[];
  const ro={isRenderObject:true,object,material,lightsNode:lightNode,_bindings:null as null|Array<{bindings:never[]}>,drawRange:undefined as unknown,group:undefined as unknown,
    getNodeBuilderState(){builds.push({target:state.target,mrt:state.mrt,lights:lights.slice(),side:material.side,keys:Object.keys(material)});},
    getBindings(){return this._bindings??= [{bindings:[]}];},
  };
  const nativeGet=vi.fn(()=>ro), nativeDelete=vi.fn(), nativeDraw=vi.fn();
  const renderer={_objects:{get:nativeGet},_nodes:{delete:nativeDelete},_bindings:{getForRender:vi.fn()},_geometries:{updateForRender:vi.fn()},
    _currentRenderContext:{},_currentRenderBundle:null,_currentSourceMaterial:null as unknown,
    lighting:{enabled:true},shadowMap:{enabled:true,type:'pcf'},contextNode:'canvas',toneMapping:1,outputColorSpace:'srgb',opaque:true,transparent:true,
    getRenderTarget:()=>state.target,getOutputRenderTarget:()=>state.output,getMRT:()=>state.mrt,getActiveCubeFace:()=>state.face,getActiveMipmapLevel:()=>state.mip,
    setRenderTarget:(target:unknown,face:number,mip:number)=>{Object.assign(state,{target,face,mip});},setOutputRenderTarget:(output:unknown)=>{state.output=output;},setMRT:(mrt:unknown)=>{state.mrt=mrt;},
    compileAsync:vi.fn(async()=>{}),
    _renderObjectDirect(...args:unknown[]){renderer._objects.get();nativeDraw(...args);},
  };
  let blocked=false;
  const ready=vi.fn(),error=vi.fn(),atomic=vi.fn();
  const preparation=deferRenderPreparation(renderer as unknown as WebGPURenderer,{ready,error,blocked:()=>blocked,atomic:draw=>{atomic();return draw();},channel:null});
  const draw=()=>renderer._renderObjectDirect(object,material,{}, {},lightNode,'group',null);
  return{renderer,state,ro,object,material,source,lightNode,builds,nativeGet,nativeDraw,preparation,draw,ready,error,atomic,block:()=>{blocked=true;},unblock:()=>{blocked=false;}};
}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe('deferred first-use render preparation',()=>{
  it('preserves pass state and light membership, then reuses the render object without a second cache lookup',async()=>{
    vi.useFakeTimers();const f=fixture();
    f.state.target='beauty';f.state.mrt='normals';f.material.side=1;f.draw();f.draw();
    expect(f.preparation.pending).toBe(1);expect(f.nativeDraw).not.toHaveBeenCalled();
    f.state.target='screen';f.state.mrt=null;f.material.side=2;f.lightNode.setLights([]);
    const idle=f.preparation.idle();await vi.runAllTimersAsync();await idle;
    expect(f.builds).toEqual([{target:'beauty',mrt:'normals',lights:['sun'],side:1,keys:['version','side']}]);
    expect(f.material).toEqual({version:0,side:2});expect(f.state.target).toBe('screen');expect(f.state.mrt).toBeNull();expect(f.lightNode.getLights()).toEqual([]);
    const gets=f.nativeGet.mock.calls.length;f.draw();expect(f.nativeDraw).toHaveBeenCalledOnce();expect(f.nativeGet.mock.calls.length-gets).toBe(1);
    expect(f.ro.drawRange).toBe(f.object.geometry.drawRange);expect(f.ro.group).toBe('group');f.preparation.dispose();
  });
  it('validates the source material instead of a shared override material version',async()=>{
    vi.useFakeTimers();const f=fixture();f.renderer._currentSourceMaterial=f.source;f.draw();f.material.version=9;
    await vi.runAllTimersAsync();expect(f.builds).toHaveLength(1);expect(f.material.version).toBe(9);f.preparation.dispose();
  });
  it('cancels obsolete/disposed objects and resolves waiters when the renderer is disposed',async()=>{
    vi.useFakeTimers();const f=fixture();f.draw();f.material.version++;await vi.runAllTimersAsync();expect(f.builds).toHaveLength(0);
    f.draw();f.renderer._nodes.delete(f.ro);await vi.runAllTimersAsync();expect(f.builds).toHaveLength(0);
    // A pending job can be canceled without keeping a scheduler or a capture waiter alive.
    const g=fixture();g.draw();const idle=g.preparation.idle();g.preparation.dispose();await idle;await vi.runAllTimersAsync();expect(g.builds).toHaveLength(0);expect(vi.getTimerCount()).toBe(0);f.preparation.dispose();
  });
  it('does not upload resources while links or native compilation are pending',async()=>{
    vi.useFakeTimers();const f=fixture();f.block();f.draw();await vi.advanceTimersByTimeAsync(16);expect(f.builds).toHaveLength(0);
    f.unblock();await vi.advanceTimersByTimeAsync(8);expect(f.builds).toHaveLength(1);f.preparation.dispose();
    const g=fixture();let release!:()=>void;
    // Install on a fresh renderer to wrap a genuinely pending native compile.
    g.preparation.dispose();g.renderer.compileAsync=vi.fn(()=>new Promise<void>(r=>{release=r;}));
    const c=deferRenderPreparation(g.renderer as unknown as WebGPURenderer,{ready:g.ready,error:g.error,blocked:()=>false,channel:null});
    const compiled=g.renderer.compileAsync();g.draw();await vi.advanceTimersByTimeAsync(16);expect(g.builds).toHaveLength(0);
    release();await compiled;await vi.advanceTimersByTimeAsync(8);expect(g.builds).toHaveLength(1);c.dispose();
  });
  it('renders one-shot environment targets atomically instead of caching incomplete textures',async()=>{
    vi.useFakeTimers();const f=fixture();f.state.target={texture:{isPMREMTexture:true}};f.draw();
    expect(f.nativeDraw).toHaveBeenCalledOnce();expect(f.atomic).toHaveBeenCalledOnce();expect(f.preparation.pending).toBe(0);
    f.state.target={isCubeRenderTarget:true};f.draw();expect(f.atomic).toHaveBeenCalledTimes(2);f.preparation.dispose();
  });
  it('cancels setup when streamed geometry replaces the discovery geometry',async()=>{
    vi.useFakeTimers();const f=fixture();f.draw();f.object.geometry={drawRange:{start:0,count:6}};
    await vi.runAllTimersAsync();expect(f.builds).toHaveLength(0);expect(f.preparation.pending).toBe(0);
    f.draw();await vi.runAllTimersAsync();expect(f.builds).toHaveLength(1);expect(f.ro.drawRange).toBe(f.object.geometry.drawRange);f.preparation.dispose();
  });
  it('does not recreate a pass target that was disposed while its setup was queued', async()=>{
    vi.useFakeTimers();const f=fixture();let dispose!:()=>void;
    f.state.target={addEventListener:(type:string,listener:()=>void)=>{expect(type).toBe('dispose');dispose=listener;}};
    f.draw();dispose();f.state.target='screen';await vi.runAllTimersAsync();
    expect(f.builds).toHaveLength(0);expect(f.renderer._bindings.getForRender).not.toHaveBeenCalled();
    expect(f.preparation.pending).toBe(0);f.preparation.dispose();
  });
  it('restores context after errors and retains an atomic path for capture draws',async()=>{
    vi.useFakeTimers();const f=fixture();f.state.target='pass';f.draw();f.state.target='screen';f.ro.getNodeBuilderState=()=>{throw new Error('custom node failed');};
    await vi.runAllTimersAsync();expect(f.error).toHaveBeenCalledOnce();expect(f.state.target).toBe('screen');expect(f.preparation.pending).toBe(0);
    f.draw();expect(f.nativeDraw).toHaveBeenCalledOnce();f.preparation.dispose();
    const g=fixture();g.preparation.synchronous(()=>g.draw());expect(g.nativeDraw).toHaveBeenCalledOnce();expect(g.preparation.pending).toBe(0);g.preparation.dispose();
  });
});

describe('budgeted phases within one cold render object',()=>{
  it('yields between graph, geometry and individual texture uploads while keeping the draw queued',async()=>{
    vi.useFakeTimers();let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock);
    const f=fixture(),build=f.ro.getNodeBuilderState;
    f.ro.getNodeBuilderState=()=>{build.call(f.ro);clock+=5;};
    f.renderer._geometries.updateForRender.mockImplementation(()=>{clock+=5;});
    const a={version:1,image:{},source:{dataReady:true}},b={version:1,image:{},source:{dataReady:true}};
    const bindings=[{bindings:[{isSampledTexture:true,texture:a},{isSampledTexture:true,texture:b}]}];
    Object.assign(f.ro,{getBindings:()=>{f.ro._bindings=[{bindings:[]}];return bindings;}});
    const versions=new WeakMap<object,{initialized:boolean;version:number}>();
    const upload=vi.fn((texture:typeof a)=>{expect(f.state.target).toBe('beauty');expect(f.lightNode.getLights()).toEqual(['sun']);versions.set(texture,{initialized:true,version:1});clock+=5;});
    Object.assign(f.renderer,{initTexture:upload,_textures:{get:(texture:object)=>versions.get(texture)??{}}});
    f.state.target='beauty';f.draw();f.state.target='screen';f.lightNode.setLights([]);
    await vi.advanceTimersToNextTimerAsync();expect(f.builds).toHaveLength(1);expect(f.renderer._geometries.updateForRender).not.toHaveBeenCalled();
    expect(f.preparation.pending).toBe(1);expect(f.state.target).toBe('screen');
    await vi.advanceTimersToNextTimerAsync();expect(f.renderer._geometries.updateForRender).toHaveBeenCalledOnce();expect(upload).not.toHaveBeenCalled();
    f.draw();expect(f.nativeDraw).not.toHaveBeenCalled();
    await vi.advanceTimersToNextTimerAsync();expect(upload.mock.calls).toEqual([[a]]);expect(f.state.target).toBe('screen');
    await vi.advanceTimersToNextTimerAsync();expect(upload.mock.calls).toEqual([[a],[b]]);expect(f.renderer._bindings.getForRender).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();expect(f.renderer._bindings.getForRender).toHaveBeenCalledOnce();expect(f.preparation.pending).toBe(0);
    f.draw();expect(f.nativeDraw).toHaveBeenCalledOnce();f.preparation.dispose();
  });
  it('cancels remaining phases when a source material changes after graph construction',async()=>{
    vi.useFakeTimers();let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock);
    const f=fixture(),build=f.ro.getNodeBuilderState;f.ro.getNodeBuilderState=()=>{build.call(f.ro);clock+=5;};
    f.draw();await vi.advanceTimersToNextTimerAsync();f.material.version++;
    await vi.runAllTimersAsync();expect(f.renderer._geometries.updateForRender).not.toHaveBeenCalled();expect(f.renderer._bindings.getForRender).not.toHaveBeenCalled();expect(f.preparation.pending).toBe(0);f.preparation.dispose();
  });
});
