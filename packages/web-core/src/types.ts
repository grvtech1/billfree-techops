// ─── All TypeScript interfaces for BillFree TechOps SPA ───
// Canonical home: @billfree/web-core (moved from apps/web/src/types).

export type Status =
  | 'Not Completed'
  | 'Pending'
  | 'In Progress'
  | 'Completed'
  | 'Closed'
  | "Can't Do";

export type SupportType = 'Customer Support' | 'IT Floor' | 'Floor' | 'FOS';
export type Role = 'admin' | 'manager' | 'agent' | 'viewer' | 'system';
export type AgeCategory = 'fresh' | 'aging' | 'old' | 'critical';
export type ReasonQuality = 'none' | 'minimal' | 'brief' | 'detailed';
export type DateRangeType = 'all' | 'today' | 'yesterday' | '7days' | '30days' | 'custom';

export interface Ticket {
  id: string;
  date: string;              // "DD-MM-YYYY"
  sortDate: number;          // epoch ms (creation)
  lastUpdatedMs: number;     // computed from reason timestamps
  ageDays: number;
  ageCategory: AgeCategory;
  hourIST: number;
  email: string;             // creator/agent email
  agent: string;             // agent display name
  requestedBy: string;
  mid: string;
  business: string;
  pos: string;
  supportType: SupportType;
  concern: string;
  phone: string;
  phoneDisplay: string;
  status: Status;
  reasonQuality: ReasonQuality;
  reason: string;            // raw append-only log
  remark: string;
  invalidClosed: boolean;       // legacy: closed with short/empty reason
  source: string;            // origin channel: 'dashboard' | 'whatsapp' | 'portal' | …
  rowIndex?: number;
}

export interface Agent {
  name: string;
  email: string;
  role: Role;
  active?: boolean;
}

export interface AppUser {
  email: string;
  name: string;
  token: string;             // HMAC server token from GAS
  role: Role;
  isAdmin: boolean;
  picture?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
}

export interface TicketDataResponse {
  success: boolean;
  tickets: RawTicket[];
  directory: Record<string, { email: string; role: Role }>;
  version: number;
  cacheStatus: string;
}

// Raw ticket from GAS API — mapped-column format
export interface RawTicket {
  id: string;
  date?: string;
  sortDate?: number;
  ageDays?: number;
  ageCategory?: AgeCategory;
  hourIST?: number;
  email?: string;
  agent?: string;
  requestedBy?: string;
  mid?: string;
  business?: string;
  pos?: string;
  supportType?: string;
  concern?: string;
  phone?: string;
  phoneDisplay?: string;
  status?: string;
  reasonQuality?: ReasonQuality;
  reason?: string;
  remark?: string;
  source?: string;
  rowIndex?: number;
  invalidClosed?: boolean;
  // Alternate GAS field names
  'Ticket ID'?: string;
  'Date'?: Date | string;
  'IT Person'?: string;
  'IT Person Email'?: string;
  'Requested By'?: string;
  'MID'?: string;
  'Business Name'?: string;
  'POS System'?: string;
  'Support Type'?: string;
  'Concern Related to'?: string;
  'System Configuration'?: string;
  'Remark'?: string;
  'Status'?: string;
  'Follow-up Reason/ Remark'?: string;
  'Phone'?: string;
  _ageDays?: number;
  _ageCategory?: AgeCategory;
  _reasonQuality?: ReasonQuality;
  _sortDate?: number;
}

export interface AnalyticsData {
  topMIDsSame:       MIDEntry[];
  topMIDsDiff:       MIDEntry[];
  topPOS:            POSEntry[];
  repeatCustomers:   CustomerEntry[];
  concernTrend:      TrendEntry[];
  agentMatrix:       Record<string, Record<string, number>>;
}

export interface MIDEntry      { mid: string; count: number; concern?: string; }
export interface POSEntry      { pos: string; count: number; }
export interface CustomerEntry { business: string; count: number; }
export interface TrendEntry    { concern: string; current: number; previous: number; delta: number; }

export interface CallEvent {
  timestamp: string;
  timestampMs?: number;
  eventId: string;
  ticketId: string;
  mid: string;
  business: string;
  customerPhone: string;
  customerPhoneDisplay?: string;
  agentEmail: string;
  agentName: string;
  role?: string;
  eventType: string;
  outcome: string;
  durationSec: number;
  channel?: string;
  provider?: string;
  providerCallId?: string;
  source?: string;
  notes?: string;
  sessionKey?: string;
  verified?: string;
}

/**
 * Backend response from generateMonthlyReport — matches Code.gs:5639 exactly.
 * Returned wrapped in { success, report }.
 */
