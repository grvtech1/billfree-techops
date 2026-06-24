# 🧩 Frontend Modularization — `apps/web` → feature packages

> **Goal:** Ek single React SPA ko **feature-sliced modular packages** mein todna —
> clean boundaries, enforced dependency direction, single deploy. Production-sound
> **aur** portfolio-grade. (Micro-frontend / Module Federation **deliberately NOT** —
> single team ke liye over-engineering; yeh decision section 6 mein justified hai.)

---

## 1. Aaj kya hai (assessment)

`apps/web` **already well-structured** hai — monolith mess nahi:

```
src/
├── views/        7 feature screens (lazy-loaded — code-split already)
├── components/   common · layout · filters · tickets
├── hooks/        useTickets, useCSRF, useBroadcastSync, useVersionPoll
├── lib/          api, apiClient, auth, gateway, utils, constants
├── store/        Zustand: ticketStore, uiStore
└── types/        shared interfaces
```

**Problem yeh NAHI hai ki code ganda hai.** Problem yeh hai:
- Boundaries **convention** se hain, **enforced** nahi — koi bhi file kisi bhi file ko import kar sakti (e.g. ek `common` component galti se `ticketStore` import kar le → tight coupling).
- Reuse mushkil — `KpiCard`/`Modal` ko doosre app mein le jaana = copy-paste.
- "Feature" ki ownership clear nahi — Analytics ka code 4 folders mein bikhra (views + components + hooks + lib).

**Modular packages** in teeno ko fix karte: boundary = package boundary (compiler enforce karta), reuse = `npm`-style import, feature = ek package.

---

## 2. Target architecture (layered packages)

```
┌─────────────────────────────────────────────────────┐
│  apps/web  (SHELL / host)                            │
│  App · AppShell · Sidebar · TopBar · main.tsx        │
│  — sirf compose karta, business logic nahi           │
└───────────────┬─────────────────────────────────────┘
                │ depends on
        ┌───────▼────────────────────────────────┐
        │  @billfree/feature-*                     │  ← feature slices
        │  feature-tickets · feature-analytics ·   │
        │  feature-calllog · feature-reports       │
        └───────┬──────────────────────┬───────────┘
                │ depends on            │
        ┌───────▼─────────┐   ┌─────────▼──────────┐
        │ @billfree/ui     │   │ @billfree/web-core │  ← shared layers
        │ design system:   │   │ infra: types,      │
        │ KpiCard, Modal,  │   │ utils, constants,  │
        │ Badges, Toast…   │   │ api, auth, gateway │
        └───────┬──────────┘   └─────────┬──────────┘
                │                         │
                └──────────┬──────────────┘
                           │ depends on
                  ┌────────▼─────────┐
                  │ @billfree/shared │  ← already exists (contract)
                  └──────────────────┘
```

### 🔑 Dependency rule (THE most important thing)
**Arrows sirf NEECHE jaate hain. Kabhi upar nahi, kabhi sideways nahi.**

| Layer | Import kar sakta | Import NAHI kar sakta |
|-------|------------------|----------------------|
| `web-core` | `shared` | ui, features, shell |
| `ui` | `web-core`, `shared` | features, shell |
| `feature-*` | `ui`, `web-core`, `shared` | **doosri feature**, shell |
| `apps/web` (shell) | features, ui, web-core | — (top hai) |

> 🎓 **Analogy:** Building floors. Ground floor (web-core) sabko sahaara deta, par
> upar wale floors ko nahi jaanta. Top floor (shell) sabke upar khada — sabko use
> karta. Ek floor doosre **same-level** floor pe load nahi daalta (feature → feature ❌).
>
> 🏭 **Real-world:** Yahi rule "feature-A team" aur "feature-B team" ko independently
> kaam karne deta. B ka refactor A ko nahi todta, kyunki A kabhi B ko import hi nahi karta.
> Shared cheez neeche (`ui`/`core`) mein jaati — ek jagah, dono use karte.

---

## 3. Package boundaries — kya kahan jaata

