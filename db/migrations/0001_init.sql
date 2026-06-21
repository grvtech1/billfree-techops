-- Tickets — the core domain table (replaces the legacy Google Sheet).
CREATE TABLE IF NOT EXISTS tickets (
  id            text PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  agent_email   text        NOT NULL,
  it_email      text,
  requested_by  text        NOT NULL,
  mid           text        NOT NULL,
  business      text        NOT NULL,
  pos           text        NOT NULL,
  support_type  text        NOT NULL,
  concern       text        NOT NULL,
  config_notes  text,
  remark        text,
  status        text        NOT NULL DEFAULT 'Not Completed',
  reason        text        NOT NULL DEFAULT '',
  phone         text
);

-- Indexes for the common query paths (status filter, recency sort, lookups).
CREATE INDEX IF NOT EXISTS idx_tickets_status      ON tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at  ON tickets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_mid         ON tickets (mid);
CREATE INDEX IF NOT EXISTS idx_tickets_agent_email ON tickets (agent_email);
