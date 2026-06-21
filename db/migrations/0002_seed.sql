-- Idempotent demo seed so analytics/leaderboard have data on a fresh cluster.
INSERT INTO tickets (id, agent_email, requested_by, mid, business, pos, support_type, concern, status, reason)
VALUES
  ('BF-202606-0001', 'agent1@billfree.in', 'Branch A', '100200', 'Green Mart',   'Tally',     'Customer Support', 'POS not syncing receipts', 'Completed',      '[2026-06-01 10:00] Resolved by re-syncing'),
  ('BF-202606-0002', 'agent1@billfree.in', 'Branch B', '100201', 'Sunrise Traders','GoFrugal',  'IT Floor',         'Settlement mismatch',      'Pending',        ''),
  ('BF-202606-0003', 'agent2@billfree.in', 'Branch C', '100202', 'City Mart',     'Petpooja',  'Customer Support', 'Onboarding help',          'Completed',      '[2026-06-02 11:30] Onboarded'),
  ('BF-202606-0004', 'agent2@billfree.in', 'Branch D', '100203', 'Bharat Stores', 'Tally',     'Floor',            'Hardware failure',         'Not Completed',  ''),
  ('BF-202606-0005', 'agent1@billfree.in', 'Branch E', '100204', 'Metro Hub',     'Marg',      'FOS',              'EDC machine issue',        'Closed',         '[2026-06-03 09:15] Replaced device')
ON CONFLICT (id) DO NOTHING;
