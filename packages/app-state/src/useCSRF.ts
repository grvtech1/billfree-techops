import { useRef, useCallback } from 'react';
import { api, ApiError } from '@billfree/api';
import { useAuthStore } from './authStore';

/**
 * CSRF hook — manages token lifecycle for mutating operations. Cross-cutting
 * (used by ticket mutations AND call-log logging), so it lives in app-state
 * alongside the auth store it depends on — not in any one feature.
 *
 * withCSRF(fn) pattern:
 *  1. Fetch (or reuse cached) CSRF token
 *  2. Execute fn(csrf)
 *  3. On E002 (token expired): clear + refetch + retry once
 */
export function useCSRF() {
  const tokenRef = useRef<string>('');

  const ensureCSRF = useCallback(async (): Promise<string> => {
    if (tokenRef.current) return tokenRef.current;
    const user = useAuthStore.getState().user;
    if (!user) throw new Error('Not authenticated');
    const res = await api.getCSRFToken(user.token);
    tokenRef.current = res.token;
    return tokenRef.current;
  }, []);

  const clearCSRF = useCallback(() => { tokenRef.current = ''; }, []);

  const withCSRF = useCallback(async <T>(
    fn: (csrf: string) => Promise<T>
  ): Promise<T> => {
    try {
      const csrf = await ensureCSRF();
      return await fn(csrf);
    } catch (e) {
      // On CSRF error (E002 / E006): clear token + retry once
      if (e instanceof ApiError && (e.code === 'E002' || e.code === 'E006')) {
        clearCSRF();
        const csrf = await ensureCSRF();
        return await fn(csrf);
      }
      throw e;
    }
  }, [ensureCSRF, clearCSRF]);

  return { ensureCSRF, clearCSRF, withCSRF };
}