| Package | Contents (aaj `apps/web` se) |
|---------|------------------------------|
| **`@billfree/web-core`** | `types/`, `lib/utils`, `lib/constants` — **pure** domain logic, no React, **no build-tool coupling** |
| **`@billfree/api`** | `lib/apiClient` (BackendApi port), `lib/api` (GAS adapter), `lib/gateway` (microservices adapter) — data-access layer, Vite-env coupled |
| **`@billfree/ui`** | **Presentational** `components/common/*` (10): KpiCard, AgentCard, Modal, Skeleton, Pagination, EmptyState, StatusBadge, AgeBadge, ChannelBadge, SupportTypeChip — props-driven, no app state. (ErrorBoundary/LoginScreen/Toast are **container** components → stay in shell.) |
| **`@billfree/app-state`** | `store/uiStore` (toasts/modal/activeView/dark-mode) + `lib/auth` → `authStore` (session + Cloudflare bridge). Cross-cutting singletons every feature consumes. zustand+react = peer deps. |
| **`@billfree/feature-tickets`** | Domain **building blocks**: `store/ticketStore` (central dataset + KPI/agent-stat selectors), `hooks/{useTickets,useCSRF}`, `components/tickets/*` (TicketTable, TicketRow, StatusDropdown, PosCell, 3 modals), `components/filters/*` (DatePills, MasterSearch). **Views stay in shell** this phase — see note ▼. |
| **`@billfree/feature-analytics`** | `views/AnalyticsView` + analytics-specific charts |
| **`@billfree/feature-calllog`** | `views/CallLogView` |
| **`@billfree/feature-reports`** | `views/{MonthlyReport,TeamReport}View` |
| **`apps/web` (shell)** | `App`, `AppShell`, `Sidebar`, `TopBar`, **container components** `ErrorBoundary` (→api), `LoginScreen` (→app-state), `Toast` (→app-state), `main.tsx`, `index.css`. (uiStore + authStore now live in `@billfree/app-state`.) |

---

## 4. Migration strategy — Strangler shims (zero-downtime refactor)

**45 import statements** in ~30 files leaf modules ko point karte. In sabko ek saath
badalna = bada-bang risk. Iske bajaye **strangler-fig** (jo yeh repo already use karta):

```
Step 1: Code ko package mein MOVE karo (canonical source)
Step 2: Purani file ko SHIM bana do:
          // apps/web/src/types/index.ts
          export * from '@billfree/web-core';   ← re-export
Step 3: Ab SAB purane imports (../types, @/types) bina chhede chalte rehte ✅
Step 4: Importers ko incrementally @billfree/web-core pe migrate karo
Step 5: Jab koi shim ko use na kare → shim delete
```

> 🔑 **Har step pe app GREEN rehti** — build + 156 tests pass. Koi "big rewrite weekend" nahi.

### Phases (neeche se upar — leaf first)
| Phase | Package | Risk | Status |
|-------|---------|------|--------|
| **1** | `@billfree/web-core` (types/utils/constants) | Low (pure leaf) | ✅ done (typecheck + 27 tests + build green) |
| **2** | `@billfree/api` (apiClient/api/gateway) — see note ▼ | Low | ✅ done (typecheck + 27 tests + build green) |
| **3** | `@billfree/ui` (10 presentational components) — first React pkg (peer dep + JSX) | Medium | ✅ done (typecheck + 27 tests + build green) |
| **4** | `@billfree/app-state` (uiStore + authStore) — see note ▼ | Medium | ✅ done (typecheck + 27 tests + build green) |
| **5** | `@billfree/feature-tickets` (domain building blocks — see note ▼) | Medium-High | ✅ done (typecheck + 27 tests + build green) |
| 6 | `@billfree/feature-{analytics,calllog,reports}` + move views | Medium | pending |
| **7** | Shell cleanup + remove shims + ESLint boundary rule | Low | ✅ done (typecheck + lint + 27 tests + build green) |

> **✅ MODULARIZATION COMPLETE.** 7 packages — `web-core`, `api`, `ui`, `app-state`,
> `feature-tickets`, `feature-calllog`, `feature-reports`. All 37 strangler shims
> removed; the shell (`apps/web/src`) is now **16 files**: `App`, `AppShell`, `Sidebar`,
> `TopBar`, 3 container components (ErrorBoundary/LoginScreen/Toast), 2 shell hooks,
> 3 tests, and infra (main/css/setup/vite-env). Boundaries enforced by ESLint
> (`no-restricted-imports` bans deep `@billfree/*/src` imports) + the layered package
> graph. Lazy-loading preserved: 3 feature chunks (tickets / calllog / reports) load
> on demand; recharts stays its own shared chunk.

