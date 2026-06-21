# WhatsApp Chatbot — Ticket Intake API

Public, machine-to-machine API the WhatsApp AI chatbot calls so customers and
cross-functional teammates can **create a support ticket** and **check its status**
straight from a WhatsApp chat — without a dashboard login.

## How it fits the architecture

```
WhatsApp bot ──x-api-key──▶ api-gateway  /api/intake/*  ──▶ ticket-service /intake/*
                                                              │ auto-assign (least-loaded agent)
                                                              ▼
                                                          Postgres (tickets, agents)
                                                              ▲
   Dashboard agents (JWT) ◀── ticket appears in the normal ticket list (source = "whatsapp")
```

- **Auth = API key, not JWT.** The bot is a trusted integration, not a user. It
  sends a shared secret in the `x-api-key` header. The key is verified at the
  gateway **and** re-verified in ticket-service (defense in depth), compared in
  constant time.
- Created tickets are **`Not Completed`** by default, **`source = "whatsapp"`**, and
  **auto-assigned** to the active agent with the fewest open tickets (least-loaded).
- They show up in the dashboard immediately (same `tickets` table); `requestedBy`
  records who raised it. The dashboard renders a **📱 WhatsApp channel badge** on
  the ticket row (and a "Created via" line in the detail modal) so agents can see
  at a glance that a ticket came from the bot rather than the in-app form.

## Base URL

```
https://<gateway-host>/api/intake
```

All requests must include:

```
x-api-key: <INTAKE_API_KEY>
Content-Type: application/json
```

---

## 1) Create a ticket

```
POST /api/intake/tickets
```

| Field | Required | Notes |
| --- | --- | --- |
| `phone` | ✅ | Customer phone (any format; digits are what matter) |
| `concern` | ✅ | The issue / concern text |
| `mid` | ⚠️ | Merchant ID — **MID _or_ `business` is required** |
| `business` | ⚠️ | Business name — **MID _or_ `business` is required** |
| `pos` | optional | POS product (Tally, GoFrugal, …) |
| `requestedBy` | optional | Name of the customer/teammate (defaults to `WhatsApp Customer`) |

**Request**

```json
{ "phone": "+91 99900 01111", "concern": "POS not printing receipts", "mid": "100200", "pos": "Tally" }
```

**Response `201`**

```json
{
  "success": true,
  "ticketId": "BF-202606-7Q3K",
  "status": "Not Completed",
  "assignedAgent": "Agent One",
  "channel": "whatsapp",
  "message": "Ticket BF-202606-7Q3K created. Reply with this reference to check its status."
}
```

**Errors** — canonical `[E0NN]` envelope:

| Status | Body | When |
| --- | --- | --- |
| `400` | `{ "success": false, "error": "[E004] …" }` | Missing phone/concern, or **both** MID and business absent |
| `401` | `{ "success": false, "error": "[E002] Invalid API key" }` | Missing/wrong `x-api-key` |

> The bot should echo `ticketId` back to the user and tell them to keep it for
> status checks.

---

## 2) Check ticket status

```
GET /api/intake/tickets/{ticketId}/status?phone=<customer phone>
```

The **phone must match** the one on the ticket — this authorizes the lookup so a
customer can't read someone else's ticket by guessing references. Phone matching
ignores formatting (compares the trailing 10 digits).

**Response `200`**

```json
{
  "success": true,
  "data": {
    "ticketId": "BF-202606-7Q3K",
    "status": "Not Completed",
    "createdAt": "2026-06-21T08:14:00.000Z",
    "business": "",
    "mid": "100200",
    "concern": "POS not printing receipts",
    "assignedAgent": "Agent One",
    "source": "whatsapp"
  }
}
```

The agent **email is never returned** — only a display name.

**Errors**

| Status | When |
| --- | --- |
| `404` `[E003]` | No ticket matches that reference **and** phone (same response whether the id is wrong or the phone doesn't match — no existence leak) |
| `401` `[E002]` | Missing/wrong `x-api-key` |

---

## Configuration

`INTAKE_API_KEY` (≥16 chars) must be set on **both** `api-gateway` and
`ticket-service`. Locally it's in `docker-compose.yml`; in the cluster it lives in
the `billfree-app-secrets` bootstrap secret. If it's unset, the intake routes are
**disabled** (the bot integration is simply off) — the JWT dashboard API is
unaffected.

Rotate the key by updating the secret and restarting both deployments; coordinate
with the chatbot owner so the new key is deployed in lock-step.
