import { z } from 'zod';

/**
 * Twelve-factor config: every service reads its configuration from the
 * environment, validated once at boot. Invalid/missing config fails fast with a
 * clear message instead of surfacing as a confusing runtime error later.
 */
const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SERVICE_NAME: z.string().default('service'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

const DbEnvSchema = z.object({
  DATABASE_URL: z.string().url().or(z.string().startsWith('postgres')),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
});

const JwtEnvSchema = z.object({
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_ISSUER: z.string().default('billfree-techops'),
});

export type BaseEnv = z.infer<typeof BaseEnvSchema>;

/** Parse and validate the base env shared by every service. */
export function loadBaseEnv(env: NodeJS.ProcessEnv = process.env): BaseEnv {
  return BaseEnvSchema.parse(env);
}

/** Extend the base schema with service-specific keys (db, jwt, custom). */
export function loadEnv<T extends z.ZodRawShape>(
  shape: T,
  env: NodeJS.ProcessEnv = process.env,
): BaseEnv & z.infer<z.ZodObject<T>> {
  const schema = BaseEnvSchema.extend(shape);
  return schema.parse(env) as BaseEnv & z.infer<z.ZodObject<T>>;
}

export const dbEnvShape = DbEnvSchema.shape;
export const jwtEnvShape = JwtEnvSchema.shape;
