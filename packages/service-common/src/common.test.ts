import { describe, it, expect } from 'vitest';
import { ok } from './http.js';
import { AppError, notFound, forbidden } from './errors.js';
import { signAccessToken, verifyAccessToken, requireApiKey, type JwtConfig } from './auth.js';
import { loadEnv, jwtEnvShape } from './config.js';

const JWT: JwtConfig = { secret: 'test-secret-at-least-16-chars', issuer: 'billfree-techops' };

describe('http envelope', () => {
  it('ok() wraps data with success + optional meta', () => {
    expect(ok({ a: 1 })).toEqual({ success: true, data: { a: 1 } });
    expect(ok([], { total: 0, page: 1, limit: 10 })).toEqual({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 10 },
    });
  });
});

describe('error model', () => {
  it('maps helpers to the right code + status', () => {
    const nf = notFound('x');
    expect(nf).toBeInstanceOf(AppError);
    expect(nf.code).toBe('E003');
    expect(nf.statusCode).toBe(404);
    expect(forbidden().statusCode).toBe(403);
  });
});

describe('jwt', () => {
  it('signs and verifies a token round-trip', async () => {
    const token = await signAccessToken({ sub: 'a@b.in', name: 'A', role: 'agent' }, JWT);
    const user = await verifyAccessToken(token, JWT);
    expect(user).toMatchObject({ sub: 'a@b.in', role: 'agent' });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken({ sub: 'a@b.in', name: 'A', role: 'agent' }, JWT);
    await expect(verifyAccessToken(token, { ...JWT, secret: 'another-secret-16chars' })).rejects.toThrow();
  });
});

describe('requireApiKey', () => {
  const run = (expected: string, header?: string | string[]) => {
    // Invoke the preHandler directly with just a request (reply is unused).
    const guard = requireApiKey(expected) as unknown as (req: {
      headers: Record<string, string | string[] | undefined>;
    }) => Promise<void>;
    return guard({ headers: header === undefined ? {} : { 'x-api-key': header } });
  };

  it('passes when the key matches', async () => {
    await expect(run('secret-key', 'secret-key')).resolves.toBeUndefined();
  });

  it('rejects a missing key (401 + E002)', async () => {
    await expect(run('secret-key')).rejects.toMatchObject({ code: 'E002', statusCode: 401 });
  });

  it('rejects a wrong key', async () => {
    await expect(run('secret-key', 'nope')).rejects.toMatchObject({ code: 'E002' });
  });
});

describe('config', () => {
  it('parses a valid env and rejects a short JWT secret', () => {
    const env = loadEnv(
      { ...jwtEnvShape },
      { SERVICE_NAME: 'svc', PORT: '8080', JWT_SECRET: 'a-sufficiently-long-secret', JWT_ISSUER: 'billfree-techops' } as NodeJS.ProcessEnv,
    );
    expect(env.PORT).toBe(8080);
    expect(env.SERVICE_NAME).toBe('svc');
    expect(() =>
      loadEnv({ ...jwtEnvShape }, { JWT_SECRET: 'short' } as NodeJS.ProcessEnv),
    ).toThrow();
  });
});
