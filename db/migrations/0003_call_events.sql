-- Call events — telephony/CDR log (replaces the legacy Google Sheet "Call Log").
-- Owned by calllog-service; read by the dashboard's CallLogView.
CREATE TABLE IF NOT EXISTS call_events (
  event_id         text PRIMARY KEY,
  created_at       timestamptz NOT NULL DEFAULT now(),
  ticket_id        text,
  mid              text,
  business         text,
  customer_phone   text,
  agent_email      text        NOT NULL,
  agent_name       text,
  role             text,
  event_type       text        NOT NULL,
  outcome          text        NOT NULL,
  duration_sec     integer     NOT NULL DEFAULT 0,
  channel          text,
  provider         text,
  provider_call_id text,
  source           text,
  notes            text,
  verified         boolean     NOT NULL DEFAULT false
);

-- Indexes for the common query paths (recency sort, owner scoping, lookups).
CREATE INDEX IF NOT EXISTS idx_call_events_created_at  ON call_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_events_agent_email ON call_events (agent_email);
CREATE INDEX IF NOT EXISTS idx_call_events_ticket_id   ON call_events (ticket_id);
CREATE INDEX IF NOT EXISTS idx_call_events_mid         ON call_events (mid);
CREATE INDEX IF NOT EXISTS idx_call_events_event_type  ON call_events (event_type);
CREATE INDEX IF NOT EXISTS idx_call_events_outcome     ON call_events (outcome);

-- A unique CDR fingerprint dedupes provider webhook retries (port of the GAS
-- ScriptProperties HMAC dedup) — only enforced when a provider_call_id exists.
CREATE UNIQUE INDEX IF NOT EXISTS uq_call_events_provider_dedupe
  ON call_events (provider, provider_call_id, event_type, outcome)
  WHERE provider_call_id IS NOT NULL;

-- Idempotent demo seed so the Call Log view + scoping have data on a fresh cluster.
INSERT INTO call_events
  (event_id, created_at, ticket_id, mid, business, customer_phone, agent_email,
   agent_name, role, event_type, outcome, duration_sec, channel, provider, source, notes, verified)
VALUES
  ('CE-202606-SEED0001', '2026-06-01T10:05:00Z', 'BF-202606-0001', '100200', 'Green Mart',     '9990001111', 'agent1@billfree.in', 'Agent One', 'agent',   'CALL_COMPLETED',  'CONNECTED',          142, 'voice', 'demo', 'seed', 'Walked through POS re-sync',   true),
  ('CE-202606-SEED0002', '2026-06-01T11:20:00Z', 'BF-202606-0002', '100201', 'Sunrise Traders','9990002222', 'agent1@billfree.in', 'Agent One', 'agent',   'CALL_NO_ANSWER',  'NO_ANSWER',            0, 'voice', 'demo', 'seed', 'No answer, will retry',        false),
  ('CE-202606-SEED0003', '2026-06-02T09:45:00Z', 'BF-202606-0003', '100202', 'City Mart',      '9990003333', 'agent2@billfree.in', 'Agent Two', 'agent',   'CALL_COMPLETED',  'CONNECTED',          308, 'voice', 'demo', 'seed', 'Completed onboarding call',    true),
  ('CE-202606-SEED0004', '2026-06-03T14:10:00Z', 'BF-202606-0004', '100203', 'Bharat Stores',  '9990004444', 'agent2@billfree.in', 'Agent Two', 'agent',   'CALL_DISPOSITION','CALLBACK_REQUESTED',  37, 'voice', 'demo', 'seed', 'Customer requested callback',  false)
ON CONFLICT (event_id) DO NOTHING;
