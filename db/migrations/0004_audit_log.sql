-- Audit log — append-only trail of ticket lifecycle events (create/update).
-- Owned by ticket-service; read by the dashboard's per-ticket audit drill-down.
-- Replaces the legacy GAS "Audit Log" sheet.
CREATE TABLE IF NOT EXISTS audit_log (
  id              bigserial   PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  ticket_id       text        NOT NULL,
  actor           text        NOT NULL,
  action          text        NOT NULL,   -- TICKET_CREATED | TICKET_UPDATED | CLOSE_ATTEMPT_DENIED
  previous_status text,
  new_status      text,
  reason_added    boolean     NOT NULL DEFAULT false,
  -- Resolution time from ticket creation to this event (ms); null when N/A.
  duration_ms     bigint,
  severity        text        NOT NULL DEFAULT 'INFO'
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ticket_id  ON audit_log (ticket_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);

-- Idempotent demo seed so the audit drill-down has data on a fresh cluster.
-- Mirrors the seeded tickets in 0002_seed.sql.
INSERT INTO audit_log
  (id, created_at, ticket_id, actor, action, previous_status, new_status, reason_added, duration_ms, severity)
VALUES
  (1, '2026-06-01T09:00:00Z', 'BF-202606-0001', 'agent1@billfree.in', 'TICKET_CREATED', NULL,            'Not Completed', false, NULL,        'INFO'),
  (2, '2026-06-01T10:00:00Z', 'BF-202606-0001', 'agent1@billfree.in', 'TICKET_UPDATED', 'Not Completed', 'Completed',     true,  3600000,     'INFO'),
  (3, '2026-06-02T08:30:00Z', 'BF-202606-0003', 'agent2@billfree.in', 'TICKET_CREATED', NULL,            'Not Completed', false, NULL,        'INFO'),
  (4, '2026-06-02T11:30:00Z', 'BF-202606-0003', 'agent2@billfree.in', 'TICKET_UPDATED', 'Not Completed', 'Completed',     true,  10800000,    'INFO')
ON CONFLICT (id) DO NOTHING;

-- Keep the bigserial sequence ahead of the hand-seeded ids.
SELECT setval(pg_get_serial_sequence('audit_log', 'id'), GREATEST((SELECT MAX(id) FROM audit_log), 1));
