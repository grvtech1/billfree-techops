import { create } from 'zustand';
import type { AppUser, Agent } from '@billfree/web-core';
import { fetchIdentity, gatewayLogin, gatewayFetchAgents } from '@billfree/api';

const SESSION_KEY = 'bt_session';

// Build-time GAS URL — defined in vite.config.ts. Empty in dev / standalone.
declare const __GAS_URL__: string;
const HAS_GAS_BACKEND: boolean =
  (typeof __GAS_URL__ !== 'undefined' && !!__GAS_URL__) ||
  !!(import.meta.env.VITE_GAS_URL as string | undefined);

interface AuthState {
  user:           AppUser | null;
  agents:         Agent[];
  trustedOrigins: string[];
  status:         'loading' | 'authenticated' | 'unauthenticated';
  setUser:        (u: AppUser) => void;
  setAgents:      (a: Agent[]) => void;
  bootstrapFromCloudflare: (idToken: string, userInfo: Partial<AppUser>) => Promise<void>;
  // Microservices-backend auth (VITE_BACKEND=gateway).
  loginWithGateway: (email: string, name?: string) => Promise<void>;
  restoreSession: () => void;
  logout:         () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user:           null,
  agents:         [],
  trustedOrigins: ['https://billfreetech.pages.dev', 'http://localhost:5173'],
  status:         'loading',

  setUser:   (user)   => set({ user, status: 'authenticated' }),
  setAgents: (agents) => set({ agents }),

  bootstrapFromCloudflare: async (idToken, userInfo) => {
    try {
      const res = await fetchIdentity(idToken);
      if (res.success && res.email) {
        set({
          user: {
            email:   res.email,
            name:    res.name   || userInfo.name   || res.email,
            token:   res.token  || '',
            role:    (res.role  || 'viewer') as AppUser['role'],
            isAdmin: res.isAdmin ?? false,
            picture: userInfo.picture,
          },
          agents:         (res.agents || []) as Agent[],
          trustedOrigins: res.trustedOrigins?.length
            ? res.trustedOrigins
            : get().trustedOrigins,
          status: 'authenticated',
        });
        return;
      }
      // [SECURITY] Identity endpoint reachable but no email returned.
      handleAuthFailure(set, 'identity returned no email');
    } catch (e) {
      // [SECURITY] Identity fetch failed (CORS, network, 401, etc.).
      handleAuthFailure(set, e);
    }
  },

  // ── Microservices backend: exchange an email for a JWT via auth-service ──
  loginWithGateway: async (email, name) => {
    try {
      const { user } = await gatewayLogin(email, name);
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      set({ user, status: 'authenticated' });
      // [GAP-04] Fetch agent directory for the Create Ticket dropdown (best-effort).
      // The endpoint is authenticated, so pass the freshly-minted token.
      try {
        const agents = (await gatewayFetchAgents(user.token)) as Agent[];
        set({ agents });
      } catch (e) {
        console.warn('[Auth] agent directory fetch failed (non-fatal):', e);
      }
    } catch (e) {
      console.error('[Auth] gateway login failed:', e);
      set({ user: null, status: 'unauthenticated' });
      throw e;
    }
  },

  // Restore a persisted JWT session on load (gateway mode).
  restoreSession: () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        // [SECURITY] Validate the shape before trusting it — JSON.parse only
        // catches syntax errors, not a structurally-invalid (or tampered)
        // object. A session without a string email+token is not a session.
        if (!isValidSession(parsed)) {
          localStorage.removeItem(SESSION_KEY);
          set({ status: 'unauthenticated' });
          return;
        }
        const user = parsed;
        set({ user, status: 'authenticated' });
        // [GAP-04] Re-populate agents after session restore (best-effort, background).
        gatewayFetchAgents(user.token)
          .then((agents) => set({ agents: agents as Agent[] }))
          .catch(() => { /* non-fatal */ });
        return;
      }
    } catch {
      /* corrupt session — fall through to unauthenticated */
    }
    set({ status: 'unauthenticated' });
  },

  logout: () => {
    localStorage.removeItem(SESSION_KEY);
    set({ user: null, status: 'unauthenticated' });
  },
}));

