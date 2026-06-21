import { describe, it, expect } from 'vitest';
import {
  ageCategory,
  reasonQuality,
  normaliseStatus,
  canonicalAgentKey,
  appendToReason,
  computeKPIs,
  computeAgentStats,
  normaliseTicket,
} from './utils';
import type { RawTicket } from '../types';

// Minimal raw-ticket factory → full Ticket via the real normaliser.
function ticket(p: Partial<RawTicket>): ReturnType<typeof normaliseTicket> {
  return normaliseTicket({ id: 'BF-1', status: 'Not Completed', ...p } as RawTicket);
}

describe('ageCategory boundaries', () => {
  it('maps day counts to the right buckets', () => {
    expect(ageCategory(0)).toBe('fresh');
    expect(ageCategory(3)).toBe('fresh');
    expect(ageCategory(4)).toBe('aging');
    expect(ageCategory(8)).toBe('old');
    expect(ageCategory(15)).toBe('critical');
  });
});

describe('reasonQuality', () => {
  it('scores by length', () => {
    expect(reasonQuality('')).toBe('none');
    expect(reasonQuality('short')).toBe('minimal');
    expect(reasonQuality('a brief explanation')).toBe('brief');
    expect(reasonQuality('a properly detailed and documented resolution note')).toBe('detailed');
  });
});

describe('normaliseStatus', () => {
  it('is case-insensitive and falls back to Not Completed', () => {
    expect(normaliseStatus('completed')).toBe('Completed');
    expect(normaliseStatus("CAN'T DO")).toBe("Can't Do");
    expect(normaliseStatus('garbage')).toBe('Not Completed');
  });
});

describe('canonicalAgentKey', () => {
  it('collapses email + friendly name for the same person', () => {
    expect(canonicalAgentKey('Suraj')).toBe('suraj');
    expect(canonicalAgentKey('suraj.billfree2@gmail.com')).toBe('suraj');
    expect(canonicalAgentKey('  Veer Bahadur ')).toBe('veerbahadur');
  });
});

describe('appendToReason', () => {
  it('prefixes a timestamp and preserves prior entries', () => {
    const out = appendToReason('[01-Jan-2026 10:00] first', 'second note');
    expect(out).toContain('first');
    expect(out).toMatch(/\] second note$/);
    expect(out.split('\n')).toHaveLength(2);
  });
});

describe('normaliseTicket — source/channel', () => {
  it('defaults missing source to dashboard', () => {
    expect(ticket({}).source).toBe('dashboard');
  });
  it('passes through and lowercases an external channel', () => {
    expect(ticket({ source: 'WhatsApp' }).source).toBe('whatsapp');
    expect(ticket({ source: 'portal' }).source).toBe('portal');
  });
});

describe('computeKPIs', () => {
  it('counts each status bucket and aging not-completed tickets', () => {
    const tickets = [
      ticket({ status: 'Completed' }),
      ticket({ status: 'Pending' }),
      ticket({ status: 'Not Completed', ageDays: 9 }), // aging (>=7)
      ticket({ status: 'Not Completed', ageDays: 1 }),
    ];
    const kpi = computeKPIs(tickets);
    expect(kpi.total).toBe(4);
    expect(kpi.completed).toBe(1);
    expect(kpi.pending).toBe(1);
    expect(kpi.notCompleted).toBe(2);
    expect(kpi.agingCount).toBe(1);
  });
});

describe('computeAgentStats — scoring algorithm (drives performance review)', () => {
  it('merges identities and applies the canonical score/rate formula', () => {
    const tickets = [
      ticket({ agent: 'Suraj', status: 'Completed', ageDays: 2, reason: 'resolved with a detailed note' }),
      ticket({ agent: 'suraj.billfree2@gmail.com', status: 'Completed', ageDays: 1, reason: 'fixed and verified properly' }),
      ticket({ agent: 'Suraj', status: "Can't Do", ageDays: 3, reason: 'cannot be done' }),
      ticket({ agent: 'Suraj', status: 'Closed', ageDays: 5, reason: 'x' }), // invalidClosed (reason < 10)
    ];
    const stats = computeAgentStats(tickets);

    // identity merge: 4 tickets → 1 agent
    expect(stats).toHaveLength(1);
    const a = stats[0];
    expect(a.name).toBe('Suraj');
    expect(a.total).toBe(4);
    expect(a.completed).toBe(2);
    expect(a.cantDo).toBe(1);
    expect(a.invalidClosed).toBe(1);
    // score = 2*(+10) + 0*validClosed - 1*5(cantDo) - 1*10(invalidClosed) - 0*pendingOld = 5
    expect(a.score).toBe(5);
    // rate = (completed + validClosed) / total = 2/4 = 50%
    expect(a.rate).toBe(50);
    expect(a.rank).toBe(1);
  });

  it('ranks agents by descending score', () => {
    const tickets = [
      ticket({ agent: 'High', status: 'Completed', reason: 'good detailed work done here' }),
      ticket({ agent: 'High', status: 'Completed', reason: 'another solid resolution note' }),
      ticket({ agent: 'Low', status: "Can't Do", reason: 'no' }),
    ];
    const [first, second] = computeAgentStats(tickets);
    expect(first.name).toBe('High');
    expect(first.rank).toBe(1);
    expect(second.name).toBe('Low');
    expect(second.score).toBeLessThan(first.score);
  });
});
