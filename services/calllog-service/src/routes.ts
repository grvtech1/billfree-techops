import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ok, requireAuth, requireApiKey, unauthorized, type JwtConfig, type Role } from '@billfree/service-common';
import {
  CreateCallEventSchema,
  ListCallQuerySchema,
  generateCallEventId,
} from './domain.js';
import { newCallEvent, type CallEventRepository, type ListScope } from './repository.js';
import { normalizeProviderOutcome, normalizePhone, sanitize } from './cdrNormalize.js';

const WRITER_ROLES: Role[] = ['admin', 'manager', 'agent'];
const MANAGER_ROLES = new Set<Role>(['admin', 'manager']);

export function registerCallLogRoutes(
  app: FastifyInstance,
  deps: { repo: CallEventRepository; jwt: JwtConfig; intakeApiKey?: string; ticketServiceUrl?: string },
): void {
  const { repo, jwt } = deps;

  // List call events (paginated, filterable). Managers/admins see everything;
  // everyone else is scoped to their own calls — mirrors the legacy GAS rule.
  app.get('/calls', { preHandler: requireAuth(jwt) }, async (req) => {
    const user = req.user;
    if (!user) throw unauthorized();
    const q = ListCallQuerySchema.parse(req.query);
    const scope: ListScope = MANAGER_ROLES.has(user.role) ? {} : { ownerEmail: user.sub };
    const { rows, total } = await repo.list(q, scope);
    return ok(rows, { total, page: q.page, limit: q.pageSize });
  });

  // Log a call event — writer roles only. The actor's identity (name, role) is
  // taken from the verified JWT; non-managers may only log under their own email.
  app.post('/calls', { preHandler: requireAuth(jwt, WRITER_ROLES) }, async (req, reply) => {
    const user = req.user;
    if (!user) throw unauthorized();
    const input = CreateCallEventSchema.parse(req.body);
    const agentEmail = MANAGER_ROLES.has(user.role) ? input.agentEmail : user.sub;

    // [GAP-17] Auto-enrich from ticket when ticketId is provided but mid/business/phone
    // are missing. Mirrors GAS CallLog.gs logCallEvent() L325-328. Best-effort — if the
    // ticket lookup fails we still log the event with whatever the client sent.
    let enrichedInput = { ...input, agentEmail };
    if (input.ticketId && deps.ticketServiceUrl && (!input.mid || !input.business)) {
      try {
        const authHeader = req.headers.authorization ?? '';
        const tRes = await fetch(
          `${deps.ticketServiceUrl}/tickets/${encodeURIComponent(input.ticketId)}`,
          { headers: { authorization: authHeader } },
        );
        if (tRes.ok) {
          const ticket = ((await tRes.json()) as { data?: Record<string, string> }).data;
          if (ticket) {
            enrichedInput = {
              ...enrichedInput,
              mid: enrichedInput.mid || ticket.mid || null,
              business: enrichedInput.business || ticket.business || null,
              customerPhone: enrichedInput.customerPhone || ticket.phone || null,
            };
          }
        }
      } catch {
        /* best-effort — enrichment failure is non-fatal */
      }
    }

    const id = generateCallEventId(new Date(), () => randomUUID().replace(/-/g, ''));
    const created = await repo.create(
      newCallEvent(
        id,
        new Date().toISOString(),
        enrichedInput,
        { agentName: user.name || null, role: user.role },
      ),
    );
    reply.code(201);
    return ok(created);
  });

  // ── [GAP-06] CDR Webhook — external telephony provider ingest ─────────────
  // Mirrors GAS CallLog.gs ingestProviderCdrEvent_(). API-key authenticated (not
  // JWT) so external webhooks (Exotel, Knowlarity, etc.) can push CDR events.
  // Deduplication is handled by the DB's unique constraint on (provider, provider_call_id).
  if (deps.intakeApiKey) {
    app.post(
      '/calls/webhook',
      { preHandler: requireApiKey(deps.intakeApiKey) },
      async (req, reply) => {
        const p = (req.body ?? {}) as Record<string, unknown>;
        const providerCallId = sanitize(
          p.providerCallId ?? p.callId ?? p.call_id ?? p.sid ?? p.uuid,
          120,
        );
        if (!providerCallId) {
          return ok({ success: false, error: 'Missing provider call ID in webhook payload' });
        }

        const provider = sanitize(
          p.provider ?? p.vendor ?? p.gateway ?? 'UNKNOWN',
          50,
        ).toUpperCase();
        const outcome = normalizeProviderOutcome(
          sanitize(p.outcome, 50),
          sanitize(p.status ?? p.callStatus ?? p.disposition, 50),
        );
        const durationSec = Math.max(0, parseInt(String(p.durationSec ?? p.duration ?? p.billsec ?? p.talkTime ?? p.talk_time ?? 0), 10) || 0);

        const id = generateCallEventId(new Date(), () => randomUUID().replace(/-/g, ''));
        const event = newCallEvent(
          id,
          new Date().toISOString(),
          {
            agentEmail: sanitize(p.agentEmail ?? p.agent_email ?? 'provider.webhook@system.local', 255) || 'provider.webhook@system.local',
            agentName: sanitize(p.agentName ?? p.agent ?? 'Provider Webhook', 100) || null,
            eventType: 'PROVIDER_CDR',
            outcome: outcome as 'CONNECTED',
            durationSec,
            ticketId: sanitize(p.ticketId ?? p.ticket_id ?? p.referenceId, 100) || null,
            mid: sanitize(p.mid ?? p.merchantId ?? p.merchant_id, 50) || null,
            business: sanitize(p.business ?? p.businessName ?? p.customerName, 200) || null,
            customerPhone: normalizePhone(String(p.customerPhone ?? p.phone ?? p.to ?? p.customer_number ?? '')),
            channel: (sanitize(p.channel, 50) || 'PROVIDER_CDR').toUpperCase(),
            provider,
            providerCallId,
            source: 'PROVIDER_WEBHOOK',
            notes: sanitize(p.notes ?? p.note ?? '', 1000) || null,
          },
          { agentName: 'Provider Webhook', role: 'system' },
        );
        // Mark as verified (provider-sourced events are pre-verified).
        const verified = { ...event, verified: true };

        const created = await repo.create(verified);
        // If the DB's unique constraint blocked the insert, it's a duplicate.
        const isDuplicate = created.eventId !== id;
        reply.code(isDuplicate ? 200 : 201);
        return ok({
          success: true,
          duplicate: isDuplicate,
          eventId: isDuplicate ? undefined : id,
          provider,
          providerCallId,
          outcome,
        });
      },
    );
  }
}
