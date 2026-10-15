/**
 * Errors of the MCP server. Tool failures reach the client as plain,
 * actionable text: never a stack trace, never an absolute path of this
 * computer. Only {@link ToolError}s carry their own message; anything else
 * becomes a generic "internal error" (the details go to stderr).
 */

/** Stable error codes (also reported to clients as `code`). */
export type ToolErrorCode =
  | 'invalid_input'
  | 'invalid_patch'
  | 'not_found'
  | 'too_large'
  | 'timeout'
  | 'cancelled'
  | 'busy'
  | 'unavailable'
  | 'path_denied'
  | 'nothing_to_undo'
  | 'internal';

/** A failure whose message is safe and useful to show to the model driving the server. */
export class ToolError extends Error {
  override readonly name = 'ToolError';
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const MAX_MESSAGE = 600;

/** Strip control characters, absolute paths and over-long text from a message. */
export function scrub(text: string, hide: readonly string[] = []): string {
  let out = text;
  for (const h of hide) if (h.length > 3) out = out.split(h).join('<project>');
  out = out
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/(?:\/[\w.@-]+){3,}/g, '<path>')
    .replace(/[A-Za-z]:\\[^\s"']+/g, '<path>');
  return out.length > MAX_MESSAGE ? `${out.slice(0, MAX_MESSAGE)}...` : out;
}

/** The client-facing message of any thrown value. */
export function safeMessage(e: unknown, hide: readonly string[] = []): { code: ToolErrorCode; message: string } {
  if (e instanceof ToolError) return { code: e.code, message: scrub(e.message, hide) };
  if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) return { code: 'timeout', message: 'The operation was cancelled or ran out of time.' };
  return { code: 'internal', message: 'Internal error. The server logged the details to its stderr.' };
}
