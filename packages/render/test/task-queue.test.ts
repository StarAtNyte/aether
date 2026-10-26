import { describe, expect, it, vi } from 'vitest';
import { TaskQueue } from '../src/gpu/task-queue';

describe('task queue', () => {
  it('runs jobs in order, never inside the caller\'s turn, and resolves with results', async () => {
    const q = new TaskQueue(1000);
    const order: number[] = [];
    const a = q.run(() => (order.push(1), 'a'));
    const b = q.run(() => (order.push(2), 'b'));
    expect(order).toEqual([]);
    expect(q.pending).toBe(2);
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
    expect(order).toEqual([1, 2]);
    expect(q.pending).toBe(0);
  });

  it('gives up the thread once a task has used its budget', async () => {
    const q = new TaskQueue(0);
    const ran: number[] = [];
    let seenAtEndOfFirstTask = -1;
    const jobs = [1, 2, 3].map((n) =>
      q.run(() => {
        ran.push(n);
        // A microtask runs when the task that is running this job ends.
        if (n === 1) queueMicrotask(() => (seenAtEndOfFirstTask = ran.length));
      }),
    );
    await Promise.all(jobs);
    expect(ran).toEqual([1, 2, 3]);
    expect(seenAtEndOfFirstTask).toBe(1);
  });

  it('shares a task between short jobs while there is budget', async () => {
    const q = new TaskQueue(1000);
    const ran: number[] = [];
    let seenAtEndOfFirstTask = -1;
    const jobs = [1, 2, 3].map((n) =>
      q.run(() => {
        ran.push(n);
        if (n === 1) queueMicrotask(() => (seenAtEndOfFirstTask = ran.length));
      }),
    );
    await Promise.all(jobs);
    expect(seenAtEndOfFirstTask).toBe(3);
  });

  it('a job that throws rejects only itself', async () => {
    const q = new TaskQueue();
    const bad = q.run(() => {
      throw new Error('boom');
    });
    const good = q.run(() => 7);
    await expect(bad).rejects.toThrow('boom');
    expect(await good).toBe(7);
  });
});

function scheduler() {
  const channels: Array<{port1:{onmessage:(()=>void)|null;close:ReturnType<typeof vi.fn>};port2:{postMessage:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>}}> = [];
  const create=()=>{
    const channel={port1:{onmessage:null as (()=>void)|null,close:vi.fn()},port2:{postMessage:vi.fn(),close:vi.fn()}};
    channels.push(channel);return channel as unknown as MessageChannel;
  };
  return {channels,create,flush:()=>channels.at(-1)!.port1.onmessage!()};
}
describe('task queue scheduling and large backlogs',()=>{
  it('schedules one work callback per budgeted job plus idle cleanup under reentrant enqueueing',async()=>{
    const s=scheduler(),q=new TaskQueue(0,s.create),order:number[]=[];
    let third!:Promise<void>;
    const first=q.run(()=>{order.push(1);third=q.run(()=>{order.push(3);});});
    const second=q.run(()=>{order.push(2);});
    s.flush();s.flush();s.flush();await Promise.all([first,second,third]);
    expect(order).toEqual([1,2,3]);expect(s.channels).toHaveLength(1);expect(s.channels[0]!.port2.postMessage).toHaveBeenCalledTimes(4);s.flush();
    expect(s.channels[0]!.port1.close).toHaveBeenCalledOnce();expect(s.channels[0]!.port2.close).toHaveBeenCalledOnce();
  });
  it('reuses a channel across sequential await continuations and releases it when idle',async()=>{
    const s=scheduler(),q=new TaskQueue(0,s.create),order:number[]=[];
    const done=(async()=>{for(let i=0;i<3;i++)await q.run(()=>{order.push(i);});})();
    for(let i=0;i<3;i++){s.flush();await Promise.resolve();}
    await done;expect(order).toEqual([0,1,2]);expect(s.channels).toHaveLength(1);s.flush();
    expect(s.channels[0]!.port1.close).toHaveBeenCalledOnce();expect(s.channels[0]!.port2.close).toHaveBeenCalledOnce();
  });
  it('preserves FIFO and pending counts while compacting a long-lived backlog',async()=>{
    const s=scheduler(),q=new TaskQueue(0,s.create),order:number[]=[];
    const promises=Array.from({length:5000},(_,i)=>q.run(()=>{order.push(i);}));
    for(let i=0;i<5000;i++){expect(q.pending).toBe(5000-i);s.flush();}
    await Promise.all(promises);s.flush();expect(order).toEqual(Array.from({length:5000},(_,i)=>i));expect(q.pending).toBe(0);
  });
  it('keeps the same asynchronous order without MessageChannel support',async()=>{
    const q=new TaskQueue(0,null),order:number[]=[];
    const jobs=[1,2,3].map(i=>q.run(()=>order.push(i)));expect(order).toEqual([]);
    await Promise.all(jobs);expect(order).toEqual([1,2,3]);expect(q.pending).toBe(0);
  });
});
