import { useEffect, useCallback } from 'react';

const CHANNEL_NAME = 'billfree_sync_v2';

interface Message {
  type:    'VERSION_UPDATE';
  version: number;
}

/**
 * Cross-tab BroadcastChannel sync hook.
 * - Guards against environments where BroadcastChannel is unavailable.
 * - Uses a new channel instance per broadcast (open → post → close) to
 *   avoid the channel staying alive and leaking across component remounts.
 */
export function useBroadcastSync(
  currentVersion: number,
  onNewVersion:   () => void
): { broadcast: (version: number) => void } {
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;

    const ch = new BroadcastChannel(CHANNEL_NAME);

    ch.addEventListener('message', (e: MessageEvent<Message>) => {
      if (e.data?.type === 'VERSION_UPDATE' && e.data.version > currentVersion) {
        onNewVersion();
      }
    });

    return () => ch.close();
  }, [currentVersion, onNewVersion]);

  const broadcast = useCallback((version: number) => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(CHANNEL_NAME);
    ch.postMessage({ type: 'VERSION_UPDATE', version } satisfies Message);
    ch.close();
  }, []);

  return { broadcast };
}
