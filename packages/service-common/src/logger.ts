import { pino, type Logger } from 'pino';

/**
 * Structured JSON logger. In production logs go to stdout as JSON (collected by
 * the cluster's log pipeline → CloudWatch/Loki); in dev they're pretty-printed.
 * Always include the service name so logs are filterable across microservices.
 */
export function createLogger(opts: { service: string; level?: string; pretty?: boolean }): Logger {
  return pino({
    name: opts.service,
    level: opts.level ?? 'info',
    base: { service: opts.service },
    redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
    ...(opts.pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  });
}

export type { Logger };
