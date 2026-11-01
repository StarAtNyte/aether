/**
 * The server must accept every request the agent builds: a stricter limit here sends a live studio silently to the offline
 * planner (it happened when the tool list passed 16 and the system prompt passed 60,000 characters).
 */
import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS, BRIEF_TOOL, LEVEL_TOOLS, MAKE_TEXTURE_TOOL, REFERENCE_TOOL, WIRE_LIMITS, buildSystemPrompt } from '@aether/agent';
import { CATALOGS } from '../../../scripts/lib/headless-world';
import { CompletionRequestSchema, LLM_LIMITS } from '../src/llm/schema';

describe('LLM request limits', () => {
  it('accept the agent’s full system prompt and tool list', () => {
    const tools = [...AGENT_TOOLS, ...LEVEL_TOOLS, MAKE_TEXTURE_TOOL, BRIEF_TOOL, REFERENCE_TOOL];
    const req = { role: 'planner', system: buildSystemPrompt(CATALOGS, { level: true }), messages: [{ role: 'user', content: 'a tea house garden' }], tools, maxTokens: 16_000 };
    const parsed = CompletionRequestSchema.safeParse(req);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
  });

  it('are no stricter than the agent’s own wire limits', () => {
    expect(LLM_LIMITS.MAX_TOOLS).toBeGreaterThanOrEqual(WIRE_LIMITS.MAX_TOOLS);
    expect(LLM_LIMITS.MAX_SYSTEM_CHARS).toBeGreaterThanOrEqual(WIRE_LIMITS.MAX_SYSTEM);
    expect(LLM_LIMITS.MAX_MESSAGES).toBeGreaterThanOrEqual(WIRE_LIMITS.MAX_MESSAGES);
    expect(LLM_LIMITS.MAX_BLOCKS_PER_MESSAGE).toBeGreaterThanOrEqual(WIRE_LIMITS.MAX_BLOCKS_PER_MESSAGE);
  });
});
