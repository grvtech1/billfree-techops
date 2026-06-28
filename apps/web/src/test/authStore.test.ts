import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

// Mock the data-access layer so the store is tested in isolation (no network).
vi.mock('@billfree/api', () => ({
  fetchIdentity: vi.fn(),
  gatewayLogin: vi.fn(),
  gatewayFetchAgents: vi.fn(),
}));

import { useAuthStore } from '@billfree/app-state';
import { gatewayLogin, gatewayFetchAgents } from '@billfree/api';

const SESSION_KEY = 'bt_session';
const mockLogin = gatewayLogin as unknown as Mock;
const mockFetchAgents = gatewayFetchAgents as unknown as Mock;

const validUser = {
  email: 'agent1@billfree.in',
  name: 'Agent One',
  token: 'jwt-token-abc',
  role: 'agent' as const,
  isAdmin: false,
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockFetchAgents.mockResolvedValue([]);
  // Reset the singleton store to a known baseline before each test.
  useAuthStore.setState({ user: null, agents: [], status: 'loading' });
});

afterEach(() => localStorage.clear());

describe('authStore.restoreSession', () => {
  it('restores a structurally-valid persisted session', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(validUser));
    useAuthStore.getState().restoreSession();
    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.user?.email).toBe('agent1@billfree.in');
    // [SECURITY FIX] agents are re-fetched with the restored token.
    expect(mockFetchAgents).toHaveBeenCalledWith('jwt-token-abc');
  });

  it('rejects a session missing the token (tampered/partial) and clears it', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email: 'x@y.z' }));
    useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(mockFetchAgents).not.toHaveBeenCalled();
  });

  it('rejects a session missing the email', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'abc' }));
    useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('handles corrupt (non-JSON) session data without throwing', () => {
    localStorage.setItem(SESSION_KEY, '{not valid json');
    expect(() => useAuthStore.getState().restoreSession()).not.toThrow();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('is unauthenticated when no session exists', () => {
    useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});

describe('authStore.loginWithGateway', () => {
  it('persists the session and fetches agents with the new token', async () => {
    mockLogin.mockResolvedValue({ user: validUser });
    mockFetchAgents.mockResolvedValue([{ name: 'A', email: 'a@b.c', role: 'agent' }]);

    await useAuthStore.getState().loginWithGateway('agent1@billfree.in');

    const s = useAuthStore.getState();
    expect(s.status).toBe('authenticated');
    expect(s.user?.token).toBe('jwt-token-abc');
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}').email).toBe('agent1@billfree.in');
    expect(mockFetchAgents).toHaveBeenCalledWith('jwt-token-abc');
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
  it('clears the persisted session and resets state', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(validUser));
    useAuthStore.setState({ user: validUser, status: 'authenticated' });
    useAuthStore.getState().logout();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(useAuthStore.getState().user).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
