-- External-channel intake (WhatsApp chatbot, web portal, …).
-- 1) Track where a ticket came from so the dashboard can flag its origin.
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'dashboard';
CREATE INDEX IF NOT EXISTS idx_tickets_source ON tickets (source);

-- 2) Assignable-agent roster used for auto-assignment (least-loaded strategy).
--    Kept as data (not env) so agents can be activated/deactivated without a deploy.
CREATE TABLE IF NOT EXISTS agents (
  email  text    PRIMARY KEY,
  name   text    NOT NULL,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO agents (email, name, active) VALUES
  ('agent1@billfree.in', 'Agent One', true),
  ('agent2@billfree.in', 'Agent Two', true)
ON CONFLICT (email) DO NOTHING;
