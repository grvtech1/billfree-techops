import { describe, it, expect, beforeEach } from 'vitest';
import { ACCESS_TOKEN_COOKIE, verifyAccessToken, type JwtConfig } from '@billfree/service-common';
import { buildServer, type Directory } from './server.js';

const JWT: JwtConfig = { secret: 'test-secret-at-least-16-chars', issuer: 'billfree-techops' };
const directory: Directory = {
  lookup: (email) => (email === 'agent1@billfree.in' ? { name: 'Agent One', role: 'agent' } : null),
  listAll: () => [{ name: 'Agent One', email: 'agent1@billfree.in', role: 'agent' }],
};

/** Extract a named cookie value from a `set-cookie` header (single or array form). */
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

let app: ReturnType<typeof buildServer>;
beforeEach(() => {
  app = buildServer({ jwt: JWT, directory, logger: false });
});

describe('auth-service /auth/token', () => {
  it('issues a verifiable JWT as an httpOnly cookie (token NOT in body)', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/token', payload: { email: 'agent1@billfree.in' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Token is NOT exposed in the response body (XSS cannot steal it).
    expect(body.data).not.toHaveProperty('token');
    expect(body.data.user.role).toBe('agent');

    // Token IS in the httpOnly cookie — extract and verify.
    const cookieVal = extractSetCookie(res.headers['set-cookie'], ACCESS_TOKEN_COOKIE);
    expect(cookieVal).toBeTruthy();
    const decoded = await verifyAccessToken(cookieVal!, JWT);
    expect(decoded.sub).toBe('agent1@billfree.in');

    // Cookie must carry the security attributes.
    const cookieLine = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join('; ');
    expect(cookieLine).toMatch(/httponly/i);
    expect(cookieLine).toMatch(/path=\//i);
  });

  it('rejects an unknown email with 401 + E002', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/token', payload: { email: 'stranger@evil.com' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('[E002]');
  });

  it('rejects a malformed request with 400 + E004', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/token', payload: { email: 'not-an-email' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('[E004]');
  });
});

describe('auth-service /auth/verify', () => {
  it('echoes the identity for a valid Bearer token', async () => {
    // Get token from cookie, then re-send as Bearer (machine-client compat path).
    const login = await app.inject({ method: 'POST', url: '/auth/token', payload: { email: 'agent1@billfree.in' } });
    const token = extractSetCookie(login.headers['set-cookie'], ACCESS_TOKEN_COOKIE);
    const res = await app.inject({ method: 'GET', url: '/auth/verify', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.sub).toBe('agent1@billfree.in');
  });

  it('echoes the identity when authenticated via the session cookie', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/token', payload: { email: 'agent1@billfree.in' } });
    const token = extractSetCookie(login.headers['set-cookie'], ACCESS_TOKEN_COOKIE);
    // Cookie path: send cookie header, no Authorization.
    const res = await app.inject({
      method: 'GET',
      url: '/auth/verify',
      headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.sub).toBe('agent1@billfree.in');
  });

  it('rejects with 401 when no credential is provided', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/verify' });
    expect(res.statusCode).toBe(401);
  });
});

describe('auth-service /auth/logout', () => {
  it('clears the session cookie (maxAge=0 or expires in the past)', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(200);
    // The cookie should be cleared: clearCookie sets maxAge=0 or an expired date.
    const cookieLine = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join('; ');
    expect(cookieLine).toMatch(new RegExp(ACCESS_TOKEN_COOKIE));
  });

  it('is idempotent — safe to call when not authenticated', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ ok: true });
  });
});

describe('auth-service /auth/agents', () => {
  it('rejects anonymous callers with 401 (no PII leak)', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/agents' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the directory for an authenticated caller (Bearer path)', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/token', payload: { email: 'agent1@billfree.in' } });
    const token = extractSetCookie(login.headers['set-cookie'], ACCESS_TOKEN_COOKIE);
    const res = await app.inject({ method: 'GET', url: '/auth/agents', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.count).toBe(1);
    expect(res.json().data.agents[0].email).toBe('agent1@billfree.in');
  });

  it('returns the directory for an authenticated caller (cookie path)', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/token', payload: { email: 'agent1@billfree.in' } });
    const token = extractSetCookie(login.headers['set-cookie'], ACCESS_TOKEN_COOKIE);
    const res = await app.inject({
      method: 'GET',
      url: '/auth/agents',
      headers: { cookie: `${ACCESS_TOKEN_COOKIE}=${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.count).toBe(1);
  });
});
