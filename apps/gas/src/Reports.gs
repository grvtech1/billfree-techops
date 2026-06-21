/**
 * ════════════════════════════════════════════════════════════════════════
 *  Monthly Reports & AI Narrative   (extracted module)
 * ════════════════════════════════════════════════════════════════════════
 * Extracted from Code.gs. In Google Apps Script all .gs files share ONE global
 * namespace, so these declarations remain callable everywhere unchanged.
 */

/**
 * [REPORT] GENERATE MONTHLY REPORT
 * Creates comprehensive monthly analytics report
 * @param {Object} options - { month: 1-12, year: YYYY }
 */
function generateMonthlyReport(options = {}) {
  try {
    const safeOptions = options || {};
    // ── NO requirePermission gate ────────────────────────────────────────
    // This is a READ-ONLY report generator. Same rationale as getTicketData:
    // Session.getActiveUser().getEmail() returns empty in 'Anyone' deployments,
    // causing E002 failures. The web app URL is access-controlled by Google.
    // sendMonthlyReportEmail (write) still enforces full auth + CSRF.
    const now = new Date();
    const month = parseInt(safeOptions.month, 10) || (now.getMonth() + 1);
    const year = parseInt(safeOptions.year, 10) || now.getFullYear();
    
    // Validate inputs
    if (month < 1 || month > 12) {
      return JSON.stringify({ success: false, error: 'Invalid month. Must be 1-12.' });
    }
    if (year < 2020 || year > 2100) {
      return JSON.stringify({ success: false, error: 'Invalid year.' });
    }
    
    // Date range for the month
    const startDate = new Date(year, month - 1, 1, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59);
    
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    
    if (!sheet) {
      return JSON.stringify({ success: false, error: 'Data sheet not found' });
    }
    
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return JSON.stringify({ success: false, error: 'No ticket data found' });
    }
    
    const data = sheet.getRange(2, 1, lastRow - 1, 14).getValues();
    
    // ── R3: Compute previous-month date range for concern trends ──
    const prevMonthDate = new Date(year, month - 2, 1);
    const prevStartDate = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), 1, 0, 0, 0);
    const prevEndDate   = new Date(prevMonthDate.getFullYear(), prevMonthDate.getMonth() + 1, 0, 23, 59, 59);
    const prevConcernStats = {};
    
    // Filter by month
    const monthData = data.filter(row => {
      const dateCell = row[1];
      if (!dateCell) return false;
      const d = dateCell instanceof Date ? dateCell : new Date(dateCell);
      if (isNaN(d.getTime())) return false;
      
      // R3: While iterating, also collect previous-month concern frequencies
      if (d >= prevStartDate && d <= prevEndDate) {
        const concern = String(row[9] || 'Unspecified').trim();
        prevConcernStats[concern] = (prevConcernStats[concern] || 0) + 1;
      }
      
      return d >= startDate && d <= endDate;
    });
    
    if (monthData.length === 0) {
      const monthNames = ['January','February','March','April','May','June',
                          'July','August','September','October','November','December'];
      return JSON.stringify({ 
        success: false, 
        error: `No tickets found for ${monthNames[month-1]} ${year}` 
      });
    }
    
    // Initialize summary
    const summary = {
      totalTickets: monthData.length,
      completed: 0,
      pending: 0,
      closed: 0,
      cantDo: 0,
      invalidClosed: 0,
      avgAgeDays: 0
    };
    
    const agentStats = {};
    const concernStats = {};
    const supportTypeStats = {};
    const dailyStats = {};
    const weekdayStats = {};
    const hourlyStats = {};
    const monthlyTickets = [];
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let totalAge = 0;
    
    // Process each ticket
    monthData.forEach(row => {
      const status = normalizeStatusWithDefault(row[12]);
      let agent = String(row[3] || 'Unassigned').trim();
      
      // Normalize email to canonical name to prevent fragmented workload stats
      const agentMatch = getAgentByEmail(agent);
      if (agentMatch && agentMatch.name) {
        agent = agentMatch.name;
      }
      
      const supportType = String(row[8] || 'Customer Support').trim();
      const concern = String(row[9] || 'Unspecified').trim();
      const dateCell = row[1];
      const d = dateCell instanceof Date ? dateCell : new Date(dateCell);
      const ticketId = String(row[0] || '');
      const mid = String(row[5] || '-');
      const business = String(row[6] || '-');
      const dayKey = d.getDate();
      const weekdayKey = weekdayNames[d.getDay()];
      const hourKey = d.getHours();
      const reason = String(row[13] || '').trim();
      
      // Calculate age
      const age = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      totalAge += age;
      
      // Check for invalid closed
      let isInvalidClosed = false;
      if (status === STATUS_ENUM.CLOSED) {
        if (age < CONFIG.MIN_CLOSURE_DAYS) {
          isInvalidClosed = true;
        }
      }
      
      // Status counts
      if (status === STATUS_ENUM.COMPLETED) summary.completed++;
      else if (status === STATUS_ENUM.CLOSED) {
        summary.closed++;
        if (isInvalidClosed) summary.invalidClosed++;
      }
      else if (status === STATUS_ENUM.CANT_DO) summary.cantDo++;
      else summary.pending++;
      
      // Agent stats
      if (!agentStats[agent]) {
        agentStats[agent] = { 
          name: agent,
          total: 0, 
          completed: 0, 
          pending: 0, 
          closed: 0, 
          cantDo: 0,
          invalidClosed: 0,
          withReason: 0
        };
      }
      const agentStat = agentStats[agent];
      agentStat.total++;
      if (status === STATUS_ENUM.COMPLETED) agentStat.completed++;
      else if (status === STATUS_ENUM.CLOSED) {
        agentStat.closed++;
        if (isInvalidClosed) agentStat.invalidClosed++;
      }
      else if (status === STATUS_ENUM.CANT_DO) agentStat.cantDo++;
      else agentStat.pending++;
      if (reason.length >= 10) agentStat.withReason++;
      
      // Concern stats
      if (!concernStats[concern]) concernStats[concern] = 0;
      concernStats[concern]++;
      
      // Support type stats
      if (!supportTypeStats[supportType]) supportTypeStats[supportType] = 0;
      supportTypeStats[supportType]++;
      
      // Daily stats
      if (!dailyStats[dayKey]) dailyStats[dayKey] = { created: 0, completed: 0 };
      dailyStats[dayKey].created++;
      if (status === STATUS_ENUM.COMPLETED) dailyStats[dayKey].completed++;
      
      // Weekday distribution for insights panel compatibility
      if (!weekdayStats[weekdayKey]) weekdayStats[weekdayKey] = 0;
      weekdayStats[weekdayKey]++;
      
      // Hourly stats
      if (!hourlyStats[hourKey]) hourlyStats[hourKey] = 0;
      hourlyStats[hourKey]++;
      
      // Ticket list for CSV export — use already-normalized agent name
      monthlyTickets.push({
        id: ticketId,
        date: Utilities.formatDate(d, 'Asia/Kolkata', 'dd-MM-yyyy'),
        agent,        // already resolved to canonical name above
        business,
        mid,
        concern,
        supportType,
        status,
        reason
      });
    });
    
    // Calculate avg age
    summary.avgAgeDays = Math.round(totalAge / Math.max(1, summary.totalTickets));
    
    // Calculate rates
    summary.completionRate = summary.totalTickets > 0 ? 
      Math.round((summary.completed / summary.totalTickets) * 100) : 0;
    summary.resolutionRate = summary.totalTickets > 0 ?
      Math.round(((summary.completed + summary.closed) / summary.totalTickets) * 100) : 0;
    summary.cantDoRate = summary.totalTickets > 0 ?
      Math.round((summary.cantDo / summary.totalTickets) * 100) : 0;
    
    // Performance score calculation
    // Weight: Completion 60%, Low Can't Do 20%, Low Pending 20%
    const pendingRate = summary.totalTickets > 0 ? (summary.pending / summary.totalTickets) * 100 : 0;
    const score = Math.min(100, Math.max(0, 
      (summary.completionRate * 0.6) + 
      ((100 - summary.cantDoRate) * 0.2) +
      ((100 - pendingRate) * 0.2)
    ));
    summary.performanceScore = Math.round(score);
    
    // Performance grade
    if (score >= 90) summary.performanceGrade = 'A+';
    else if (score >= 80) summary.performanceGrade = 'A';
    else if (score >= 70) summary.performanceGrade = 'B';
    else if (score >= 60) summary.performanceGrade = 'C';
    else summary.performanceGrade = 'D';
    
    // Agent rankings with scoring
    const agentRankings = Object.values(agentStats).map(stats => {
      const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
      const reasonRate = stats.total > 0 ? Math.round((stats.withReason / stats.total) * 100) : 0;
      // Score: +10 completed, +5 closed, -5 can't do, -10 invalid closed, -3 pending
      const agentScore = (stats.completed * 10) + (stats.closed * 5) - 
                         (stats.cantDo * 5) - (stats.invalidClosed * 10) - (stats.pending * 3);
      
      return {
        ...stats,
        completionRate,
        reasonRate,
        score: agentScore
      };
    }).sort((a, b) => b.score - a.score);
    
    // Top concerns (top 10)
    const topConcerns = Object.entries(concernStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([concern, count]) => ({ 
        concern, 
        count,
        percentage: Math.round((count / summary.totalTickets) * 100)
      }));
    
    // ── R3: Concern Trends — rising / falling / stable vs. previous month ──
    const concernTrends = Object.entries(concernStats)
      .map(([concern, count]) => {
        const prev = prevConcernStats[concern] || 0;
        const changePercent = prev > 0
          ? Math.round(((count - prev) / prev) * 100)
          : (count > 0 ? 100 : 0);  // new concern = +100%
        return {
          concern,
          current: count,
          previous: prev,
          changePercent,
          trend: changePercent > 15 ? 'rising' : changePercent < -15 ? 'falling' : 'stable'
        };
      })
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
    
    // Also check for concerns that existed last month but vanished this month
    Object.keys(prevConcernStats).forEach(concern => {
      if (!concernStats[concern]) {
        concernTrends.push({
          concern,
          current: 0,
          previous: prevConcernStats[concern],
          changePercent: -100,
          trend: 'falling'
        });
      }
    });
    
    const supportTypeBreakdown = Object.entries(supportTypeStats)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        count,
        percentage: Math.round((count / summary.totalTickets) * 100)
      }));
    
    // Daily trend (fill all days of month)
    const daysInMonth = new Date(year, month, 0).getDate();
    const dailyTrend = [];
    for (let day = 1; day <= daysInMonth; day++) {
      dailyTrend.push({
        day,
        created: (dailyStats[day] && dailyStats[day].created) || 0,
        completed: (dailyStats[day] && dailyStats[day].completed) || 0
      });
    }
    
    // Hourly distribution
    const hourlyDistribution = [];
    for (let hour = 0; hour < 24; hour++) {
      hourlyDistribution.push({
        hour,
        label: `${hour.toString().padStart(2, '0')}:00`,
        count: hourlyStats[hour] || 0
      });
    }
    
    // Peak hour
    const peakHour = hourlyDistribution.reduce((max, curr) => 
      curr.count > max.count ? curr : max, { hour: 0, count: 0 });
    
    const dailyDistribution = weekdayNames.map(day => ({
      day,
      count: weekdayStats[day] || 0
    }));
    
    const busiestDay = dailyDistribution.reduce((max, curr) =>
      curr.count > max.count ? curr : max, { day: 'N/A', count: 0 });
    
    const activeDays = dailyDistribution.filter(d => d.count > 0);
    const slowestDay = activeDays.length > 0
      ? activeDays.reduce((min, curr) => curr.count < min.count ? curr : min, activeDays[0])
      : { day: 'N/A', count: 0 };
    
    const topPerformer = agentRankings[0] || { name: 'N/A', completed: 0, completionRate: 0, total: 0 };
    const highestRateAgent = agentRankings.reduce((best, current) => {
      if (current.total < 5) return best;
      if (!best || current.completionRate > best.completionRate) return current;
      return best;
    }, null) || topPerformer;
    
    const topConcern = topConcerns[0] || { concern: 'N/A', count: 0, percentage: 0 };
    
    // Generate recommendations
    const recommendations = [];
    
    if (summary.completionRate < 70) {
      recommendations.push({
        priority: 'HIGH',
        category: 'Performance',
        icon: '⚠️',
        message: `Completion rate is ${summary.completionRate}% (below 70% target). Review pending tickets and improve prioritization.`
      });
    }
    
    if (summary.cantDoRate > 10) {
      recommendations.push({
        priority: 'HIGH',
        category: 'Training',
        icon: '📚',
        message: `Can't Do rate is ${summary.cantDoRate}% (above 10% threshold). Consider additional training or better escalation paths.`
      });
    }
    
    if (summary.invalidClosed > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        category: 'Process',
        icon: '🔒',
        message: `${summary.invalidClosed} ticket(s) closed before ${CONFIG.MIN_CLOSURE_DAYS}-day minimum. Enforce closure policy.`
      });
    }
    
    if (topConcerns.length > 0 && topConcerns[0].percentage > 30) {
      recommendations.push({
        priority: 'MEDIUM',
        category: 'Automation',
        icon: '🤖',
        message: `"${topConcerns[0].concern}" represents ${topConcerns[0].percentage}% of tickets. Consider automation or self-service documentation.`
      });
    }
    
    
    // Achievements
    const achievements = [];
    if (summary.completionRate >= 80) {
      achievements.push({ icon: '🏆', text: 'Excellent completion rate!' });
    }
    if (summary.cantDoRate < 5) {
      achievements.push({ icon: '💪', text: "Low Can't Do rate - great capability!" });
    }
    if (agentRankings.length > 0 && agentRankings[0].completionRate >= 90) {
      achievements.push({ icon: '⭐', text: `Top performer: ${agentRankings[0].name} (${agentRankings[0].completionRate}%)` });
    }
    if (summary.completionRate === 100) {
      achievements.push({ icon: '🚀', text: 'Perfect month — 100% completion!' });
    }
    
    const insights = {
      busiestDay: { day: busiestDay.day, count: busiestDay.count },
      slowestDay: { day: slowestDay.day, count: slowestDay.count },
      topPerformer: {
        name: topPerformer.name,
        completed: topPerformer.completed || 0,
        rate: topPerformer.completionRate || 0
      },
      highestRateAgent: {
        name: highestRateAgent.name,
        rate: highestRateAgent.completionRate || 0,
        total: highestRateAgent.total || 0
      },
      topConcern: {
        name: topConcern.concern,
        count: topConcern.count,
        percentage: topConcern.percentage
      },
      recommendations: recommendations.map(r => ({
        priority: r.priority,
        icon: r.icon,
        message: r.message
      }))
    };

    const monthNames = ['January','February','March','April','May','June',
                        'July','August','September','October','November','December'];
    
    // Log audit event
    logAuditEvent('MONTHLY_REPORT_GENERATED', null, {
      month: monthNames[month-1],
      year: year,
      totalTickets: summary.totalTickets
    });
    
    return JSON.stringify({
      success: true,
      report: {
        title: `Monthly Operations Report - ${monthNames[month-1]} ${year}`,
        generatedAt: new Date().toISOString(),
        generatedBy: Session.getActiveUser().getEmail() || 'System',
        period: {
          month,
          year,
          monthName: monthNames[month-1],
          startDate: Utilities.formatDate(startDate, 'Asia/Kolkata', 'dd-MMM-yyyy'),
          endDate: Utilities.formatDate(endDate, 'Asia/Kolkata', 'dd-MMM-yyyy'),
          daysInMonth
        },
        summary,
        agentRankings,
        topConcerns,
        supportTypeBreakdown,
        insights,
        dailyDistribution,
        dailyTrend,
        hourlyDistribution,
        peakHour: peakHour.label,
        recommendations,
        achievements,
        concernTrends,
        tickets: monthlyTickets
      }
    });
  } catch (e) {
    Logger.log('generateMonthlyReport error: ' + e.toString());
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 *  SEND MONTHLY REPORT VIA EMAIL (Manual)
 * Sends polished formatted report with CSV attachments to admin emails.
 * Uses the same template as the scheduled sender for consistency.
 *
 * Enhancements: R10 (CSV attachments), R11 (scannable subject), R13 (AI narrative)
 */
function sendMonthlyReportEmail(options = {}) {
  try {
    requirePermission('EXPORT_REPORT');
    requireCSRFToken(options.csrfToken || '');
    
    const reportResult = generateMonthlyReport(options);
    const parsed = JSON.parse(reportResult);
    
    if (!parsed.success) {
      return JSON.stringify({ success: false, error: 'Failed to generate report: ' + parsed.error });
    }
    
    const report = parsed.report;
    const recipients = ADMIN_EMAILS.join(',');
    const s = report.summary || {};

    // R11: Scannable subject line
    const subject = `📊 ${report.period.monthName} ${report.period.year} — ${s.totalTickets} tickets, ${s.completionRate}% complete, Grade ${s.performanceGrade}`;
    
    // R13: Generate AI narrative (best effort)
    let aiNarrativeHtml = '';
    try {
      const aiResult = generateAINarrative_(report);
      aiNarrativeHtml = aiResult.html || '';
    } catch (e) {
      Logger.log('[ManualEmail] AI narrative failed (non-fatal): ' + e);
    }

    // Try previous month for MoM comparison
    let prevReport = null;
    try {
      const month = parseInt(options.month, 10) || (new Date().getMonth() + 1);
      const year = parseInt(options.year, 10) || new Date().getFullYear();
      const prevDate = new Date(year, month - 2, 1);
      const prevResult = JSON.parse(generateMonthlyReport({
        month: prevDate.getMonth() + 1,
        year: prevDate.getFullYear()
      }));
      if (prevResult.success) prevReport = prevResult.report;
    } catch (e) { /* non-fatal */ }

    // Build polished email body
    const htmlBody = buildMonthlyReportEmailHtml_(report, prevReport, aiNarrativeHtml);

    // R10: Build CSV attachments
    const monthTag = `${report.period.monthName}_${report.period.year}`;
    const attachments = [];
    try {
      attachments.push(
        Utilities.newBlob(buildAgentCSV_(report), 'text/csv', `Agent_Performance_${monthTag}.csv`)
      );
    } catch (e) { Logger.log('[ManualEmail] Agent CSV failed: ' + e); }
    try {
      attachments.push(
        Utilities.newBlob(buildTicketCSV_(report), 'text/csv', `Ticket_Details_${monthTag}.csv`)
      );
    } catch (e) { Logger.log('[ManualEmail] Ticket CSV failed: ' + e); }

    GmailApp.sendEmail(recipients, subject, '', {
      htmlBody: htmlBody,
      attachments: attachments
    });
    
    logAuditEvent('MONTHLY_REPORT_EMAILED', null, {
      recipients: recipients,
      month: report.period.monthName,
      year: report.period.year,
      attachmentCount: attachments.length,
      hasAINarrative: aiNarrativeHtml.length > 0
    });
    
    return JSON.stringify({ 
      success: true, 
      message: `Report sent to ${recipients} with ${attachments.length} CSV attachments${aiNarrativeHtml ? ' + AI narrative' : ''}` 
    });
  } catch (e) {
    Logger.log('sendMonthlyReportEmail error: ' + e.toString());
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Build the polished HTML body for the monthly email.
 * Includes prose executive summary, agent table with workload share,
 * support-type mix, top concerns w/ trend, MoM comparison, AI narrative,
 * achievements, recommendations.
 * @param {Object} report           current month's report object
 * @param {Object} prevRpt          previous month's report (or null)
 * @param {string} aiNarrativeHtml  Gemini-generated narrative HTML (or '')
 */
function buildMonthlyReportEmailHtml_(report, prevRpt, aiNarrativeHtml) {
  aiNarrativeHtml = aiNarrativeHtml || '';  // R13: default to empty if not provided
  const s = report.summary || {};
  const p = report.period  || {};
  const monthName = p.monthName || '';
  const fmtN = n => Number(n || 0).toLocaleString('en-IN');

  // ── Prose paragraph ─────────────────────────────────────────────────────
  const pendingTxt   = s.pending     ? `${s.pending} ticket${s.pending > 1 ? 's remain' : ' remains'} pending` : 'no tickets remain pending';
  const cantDoTxt    = !s.cantDo && !s.invalidClosed
    ? 'and there are no tickets in the "Can\'t Do" or invalid category, reflecting strong resolution efficiency'
    : `with ${s.cantDo || 0} marked "Can't Do" and ${s.invalidClosed || 0} invalid closures`;

  // ── Month-over-month delta ──────────────────────────────────────────────
  const mom = (curr, prev) => {
    if (!prev || prev === 0) return '';
    const diff = curr - prev;
    const pct  = Math.round((diff / prev) * 100);
    const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
    const color = diff > 0 ? '#10B981' : diff < 0 ? '#EF4444' : '#64748B';
    return `<span style="color:${color}; font-weight:600; font-size:12px; margin-left:6px;">${arrow} ${Math.abs(pct)}%</span>`;
  };
  const ps = (prevRpt && prevRpt.summary) || null;

  // ── Agent rows with workload share ──────────────────────────────────────
  const totalT = Math.max(s.totalTickets || 0, 1);
  const agentRows = (report.agentRankings || []).slice(0, 10).map((a, i) => {
    const share = ((a.total || 0) / totalT * 100).toFixed(1);
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
    return `
      <tr>
        <td style="padding:10px 12px;">${medal}</td>
        <td style="padding:10px 12px;"><strong>${a.name}</strong></td>
        <td style="padding:10px 12px; text-align:right;">${fmtN(a.total)}</td>
        <td style="padding:10px 12px; text-align:right; color:#10B981;">${fmtN(a.completed)}</td>
        <td style="padding:10px 12px; text-align:right;">${a.completionRate}%</td>
        <td style="padding:10px 12px; text-align:right; color:#4F46E5; font-weight:600;">${share}%</td>
      </tr>`;
  }).join('');

  // ── Support type breakdown ──────────────────────────────────────────────
  const stb = report.supportTypeBreakdown || [];
  const stRows = stb.map(st => `
      <tr>
        <td style="padding:8px 12px;">${st.type || st.name}</td>
        <td style="padding:8px 12px; text-align:right;">${fmtN(st.count)}</td>
        <td style="padding:8px 12px; text-align:right; color:#64748B;">${st.percentage || Math.round((st.count / totalT) * 100)}%</td>
      </tr>`).join('');

  // ── Top concerns with R3 trend badges ────────────────────────────────
  const tc = (report.topConcerns || []).slice(0, 5);
  const trendMap = {};
  (report.concernTrends || []).forEach(t => { trendMap[t.concern] = t; });
  const tcRows = tc.map((c, i) => {
    const trend = trendMap[c.concern || c.name];
    let trendBadge = '<span style="color:#94A3B8; font-size:12px;">— stable</span>';
    if (trend) {
      if (trend.trend === 'rising') {
        trendBadge = `<span style="color:#DC2626; font-weight:600; font-size:12px;">🔥 +${Math.abs(trend.changePercent)}% ▲</span>`;
      } else if (trend.trend === 'falling') {
        trendBadge = `<span style="color:#059669; font-weight:600; font-size:12px;">✅ -${Math.abs(trend.changePercent)}% ▼</span>`;
      }
    }
    return `
      <tr>
        <td style="padding:8px 12px;">#${i + 1}</td>
        <td style="padding:8px 12px;">${c.concern || c.name}</td>
        <td style="padding:8px 12px; text-align:right;">${fmtN(c.count)}</td>
        <td style="padding:8px 12px; text-align:right; color:#64748B;">${c.percentage || Math.round((c.count / totalT) * 100)}%</td>
        <td style="padding:8px 12px; text-align:right;">${trendBadge}</td>
      </tr>`;
  }).join('');

  // ── Achievements & recommendations ──────────────────────────────────────
  const achievementsHtml = (report.achievements || []).map(a =>
    `<li style="margin:6px 0;">${a.icon || '🏆'} ${a.text || a.message}</li>`
  ).join('');

  const recHtml = (report.recommendations || []).map(r => {
    const bg = r.priority === 'High' ? '#FEE2E2' : r.priority === 'Medium' ? '#FEF3C7' : '#D1FAE5';
    const bd = r.priority === 'High' ? '#DC2626' : r.priority === 'Medium' ? '#F59E0B' : '#10B981';
    return `
      <div style="background:${bg}; border-left:4px solid ${bd}; padding:12px 16px; margin:8px 0; border-radius:6px;">
        <strong>${r.icon || ''} ${r.category || r.priority || ''}</strong><br>
        <span style="color:#334155;">${r.message}</span>
      </div>`;
  }).join('');

  // ── Build email ─────────────────────────────────────────────────────────
  return `
  <!DOCTYPE html>
  <html><head><meta charset="utf-8"><style>
    body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1E293B; max-width: 760px; margin: 0 auto; }
    h1, h2, h3 { color: #0F172A; }
    h2 { border-bottom: 2px solid #E2E8F0; padding-bottom: 6px; margin-top: 28px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; background: #fff; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; }
    th { background: #F1F5F9; padding: 10px 12px; text-align: left; font-weight: 600; font-size: 13px; color: #475569; }
    tr { border-bottom: 1px solid #F1F5F9; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
    .kpi { background: #F8FAFC; border: 1px solid #E2E8F0; padding: 14px; border-radius: 10px; text-align: center; }
    .kpi-v { font-size: 26px; font-weight: 700; color: #4F46E5; }
    .kpi-l { font-size: 11px; color: #64748B; text-transform: uppercase; letter-spacing: 0.5px; }
  </style></head><body>

    <div style="background: linear-gradient(135deg, #4F46E5, #7C3AED); color: #fff; padding: 24px; border-radius: 12px;">
      <h1 style="color:#fff; margin:0;">📊 ${report.title}</h1>
      <p style="margin:8px 0 0; opacity:0.9;">${p.startDate} → ${p.endDate} &nbsp;•&nbsp; Performance Grade: <strong>${s.performanceGrade || '—'}</strong></p>
    </div>

    <p>Dear Sir,</p>
    <p>Please find below the consolidated performance summary for <strong>${monthName} ${p.year}</strong>.</p>
    <p>The team handled a total of <strong>${fmtN(s.totalTickets)}</strong> support tickets during the month, achieving a <strong>${s.completionRate}%</strong> completion rate. ${pendingTxt[0].toUpperCase() + pendingTxt.slice(1)}, ${cantDoTxt} and control over backlog.</p>

    <h2>1. Executive Summary</h2>
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-v">${fmtN(s.totalTickets)}${mom(s.totalTickets, ps && ps.totalTickets)}</div><div class="kpi-l">Total Tickets</div></div>
      <div class="kpi"><div class="kpi-v" style="color:#10B981;">${fmtN(s.completed)}${mom(s.completed, ps && ps.completed)}</div><div class="kpi-l">Completed (${s.completionRate}%)</div></div>
      <div class="kpi"><div class="kpi-v" style="color:#F59E0B;">${fmtN(s.pending)}</div><div class="kpi-l">Pending</div></div>
      <div class="kpi"><div class="kpi-v" style="color:#EF4444;">${fmtN((s.cantDo || 0) + (s.invalidClosed || 0))}</div><div class="kpi-l">Can't Do / Invalid</div></div>
    </div>

    <h2>2. Agent Performance Overview</h2>
    <p style="color:#475569;">Individual contributions based on workload and completion rate:</p>
    <table>
      <thead><tr><th>Rank</th><th>Agent</th><th style="text-align:right;">Total</th><th style="text-align:right;">Completed</th><th style="text-align:right;">Rate</th><th style="text-align:right;">Workload Share</th></tr></thead>
      <tbody>${agentRows || '<tr><td colspan="6" style="padding:16px; text-align:center; color:#94A3B8;">No agent activity in this period.</td></tr>'}</tbody>
    </table>

    <h2>3. Workload Distribution</h2>
    <p style="color:#475569;">Breakdown of tickets handled across different support categories:</p>
    <table>
      <thead><tr><th>Category</th><th style="text-align:right;">Tickets</th><th style="text-align:right;">Share</th></tr></thead>
      <tbody>${stRows || '<tr><td colspan="3" style="padding:16px; text-align:center; color:#94A3B8;">—</td></tr>'}</tbody>
    </table>

    <h2>4. Top Concerns Handled</h2>
    <table>
      <thead><tr><th>#</th><th>Concern</th><th style="text-align:right;">Count</th><th style="text-align:right;">Share</th><th style="text-align:right;">MoM Trend</th></tr></thead>
      <tbody>${tcRows || '<tr><td colspan="5" style="padding:16px; text-align:center; color:#94A3B8;">—</td></tr>'}</tbody>
    </table>

    ${aiNarrativeHtml ? `
    <h2>5. AI-Powered Executive Narrative</h2>
    <div style="background: linear-gradient(135deg, #F0F9FF 0%, #EFF6FF 100%); border-radius:10px; padding:20px 24px; border:1px solid #BAE6FD; border-left:4px solid #3B82F6;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; font-size:12px; font-weight:700; color:#1D4ED8; text-transform:uppercase; letter-spacing:0.5px;">
        <span style="font-size:18px;">🤖</span> Generated by Gemini AI
      </div>
      ${aiNarrativeHtml}
    </div>
    ` : ''}

    <h2>${aiNarrativeHtml ? '6' : '5'}. Operational Highlights</h2>
    <ul style="line-height:1.8;">
      <li><strong>Peak Hour:</strong> ${report.peakHour || '—'}</li>
      <li><strong>Top Performer:</strong> ${(report.insights && report.insights.topPerformer && report.insights.topPerformer.name) || '—'}</li>
      <li><strong>Highest Completion Rate:</strong> ${(report.insights && report.insights.highestRateAgent && report.insights.highestRateAgent.name) || '—'} (${(report.insights && report.insights.highestRateAgent && report.insights.highestRateAgent.rate) || 0}%)</li>
      <li><strong>Top Concern:</strong> ${(report.insights && report.insights.topConcern && report.insights.topConcern.name) || '—'} — ${(report.insights && report.insights.topConcern && report.insights.topConcern.count) || 0} tickets</li>
      ${ps ? `<li><strong>Vs. Previous Month:</strong> ${s.totalTickets >= ps.totalTickets ? 'Volume up' : 'Volume down'} by ${Math.abs(s.totalTickets - ps.totalTickets)} tickets; completion rate ${s.completionRate >= ps.completionRate ? 'improved' : 'declined'} by ${Math.abs((s.completionRate || 0) - (ps.completionRate || 0))} pp.</li>` : ''}
    </ul>

    ${achievementsHtml ? `<h2>🏆 Achievements</h2><ul style="line-height:1.8;">${achievementsHtml}</ul>` : ''}

    ${recHtml ? `<h2>💡 Recommendations</h2>${recHtml}` : ''}

    <hr style="border:none; border-top:1px solid #E2E8F0; margin:32px 0 12px;">
    <p style="color:#94A3B8; font-size:12px;">
      Generated automatically on ${Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy HH:mm')} IST by BillFree TechSupport Ops v${CONFIG.APP_VERSION}.<br>
      You are receiving this because you are listed in <code>ADMIN_EMAILS</code>. To unsubscribe, contact the system administrator.
    </p>
  </body></html>`;
}

/**
 * Generate a 3-paragraph AI executive narrative from the monthly report JSON.
 *
 * SETUP: Store your Gemini API key in Script Properties:
 *   PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', 'AIza...');
 *
 * Falls back gracefully to '' if:
 *   - GEMINI_API_KEY is not set
 *   - The API call fails or times out
 *   - Response is unparseable
 *
 * @param {Object} report  The report object from generateMonthlyReport()
 * @returns {string} HTML-formatted narrative (3 paragraphs), or '' on failure
 */
function generateAINarrative_(report) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('[AI-Narrative] GEMINI_API_KEY not configured — skipping.');
    return { html: '', error: 'NO_KEY' };
  }

  try {
    const s = report.summary || {};
    const p = report.period || {};
    const agents = (report.agentRankings || []).slice(0, 5);
    const concerns = (report.topConcerns || []).slice(0, 5);
    const trends = (report.concernTrends || [])
      .filter(t => t.trend !== 'stable')
      .slice(0, 6);

    // Build a tight JSON payload — stay under 2K tokens to keep cost near-zero
    const payload = {
      month: p.monthName,
      year: p.year,
      total: s.totalTickets,
      completed: s.completed,
      pending: s.pending,
      closed: s.closed,
      cantDo: s.cantDo,
      completionRate: s.completionRate,
      resolutionRate: s.resolutionRate,
      grade: s.performanceGrade,
      score: s.performanceScore,
      avgAgeDays: s.avgAgeDays,
      topAgents: agents.map(a => ({
        name: a.name,
        total: a.total,
        completed: a.completed,
        rate: a.completionRate
      })),
      topConcerns: concerns.map(c => ({ concern: c.concern, count: c.count, pct: c.percentage })),
      trends: trends.map(t => ({ concern: t.concern, change: t.changePercent + '%', dir: t.trend })),
      recommendations: (report.recommendations || []).map(r => r.message).slice(0, 3)
    };

    const prompt = `You are an operations analytics expert writing for a tech support team manager.
Given this monthly performance JSON, write EXACTLY 3 paragraphs in professional, concise English:
1. Executive overview: volume, completion rate, grade, and how the month compares to expectations.
2. Noteworthy trends: which concerns are rising/falling, what that implies, and one actionable callout.
3. Team & staffing: top performer recognition, workload balance observation, and one forward-looking recommendation.

Rules:
- No bullet points, no headings, no markdown.
- Keep total length under 200 words.
- Reference specific numbers from the data (e.g., "902 tickets", "99.2% completion").
- Tone: confident, data-driven, suitable for an executive email.

DATA:
${JSON.stringify(payload)}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
          // Gemini 2.5 Flash has "thinking" enabled by default, which silently
          // consumes most of the output budget. Disable it for narrative
          // generation so the full token budget goes to the visible reply.
          thinkingConfig: { thinkingBudget: 0 }
        }
      }),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      Logger.log('[AI-Narrative] Gemini API error ' + response.getResponseCode() + ': ' + response.getContentText().substring(0, 300));
      return { html: '', error: 'API_ERROR_' + response.getResponseCode() };
    }

    const json = JSON.parse(response.getContentText());
    const cand = (json.candidates && json.candidates[0]) || {};
    const text = (cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text) || '';
    const finishReason = cand.finishReason || '';

    // Diagnostic: log token usage + finish reason so future truncations are obvious
    if (json.usageMetadata) {
      Logger.log('[AI-Narrative] tokens prompt=' + json.usageMetadata.promptTokenCount +
                 ' output=' + json.usageMetadata.candidatesTokenCount +
                 ' thoughts=' + (json.usageMetadata.thoughtsTokenCount || 0) +
                 ' finish=' + finishReason +
                 ' textLen=' + text.length);
    }

    if (!text.trim()) {
      Logger.log('[AI-Narrative] Empty response from Gemini (finish=' + finishReason + ')');
      return { html: '', error: 'EMPTY_RESPONSE' + (finishReason ? '_' + finishReason : '') };
    }
    if (finishReason === 'MAX_TOKENS' && text.length < 200) {
      Logger.log('[AI-Narrative] Truncated by MAX_TOKENS — output too short');
      return { html: '', error: 'TRUNCATED_MAX_TOKENS' };
    }

    // Convert plain-text paragraphs to styled HTML
    const paragraphs = text.trim().split(/\n\n+/).filter(Boolean);
    const html = paragraphs.map(p =>
      `<p style="margin:0 0 12px; font-size:14px; line-height:1.7; color:#334155;">${p.trim()}</p>`
    ).join('');

    Logger.log('[AI-Narrative] Generated ' + paragraphs.length + ' paragraphs (' + text.length + ' chars)');
    return { html: html, error: null };
  } catch (e) {
    Logger.log('[AI-Narrative] Error (non-fatal): ' + e.toString());
    return { html: '', error: e.toString() };
  }
}

/**
 * R13 (in-app): Called by frontend to get AI narrative for the report preview.
 * Exposed as google.script.run.getAINarrative(options)
 */
function getAINarrative(options) {
  try {
    const safeOpts = options || {};
    // No requirePermission — read-only, same rationale as getTicketData.

    const reportResult = JSON.parse(generateMonthlyReport(safeOpts));
    if (!reportResult.success) {
      return JSON.stringify({ success: false, error: reportResult.error });
    }

    const result = generateAINarrative_(reportResult.report);
    return JSON.stringify({
      success: true,
      narrative: result.html || '',
      hasNarrative: (result.html || '').length > 0,
      aiError: result.error || null
    });
  } catch (e) {
    Logger.log('getAINarrative error: ' + e.toString());
    return JSON.stringify({ success: false, error: e.toString() });
  }
}

/**
 * Build per-agent CSV content from report data.
 * @param {Object} report  The report object
 * @returns {string} CSV content
 */
function buildAgentCSV_(report) {
  const rows = [
    csvRow_(['Agent', 'Total Tickets', 'Completed', 'Pending', 'Closed', "Can't Do",
             'Invalid Closed', 'Completion Rate (%)', 'Reason Rate (%)', 'Score'])
  ];
  (report.agentRankings || []).forEach(a => {
    rows.push(csvRow_([
      a.name, a.total, a.completed, a.pending, a.closed, a.cantDo,
      a.invalidClosed || 0, a.completionRate, a.reasonRate || 0, a.score
    ]));
  });
  return rows.join('\n');
}

/**
 * Build per-ticket CSV content from report data.
 * @param {Object} report  The report object
 * @returns {string} CSV content
 */
function buildTicketCSV_(report) {
  const rows = [
    csvRow_(['Ticket ID', 'Date', 'Agent', 'Business', 'MID', 'Concern',
             'Support Type', 'Status', 'Reason'])
  ];
  (report.tickets || []).forEach(t => {
    rows.push(csvRow_([
      t.id, t.date, t.agent, t.business, t.mid, t.concern,
      t.supportType, t.status, t.reason || ''
    ]));
  });
  return rows.join('\n');
}

/**
 * Trigger-safe scheduled monthly report sender.
 * Runs on the 1st of every month and emails the *previous* month's report
 * to ADMIN_EMAILS. Bypasses CSRF (non-applicable in trigger context).
 *
 * Enhancements:
 *   R10  — Auto-attaches per-agent CSV + per-ticket CSV to the email.
 *   R11  — Scannable subject line with headline metrics.
 *   R13  — Gemini AI narrative injected into email body.
 */
function sendScheduledMonthlyReport() {
  try {
    // Always report on the previous month
    const now = new Date();
    const reportFor = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = reportFor.getMonth() + 1;
    const year  = reportFor.getFullYear();

    // Generate current month report (no idToken — generateMonthlyReport will
    // use Session.getEffectiveUser() which is reliable in trigger context).
    const curr = JSON.parse(generateMonthlyReport({ month, year }));
    if (!curr.success) {
      Logger.log('[ScheduledReport] Failed to generate current report: ' + curr.error);
      return;
    }

    // Try previous month for MoM comparison (best effort — may not exist)
    const prevDate = new Date(year, month - 2, 1); // month is 1-indexed already
    let prev = null;
    try {
      const prevResult = JSON.parse(generateMonthlyReport({
        month: prevDate.getMonth() + 1,
        year:  prevDate.getFullYear()
      }));
      if (prevResult.success) prev = prevResult.report;
    } catch (e) {
      Logger.log('[ScheduledReport] MoM comparison unavailable: ' + e);
    }

    const recipients = (ADMIN_EMAILS || []).join(',');
    if (!recipients) {
      Logger.log('[ScheduledReport] No ADMIN_EMAILS configured — skipping send.');
      return;
    }

    // ── R13: Generate AI narrative ────────────────────────────────────────
    let aiNarrativeHtml = '';
    try {
      const aiResult = generateAINarrative_(curr.report);
      aiNarrativeHtml = aiResult.html || '';
    } catch (e) {
      Logger.log('[ScheduledReport] AI narrative failed (non-fatal): ' + e);
    }

    // ── R11: Scannable subject line ───────────────────────────────────────
    const s = curr.report.summary || {};
    const subject = `📊 ${curr.report.period.monthName} ${year} — ${s.totalTickets} tickets, ${s.completionRate}% complete, Grade ${s.performanceGrade}`;

    // ── Build email body with AI narrative ─────────────────────────────────
    const htmlBody = buildMonthlyReportEmailHtml_(curr.report, prev, aiNarrativeHtml);

    // ── R10: Build CSV attachments ────────────────────────────────────────
    const monthTag = `${curr.report.period.monthName}_${year}`;
    const attachments = [];

    try {
      const agentCSV = buildAgentCSV_(curr.report);
      attachments.push(
        Utilities.newBlob(agentCSV, 'text/csv', `Agent_Performance_${monthTag}.csv`)
      );
    } catch (e) {
      Logger.log('[ScheduledReport] Agent CSV build failed: ' + e);
    }

    try {
      const ticketCSV = buildTicketCSV_(curr.report);
      attachments.push(
        Utilities.newBlob(ticketCSV, 'text/csv', `Ticket_Details_${monthTag}.csv`)
      );
    } catch (e) {
      Logger.log('[ScheduledReport] Ticket CSV build failed: ' + e);
    }

    // ── Send with attachments ─────────────────────────────────────────────
    GmailApp.sendEmail(recipients, subject, '', {
      htmlBody: htmlBody,
      attachments: attachments
    });

    logAuditEvent('MONTHLY_REPORT_AUTO_SENT', null, {
      recipients,
      month: curr.report.period.monthName,
      year:  curr.report.period.year,
      totalTickets: s.totalTickets,
      attachmentCount: attachments.length,
      hasAINarrative: aiNarrativeHtml.length > 0
    });
    Logger.log(`[ScheduledReport] Sent ${curr.report.period.monthName} ${year} report to ${recipients} with ${attachments.length} CSV attachments`);
  } catch (e) {
    Logger.log('[ScheduledReport] FATAL: ' + e.toString() + '\n' + e.stack);
    try {
      logAuditEvent('MONTHLY_REPORT_AUTO_FAILED', null, { error: e.toString() }, 'ERROR');
    } catch (_) { /* swallow */ }
  }
}

/**
 *  Run ONCE from the GAS editor to install the monthly schedule.
 * Creates a time-driven trigger that fires on the 1st of every month at 09:00 IST.
 */
function installMonthlyReportTrigger() {
  // Remove any existing schedule first to prevent duplicates
  uninstallMonthlyReportTrigger();

  ScriptApp.newTrigger('sendScheduledMonthlyReport')
    .timeBased()
    .onMonthDay(1)
    .atHour(9)
    .inTimezone('Asia/Kolkata')
    .create();

  Logger.log('✅ Monthly report trigger installed: 1st of every month, 09:00 IST');
  return '✅ Monthly report trigger installed (1st of every month, 09:00 IST). Recipients: ' + (ADMIN_EMAILS || []).join(', ');
}

/** Removes the scheduled monthly report trigger. */
function uninstallMonthlyReportTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'sendScheduledMonthlyReport') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  Logger.log(`Removed ${removed} monthly-report trigger(s).`);
  return `Removed ${removed} monthly-report trigger(s).`;
}

/**
 * Manual test runner — call from the GAS editor to send the previous month's
 * report immediately without waiting for the schedule.
 */
function testSendMonthlyReportNow() {
  sendScheduledMonthlyReport();
  return 'Done. Check Logger output and your inbox.';
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔧 DIAGNOSTIC: Run this ONCE from the GAS editor to verify Gemini setup.
//    After confirming it works, you can delete this function.
// ═══════════════════════════════════════════════════════════════════════════
function testGeminiSetup() {
  const props = PropertiesService.getScriptProperties();
  const allKeys = props.getKeys();
  Logger.log('── All Script Property keys: ' + JSON.stringify(allKeys));

  const apiKey = props.getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('❌ GEMINI_API_KEY not found!');
    Logger.log('   Available keys: ' + allKeys.join(', '));
    Logger.log('   Fix: Go to Project Settings → Script Properties → Add:');
    Logger.log('   Property: GEMINI_API_KEY');
    Logger.log('   Value: your-api-key-here');
    return;
  }

  Logger.log('✅ GEMINI_API_KEY found (' + apiKey.substring(0, 8) + '...)');
  Logger.log('   Key length: ' + apiKey.length + ' chars');

  // Quick test: ping Gemini API
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        contents: [{ parts: [{ text: 'Say hello in one word.' }] }],
        generationConfig: { maxOutputTokens: 10 }
      }),
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    if (code === 200) {
      const json = JSON.parse(response.getContentText());
      const text = json.candidates[0].content.parts[0].text;
      Logger.log('✅ Gemini API works! Response: ' + text.trim());
    } else {
      Logger.log('❌ Gemini API error (HTTP ' + code + '): ' + response.getContentText().substring(0, 300));
    }
  } catch (e) {
    Logger.log('❌ Gemini API connection failed: ' + e.toString());
  }
}

/**
 * Public entry — call from frontend via google.script.run.
 * Returns a JSON-stringified response so Apps Script transports it cleanly.
 *
 * @param {string} intent     One of AI_INTENTS values
 * @param {Object} payload    Intent-specific input (already pre-computed in JS)
 * @param {string} csrfToken  Required to prevent abuse via XSRF
 * @returns {string} JSON: { success, data, cached, tokenIn, tokenOut, error? }
 */
function aiAnalytics(intent, payload, csrfToken) {
  try {
    requireCSRFToken(csrfToken || '');
    rateLimitCheck('ai_analytics');

    var validIntents = Object.keys(AI_INTENTS).map(function(k){ return AI_INTENTS[k]; });
    if (validIntents.indexOf(intent) < 0) {
      return JSON.stringify({ success: false, error: 'Invalid intent: ' + intent });
    }

    // Cache key — hash of intent + payload (5 min TTL)
    var cacheKey = 'ai_' + intent + '_' + Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5,
      JSON.stringify(payload || {})
    ).map(function(b){ return ((b<0?b+256:b).toString(16).padStart(2,'0')); }).join('').substring(0, 16);

    var cache = CacheService.getScriptCache();
    var cached = cache.get(cacheKey);
    if (cached) {
      return JSON.stringify({ success: true, data: JSON.parse(cached), cached: true });
    }

    var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return JSON.stringify({ success: false, error: 'GEMINI_API_KEY not configured' });
    }

    var spec = aiBuildIntentSpec_(intent, payload || {});
    if (!spec) {
      return JSON.stringify({ success: false, error: 'Intent builder returned null' });
    }

    var result = aiCallGemini_(apiKey, spec);
    if (!result.ok) {
      logAuditEvent('AI_CALL_FAILED', null, {
        intent: intent, error: result.error
      }, 'WARN');
      return JSON.stringify({ success: false, error: result.error });
    }

    // Cache & audit
    cache.put(cacheKey, JSON.stringify(result.data), 300); // 5 min
    logAuditEvent('AI_CALL_OK', null, {
      intent: intent,
      tokenIn:  result.tokenIn,
      tokenOut: result.tokenOut
    }, 'INFO');

    return JSON.stringify({
      success:  true,
      data:     result.data,
      cached:   false,
      tokenIn:  result.tokenIn,
      tokenOut: result.tokenOut
    });
  } catch (e) {
    Logger.log('aiAnalytics error: ' + e.toString());
    return JSON.stringify({ success: false, error: e.message || e.toString() });
  }
}

/**
 * Build the {prompt, schema, systemInstruction} for a given intent.
 * Each branch is independently testable — keep prompts terse, schemas tight.
 */
function aiBuildIntentSpec_(intent, payload) {
  if (intent === AI_INTENTS.ANALYTICS_BRIEF) {
    return {
      systemInstruction:
        'You are an elite tech-support operations director. Speak in tight, ' +
        'data-grounded bullets — no fluff, no hedging. Always cite specific numbers.',
      prompt:
        'Compare today vs the trailing 7-day baseline and produce 3 bullets ' +
        '(<=22 words each) of what a manager should focus on. Each bullet must ' +
        'cite a specific number or % change and end with an action verb if relevant. ' +
        'No greetings, no preamble.\n\nDATA:\n' + JSON.stringify(payload),
      schema: {
        type: 'OBJECT',
        properties: {
          headline: { type: 'STRING' },
          bullets:  { type: 'ARRAY', items: { type: 'STRING' } },
          mood:     { type: 'STRING', enum: ['positive','neutral','warning','critical'] }
        },
        required: ['bullets', 'mood']
      }
    };
  }

  if (intent === AI_INTENTS.RANK_ANOMALIES) {
    return {
      systemInstruction:
        'You are a tech-support ops analyst. Given pre-computed anomaly candidates, ' +
        'rank them by manager-actionability and drop noise. Be ruthlessly concise.',
      prompt:
        'Rank these anomalies. Keep at most 6. For each kept item produce: ' +
        '(a) severity (critical|warning|info), (b) headline (<=12 words, includes the key number), ' +
        '(c) why-it-matters (<=20 words), (d) recommended_action (imperative, <=12 words), ' +
        '(e) preserve the original "filter" object verbatim so frontend can apply it.\n\n' +
        'CANDIDATES:\n' + JSON.stringify(payload.candidates || []),
      schema: {
        type: 'OBJECT',
        properties: {
          anomalies: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                id:                 { type: 'STRING' },
                severity:           { type: 'STRING', enum: ['critical','warning','info'] },
                headline:           { type: 'STRING' },
                whyItMatters:       { type: 'STRING' },
                recommendedAction:  { type: 'STRING' },
                filter:             { type: 'OBJECT', properties: {
                  agent:       { type: 'STRING' },
                  mid:         { type: 'STRING' },
                  business:    { type: 'STRING' },
                  concern:     { type: 'STRING' },
                  pos:         { type: 'STRING' },
                  status:      { type: 'STRING' },
                  ageDaysMin:  { type: 'NUMBER' }
                }}
              },
              required: ['id','severity','headline','whyItMatters','recommendedAction']
            }
          }
        },
        required: ['anomalies']
      }
    };
  }

  if (intent === AI_INTENTS.CHART_CAPTIONS) {
    return {
      systemInstruction:
        'You are a senior data analyst writing one-line chart annotations. ' +
        'Each caption must be a single sentence (<=22 words), name a specific ' +
        'entity from the data, and end with an implication or suggested action.',
      prompt:
        'For each chart, write ONE caption explaining the dominant pattern. ' +
        'Cite specific labels and numbers. No generic statements.\n\n' +
        'CHARTS:\n' + JSON.stringify(payload.charts || {}),
      schema: {
        type: 'OBJECT',
        properties: {
          captions: {
            type: 'OBJECT',
            properties: {
              midSameConcern:      { type: 'STRING' },
              midDiffConcern:      { type: 'STRING' },
              topPos:              { type: 'STRING' },
              repeatCustomers:     { type: 'STRING' },
              concernTrends:       { type: 'STRING' },
              agentSpecialization: { type: 'STRING' }
            }
          }
        },
        required: ['captions']
      }
    };
  }

  if (intent === AI_INTENTS.ASK_DATA) {
    return {
      systemInstruction:
        'You translate natural-language ops questions into a structured filter ' +
        'object that an existing JS filter pipeline understands. Be conservative — ' +
        'omit any field you are not sure about. Return ONLY the filter object.',
      prompt:
        'Allowed schema fields: agent (string contains, case-insensitive), ' +
        'mid (exact), business (contains), concern (contains), pos (contains), ' +
        'supportType (one of: "Customer Support","IT Floor","Floor","FOS"), ' +
        'status (one of: "Not Completed","Pending","In Progress","Completed","Closed","Can\'t Do"), ' +
        'statusNot (same set, exclude), ageDaysMin (number), ageDaysMax (number), ' +
        'reasonShorterThan (number, char count), groupBy (one of: "agent","mid","concern","pos","business"), ' +
        'sortBy (one of: "ageDays","date","count"), sortDir ("asc" | "desc"), ' +
        'topN (number).\n\nKnown agents: ' + JSON.stringify(payload.knownAgents || []) +
        '\nKnown POS systems: ' + JSON.stringify(payload.knownPos || []) +
        '\n\nUSER QUESTION:\n' + (payload.question || '').substring(0, 280),
      schema: {
        type: 'OBJECT',
        properties: {
          intent:     { type: 'STRING', enum: ['filter','aggregate','rank'] },
          filter: {
            type: 'OBJECT',
            properties: {
              agent:             { type: 'STRING' },
              mid:               { type: 'STRING' },
              business:          { type: 'STRING' },
              concern:           { type: 'STRING' },
              pos:               { type: 'STRING' },
              supportType:       { type: 'STRING' },
              status:            { type: 'STRING' },
              statusNot:         { type: 'STRING' },
              ageDaysMin:        { type: 'NUMBER' },
              ageDaysMax:        { type: 'NUMBER' },
              reasonShorterThan: { type: 'NUMBER' }
            }
          },
          groupBy:    { type: 'STRING' },
          sortBy:     { type: 'STRING' },
          sortDir:    { type: 'STRING' },
          topN:       { type: 'NUMBER' },
          explanation:{ type: 'STRING' }
        },
        required: ['intent','filter','explanation']
      }
    };
  }

  return null;
}

/**
 * Low-level Gemini caller. Uses 2.5 Flash with JSON mode + response schema
 * so we get back guaranteed-shape JSON.
 *
 * Avoids the literal Gemini URL pattern that GAS was stripping (we hit it
 * earlier on the served HTML) — UrlFetchApp doesn't suffer from that, but
 * we keep the slash-fromCharCode pattern for consistency in case anything
 * upstream ever re-emits this code into served HTML.
 */
function aiCallGemini_(apiKey, spec) {
  var sl = String.fromCharCode(47);
  var url = 'https:' + sl + sl + 'generativelanguage.googleapis.com'
          + sl + 'v1beta' + sl + 'models'
          + sl + 'gemini-2.5-flash:generateContent?key=' + apiKey;

  var body = {
    systemInstruction: { parts: [{ text: spec.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: spec.prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: spec.schema
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
    ]
  };

  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var txt  = res.getContentText();
    if (code !== 200) {
      return { ok: false, error: 'HTTP ' + code + ': ' + txt.substring(0, 200) };
    }
    var json = JSON.parse(txt);
    var part = json && json.candidates && json.candidates[0]
      && json.candidates[0].content && json.candidates[0].content.parts
      && json.candidates[0].content.parts[0];
    var text = part && part.text || '';
    if (!text) return { ok: false, error: 'Empty response from Gemini' };

    // The response is a JSON string per schema — parse defensively
    var data;
    try { data = JSON.parse(text); }
    catch (e) { return { ok: false, error: 'Schema-violating response: ' + text.substring(0, 200) }; }

    var meta = json.usageMetadata || {};
    return {
      ok:       true,
      data:     data,
      tokenIn:  meta.promptTokenCount     || 0,
      tokenOut: meta.candidatesTokenCount || 0
    };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🛡 SECURITY: deprecate the old key-leak endpoint
// ───────────────────────────────────────────────────────────────────────────
//   Previous design exposed the raw GEMINI_API_KEY to the browser via
//   getGeminiConfig(). Anyone who could load the page could exfiltrate it.
//   Frontend now calls aiAnalytics(...) instead — key never leaves server.
// ═══════════════════════════════════════════════════════════════════════════
function getGeminiConfig() {
  // Intentionally returns empty. Frontend no longer needs the raw key.
  // Kept as a stub so any old client code that still calls this fails soft
  // (returns '' → caller's null-check skips the AI step) instead of throwing.
  logAuditEvent('AI_KEY_REQUEST_BLOCKED', null, {
    note: 'getGeminiConfig() is deprecated; use server-side aiAnalytics() instead.'
  }, 'WARN');
  return '';
}

/**
 * Server-side wrapper around the private generateAINarrative_(report).
 * Replaces the previous client-side direct fetch (which leaked GEMINI_API_KEY).
 *
 * @param {Object} report     The current monthly report object (CURRENT_REPORT)
 * @param {string} csrfToken  CSRF token for the calling user
 * @returns {string} JSON: { success, html, error? }
 */
function generateMonthlyNarrativeServer(report, csrfToken) {
  try {
    requireCSRFToken(csrfToken || '');
    rateLimitCheck('ai_monthly_narrative');
    if (!report || typeof report !== 'object') {
      return JSON.stringify({ success: false, error: 'Invalid report payload' });
    }
    var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return JSON.stringify({ success: false, error: 'GEMINI_API_KEY not configured on server' });
    }
    // Reuse the existing narrative generator (private function in Code.gs).
    var result = generateAINarrative_(report);
    if (result && result.html) {
      logAuditEvent('AI_NARRATIVE_OK', null, { period: report.period || null }, 'INFO');
      return JSON.stringify({ success: true, html: result.html });
    }
    return JSON.stringify({
      success: false,
      error:   'Narrative generation failed: ' + (result && result.error || 'unknown')
    });
  } catch (e) {
    Logger.log('generateMonthlyNarrativeServer error: ' + e.toString());
    return JSON.stringify({ success: false, error: e.message || e.toString() });
  }
}
