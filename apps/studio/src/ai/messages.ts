/**
 * Plain-language explanations for connection failures (fallback notices,
 * setup hints). Bridge error codes are mapped to an action the user can take.
 */
import type { FallbackNotice } from '@aether/agent';

const ACTIONS: Readonly<Record<string, string>> = {
  bridge_offline: 'the local bridge is not running. Start it with "npm run bridge" and pair it in Settings → AI connection',
  unauthorized: 'the bridge pairing expired (the bridge restarted). Pair again in Settings → AI connection',
  not_logged_in: 'it is not signed in on this computer. Run "codex login" or start "claude" once to sign in',
  cli_missing: 'its command-line tool is not installed on this computer',
  rate_limited: "your subscription's usage limit is reached for now. Try again later or pick another model",
  timeout: 'it took too long to answer. Try a faster model or lower effort',
  busy: 'the bridge is busy with other requests',
  tool_violation: 'the run was stopped because the model tried to use a tool (tools are never allowed)',
  forbidden_origin: 'the bridge does not allow this site yet. Restart it with --origin set to this address',
  invalid_url: 'the bridge address is not a local address',
  webllm_error: 'the on-device model failed',
  webllm_context: 'this request is too long for the small on-device model. Try a shorter prompt, start from a smaller world, or use the local bridge',
};

/** Notice shown when a run falls back to the offline planner. */
export function fallbackText(label: string, n: FallbackNotice): string {
  const action = (n.reason && ACTIONS[n.reason]) ?? (n.code === 'network' ? 'it could not be reached' : n.code === 'auth' ? 'it rejected the credentials' : n.message);
  return `${label} could not answer: ${action}. Finished with the offline planner instead.`.slice(0, 600);
}
