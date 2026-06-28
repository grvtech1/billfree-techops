import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  ok,
  notFound,
  requireAuth,
  unauthorized,
  forbidden,
  validationFailed,
  type JwtConfig,
} from '@billfree/service-common';
import {
  CreateTicketSchema,
  ListQuerySchema,
  UpdateTicketSchema,
  appendReason,
  computeDurationStats,
  generateTicketId,
  toAuditEntryView,
  type NewAuditEvent,
} from './domain.js';
import { newTicket, type AuditRepository, type TicketRepository } from './repository.js';

export function registerTicketRoutes(
  app: FastifyInstance,
  deps: { repo: TicketRepository; audit: AuditRepository; jwt: JwtConfig },
): void {
  const { repo, audit, jwt } = deps;
  const WRITER_ROLES = ['admin', 'manager', 'agent'] as const;

  // Best-effort audit write — never let an audit failure break the user's action
  // (mirrors the legacy GAS "fire-and-forget, non-critical" audit semantics).
  const recordAudit = async (e: NewAuditEvent): Promise<void> => {
    try {
      await audit.record(e);
    } catch (err) {
      app.log.warn({ err, ticketId: e.ticketId }, 'audit record failed (non-fatal)');
    }
  };

  // List (paginated, filterable) — any authenticated user.
  app.get('/tickets', { preHandler: requireAuth(jwt) }, async (req) => {
    const q = ListQuerySchema.parse(req.query);
    const { rows, total } = await repo.list(q);
    return ok(rows, { total, page: q.page, limit: q.pageSize });
  });

  // Get one.
  app.get('/tickets/:id', { preHandler: requireAuth(jwt) }, async (req) => {
    const { id } = req.params as { id: string };
    const t = await repo.getById(id);
    if (!t) throw notFound(`Ticket ${id} not found`);
    return ok(t);
  });

  // Per-ticket audit trail — the dashboard's drill-down modal.
  app.get('/tickets/:id/history', { preHandler: requireAuth(jwt) }, async (req) => {
    const { id } = req.params as { id: string };
    const { page = '1', pageSize = '20' } = req.query as { page?: string; pageSize?: string };
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 20));
    const { rows, total } = await audit.listByTicket(id, p, ps);
    const entries = rows.map(toAuditEntryView);
    return {
      success: true,
      data: entries,
      pagination: { page: p, pageSize: ps, totalRows: total, totalPages: Math.ceil(total / ps) },
      durationStats: computeDurationStats(entries),
    };
  });

  // Create — writer roles only.
  app.post('/tickets', { preHandler: requireAuth(jwt, [...WRITER_ROLES]) }, async (req, reply) => {
    const input = CreateTicketSchema.parse(req.body);
    const id = generateTicketId(new Date(), () => randomUUID().replace(/-/g, ''));
    const ticket = newTicket(id, new Date().toISOString(), input);
    // Atomic: the ticket and its TICKET_CREATED audit commit together, so a
    // ticket can never exist without its creation record.
    const created = await repo.createWithAudit(ticket, {
      ticketId: id,
      actor: req.user?.sub ?? input.agentEmail,
      action: 'TICKET_CREATED',
      newStatus: ticket.status,
    });
    reply.code(201);
    return ok(created);
  });

  // Update status and/or append a follow-up reason — writer roles only.
  app.patch('/tickets/:id', { preHandler: requireAuth(jwt, [...WRITER_ROLES]) }, async (req) => {
    const user = req.user;
    if (!user) throw unauthorized();
    const { id } = req.params as { id: string };
    const body = UpdateTicketSchema.parse(req.body);
    const current = await repo.getById(id);
    if (!current) throw notFound(`Ticket ${id} not found`);

    const patch: { status?: string; reason?: string; pos?: string } = {};

    // ── [GAP-05] Closure authority enforcement (mirrors GAS updateTicketFull) ──
    // Only admins may set status to 'Closed', and a follow-up reason of at least
    // 5 characters is mandatory. This replicates the GAS guard exactly.
    if (body.status === 'Closed') {
      if (user.role !== 'admin') {
        await recordAudit({
          ticketId: id,
          actor: user.sub,
          action: 'CLOSE_ATTEMPT_DENIED',
          previousStatus: current.status,
          newStatus: 'Closed',
          severity: 'WARNING',
        });
        throw forbidden('Only admin can close tickets');
      }
      if (!body.appendReason || body.appendReason.trim().length < 5) {
        throw validationFailed('Closure requires a follow-up reason (min 5 characters)');
      }
    }

    if (body.status) patch.status = body.status;
    if (body.pos) patch.pos = body.pos;
    if (body.appendReason) {
      patch.reason = appendReason(current.reason, body.appendReason, new Date().toISOString());
    }
    const updated = await repo.update(id, patch);

    // Resolution time = creation → this change; only meaningful on a status change.
    const statusChanged = body.status !== undefined && body.status !== current.status;
    const durationMs = statusChanged
      ? Math.max(0, Date.now() - (Date.parse(current.createdAt) || Date.now()))
      : null;
    await recordAudit({
      ticketId: id,
      actor: user.sub,
      action: 'TICKET_UPDATED',
      previousStatus: current.status,
      newStatus: updated?.status ?? current.status,
      reasonAdded: Boolean(body.appendReason),
      durationMs,
    });
    return ok(updated);
  });

  // [GAP-20] Version counter — the SPA polls this to detect mutations and trigger
  // refetches (mirrors GAS DATA_VERSION in ScriptProperties). Returns the newest
  // ticket timestamp as epoch-ms so polling detects any INSERT/UPDATE.
  app.get('/tickets/version', { preHandler: requireAuth(jwt) }, async () => {
    const res = await repo.latestVersion();
    return ok({ version: res });
  });
}
