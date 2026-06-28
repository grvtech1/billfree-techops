import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// Mock the data-access layer so the store is tested in isolation (no network).
vi.mock('@billfree/api', () => ({
  fetchIdentity: vi.fn(),
  gatewayLogin: vi.fn(),
  gatewayLogout: vi.fn(),
  gatewayVerifySession: vi.fn(),
  gatewayFetchAgents: vi.fn(),
}));

import { useAuthStore } from '@billfree/app-state';
import { gatewayLogin, gatewayLogout, gatewayVerifySession, gatewayFetchAgents } from '@billfree/api';

const mockLogin = gatewayLogin as unknown as Mock;
const mockLogout = gatewayLogout as unknown as Mock;
const mockVerify = gatewayVerifySession as unknown as Mock;
const mockFetchAgents = gatewayFetchAgents as unknown as Mock;

// JWT lives in the httpOnly cookie — token field is always '' in the gateway path.
const validUser = {
  email: 'agent1@billfree.in',
  name: 'Agent One',
  token: '',
  role: 'agent' as const,
  isAdmin: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchAgents.mockResolvedValue([]);
  mockLogout.mockResolvedValue(undefined);
  // Reset the singleton store to a known baseline before each test.
  useAuthStore.setState({ user: null, agents: [], status: 'loading' });
});

describe('authStore.restoreSession', () => {
  it('authenticates when the server confirms a valid cookie', async () => {
    mockVerify.mockResolvedValue(validUser);
    useAuthStore.getState().restoreSession();
    // restoreSession is fire-and-forget; flush the microtask queue.
    await Promise.resolve();
    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.user?.email).toBe('agent1@billfree.in');
    expect(mockFetchAgents).toHaveBeenCalledOnce();
    expect(mockFetchAgents).toHaveBeenCalledWith(); // no token arg — cookie is sent automatically
  });

  it('is unauthenticated when server returns null (no cookie / expired)', async () => {
    mockVerify.mockResolvedValue(null);
    useAuthStore.getState().restoreSession();
    await Promise.resolve();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(mockFetchAgents).not.toHaveBeenCalled();
  });

  it('is unauthenticated when verify throws (network error)', async () => {
    mockVerify.mockRejectedValue(new Error('network'));
    useAuthStore.getState().restoreSession();
    // Two ticks: one to schedule the rejection handler, one to execute it.
    await Promise.resolve();
    await Promise.resolve();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});

describe('authStore.loginWithGateway', () => {
  it('authenticates and fetches agents (cookie path — no localStorage)', async () => {
    mockLogin.mockResolvedValue({ user: validUser });
    mockFetchAgents.mockResolvedValue([{ name: 'A', email: 'a@b.c', role: 'agent' }]);

    await useAuthStore.getState().loginWithGateway('agent1@billfree.in');

    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.user?.email).toBe('agent1@billfree.in');
    expect(s.user?.token).toBe('');  // JWT is in httpOnly cookie; JS never sees the token
    expect(s.agents).toHaveLength(1);
    expect(mockFetchAgents).toHaveBeenCalledOnce();
    expect(mockFetchAgents).toHaveBeenCalledWith(); // no token arg
  });

  it('surfaces a login failure and stays unauthenticated', async () => {
    mockLogin.mockRejectedValue(new Error('bad creds'));
    await expect(useAuthStore.getState().loginWithGateway('x@y.z')).rejects.toThrow('bad creds');
    const s = useAuthStore.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.user).toBeNull();
  });

  it('still authenticates when the (best-effort) agents fetch fails', async () => {
    mockLogin.mockResolvedValue({ user: validUser });
    mockFetchAgents.mockRejectedValue(new Error('agents down'));
    await useAuthStore.getState().loginWithGateway('agent1@billfree.in');
    expect(useAuthStore.getState().status).toBe('authenticated');
  });
});

describe('authStore.logout', () => {
  it('calls gatewayLogout to clear the server cookie and resets local state', () => {
    useAuthStore.setState({ user: validUser, status: 'authenticated' });
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(useAuthStore.getState().user).toBeNull();
    expect(mockLogout).toHaveBeenCalledOnce();
  });
});
