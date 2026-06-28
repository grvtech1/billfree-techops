import { useEffect, useRef } from 'react';
import { fetchVersion } from '@billfree/api';
import { VERSION_POLL_MIN_MS, VERSION_POLL_MAX_MS } from '@billfree/web-core';

interface Options {
  currentVersion: number;
  onNewVersion: () => void;
}

/**
 * Exponential backoff version polling hook.
 * - Starts at 30s, backs off to 120s on failure, resets on success.
 * - Pauses when tab is hidden (Page Visibility API).
 * - Resets backoff on tab re-focus or user click/keydown.
 */
export function useVersionPoll({ currentVersion, onNewVersion }: Options) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const backoffRef = useRef(VERSION_POLL_MIN_MS);
  const versionRef = useRef(currentVersion);
  const cbRef = useRef(onNewVersion);

  // Keep refs up to date without re-running the effect
  useEffect(() => {
    versionRef.current = currentVersion;
  }, [currentVersion]);
  useEffect(() => {
    cbRef.current = onNewVersion;
  }, [onNewVersion]);

  useEffect(() => {
    const schedule = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        if (document.hidden) {
          schedule();
          return;
        }
        try {
          const v = await fetchVersion();
          if (v > versionRef.current) cbRef.current();
          backoffRef.current = VERSION_POLL_MIN_MS;
        } catch {
          backoffRef.current = Math.min(backoffRef.current * 1.5, VERSION_POLL_MAX_MS);
        }
        schedule();
      }, backoffRef.current);
    };

    schedule();

    const resetBackoff = () => {
      backoffRef.current = VERSION_POLL_MIN_MS;
      // Fast path: reschedule immediately at min interval
      schedule();
    };

    document.addEventListener('visibilitychange', resetBackoff);
    document.addEventListener('click', resetBackoff, { passive: true });
    document.addEventListener('keydown', resetBackoff, { passive: true });

    return () => {
      clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', resetBackoff);
      document.removeEventListener('click', resetBackoff);
      document.removeEventListener('keydown', resetBackoff);
    };
  }, []);
}
