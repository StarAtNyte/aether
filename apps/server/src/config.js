/**
 * Server configuration, read from environment variables and validated with zod.
 *
 * Every knob has a safe default so `npm run dev` works with an empty
 * environment (mock mode). Secrets are only ever held in {@link ServerConfig.keys}
 * and are stripped by {@link redactConfig} before anything is logged.
 */
import { isAllowedEndpoint } from '@aether/assets';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
/** Repository root (apps/server/src → ../../..). */
export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
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
const modelId = (fallback) => z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:/@-]{1,128}$/, 'invalid model id')
    .optional()
    .transform((v) => v ?? fallback);
const int = (fallback, min, max) => z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
    if (v === undefined || v === '')
        return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: 'custom', message: `must be an integer in [${min}, ${max}]` });
        return z.NEVER;
    }
    return n;
});
const bool = (fallback) => z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v, ctx) => {
    if (v === undefined || v === '')
        return fallback;
    if (['1', 'true', 'yes', 'on'].includes(v))
        return true;
    if (['0', 'false', 'no', 'off'].includes(v))
        return false;
    ctx.addIssue({ code: 'custom', message: 'must be a boolean (true/false)' });
    return z.NEVER;
});
const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
/** `host:port` (DNS name, IPv4 or bracketed IPv6). */
const HOST_PORT_RE = /^([a-z0-9.-]{1,253}|\[[0-9a-f:.]{2,45}\]):\d{1,5}$/;
/** Hosted studio origins the bridge may serve: https, or loopback http. */
const BRIDGE_ORIGIN_RE = /^(https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/;
/** Shape of the session secret / access token files' content. */
const SECRET_FILE_RE = /^[A-Za-z0-9_-]{32,128}$/;
const EnvSchema = z.object({
    PORT: int(8787, 1, 65535),
    HOST: z.string().trim().min(1).max(255).optional().default('127.0.0.1'),
    NODE_ENV: z.string().trim().optional().default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional().default('info'),
    AETHER_PROVIDER: z
        .string()
        .trim()
        .toLowerCase()
        .optional()
        .transform((v) => (v === undefined || v === '' ? 'mock' : v))
        .pipe(z.enum(['anthropic', 'openai', 'mock', 'codex', 'claude-code'])),
    AETHER_HEADLESS_MODEL: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/, 'invalid model id').optional(),
    AETHER_HEADLESS_EFFORT: z.enum(['low', 'medium', 'high']).optional().default('low'),
    AETHER_LOCAL_AI: z.enum(['auto', 'on', 'off']).optional().default('auto'),
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
    AETHER_ALLOWED_HOSTS: z
        .string()
        .optional()
        .transform((v, ctx) => {
        if (v === undefined || v.trim() === '')
            return null;
        const list = v.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s !== '');
        for (const h of list) {
            if (!HOST_PORT_RE.test(h)) {
                ctx.addIssue({ code: 'custom', message: `invalid host '${h}' (expected host:port)` });
                return z.NEVER;
            }
        }
        return list.slice(0, 16);
    }),
    AETHER_SECRET_FILE: z.string().trim().max(1024).optional(),
    AETHER_ACCESS_TOKEN_FILE: z.string().trim().max(1024).optional(),
    AETHER_INSTANCE_ID: z.string().trim().regex(/^[A-Za-z0-9-]{8,64}$/, 'invalid instance id').optional(),
    AETHER_LOG_FILE: z.string().trim().max(1024).optional(),
    AETHER_BRIDGE_ORIGINS: z
        .string()
        .optional()
        .transform((v, ctx) => {
        if (v === undefined || v.trim() === '')
            return [];
        const list = v.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter((s) => s !== '');
        for (const o of list) {
            if (!BRIDGE_ORIGIN_RE.test(o)) {
                ctx.addIssue({ code: 'custom', message: `invalid bridge origin '${o}' (https://host, or http://localhost:<port>)` });
                return z.NEVER;
            }
        }
        return list.slice(0, 16);
    }),
    AETHER_BRIDGE_PORT: int(8790, 0, 65535),
    AETHER_VALIDATE_GENERATORS: bool(false),
    AETHER_IMAGE_TO_3D_URL: z
        .string()
        .trim()
        .max(512)
        .optional()
        .refine((v) => v === undefined || v === '' || isAllowedEndpoint(v), 'AETHER_IMAGE_TO_3D_URL must be http://127.0.0.1 / localhost or https'),
    AETHER_IMAGE_TO_3D_TOKEN: z.string().max(512).optional(),
    AETHER_GENERATOR_TIMEOUT_MS: int(1_000, 50, 5_000),
    AETHER_GENERATOR_MAX_QUEUE: int(8, 1, 256),
});
/** Error thrown when the environment is invalid; the message lists every problem but never values. */
export class ConfigError extends Error {
    problems;
    constructor(problems) {
        super(`invalid server configuration:\n  - ${problems.join('\n  - ')}`);
        this.problems = problems;
        this.name = 'ConfigError';
    }
}
/** Environment markers of hosting platforms and containers (local AI is never offered there). */
const HOSTED_MARKERS = ['VERCEL', 'FLY_APP_NAME', 'RENDER', 'RAILWAY_ENVIRONMENT', 'K_SERVICE', 'AWS_LAMBDA_FUNCTION_NAME', 'DYNO', 'NETLIFY', 'KUBERNETES_SERVICE_HOST', 'AETHER_HOSTED'];
/** The hosting platform marker found in `env`, or null when the server looks local. */
export function hostedPlatform(env) {
    for (const k of HOSTED_MARKERS)
        if (typeof env[k] === 'string' && env[k] !== '' && env[k] !== '0' && env[k] !== 'false')
            return k;
    return null;
}
/** Read a secret file (trimmed); throws a ConfigError naming the variable (never the value). */
function readSecretFile(name, path) {
    if (path === undefined || path === '')
        return null;
    let text;
    try {
        text = readFileSync(path, 'utf8').trim();
    }
    catch {
        throw new ConfigError([`${name}: the file cannot be read`]);
    }
    if (!SECRET_FILE_RE.test(text))
        throw new ConfigError([`${name}: the file does not hold a valid secret`]);
    return text;
}
function resolvePath(p, fallback) {
    if (p === undefined || p === '')
        return fallback;
    return isAbsolute(p) ? p : resolve(REPO_ROOT, p);
}
/**
 * Parse and validate configuration from an environment record.
 * Throws {@link ConfigError} on invalid input (messages never include values).
 */
