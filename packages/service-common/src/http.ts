import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { ERROR_CODES, type ApiEnvelope } from '@billfree/shared';
import { AppError } from './errors.js';

/** Canonical success envelope (matches @billfree/shared ApiEnvelope). */
export function ok<T>(data: T, meta?: ApiEnvelope<T>['meta']): ApiEnvelope<T> {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

/**
 * Central error handler. Maps AppError → its code/status, ZodError → 400
 * validation, everything else → 500 (logged, message hidden). Every error
 * leaves as the same `{ success:false, error }` envelope the SPA expects, with
 * an `[E0NN]` code embedded so the client can branch.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      req.log.warn({ code: err.code, err: err.message }, 'handled app error');
      reply.code(err.statusCode);
      return reply.send({ success: false, error: `[${err.code}] ${err.message}`, data: null });
    }
    if (err instanceof ZodError) {
      reply.code(400);
      return reply.send({
        success: false,
        error: `[${ERROR_CODES.VALIDATION_FAILED}] ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        data: null,
      });
    }
    // Fastify's own validation errors carry a statusCode. (Fastify 5 types the
    // error-handler error as `unknown`, so narrow before reading .message.)
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode === 400) {
      reply.code(400);
      return reply.send({ success: false, error: `[${ERROR_CODES.VALIDATION_FAILED}] ${e.message ?? 'Validation failed'}`, data: null });
    }
    req.log.error({ err }, 'unhandled error');
    reply.code(500);
    return reply.send({ success: false, error: `[${ERROR_CODES.UNKNOWN_ERROR}] Internal server error`, data: null });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404);
    return reply.send({ success: false, error: `[${ERROR_CODES.NOT_FOUND}] Route not found: ${req.method} ${req.url}`, data: null });
  });
}
