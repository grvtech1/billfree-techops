// @billfree/api — data-access adapter layer (ports & adapters).
//
// `BackendApi` is the port; `gasApi` (legacy Google Apps Script) and
// `gatewayApi` (microservices gateway) are the adapters, selected once at
// build time by VITE_BACKEND. The rest of the app imports `api` / `fetchVersion`
// and stays unaware of which backend is live.
//
//   import { api, fetchVersion, ApiError, type BackendApi } from '@billfree/api';

export * from './apiClient';   // ApiError, BACKEND, emptyAuditLogResponse, BackendApi
export * from './gateway';     // gatewayApi, gatewayLogin, mappers, gatewayFetchVersion
export * from './api';         // api, fetchVersion, fetchIdentity, reportClientError
