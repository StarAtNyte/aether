import { planMock } from '../packages/agent/src/providers/mock/planner';
import { DEFAULT_PROMPTS } from './smoke-prompts';
for (const p of DEFAULT_PROMPTS) { const r = planMock(p, ''); const envp = r.patches.find((x:any)=>x.op==='setEnvironment' || x.op==='env') as any; console.log(p,'\n  ',r.plan, '\n   ENV', JSON.stringify(r.patches.filter((x:any)=>/env/i.test(x.op)).map((x:any)=>x.value ?? x.environment ?? x)).slice(0,600)); }