> **📌 Phase 2 design note (plan revised — code revealed a better boundary):**
> Original plan folded `api/auth/gateway` into `web-core`. While extracting, two
> things became clear:
> 1. **`api/apiClient/gateway` are a data-access *adapter* layer**, coupled to Vite
>    env (`import.meta.env.VITE_*`). Putting them in `web-core` would make the "pure
>    domain core" depend on a build tool. → Split into a dedicated **`@billfree/api`**
>    package (the `BackendApi` *port* + GAS/gateway *adapters* — textbook ports-&-adapters).
> 2. **`auth.ts` is a Zustand store + Cloudflare iframe bridge** — stateful and
>    browser-coupled, *not* pure core. It stays in the **shell** (`apps/web`); it
>    imports *down* into `@billfree/api` (correct direction).
>
> Lesson: module boundaries are discovered by looking at *coupling*, not guessed up
> front. `web-core` stays pure; env-coupled I/O lives in `api`; stateful UI glue stays
> in the shell.

> **📌 Phase 4 design note (coupling forced a new layer):**
> Mapping the ticket feature's imports showed nearly every component depends on
> **`useUiStore`** (toasts/modal) and **`useAuthStore`** (current user) — both then
> living in the shell. A feature package importing shell state = **feature → shell**,
> the wrong direction. So before any feature could move, the cross-cutting stores had
> to be promoted into a shared layer **below** features: **`@billfree/app-state`**
> (`uiStore` + `authStore`). zustand + react are **peer deps** here — these stores are
> app-wide singletons; bundling a 2nd copy would fork the state.
>
> Lesson: you can't extract a feature until its shared dependencies sit *beneath* it.
> The coupling map dictated the layer; it wasn't planned up front.

> **📌 Phase 5 scope note (building blocks now, views later):**
> `AnalyticsView` and `TeamReportView` also import `useTicketStore` + `DatePills` +
> `TicketTable`. Had the 3 ticket *views* moved into `feature-tickets`, the analytics/
> reports views (their own features) would import `feature-tickets` — a sibling
> feature→feature edge. So Phase 5 extracted only the **reusable domain building
> blocks** (store, hooks, ticket components, filters); **all views stay in the shell**
> as the composition layer. This keeps every view uniform (shell composes building
> blocks) and avoids the cross-feature tangle. Phase 6 decides whether views become
> per-feature packages (with `tickets` as a shared domain dep) or stay as shell pages.
> 12 files moved, 12 strangler shims, app green at every step.

---

## 5. Boundary enforcement (rule ko compiler/lint se pakka karo)

Modular tabhi "modular" hai jab boundary **toot nahi sakti**. 2 layers:

1. **TypeScript project references** — har package apna `tsconfig`, shell unhe reference karta. Galat-direction import → type error.
2. **ESLint `no-restricted-imports`** (Phase 6) — e.g. `feature-analytics` mein `feature-tickets` import → lint error:
   ```jsonc
   "no-restricted-imports": ["error", {
     "patterns": ["@billfree/feature-*"]   // features mein, doosri feature ban
   }]
   ```

> Bina enforcement ke, 3 mahine baad koi shortcut maar dega aur "modular" wapas
> spaghetti ban jaayega. Rule = guardrail.

---

## 6. Kyun Module Federation NAHI (honest tradeoff)

| | Modular packages (yeh) | Module Federation (micro-FE) |
|---|---|---|
| Deploy | 1 artifact | N independent deploys |
| Runtime | 1 React, 1 bundle (code-split) | N React runtimes (skew risk) |
| Best for | 1 team, shared release | **alag teams**, independent release cadence |
| Complexity | Low (npm workspaces) | High (federation, version mgmt) |
| Yeh project | ✅ fit | ❌ over-engineering |

**Interview line:** *"Maine modular feature-packages chune, Module Federation nahi —
kyunki micro-frontends ek **organizational** scaling tool hai (multiple independent
teams), na ki single-team codebase ke liye. Galat jagah federation = duplicate
runtime + version skew, bina kisi fayde ke. Boundaries maine package + lint rules
se enforce kiye, jo 90% benefit deta bina deploy complexity ke."*

---

## 7. Verification gate (har phase ke baad)

```bash
npm run typecheck --workspace apps/web   # boundary violations = type errors
npm test --workspace apps/web            # 156 tests still green
npm run build --workspace apps/web       # bundle still builds + code-splits
```

---

> **Tldr:** `apps/web` ko **layered feature-packages** mein todo (web-core → ui →
> features → shell), **strangler shims** se zero-downtime, **dependency rule** ko
> lint/TS se enforce karo. Production-sound, portfolio-strong, over-engineering nahi.
