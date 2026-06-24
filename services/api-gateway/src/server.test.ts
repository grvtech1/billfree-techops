import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { JwtConfig } from '@billfree/service-common';
import { buildServer } from './server.js';

const JWT: JwtConfig = { secret: 'test-secret-at-least-16-chars', issuer: 'billfree-techops' };

let app: Awaited<ReturnType<typeof buildServer>>;
let ticketUpstream: FastifyInstance;
beforeEach(async () => {
  ticketUpstream = Fastify({ logger: false });
  ticketUpstream.post('/intake/tickets', async () => ({
    success: true,
    data: { ticketRef: 'WA-1' },
  }));
  const ticketUpstreamUrl = await ticketUpstream.listen({ port: 0, host: '127.0.0.1' });

  app = await buildServer({
    jwt: JWT,
    upstreams: {
      auth: 'http://auth-service:8080',
      tickets: ticketUpstreamUrl,
      analytics: 'http://analytics-service:8080',
      calllog: 'http://calllog-service:8080',
      reports: 'http://report-service:8080',
    },
    intakeApiKey: 'whatsapp-intake-key-1234567890',
    logger: false,
  });
});

afterEach(async () => {
  await app.close();
  await ticketUpstream.close();
});

describe('api-gateway', () => {
  it('serves liveness without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });

  it('blocks protected routes without a token at the edge (401 + E002)', async () => {
    // No upstream call happens — the auth preHandler rejects first.
    const res = await app.inject({ method: 'GET', url: '/api/tickets' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('[E002]');
  });

  it('guards the call-log route at the edge too (401 + E002)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/calls' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('[E002]');
  });

  it('guards the reports route at the edge too (401 + E002)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/monthly?month=6&year=2026' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('[E002]');
  });

  it('rejects intake without the API key at the edge (401 + E002)', async () => {
    // The requireApiKey preHandler rejects before any upstream proxy happens.
    const res = await app.inject({ method: 'POST', url: '/api/intake/tickets', payload: { phone: '1', concern: 'x' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('[E002]');
  });

  it('does NOT require a JWT on the intake path (API key is the auth)', async () => {
    // With a valid API key the edge guard passes; the request is then proxied
    // upstream (which fails to connect in this test) — i.e. NOT a 401.
    const res = await app.inject({
      method: 'POST', url: '/api/intake/tickets',
      headers: { 'x-api-key': 'whatsapp-intake-key-1234567890' },
      payload: { phone: '9990001111', concern: 'x', mid: '1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { ticketRef: 'WA-1' } });
  });

  it('exposes Prometheus metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('http_request_duration_seconds');
  });
});
