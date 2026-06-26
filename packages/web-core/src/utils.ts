import type { Ticket, RawTicket, AgeCategory, Status, ReasonQuality } from './types';

// ─── Timestamp parser ─────────────────────────────────────────
const MONTH_MAP: Record<string, number> = {
  jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
  jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
};

/**
 * Parse reason timestamps. Returns array of epoch ms values.
 * CRITICAL: creates a NEW RegExp per call — shared /g regex retains
 * lastIndex across calls and causes intermittent missed matches.
 */
export function parseReasonTimestamps(reason: string): number[] {
  const nowMs  = Date.now();
  const curYr  = new Date().getFullYear();
  const results: number[] = [];
  // format: [dd-MMM-yyyy HH:mm] (new) or [dd-MMM HH:mm] (old)
  const re = /\[(\d{1,2})-([A-Za-z]{3})(?:-(\d{4}))?\s+(\d{2}:\d{2})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reason)) !== null) {
    const day = parseInt(m[1], 10);
    const mon = MONTH_MAP[m[2].toLowerCase()];
    if (mon === undefined) continue;
    const [h, min] = m[4].split(':').map(Number);
    let yr = m[3] ? parseInt(m[3], 10) : curYr;
    let d  = new Date(yr, mon, day, h, min, 0, 0);
    // Old-format heuristic: if > 1 day in the future, assume last year
    if (!m[3] && d.getTime() > nowMs + 864e5) d = new Date(yr - 1, mon, day, h, min, 0, 0);
    results.push(d.getTime());
  }
  return results;
}

export function computeLastUpdatedMs(ticket: { sortDate: number; reason: string }): number {
  const ts = parseReasonTimestamps(ticket.reason || '');
  return ts.length === 0 ? ticket.sortDate : Math.max(ticket.sortDate, ...ts);
}

