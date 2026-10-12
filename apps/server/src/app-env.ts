/**
 * Hono environment typing shared by the app and its routes.
 */

/** Per-request variables set by middleware. */
export interface AppEnv {
  Variables: {
    /** Correlation id (from a valid incoming X-Request-Id or generated). */
    requestId: string;
  };
}
