/**
 * Server configuration, read from environment variables and validated with zod.
 *
 * Every knob has a safe default so `npm run dev` works with an empty
 * environment (mock mode). Secrets are only ever held in {@link ServerConfig.keys}
 * and are stripped by {@link redactConfig} before anything is logged.
 */
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Repository root (apps/server/src → ../../..). */
export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

/** LLM roles the agent uses; each maps to exactly one server-side model id. */
export type LlmRole = 'planner' | 'coder' | 'critic';

/** Model id per role for one provider. */
export type RoleModels = Record<LlmRole, string>;

/** Which upstream LLM provider to prefer. */
export type ProviderPreference = 'anthropic' | 'openai' | 'mock';

/** Fully-resolved, validated server configuration. */
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly production: boolean;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error' | 'silent';
  readonly provider: ProviderPreference;
  /** API keys (secrets). Never log or return these. */
  readonly keys: { readonly anthropic?: string; readonly openai?: string };
  readonly baseUrls: { readonly anthropic?: string; readonly openai?: string };
  readonly models: { readonly anthropic: RoleModels; readonly openai: RoleModels };
  readonly allowedOrigins: readonly string[];
  readonly dataDir: string;
  readonly staticDir: string;
  readonly serveStatic: boolean;
  /** Number of reverse proxies in front of us whose X-Forwarded-For entries we trust. */
  readonly trustProxyHops: number;
  readonly rateLimit: {
    readonly llmPerMinute: number;
    readonly llmBurst: number;
    readonly apiPerMinute: number;
    readonly apiBurst: number;
    /** Stricter per-client limit for generator uploads (each may trigger a sandbox dry run). */
    readonly generatorPutPerMinute: number;
    readonly generatorPutBurst: number;
  };
  readonly llm: {
    readonly maxBodyBytes: number;
    readonly timeoutMs: number;
    readonly maxOutputTokens: number;
    /** Daily (UTC) input+output token budget across all clients; 0 disables the guard. */
    readonly dailyTokenBudget: number;
  };
  readonly storage: {
    readonly maxGenerators: number;
    readonly maxWorlds: number;
    readonly maxWorldBytes: number;
    readonly maxGeneratorBytes: number;
  };
  readonly generators: {
    /**
     * Dry-run uploaded generators in the procgen node sandbox before caching them.
     * Off by default: `node:vm` is not a security boundary, so this should only be
     * enabled on deployments that accept that risk (runs in an isolated worker thread).
     */
    readonly validate: boolean;
    /** Sandbox time budget per dry run (ms); enforced in the worker and by a terminate watchdog. */
    readonly timeoutMs: number;
    /** Maximum dry runs waiting for the validation worker; further uploads get 503. */
    readonly maxQueue: number;
  };
}

const optionalSecret = z
  .string()
  .trim()
  .max(512)
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v));

const optionalHttpsUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v))
  .refine((v) => v === undefined || /^https:\/\/[^\s]+$/.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?$/.test(v), {
    message: 'must be an https URL (http allowed only for localhost)',
  });

const modelId = (fallback: string) =>
  z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:/@-]{1,128}$/, 'invalid model id')
    .optional()
    .transform((v) => v ?? fallback);

const int = (fallback: number, min: number, max: number) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return fallback;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: 'custom', message: `must be an integer in [${min}, ${max}]` });
        return z.NEVER;
      }
      return n;
    });

const bool = <T extends boolean | undefined>(fallback: T) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return fallback;
      if (['1', 'true', 'yes', 'on'].includes(v)) return true;
      if (['0', 'false', 'no', 'off'].includes(v)) return false;
      ctx.addIssue({ code: 'custom', message: 'must be a boolean (true/false)' });
      return z.NEVER;
    });

const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

const EnvSchema = z.object({
  PORT: int(8787, 1, 65535),
  HOST: z.string().trim().min(1).max(255).optional().default('0.0.0.0'),
  NODE_ENV: z.string().trim().optional().default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional().default('info'),
  AETHER_PROVIDER: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => (v === undefined || v === '' ? 'anthropic' : v))
    .pipe(z.enum(['anthropic', 'openai', 'mock'])),
  ANTHROPIC_API_KEY: optionalSecret,
  OPENAI_API_KEY: optionalSecret,
  ANTHROPIC_BASE_URL: optionalHttpsUrl,
  OPENAI_BASE_URL: optionalHttpsUrl,
  AETHER_PLANNER_MODEL: modelId('claude-haiku-5-5'),
  AETHER_CODER_MODEL: modelId('claude-sonnet-5-5'),
  AETHER_CRITIC_MODEL: z.string().trim().regex(/^[A-Za-z0-9._:/@-]{1,128}$/, 'invalid model id').optional(),
  AETHER_OPENAI_PLANNER_MODEL: modelId('gpt-6-luna'),
  AETHER_OPENAI_CODER_MODEL: modelId('gpt-6.1-sol'),
  AETHER_OPENAI_CRITIC_MODEL: z.string().trim().regex(/^[A-Za-z0-9._:/@-]{1,128}$/, 'invalid model id').optional(),
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((v, ctx) => {
      const list = (v ?? 'http://localhost:5173')
        .split(',')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter((s) => s !== '');
      for (const o of list) {
        if (!ORIGIN_RE.test(o)) {
          ctx.addIssue({ code: 'custom', message: `invalid origin '${o}' (expected scheme://host[:port])` });
          return z.NEVER;
        }
      }
      return list;
    }),
  DATA_DIR: z.string().trim().optional(),
  STATIC_DIR: z.string().trim().optional(),
  SERVE_STATIC: bool(undefined),
  TRUST_PROXY_HOPS: int(0, 0, 10),
  RATE_LIMIT_LLM_PER_MIN: int(20, 1, 100_000),
  RATE_LIMIT_LLM_BURST: int(5, 1, 100_000),
  RATE_LIMIT_API_PER_MIN: int(120, 1, 1_000_000),
  RATE_LIMIT_API_BURST: int(60, 1, 1_000_000),
  RATE_LIMIT_GENERATOR_PUT_PER_MIN: int(10, 1, 100_000),
  RATE_LIMIT_GENERATOR_PUT_BURST: int(5, 1, 100_000),
  AETHER_LLM_MAX_BODY_BYTES: int(1024 * 1024, 1024, 8 * 1024 * 1024),
  AETHER_LLM_TIMEOUT_MS: int(90_000, 1_000, 600_000),
  AETHER_MAX_OUTPUT_TOKENS: int(16_000, 256, 128_000),
  AETHER_DAILY_TOKEN_BUDGET: int(2_000_000, 0, 10_000_000_000),
  AETHER_MAX_GENERATORS: int(5_000, 1, 1_000_000),
  AETHER_MAX_WORLDS: int(10_000, 1, 1_000_000),
  AETHER_VALIDATE_GENERATORS: bool(false),
  AETHER_GENERATOR_TIMEOUT_MS: int(1_000, 50, 5_000),
  AETHER_GENERATOR_MAX_QUEUE: int(8, 1, 256),
});

