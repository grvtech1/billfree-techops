import { describe, it, expect, beforeEach } from 'vitest';
import { verifyAccessToken, type JwtConfig } from '@billfree/service-common';
import { buildServer, type Directory } from './server.js';

const JWT: JwtConfig = { secret: 'test-secret-at-least-16-chars', issuer: 'billfree-techops' };
const directory: Directory = {
  lookup: (email) => (email === 'agent1@billfree.in' ? { name: 'Agent One', role: 'agent' } : null),
  listAll: () => [{ name: 'Agent One', email: 'agent1@billfree.in', role: 'agent' }],
};

let app: ReturnType<typeof buildServer>;
beforeEach(() => {
  app = buildServer({ jwt: JWT, directory, logger: false });
});

describe('auth-service', () => {
  it('issues a verifiable token for an authorized email', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/token', payload: { email: 'agent1@billfree.in' } });
    expect(res.statusCode).toBe(200);
    const { token, user } = res.json().data;
    expect(user.role).toBe('agent');
    const decoded = await verifyAccessToken(token, JWT);
    expect(decoded.sub).toBe('agent1@billfree.in');
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

  it('/auth/verify echoes the identity for a valid token', async () => {
    const issued = (await app.inject({ method: 'POST', url: '/auth/token', payload: { email: 'agent1@billfree.in' } })).json();
    const res = await app.inject({ method: 'GET', url: '/auth/verify', headers: { authorization: `Bearer ${issued.data.token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.sub).toBe('agent1@billfree.in');
  });
});
