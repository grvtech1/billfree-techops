import { describe, it, expect, beforeEach } from 'vitest';
import { signAccessToken, type JwtConfig } from '@billfree/service-common';
import { buildServer } from './server.js';
import type { AnalyticsRepository } from './repository.js';

const JWT: JwtConfig = { secret: 'test-secret-at-least-16-chars', issuer: 'billfree-techops' };

const repo: AnalyticsRepository = {
  statusBreakdown: async () => [
    { status: 'Completed', count: 3 },
    { status: 'Pending', count: 1 },
  ],
  topPos: async (limit) => [{ pos: 'Tally', count: 2 }].slice(0, limit),
  agentLeaderboard: async () => [{ agentEmail: 'agent1@billfree.in', total: 4, completed: 3 }],
};

let app: ReturnType<typeof buildServer>;
let token: string;
beforeEach(async () => {
  app = buildServer({ repo, jwt: JWT, logger: false });
  token = await signAccessToken({ sub: 'v@billfree.in', name: 'V', role: 'viewer' }, JWT);
});
const auth = { authorization: () => `Bearer ${token}` };

describe('analytics-service', () => {
  it('requires auth (401 + E002)', async () => {
    const res = await app.inject({ method: 'GET', url: '/analytics/status-breakdown' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('[E002]');
  });

  it('returns status breakdown', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/status-breakdown',
      headers: { authorization: auth.authorization() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toEqual({ status: 'Completed', count: 3 });
  });

  it('respects the top-pos limit query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/top-pos?limit=1',
      headers: { authorization: auth.authorization() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('returns the agent leaderboard', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/agent-leaderboard',
      headers: { authorization: auth.authorization() },
    });
    expect(res.json().data[0].completed).toBe(3);
  });
});
