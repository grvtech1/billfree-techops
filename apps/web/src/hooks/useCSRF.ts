import { useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuthStore } from '../lib/auth';
import { ApiError } from '../lib/api';

/**
 * CSRF hook — manages token lifecycle for mutating operations.
 *
 * withCSRF(fn) pattern:
 *  1. Fetch (or reuse cached) CSRF token
 *  2. Execute fn(csrf)
 *  3. On E002 (token expired): clear + refetch + retry once
 *
 * Usage:
 *   const { withCSRF } = useCSRF();
 *   const ok = await withCSRF(csrf =>
 *     api.updateFull({ ticketId, newStatus, newReason, csrfToken: csrf, token: user.token })
 *   );
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
