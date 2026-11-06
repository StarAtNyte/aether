/**
 * Blender tools in the agent loop: offered only when the host passes a runner (the studio does so only while the
 * local server reports Blender ready), executed through it, pictures handed to the model with the result.
 */
import { createWorld } from '@aether/core';
import { describe, expect, it } from 'vitest';
import { WorldAgent } from '../src/agent';
import { BLENDER_TOOLS } from '../src/blender';
import { AGENT_TOOLS } from '../src/tools';
import type { CompletionRequest, CompletionResponse, ContentBlock, HostToolRunner, Provider } from '../src/types';
import { collect, MemoryHost, TEST_CATALOGS } from './helpers';

class Scripted implements Provider {
  readonly name = 'scripted';
  readonly requests: CompletionRequest[] = [];
  constructor(private readonly script: CompletionResponse[]) {}
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push({ ...req, messages: req.messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? [...m.content] : m.content })) });
    return this.script.shift() ?? { content: [{ type: 'text', text: 'done' }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 } };
  }
}

let seq = 0;
const call = (name: string, input: unknown): ContentBlock => ({ type: 'tool_use', id: `b-${++seq}`, name, input });
const turn = (...content: ContentBlock[]): CompletionResponse => ({ content, stopReason: 'tool_use', usage: { inputTokens: 10, outputTokens: 5 } });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('Blender tools in the agent', () => {
  it('are not offered, and not executable, without a runner', async () => {
    const provider = new Scripted([turn(call('blender_python', { code: 'x' }), call('finish', { message: 'x' }))]);
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS }).run('model a chair in blender', new MemoryHost()));
    expect(provider.requests[0]?.tools?.some((t) => t.name.startsWith('blender_'))).toBe(false);
    expect(JSON.stringify(provider.requests[1]?.messages.at(-1)?.content)).toMatch(/Unknown tool/);
  });

  it('are offered with a runner, which runs them and shows pictures to the model', async () => {
    const seen: string[] = [];
    const blender: HostToolRunner = {
      tools: BLENDER_TOOLS,
      async run(name) {
        seen.push(name);
        return name === 'blender_render' ? { text: 'Cycles render of the scene camera.', image: PNG } : { text: 'Cube at (0, 0, 0)' };
      },
    };
    const provider = new Scripted([turn(call('blender_scene_info', {}), call('blender_render', { samples: 8 })), turn(call('finish', { message: 'Rendered.' }))]);
    await collect(new WorldAgent({ provider, catalogs: TEST_CATALOGS, blender }).run('render my blender scene', new MemoryHost(createWorld())));
    expect(provider.requests[0]?.tools).toEqual([...AGENT_TOOLS, ...BLENDER_TOOLS]);
    expect(seen).toEqual(['blender_scene_info', 'blender_render']);
    const last = provider.requests[1]?.messages.at(-1)?.content as ContentBlock[];
    expect(JSON.stringify(last)).toContain('Cube at (0, 0, 0)');
    expect(last.some((b) => b.type === 'image' && b.dataUrl === PNG)).toBe(true);
  });
});
