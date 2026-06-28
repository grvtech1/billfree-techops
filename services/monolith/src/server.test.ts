import { describe, it, expect, beforeEach } from 'vitest';
import { ACCESS_TOKEN_COOKIE, verifyAccessToken, type JwtConfig, type Pool } from '@billfree/service-common';
import { buildMonolith } from './server.js';

function extractSetCookie(raw: string | string[] | undefined, name: string): string | null {
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const c of cookies) {
    const pair = c.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return null;
}

const JWT: JwtConfig = { secret: 'test-secret-at-least-16-chars', issuer: 'billfree-techops' };
// The repos store the pool but don't touch it until a DB route is hit; these
// tests exercise only the no-DB surface (health + auth), so a stub pool is fine.
const fakePool = {} as unknown as Pool;

let app: Awaited<ReturnType<typeof buildMonolith>>;
beforeEach(async () => {
  app = await buildMonolith({ pool: fakePool, jwt: JWT, requireGoogleAuth: false, logger: false });
});

describe('modular monolith composition', () => {
  it('serves the shared health endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });

  it('mounts the auth module: issues a verifiable JWT as an httpOnly cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { email: 'agent1@billfree.in' },
    });
    expect(res.statusCode).toBe(200);
    // Token is in httpOnly cookie, not in response body.
    expect(res.json().data).not.toHaveProperty('token');
    expect(res.json().data.user.role).toBe('agent');
    const token = extractSetCookie(res.headers['set-cookie'], ACCESS_TOKEN_COOKIE);
    expect(token).toBeTruthy();
    const decoded = await verifyAccessToken(token!, JWT);
    expect(decoded.sub).toBe('agent1@billfree.in');
  });

  it('mounts the auth module: rejects an unknown identity', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/token',
      payload: { email: 'stranger@evil.com' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('enforces auth on the directory endpoint (composed preHandler works)', async () => {
    const anon = await app.inject({ method: 'GET', url: '/auth/agents' });
    expect(anon.statusCode).toBe(401);

    // Extract token from cookie, then send as Bearer (inject doesn't auto-send cookies).
    const login = await app.inject({ method: 'POST', url: '/auth/token', payload: { email: 'admin@billfree.in' } });
    const token = extractSetCookie(login.headers['set-cookie'], ACCESS_TOKEN_COOKIE);
    const ok = await app.inject({
      method: 'GET',
      url: '/auth/agents',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.count).toBeGreaterThan(0);
  });

  it('mounts the DB-backed modules (tickets/analytics/calls/reports) behind auth', async () => {
    // No token → each protected module route returns 401 (proves the route
    // exists and is guarded, without needing a database).
    for (const url of [
      '/tickets?page=1&pageSize=10',
      '/analytics/top-pos',
      '/calls?page=1&pageSize=10',
      '/reports/monthly?month=6&year=2026',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, `${url} should be auth-guarded`).toBe(401);
    }
  });
});