export interface MonthlyReport {
  title: string;
  generatedAt: string;
  generatedBy: string;
  period: {
    month: number;
    year: number;
    monthName: string;
    startDate: string;
    endDate: string;
    daysInMonth: number;
  };
  summary: {
    totalTickets: number;
    completed: number;
    pending: number;
    closed: number;
    cantDo: number;
    invalidClosed: number;
    avgAgeDays: number;
    completionRate: number;
    resolutionRate: number;
    cantDoRate: number;
    performanceScore: number;
    performanceGrade: 'A+' | 'A' | 'B' | 'C' | 'D';
  };
  agentRankings: AgentRanking[];
  topConcerns: Array<{ concern: string; count: number; percentage: number }>;
  supportTypeBreakdown: Array<{ type: string; count: number; percentage: number }>;
  insights: {
    busiestDay:       { day: string; count: number };
    slowestDay:       { day: string; count: number };
    topPerformer:     { name: string; completed: number; rate: number };
    highestRateAgent: { name: string; rate: number; total: number };
    topConcern:       { name: string; count: number; percentage: number };
    recommendations:  Array<{ priority: string; icon: string; message: string }>;
  };
  dailyDistribution:  Array<{ day: string; count: number }>;
  dailyTrend:         Array<{ day: number; created: number; completed: number }>;
  hourlyDistribution: Array<{ hour: number; label: string; count: number }>;
  peakHour: string;
  concernTrends?:     Array<{ concern: string; current: number; previous: number; trend: 'rising' | 'falling' | 'stable' }>;
  recommendations:    Array<{ priority: string; category: string; icon: string; message: string }>;
  achievements:       Array<{ icon: string; text: string }>;
  tickets: Array<{
    id: string; date: string; agent: string; business: string;
    mid: string; concern: string; supportType: string;
    status: string; reason: string;
  }>;
}

export interface AgentRanking {
  name: string;
  total: number;
  completed: number;
  pending: number;
  closed: number;
  cantDo: number;
  invalidClosed: number;
  withReason: number;
  completionRate: number;
  reasonRate: number;
  score: number;
}

/**
 * Backend audit-log entry from getUpdateHistory — matches Code.gs:5091 exactly.
 */
export interface AuditLogEntry {
  rowNum: number;
  timestamp: string;
  timestampMs: number;
  user: string;
  action: string;
  ticketId: string;
  details: string;        // raw JSON string of details payload
  severity: string;
  sessionId: string;
  version: string;
  previousStatus: string;
  newStatus: string;
  reasonAdded: 'Yes' | 'No';
  duration: string | null;
  durationHours: number | null;
  durationCategory: 'fast' | 'normal' | 'slow' | 'critical' | null;
}

export interface AuditLogResponse {
  success: boolean;
  data: AuditLogEntry[];
  pagination: { page: number; pageSize: number; totalRows: number; totalPages: number };
  durationStats: {
    totalWithDuration: number;
    avgHours: number;
    fastCount: number;
    normalCount: number;
    slowCount: number;
    criticalCount: number;
  };
  message?: string;
  error?: string;
}

export interface DateRange {
  type: DateRangeType;
  start?: number;  // epoch ms local midnight
  end?: number;
}

export interface MasterFilter {
  query:       string;
  agent:       string;
  status:      string;
  supportType: string;
  page:        number;
  pageSize:    number;
}

export interface CreateTicketPayload {
  agentName:    string;
  agentEmail:   string;
  requestedBy:  string;
  mid:          string;
  business:     string;
  pos:          string;
  supportType:  SupportType;
  concern:      string;
  remark:       string;
  phone:        string;
}

export interface AgentStats {
  name:          string;
  email:         string;
  total:         number;
  notCompleted:  number;
  inProgress:    number;
  pending:       number;
  completed:     number;
  closed:        number;
  validClosed:   number;   // closed with valid reason
  cantDo:        number;
  oldPending:    number;   // age >= 7 days
  pendingOld:    number;   // age > 7 days (legacy)
  invalidClosed: number;
  completedDays: number;   // sum of ageDays for completed tickets
  agingCount:    number;
  score:         number;
  rate:          number;   // completion %
  rank:          number;
}

export interface KpiData {
  total:        number;
  notCompleted: number;
  inProgress:   number;
  pending:      number;
  completed:    number;
  closed:       number;
  cantDo:       number;
  agingCount:   number;    // age >= 7d not completed
}

export interface Toast {
  id:      number;
  message: string;
  type:    'success' | 'error' | 'warning' | 'info';
}

export type ModalType = 'createTicket' | 'updateTicket' | 'confirm' | 'ticketAudit' | null;

export interface ModalState {
  type:   ModalType;
  data?:  unknown;
}
