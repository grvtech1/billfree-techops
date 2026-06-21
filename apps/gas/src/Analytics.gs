/**
 * ════════════════════════════════════════════════════════════════════════
 *  Manager Analytics   (extracted module)
 * ════════════════════════════════════════════════════════════════════════
 * Extracted from Code.gs. In Google Apps Script all .gs files share ONE global
 * namespace, so these declarations remain callable everywhere unchanged.
 */

// Shared analytics constants — single source of truth.
const ANALYTICS_EXCLUDE_MIDS = Object.freeze(['301', '201', '202', '302']);

const ANALYTICS_TOP_N = 10;

/**
 * Wraps an analytics body in the common { success, data } / { success, error }
 * envelope that every analytics endpoint returned verbatim before.
 * @param {string} name  — used for log tagging
 * @param {() => any} compute — returns the `data` payload
 * @returns {string} JSON-stringified response
 */
function analyticsEnvelope_(name, compute) {
  try {
    return JSON.stringify({ success: true, data: compute() });
  } catch (e) {
    Logger.log('[Analytics] ' + name + ' error: ' + e.toString());
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/** Active = not closed and not completed. */
function isActiveTicket_(t) {
  return t && t.status !== STATUS_ENUM.CLOSED && t.status !== STATUS_ENUM.COMPLETED;
}

function getTopMIDsSameConcern() {
  return analyticsEnvelope_('getTopMIDsSameConcern', () => {
    const midConcernMap = {};

    getCachedTickets().filter(isActiveTicket_).forEach(t => {
      if (!t.mid || t.mid === '-' || ANALYTICS_EXCLUDE_MIDS.includes(t.mid)) return;

      const key = `${t.mid}|||${t.concern}`;
      if (!midConcernMap[key]) {
        midConcernMap[key] = {
          mid: t.mid,
          concern: t.concern,
          business: t.business,
          count: 0,
          tickets: []
        };
      }
      midConcernMap[key].count++;
      midConcernMap[key].tickets.push(t.id);
    });

    return Object.values(midConcernMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, ANALYTICS_TOP_N);
  });
}

function getTopMIDsDifferentConcerns() {
  return analyticsEnvelope_('getTopMIDsDifferentConcerns', () => {
    const midMap = {};

    getCachedTickets().filter(isActiveTicket_).forEach(t => {
      if (!t.mid || t.mid === '-' || ANALYTICS_EXCLUDE_MIDS.includes(t.mid)) return;

      if (!midMap[t.mid]) {
        midMap[t.mid] = {
          mid: t.mid,
          business: t.business,
          concerns: new Set(),
          totalTickets: 0
        };
      }
      midMap[t.mid].concerns.add(t.concern);
      midMap[t.mid].totalTickets++;
    });

    return Object.values(midMap)
      .map(m => ({
        mid: m.mid,
        business: m.business,
        concernCount: m.concerns.size,
        concerns: Array.from(m.concerns),
        totalTickets: m.totalTickets
      }))
      .filter(m => m.concernCount > 1)
      .sort((a, b) => b.concernCount - a.concernCount)
      .slice(0, ANALYTICS_TOP_N);
  });
}

// POS normalization dictionary — shared by getTopPOS and any future POS analytics.
const ANALYTICS_POS_EXCLUDES = Object.freeze(['bf', 'billfree', '-', '', 'na', 'n/a', 'unknown']);

function normalizePos_(raw) {
  const v = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (v.includes('tally')) return 'Tally';
  if (v.includes('busy')) return 'Busy';
  if (v.includes('custom') || v.includes('costum')) return 'Custom';
  if (v.includes('mmi')) return 'MMI';
  if (v.includes('petpooja') || v.includes('pet')) return 'PetPooja';
  if (v.includes('margh') || v.includes('marg')) return 'Marg';
  if (v.includes('logic')) return 'Logic ERP';
  if (v.includes('cider')) return 'Cider';
  if (v.includes('wing')) return 'Wing';
  if (v.includes('gofrugal')) return 'GoFrugal';
  if (v.includes('posist')) return 'Posist';
  if (v.includes('saral')) return 'Saral';
  const str = String(raw || '');
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function getTopPOS() {
  return analyticsEnvelope_('getTopPOS', () => {
    const posMap = {};

    getCachedTickets().forEach(t => {
      const raw = String(t.pos || '').trim();
      const lower = raw.toLowerCase();
      // Exclude loose matches (only for excludes longer than 2 chars) + exact matches.
      if (ANALYTICS_POS_EXCLUDES.some(ex => lower.includes(ex) && ex.length > 2) ||
          ANALYTICS_POS_EXCLUDES.includes(lower)) {
        return;
      }

      const pos = normalizePos_(raw);
      if (!posMap[pos]) {
        posMap[pos] = { pos: pos, count: 0, businesses: new Set() };
      }
      posMap[pos].count++;
      posMap[pos].businesses.add(t.business);
    });

    return Object.values(posMap)
      .map(p => ({ pos: p.pos, count: p.count, businessCount: p.businesses.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, ANALYTICS_TOP_N);
  });
}

function getRepeatCustomerAnalysis() {
  return analyticsEnvelope_('getRepeatCustomerAnalysis', () => {
    const businessMap = {};

    getCachedTickets().forEach(t => {
      if (!t.business || t.business === '-') return;

      if (!businessMap[t.business]) {
        businessMap[t.business] = {
          business: t.business,
          mid: t.mid,
          ticketCount: 0,
          concerns: new Set(),
          agents: new Set(),
          completedCount: 0,
          totalDays: 0
        };
      }
      const b = businessMap[t.business];
      b.ticketCount++;
      b.concerns.add(t.concern);
      b.agents.add(t.agent);

      if (String(t.status || '').toLowerCase() === 'completed') {
        b.completedCount++;
        b.totalDays += (t.ageDays || 0);
      }
    });

    return Object.values(businessMap)
      .filter(b => b.ticketCount >= 3)
      .map(b => ({
        business: b.business,
        mid: b.mid,
        ticketCount: b.ticketCount,
        concernCount: b.concerns.size,
        agentCount: b.agents.size,
        completionRate: Math.round((b.completedCount / b.ticketCount) * 100),
        avgResolutionDays: b.completedCount > 0
          ? Math.round(b.totalDays / b.completedCount)
          : 0
      }))
      .sort((a, b) => b.ticketCount - a.ticketCount)
      .slice(0, ANALYTICS_TOP_N);
  });
}

function getConcernTrendAnalysis() {
  return analyticsEnvelope_('getConcernTrendAnalysis', () => {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const last30Days = now - 30 * DAY;
    const last60to30Days = now - 60 * DAY;

    const current = {};
    const previous = {};

    getCachedTickets().forEach(t => {
      if (t.sortDate >= last30Days) {
        current[t.concern] = (current[t.concern] || 0) + 1;
      } else if (t.sortDate >= last60to30Days) {
        previous[t.concern] = (previous[t.concern] || 0) + 1;
      }
    });

    return Object.keys(current).map(concern => {
      const c = current[concern];
      const p = previous[concern] || 0;
      const change = p > 0 ? Math.round(((c - p) / p) * 100) : 100;
      return {
        concern: concern,
        currentMonth: c,
        previousMonth: p,
        changePercent: change,
        trend: change > 10 ? 'rising' : change < -10 ? 'falling' : 'stable'
      };
    }).sort((a, b) => b.currentMonth - a.currentMonth);
  });
}

function getAgentSpecializationMatrix() {
  return analyticsEnvelope_('getAgentSpecializationMatrix', () => {
    const agentConcernMap = {};

    getCachedTickets().forEach(t => {
      if (!agentConcernMap[t.agent]) agentConcernMap[t.agent] = {};
      const slot = agentConcernMap[t.agent];
      if (!slot[t.concern]) slot[t.concern] = { total: 0, completed: 0 };
      slot[t.concern].total++;
      if (String(t.status || '').toLowerCase() === 'completed') {
        slot[t.concern].completed++;
      }
    });

    const specializations = [];
    for (const [agent, concerns] of Object.entries(agentConcernMap)) {
      for (const [concern, stats] of Object.entries(concerns)) {
        if (stats.total >= 3) {
          specializations.push({
            agent: agent,
            concern: concern,
            ticketCount: stats.total,
            completionRate: Math.round((stats.completed / stats.total) * 100),
            expertise: stats.total >= 10 ? 'Expert' : stats.total >= 5 ? 'Experienced' : 'Learning'
          });
        }
      }
    }

    return specializations.sort((a, b) => b.completionRate - a.completionRate);
  });
}