/** Error thrown when the environment is invalid; the message lists every problem but never values. */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid server configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

function resolvePath(p: string | undefined, fallback: string): string {
  if (p === undefined || p === '') return fallback;
  return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
}

/**
 * Parse and validate configuration from an environment record.
 * Throws {@link ConfigError} on invalid input (messages never include values).
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>> = process.env): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`));
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const serveStatic = e.SERVE_STATIC ?? production;
  return {
    port: e.PORT,
    host: e.HOST,
    production,
    logLevel: e.LOG_LEVEL,
    provider: e.AETHER_PROVIDER,
    keys: { anthropic: e.ANTHROPIC_API_KEY, openai: e.OPENAI_API_KEY },
    baseUrls: { anthropic: e.ANTHROPIC_BASE_URL, openai: e.OPENAI_BASE_URL },
    models: {
      anthropic: { planner: e.AETHER_PLANNER_MODEL, coder: e.AETHER_CODER_MODEL, critic: e.AETHER_CRITIC_MODEL ?? e.AETHER_PLANNER_MODEL },
      openai: {
        planner: e.AETHER_OPENAI_PLANNER_MODEL,
        coder: e.AETHER_OPENAI_CODER_MODEL,
        critic: e.AETHER_OPENAI_CRITIC_MODEL ?? e.AETHER_OPENAI_PLANNER_MODEL,
      },
    },
    allowedOrigins: e.ALLOWED_ORIGINS,
    dataDir: resolvePath(e.DATA_DIR, resolve(REPO_ROOT, 'apps/server/data')),
    staticDir: resolvePath(e.STATIC_DIR, resolve(REPO_ROOT, 'apps/studio/dist')),
    serveStatic,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    rateLimit: {
      llmPerMinute: e.RATE_LIMIT_LLM_PER_MIN,
      llmBurst: e.RATE_LIMIT_LLM_BURST,
      apiPerMinute: e.RATE_LIMIT_API_PER_MIN,
      apiBurst: e.RATE_LIMIT_API_BURST,
      generatorPutPerMinute: e.RATE_LIMIT_GENERATOR_PUT_PER_MIN,
      generatorPutBurst: e.RATE_LIMIT_GENERATOR_PUT_BURST,
    },
    llm: {
      maxBodyBytes: e.AETHER_LLM_MAX_BODY_BYTES,
      timeoutMs: e.AETHER_LLM_TIMEOUT_MS,
      maxOutputTokens: e.AETHER_MAX_OUTPUT_TOKENS,
      dailyTokenBudget: e.AETHER_DAILY_TOKEN_BUDGET,
    },
    storage: {
      maxGenerators: e.AETHER_MAX_GENERATORS,
      maxWorlds: e.AETHER_MAX_WORLDS,
      maxWorldBytes: 2 * 1024 * 1024,
      maxGeneratorBytes: 256 * 1024,
    },
    generators: {
      validate: e.AETHER_VALIDATE_GENERATORS,
      timeoutMs: e.AETHER_GENERATOR_TIMEOUT_MS,
      maxQueue: e.AETHER_GENERATOR_MAX_QUEUE,
    },
  };
}

/** A copy of the config that is safe to log: secrets become "set"/"unset". */
export function redactConfig(config: ServerConfig): Record<string, unknown> {
  return {
    ...config,
    keys: {
      anthropic: config.keys.anthropic ? '[set]' : '[unset]',
      openai: config.keys.openai ? '[set]' : '[unset]',
    },
  };
}

/** Every secret value in the config, for scrubbing free text (e.g. upstream error messages). */
export function secretValues(config: ServerConfig): string[] {
  return [config.keys.anthropic, config.keys.openai].filter((k): k is string => typeof k === 'string' && k.length > 0);
}
