import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));
const int = (def: number) => z.coerce.number().int().min(0).default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(10000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),
  PUBLIC_BASE_URL: z.string().optional(),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().default('torbox_gateway'),
  MASTER_ENCRYPTION_KEY: z.string().min(16),
  SESSION_SECRET: z.string().min(16),
  PERMALINK_SIGNING_SECRET: z.string().min(16),
  WEBHOOK_INBOUND_SECRET: z.string().min(8),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(8).optional(),
  TORBOX_API_KEY: z.string().optional(),
  TORBOX_API_BASE: z.string().url().default('https://api.torbox.app'),
  UPSTREAM_GLOBAL_PER_MINUTE: int(280),
  UPSTREAM_GLOBAL_CREATE_UNCACHED_PER_HOUR: int(55),
  UPSTREAM_GLOBAL_CREATE_USENET_PER_HOUR: int(55),
  UPSTREAM_GLOBAL_CREATE_WEBDL_PER_HOUR: int(55),
  LOG_RETENTION_DAYS: int(30),
  MAX_UPLOAD_MB: int(100),
  TRUST_PROXY: bool.default(true),
  RUN_JOBS_IN_PROCESS: bool.default(true),
  UPSTREAM_TIMEOUT_MS: int(45000),
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof schema> & { version: string; publicBaseUrl: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid configuration:\n  ${issues}`);
  }
  const c = parsed.data;
  const publicBaseUrl = (c.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${c.PORT}`).replace(/\/$/, '');
  return { ...c, version: env.npm_package_version || '1.0.0', publicBaseUrl };
}