// ─── Optimistic timestamp writer ─────────────────────────────
const MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function nowTimestamp(): string {
  const n  = new Date();
  const dd = String(n.getDate()).padStart(2, '0');
  const mm = MON_ABBR[n.getMonth()];
  return `${dd}-${mm}-${n.getFullYear()} ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
}

export function appendToReason(existing: string, text: string): string {
  const entry = `[${nowTimestamp()}] ${text.trim()}`;
  return existing ? `${existing}\n${entry}` : entry;
}

// ─── Date helpers ─────────────────────────────────────────────
/** Build epoch ms for LOCAL midnight of a yyyy-mm-dd string */
export function localDayStart(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** Effective date for filter comparisons */
export const eff = (t: { lastUpdatedMs: number; sortDate: number }): number =>
  t.lastUpdatedMs || t.sortDate;

// ─── Ticket normaliser ────────────────────────────────────────
export function normaliseStatus(raw: string): Status {
  const s = (raw || '').trim();
  const valid: Status[] = [
    'Not Completed', 'Pending', 'In Progress',
    'Completed', 'Closed', "Can't Do",
  ];
  return (valid.find(v => v.toLowerCase() === s.toLowerCase()) ?? 'Not Completed');
}

export function ageCategory(days: number): AgeCategory {
  if (days >= 15) return 'critical';
  if (days >= 8)  return 'old';
  if (days >= 4)  return 'aging';
  return 'fresh';
}

export function reasonQuality(reason: string): ReasonQuality {
  const len = (reason || '').trim().length;
  if (len === 0)   return 'none';
  if (len < 10)    return 'minimal';   // Very short — matches legacy
  if (len < 30)    return 'brief';     // Basic explanation
  return 'detailed';                   // Well documented
}

export function formatDateDDMMYYYY(ms: number): string {
  if (!ms) return '-';
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

export function normaliseTicket(raw: RawTicket): Ticket {
  const sortDate: number =
    (raw.sortDate ?? raw._sortDate) ??
    ((raw['Date'] instanceof Date ? (raw['Date'] as Date).getTime() : 0) ||
     (raw['Date'] ? new Date(String(raw['Date'])).getTime() : 0));

  const ageDays = raw.ageDays ?? raw._ageDays ??
    (sortDate ? Math.floor((Date.now() - sortDate) / 86_400_000) : 0);

  const reason = raw.reason ?? raw['Follow-up Reason/ Remark'] ?? '';

  const status = normaliseStatus(raw.status ?? raw['Status'] ?? '');
  const rq = raw.reasonQuality ?? raw._reasonQuality ?? reasonQuality(reason);
  // [GAP-08] Canonical rule: GAS Reports.gs L131-137 uses age-based check.
  // A ticket closed within CONFIG.MIN_CLOSURE_DAYS (7) is "invalid closed".
  const MIN_CLOSURE_DAYS = 7;
  const invalidClosed = raw.invalidClosed ?? (status === 'Closed' && ageDays < MIN_CLOSURE_DAYS);

  const ticket: Ticket = {
    id:            raw.id ?? raw['Ticket ID'] ?? '',
    date:          raw.date ?? formatDateDDMMYYYY(sortDate),
    sortDate,
    lastUpdatedMs: computeLastUpdatedMs({ sortDate, reason }),
    ageDays,
    ageCategory:   raw.ageCategory ?? raw._ageCategory ?? ageCategory(ageDays),
    hourIST:       raw.hourIST ?? 0,
    email:         raw.email  ?? raw['IT Person Email'] ?? '',
    agent:         raw.agent  ?? raw['IT Person'] ?? '',
    requestedBy:   raw.requestedBy ?? raw['Requested By'] ?? '',
    mid:           raw.mid    ?? raw['MID'] ?? '',
    business:      raw.business ?? raw['Business Name'] ?? '',
    pos:           raw.pos    ?? raw['POS System'] ?? '',
    supportType:   (raw.supportType ?? raw['Support Type'] ?? 'Customer Support') as Ticket['supportType'],
    concern:       raw.concern ?? raw['Concern Related to'] ?? '',
    phone:         raw.phone  ?? raw['Phone'] ?? '',
    phoneDisplay:  raw.phoneDisplay ?? raw.phone ?? raw['Phone'] ?? '',
    status,
    reasonQuality: rq,
    reason,
    remark:        raw.remark ?? raw['Remark'] ?? '',
    invalidClosed,
    source:        (raw.source ?? 'dashboard').toLowerCase(),
    rowIndex:      raw.rowIndex,
  };
  return ticket;
}

// ─── CSV export ───────────────────────────────────────────────
export function downloadCSV(rows: string[][], filename: string): void {
  const csv = rows
    .map(row =>
      row
        .map(cell => {
          const s    = String(cell ?? '');
          // Prevent CSV injection (OWASP recommendation)
          const safe = /^[=+\-@\t]/.test(s) ? "'" + s : s;
          return `"${safe.replace(/"/g, '""')}"`;
        })
        .join(',')
    )
    .join('\r\n');

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── KPI computation ─────────────────────────────────────────
export function computeKPIs(tickets: Ticket[]) {
  const kpi = {
    total: tickets.length,
    notCompleted: 0, inProgress: 0, pending: 0,
    completed: 0, closed: 0, cantDo: 0, agingCount: 0,
  };
  for (const t of tickets) {
    if (t.status === 'Not Completed') { kpi.notCompleted++; if (t.ageDays >= 7) kpi.agingCount++; }
    else if (t.status === 'In Progress') kpi.inProgress++;
    else if (t.status === 'Pending')     kpi.pending++;
    else if (t.status === 'Completed')   kpi.completed++;
    else if (t.status === 'Closed')      kpi.closed++;
    else if (t.status === "Can't Do")    kpi.cantDo++;
  }
  return kpi;
}

/**
 * Canonical agent key — collapses friendly name and email-tagged tickets
 * for the same person ("Suraj" + "suraj.billfree2@gmail.com" → "suraj").
 * Strips email domain, common org tokens (`billfree`), digits and punctuation.
 */
export function canonicalAgentKey(raw: string | undefined | null): string {
  if (!raw) return '';
  let s = String(raw).toLowerCase().trim();
  if (!s) return '';
  if (s.indexOf('@') !== -1) s = s.split('@')[0];
  return s.replace(/billfree\d*/g, '').replace(/[^a-z0-9]/g, '');
}

/**
 * Build raw-value → { key, name } map for the given tickets.
 * Buckets by canonical key, then union-finds prefix-overlapping keys
 * (e.g. "veer" ⊂ "veerbahadur"). Picks the most frequent friendly name
 * as the display, falls back to email.
 */
