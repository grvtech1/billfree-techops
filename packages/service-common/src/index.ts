/**
 * @billfree/service-common — shared building blocks for every Node microservice:
 * config validation, structured logging, the error model + Fastify handler,
 * Postgres pool, Prometheus metrics, K8s health probes, and JWT auth.
 */
export * from './config.js';
export * from './logger.js';
export * from './errors.js';
export * from './db.js';
export * from './http.js';
export * from './health.js';
export * from './metrics.js';
export * from './auth.js';
