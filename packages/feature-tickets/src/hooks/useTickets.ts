import { useCallback } from 'react';
import { api } from '@billfree/api';
import { useAuthStore } from '@billfree/app-state';
import { useUiStore } from '@billfree/app-state';
import { useTicketStore } from '../ticketStore';

export function useTickets() {
  const { user } = useAuthStore();
  const { setRawData, version, isLoading } = useTicketStore();
  const showToast = useUiStore(s => s.showToast);

  const fetchData = useCallback(async () => {
    if (!user || isLoading) return;
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
  }, [user, isLoading, setRawData, showToast]);

  return { fetchData, version };
}
