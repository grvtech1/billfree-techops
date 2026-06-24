// @billfree/app-state — cross-cutting global stores consumed by every feature.
//
// `useUiStore`  — ephemeral UI state: toasts, modal, active view, dark mode.
// `useAuthStore`— session/identity + the Cloudflare OAuth bridge.
//
// These are app-wide singletons (zustand). zustand + react are PEER deps so a
// single instance is shared — never bundle a second copy (would fork the state).
//
//   import { useUiStore, useAuthStore } from '@billfree/app-state';

export * from './uiStore';      // useUiStore
export * from './authStore';    // useAuthStore, initCloudflareAuthBridge
export * from './useCSRF';      // useCSRF (cross-cutting auth/csrf hook)