/** Narrow an untrusted parsed value to a usable AppUser session. */
function isValidSession(v: unknown): v is AppUser {
  if (typeof v !== 'object' || v === null) return false;
  const u = v as Record<string, unknown>;
  return typeof u.email === 'string' && u.email.length > 0 && typeof u.token === 'string';
}

/**
 * [SECURITY] Centralised auth-failure handler.
 *
 * Previous behaviour granted `isAdmin: true` demo access on ANY identity
 * failure — including in production (a real CORS error would silently log
 * the user in as admin). This is the closed-loop fix:
 *
 * - Dev / standalone (no GAS_URL configured): keep the demo session so the
 *   developer can iterate against mock data.
 * - Production (GAS_URL configured): set status to 'unauthenticated' and
 *   surface the real error. The user sees the AuthErrorScreen.
 */
function handleAuthFailure(
  set: (s: Partial<AuthState>) => void,
  reason: unknown
) {
  if (HAS_GAS_BACKEND) {
    console.error('[Auth] Identity verification failed in production:', reason);
    set({ user: null, status: 'unauthenticated' });
    return;
  }
  console.warn('[Auth] Dev mode — using demo session. Reason:', reason);
  set({
    user: {
      email:   'demo@billfree.in',
      name:    'Demo User',
      token:   '',
      role:    'admin',
      isAdmin: true,
    },
    status: 'authenticated',
  });
}

/**
 * How long to wait for the Cloudflare parent's BT_AUTH_SYNC before giving up.
 * Without this bound, a parent that never posts (CSP block, wrong origin, script
 * error) would leave the app stuck on the loading screen forever.
 */
const AUTH_BRIDGE_TIMEOUT_MS = 10_000;

/**
 * Cloudflare postMessage bridge.
 * In production the app runs inside a Cloudflare Pages iframe wrapper that
 * sends BT_AUTH_SYNC after Google OAuth completes.
 * In dev (no parent) we fall back to fetchIdentity('') which uses mock data.
 *
 * Call once in App.tsx on mount. Returns cleanup function.
 */
export function initCloudflareAuthBridge(
  onAuth: (idToken: string, userInfo: Partial<AppUser>) => void
): () => void {
  const inIframe = window !== window.top;
  let resolved = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  // Run onAuth at most once, and stop the timeout once we have an answer.
  const resolveOnce = (token: string, info: Partial<AppUser>) => {
    if (resolved) return;
    resolved = true;
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    onAuth(token, info);
  };

  const handleMessage = (e: MessageEvent) => {
    const trustedOrigins = useAuthStore.getState().trustedOrigins;
    // [SECURITY] Strict equality (not startsWith) — prevents a malicious
    // 'https://billfree.evil.com' from passing a 'https://billfree' prefix.
    if (!trustedOrigins.includes(e.origin)) return;
    if (e.source !== window.parent) return;
    if (e.data?.type !== 'BT_AUTH_SYNC') return;

    const { email, name, picture, token } = e.data as {
      type: string; email?: string; name?: string; picture?: string; token?: string;
    };
    resolveOnce(token || '', { email, name, picture });
  };

  window.addEventListener('message', handleMessage);

  if (inIframe) {
    try {
      const origins = useAuthStore.getState().trustedOrigins;
      window.parent.postMessage({ type: 'BT_APP_READY' }, origins[0] || '*');
    } catch {
      /* cross-origin security: ignore */
    }
    // [FIX] Bound the wait. If no BT_AUTH_SYNC arrives in time, fail closed via
    // an empty-token bootstrap → handleAuthFailure shows the AuthErrorScreen in
    // production (or the demo session in dev), instead of an infinite spinner.
    timeoutId = setTimeout(() => {
      console.warn('[Auth] Cloudflare parent did not respond within timeout — failing closed.');
      resolveOnce('', {});
    }, AUTH_BRIDGE_TIMEOUT_MS);
  } else {
    // Standalone / dev: bootstrap immediately without a token
    resolveOnce('', {});
  }

  return () => {
    window.removeEventListener('message', handleMessage);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  };
}
