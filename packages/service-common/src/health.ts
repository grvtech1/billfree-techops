import type { FastifyInstance } from 'fastify';

/**
 * Kubernetes health endpoints:
 *   GET /healthz  — liveness: process is up (never touches dependencies, so a
 *                   slow DB doesn't cause pod restarts).
 *   GET /readyz   — readiness: dependencies (DB, etc.) are reachable; gates
 *                   traffic via the readinessProbe.
 */
export function registerHealth(
  app: FastifyInstance,
  opts: { readiness?: () => Promise<boolean> } = {},
): void {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_req, reply) => {
    const ready = opts.readiness ? await opts.readiness() : true;
    if (!ready) {
      reply.code(503);
      return { status: 'unready' };
    }
    return { status: 'ready' };
  });
}