export function loadConfig(env = process.env) {
    const parsed = EnvSchema.safeParse(env);
    if (!parsed.success) {
        throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`));
    }
    const e = parsed.data;
    const production = e.NODE_ENV === 'production';
    const serveStatic = e.SERVE_STATIC ?? production;
    const hosted = hostedPlatform(env);
    if (e.AETHER_LOCAL_AI === 'on' && hosted)
        throw new ConfigError([`AETHER_LOCAL_AI: local AI cannot be enabled on a hosted platform (${hosted})`]);
    const localAi = e.AETHER_LOCAL_AI === 'on' || (e.AETHER_LOCAL_AI === 'auto' && !production && hosted === null);
    if (e.AETHER_BRIDGE_ORIGINS.length > 0 && !localAi)
        throw new ConfigError(['AETHER_BRIDGE_ORIGINS: the bridge needs local AI (AETHER_LOCAL_AI=on, not on a hosted platform)']);
    return {
        port: e.PORT,
        host: e.HOST,
        production,
        logLevel: e.LOG_LEVEL,
        provider: e.AETHER_PROVIDER,
        headless: { ...(e.AETHER_HEADLESS_MODEL ? { model: e.AETHER_HEADLESS_MODEL } : {}), effort: e.AETHER_HEADLESS_EFFORT },
        localAi,
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
        local: {
            allowedHosts: e.AETHER_ALLOWED_HOSTS,
            sessionSecret: readSecretFile('AETHER_SECRET_FILE', e.AETHER_SECRET_FILE),
            accessToken: readSecretFile('AETHER_ACCESS_TOKEN_FILE', e.AETHER_ACCESS_TOKEN_FILE),
            instanceId: e.AETHER_INSTANCE_ID ?? null,
            logFile: e.AETHER_LOG_FILE ? resolvePath(e.AETHER_LOG_FILE, '') : null,
            bridge: e.AETHER_BRIDGE_ORIGINS.length > 0 ? { origins: e.AETHER_BRIDGE_ORIGINS, port: e.AETHER_BRIDGE_PORT } : null,
        },
        imageTo3d: e.AETHER_IMAGE_TO_3D_URL ? { endpoint: e.AETHER_IMAGE_TO_3D_URL, ...(e.AETHER_IMAGE_TO_3D_TOKEN ? { token: e.AETHER_IMAGE_TO_3D_TOKEN } : {}) } : null,
        generators: {
            validate: e.AETHER_VALIDATE_GENERATORS,
            timeoutMs: e.AETHER_GENERATOR_TIMEOUT_MS,
            maxQueue: e.AETHER_GENERATOR_MAX_QUEUE,
        },
    };
}
/** A copy of the config that is safe to log: secrets become "set"/"unset". */
export function redactConfig(config) {
    return {
        ...config,
        keys: {
            anthropic: config.keys.anthropic ? '[set]' : '[unset]',
            openai: config.keys.openai ? '[set]' : '[unset]',
        },
        local: { ...config.local, sessionSecret: config.local.sessionSecret ? '[set]' : '[unset]', accessToken: config.local.accessToken ? '[set]' : '[unset]' },
        imageTo3d: config.imageTo3d ? { endpoint: config.imageTo3d.endpoint, token: config.imageTo3d.token ? '[set]' : '[unset]' } : null,
    };
}
/** Every secret value in the config, for scrubbing free text (e.g. upstream error messages). */
export function secretValues(config) {
    return [config.keys.anthropic, config.keys.openai, config.local.sessionSecret ?? undefined, config.local.accessToken ?? undefined, config.imageTo3d?.token].filter((k) => typeof k === 'string' && k.length > 0);
}
