/**
 * Hard limits of the MCP server. Every tool input is size-checked and every
 * long-running tool has a wall-clock cap; an MCP client (an LLM) is untrusted.
 */
export const MCP_LIMITS = Object.freeze({
  /** Longest prompt accepted by `create_world` / `edit` (characters). */
  MAX_PROMPT_CHARS: 4_000,
  /** Most patches in one `apply_patch` call. */
  MAX_PATCHES: 200,
  /** Largest `apply_patch` payload (bytes of JSON). */
  MAX_PATCH_BYTES: 512 * 1024,
  /** Largest world JSON accepted from or written to the project folder (bytes). */
  MAX_WORLD_BYTES: 32 * 1024 * 1024,
  /** Entities listed by one `list_entities` call. */
  MAX_LIST: 200,
  /** Largest text block returned by a tool or resource (characters). */
  MAX_TEXT_CHARS: 60_000,
  /** Largest image returned inline by `render_still` (bytes of PNG). */
  MAX_INLINE_IMAGE_BYTES: 1_500_000,
  /** Wall-clock cap of an agent run (`create_world`, `edit`), ms. */
  AGENT_TIMEOUT_MS: 5 * 60_000,
  /** Wall-clock cap of `verify` (physics tests), ms. */
  VERIFY_TIMEOUT_MS: 60_000,
  /** Wall-clock cap of `playtest`, ms. */
  PLAYTEST_TIMEOUT_MS: 60_000,
  /** Wall-clock cap of `render_still` and exports, ms. */
  RENDER_TIMEOUT_MS: 60_000,
  /** Simulated seconds a playtest may run at most. */
  MAX_PLAYTEST_SECONDS: 120,
  /** Still image bounds (pixels per side). */
  MIN_IMAGE: 64,
  MAX_IMAGE: 1920,
  /** Triangles a still or a glTF export draws at most. */
  MAX_TRIANGLES: 3_000_000,
  /** Undo steps kept. */
  MAX_UNDO: 200,
  /** Largest file the exports write (bytes). */
  MAX_EXPORT_BYTES: 256 * 1024 * 1024,
});
