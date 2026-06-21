import type { FastifyInstance } from 'fastify';
import client from 'prom-client';

/**
 * Prometheus metrics plugin. Registers default Node process metrics + an HTTP
 * request histogram, and exposes GET /metrics for the Prometheus scraper
 * (wired via a ServiceMonitor in the Helm chart). Standard RED-method signals.
 */
export function registerMetrics(app: FastifyInstance, serviceName: string): void {
  const registry = new client.Registry();
  registry.setDefaultLabels({ service: serviceName });
  client.collectDefaultMetrics({ register: registry });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  app.addHook('onResponse', (req, reply, done) => {
    const route = (req.routeOptions?.url as string) ?? req.url;
    httpDuration
      .labels(req.method, route, String(reply.statusCode))
      .observe(reply.elapsedTime / 1000);
    done();
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });
}
