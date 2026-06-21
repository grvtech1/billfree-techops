# @billfree/shared

The cross-cutting **contract** shared by the web SPA (`apps/web`) and the GAS
backend (`apps/gas`). Anything that must stay identical on both sides lives here:

| Export | Mirrors in GAS backend |
| --- | --- |
| `STATUSES`, `Status`, `isStatus` | `STATUS_ENUM` (Code.gs) |
| `ERROR_CODES`, `ERROR_MESSAGES`, `parseErrorCode` | `ERROR_CODES` (Code.gs) |
| `POST_ACTIONS`, `GET_ACTIONS`, `ApiEnvelope` | `doPost` / `doGet` router (Code.gs) |

## Why

The GAS backend is JavaScript and the web app is TypeScript, so the two can
silently drift — e.g. a renamed status or a new error code. `contract.test.ts`
reads `apps/gas/src/Code.gs` directly and **fails CI** if the shared definitions
no longer match the backend. Change one side, the test forces you to change both.

## Usage (from apps/web)

```ts
import { STATUSES, parseErrorCode, type Status } from '@billfree/shared';
```

The web app resolves `@billfree/shared` via the path alias in
`apps/web/tsconfig.json` and `apps/web/vite.config.ts`.
