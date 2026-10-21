import { it, expect } from 'vitest';
import { applyPatches, createWorld } from '@aether/core';
import { runDesignTool, applyArchOps, readScene } from '../src/index';
import { convexOverlap } from '../src/layout';
// Bathrooms of several sizes, door walls, with and without a placed shower and an added window: nothing dry stands in or at a wet fitting.
it('a sweep of bathrooms keeps plants and loose furniture out of the shower and bath', () => {
  const bad: string[] = []; let n = 0;
  for (const [w, d] of [[1.8,2.2],[2.0,2.4],[2.4,2.6],[2.6,3.2],[3.0,3.0],[1.6,3.4],[3.4,2.0]] as Array<[number, number]>) for (const doorWall of ['south','east','west','north']) for (const sh of [false,true]) for (const win of [false,true]) {
    const along = doorWall==='south'||doorWall==='north' ? w*0.6 : d*0.6;
    const plan = { id:'b', name:'B', style:'modern', brief:'bath', programme:[{room:'bath',purpose:'wash',targetArea:w*d}], circulation:{entrance:'bath',notes:'door'},
      levels:[{height:2.8,rooms:[{id:'bath',type:'bathroom',rect:[0,0,w,d]}],openings:[{id:'dr',kind:'door',room:'bath',wall:doorWall,to:'outside',along,width:0.8,main:true}]}],
      furniture: sh ? [{id:'shower',kind:'shower',room:'bath',intent:'shower',relations:[{type:'in_corner',wall:'north'}]}] : [] };
    let world = createWorld({}); const r = runDesignTool(world,'design_plan',{plan}); if (!r.ok) continue;
    world = applyPatches(world, r.patches).world;
    const ops: unknown[] = [{op:'furnish_room',building:'b',room:'bath'}];
    if (win) ops.push({op:'add_window',building:'b',window:{room:'bath',side:'east',width:0.6,height:0.6,sill:1.5}});
    const res = applyArchOps(world, ops); world = applyPatches(world, res.patches).world;
    const sc = readScene(world,'b'); if (!sc) continue; n++;
    for (const wet of sc.items.filter(i=>i.kind==='shower'||i.kind==='bathtub')) for (const it of sc.items) {
      if (it===wet||it.mount!=='floor'||it.footprint.length===0||it.kind==='rug') continue;
      const dry=['plant','floor-lamp','side-table','armchair','chair','stool','pouf','bench','basket'].includes(it.kind);
      if (convexOverlap(it.footprint,wet.footprint) || (dry && convexOverlap(it.footprint,wet.footprint,-0.3))) bad.push(`${w}x${d} door ${doorWall} sh=${sh} win=${win}: ${it.kind} vs ${wet.kind}`);
    }
  }
  console.log('compiled', n, 'bad', bad.length, bad.slice(0,10));
  expect(n).toBeGreaterThan(20);
  expect(bad).toEqual([]);
});