export function buildAgentIdentityMap(
  tickets: Pick<Ticket, 'agent' | 'email'>[]
): Record<string, { key: string; name: string }> {
  const buckets: Record<string, { names: string[]; emails: string[]; raws: Set<string> }> = {};
  for (const t of tickets) {
    for (const raw of [t.agent, t.email]) {
      if (!raw) continue;
      const k = canonicalAgentKey(raw);
      if (!k) continue;
      if (!buckets[k]) buckets[k] = { names: [], emails: [], raws: new Set() };
      buckets[k].raws.add(raw);
      if (raw.indexOf('@') !== -1) buckets[k].emails.push(raw);
      else buckets[k].names.push(raw);
    }
  }
  const keys = Object.keys(buckets);
  const parent: Record<string, string> = {};
  keys.forEach(k => { parent[k] = k; });
  const find = (k: string): string => {
    while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; }
    return k;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const hasA = buckets[ra].names.length > 0;
    const hasB = buckets[rb].names.length > 0;
    if (hasA && !hasB) parent[rb] = ra;
    else if (hasB && !hasA) parent[ra] = rb;
    else if (ra.length >= rb.length) parent[rb] = ra;
    else parent[ra] = rb;
  };
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i], b = keys[j];
      if (a.length < 3 || b.length < 3) continue;
      if (a.startsWith(b) || b.startsWith(a)) union(a, b);
    }
  }
  const groups: Record<string, { names: string[]; emails: string[]; raws: string[] }> = {};
  keys.forEach(k => {
    const fk = find(k);
    if (!groups[fk]) groups[fk] = { names: [], emails: [], raws: [] };
    groups[fk].names.push(...buckets[k].names);
    groups[fk].emails.push(...buckets[k].emails);
    buckets[k].raws.forEach(r => groups[fk].raws.push(r));
  });
  const map: Record<string, { key: string; name: string }> = {};
  Object.keys(groups).forEach(fk => {
    const g = groups[fk];
    let display: string;
    if (g.names.length > 0) {
      const freq: Record<string, number> = {};
      g.names.forEach(n => { freq[n] = (freq[n] || 0) + 1; });
      display = Object.keys(freq).sort((a, b) =>
        freq[b] !== freq[a] ? freq[b] - freq[a] : b.length - a.length
      )[0];
    } else {
      display = g.emails[0] || fk;
    }
    g.raws.forEach(r => { map[r] = { key: fk, name: display }; });
  });
  return map;
}

export function computeAgentStats(tickets: Ticket[]) {
  const map: Record<string, {
    key: string; name: string; email: string;
    total: number; completed: number; notCompleted: number; inProgress: number;
    pending: number; closed: number; validClosed: number; invalidClosed: number;
    cantDo: number; pendingOld: number; agingCount: number;
    score: number; rate: number; rank: number;
    completedDays: number; // sum of ageDays for completed tickets (for avg resolution)
  }> = {};

  // Canonical identity map merges name- and email-tagged tickets for the same person.
  const identityMap = buildAgentIdentityMap(tickets);

  for (const t of tickets) {
    const ident =
      identityMap[t.email] || identityMap[t.agent] ||
      { key: canonicalAgentKey(t.email || t.agent) || 'unknown', name: t.agent || t.email || 'Unknown' };
    const key = ident.key;
    if (!map[key]) {
      map[key] = {
        key, name: ident.name, email: t.email,
        total: 0, completed: 0, notCompleted: 0, inProgress: 0,
        pending: 0, closed: 0, validClosed: 0, invalidClosed: 0,
        cantDo: 0, pendingOld: 0, agingCount: 0,
        score: 0, rate: 0, rank: 0, completedDays: 0,
      };
    }
    const a = map[key];
    a.total++;
    const sl = t.status.toLowerCase();
    if (sl === 'completed') {
      a.completed++;
      a.completedDays += t.ageDays;
    } else if (sl === 'closed') {
      a.closed++;
      if (t.invalidClosed) { a.invalidClosed++; } else { a.validClosed++; }
    } else if (sl.includes("can't") || sl.includes('cant')) {
      a.cantDo++;
    } else {
      // Not Completed, Pending, In Progress
      if (sl === 'in progress') a.inProgress++;
      else if (sl === 'pending') a.pending++;
      else a.notCompleted++;
    }
    // Old pending: age > 7 days and not completed/closed
    if (t.ageDays > 7 && sl !== 'completed' && sl !== 'closed') {
      a.pendingOld++;
    }
    if (t.ageDays >= 7 && sl !== 'completed' && sl !== 'closed') {
      a.agingCount++;
    }
  }

  return Object.values(map)
    .map(a => ({
      ...a,
      // ── UNIFIED SCORING (matches legacy getAgentStats exactly) ──
      // +10 Completed, +0 Valid Closed, -5 Can't Do, -10 Invalid Closed, -3 Old Pending
      score: (a.completed * 10) + (a.validClosed * 0) - (a.cantDo * 5) - (a.invalidClosed * 10) - (a.pendingOld * 3),
      // Legacy: completionRate = (completed + validClosed) / total
      rate: a.total ? Math.round(((a.completed + a.validClosed) / a.total) * 100) : 0,
    }))
    .sort((a, b) => b.score - a.score)
    .map((a, i) => ({ ...a, rank: i + 1 }));
}
