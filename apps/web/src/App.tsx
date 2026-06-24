import { useEffect } from 'react';
import { useAuthStore, initCloudflareAuthBridge, useUiStore } from '@billfree/app-state';
import { useTickets } from '@billfree/feature-tickets';
import { BACKEND } from '@billfree/api';
import type { AppUser } from '@billfree/web-core';
import { useVersionPoll } from './hooks/useVersionPoll';
import { useBroadcastSync } from './hooks/useBroadcastSync';
import AppShell from './components/layout/AppShell';
import ErrorBoundary from './components/common/ErrorBoundary';
import LoginScreen from './components/common/LoginScreen';

export default function App() {
  const { status, bootstrapFromCloudflare } = useAuthStore();
  const { fetchData, version } = useTickets();
  const { broadcast } = useBroadcastSync(version, fetchData);
  const applyDarkMode = useUiStore(s => s.applyDarkMode);

  // ── 1. Dark mode (restores from localStorage) ────────────
  useEffect(() => {
    const saved = localStorage.getItem('billfree_darkMode');
    const dark  = saved !== null ? saved === 'true' : window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    applyDarkMode(dark);
  }, [applyDarkMode]);

  // ── 2. Auth bootstrap ────────────────────────────────────
  // Gateway (microservices) mode: restore a persisted JWT session, else show
  // the login screen. GAS mode: the Cloudflare postMessage identity bridge.
  useEffect(() => {
    if (BACKEND === 'gateway') {
      useAuthStore.getState().restoreSession();
      return;
    }
    const cleanup = initCloudflareAuthBridge(
      (idToken: string, userInfo: Partial<AppUser>) => {
        bootstrapFromCloudflare(idToken, userInfo);
      }
    );
    return cleanup;
  }, [bootstrapFromCloudflare]);

  // ── 3. Data fetch after auth ─────────────────────────────
  useEffect(() => {
    if (status === 'authenticated') fetchData();
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 4. Broadcast new version to other tabs ───────────────
  useEffect(() => {
    if (version > 0) broadcast(version);
  }, [version, broadcast]);

  // ── 5. Version polling ───────────────────────────────────
  useVersionPoll({ currentVersion: version, onNewVersion: fetchData });

  // ── 6. Loading / error screens ───────────────────────────
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'unauthenticated') {
    return BACKEND === 'gateway' ? <LoginScreen /> : <AuthErrorScreen />;
  }

  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true" />
      <p className="loading-text">Initialising BillFree TechOps…</p>
    </div>
  );
}

function AuthErrorScreen() {
  return (
    <div className="error-screen" role="alert">
      <div className="error-icon">🔒</div>
      <h1>Access Denied</h1>
      <p>Please sign in with your BillFree Google account to continue.</p>
      <button
        className="btn btn-primary"
        onClick={() => window.location.reload()}
      >
        Retry
      </button>
    </div>
  );
}
