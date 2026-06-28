import { useCallback } from 'react';
import { api } from '@billfree/api';
import { useAuthStore } from '@billfree/app-state';
import { useUiStore } from '@billfree/app-state';
import { useTicketStore } from '../ticketStore';

export function useTickets() {
  const { user } = useAuthStore();
  const { setRawData, version } = useTicketStore();
  const showToast = useUiStore(s => s.showToast);

  const fetchData = useCallback(async () => {
    if (!user) return;
    // Read isLoading from the store at call time, not from a closed-over render
    // snapshot. Keying the guard on the live value prevents concurrent fetches
    // (e.g. version-poll + tab-focus firing together) and stops `fetchData`'s
    // identity from churning every time isLoading flips.
    if (useTicketStore.getState().isLoading) return;
    useTicketStore.setState({ isLoading: true });
    try {
      const res = await api.getTicketData(user.token);
      if (res.success) {
        setRawData(res.tickets ?? [], res.version ?? 0);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load tickets';
      showToast(msg, 'error');
    } finally {
      useTicketStore.setState({ isLoading: false });
    }
  }, [user, setRawData, showToast]);

  return { fetchData, version };
}
