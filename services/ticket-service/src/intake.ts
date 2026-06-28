import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { notFound, requireApiKey } from '@billfree/service-common';
import {
  IntakeTicketSchema,
  agentDisplayName,
  generateTicketId,
  newIntakeTicket,
  phoneMatches,
  toPublicStatus,
} from './domain.js';
import type { AgentRepository, AuditRepository, TicketRepository } from './repository.js';

/**
 * External-channel intake — used by the WhatsApp AI chatbot (a machine client,
 * authenticated with a shared API key, NOT a user JWT). A customer or
 * cross-functional teammate supplies a few fields; we create a ticket, auto-assign
 * it to the least-loaded agent, and let them poll its status with the returned
 * reference + their phone number.
 */
export function registerIntakeRoutes(
  app: FastifyInstance,
  deps: { repo: TicketRepository; agents: AgentRepository; audit: AuditRepository; apiKey: string },
): void {
  // `audit` remains in deps for the registration contract; creation auditing is
  // now atomic via repo.createWithAudit, so it is not used directly here.
  const { repo, agents, apiKey } = deps;
  const guard = requireApiKey(apiKey);

  // Create a ticket from the chatbot. Defaults: status "Not Completed",
  // source "whatsapp", auto-assigned. Returns the reference + assignee name.
  app.post('/intake/tickets', { preHandler: guard }, async (req, reply) => {
    const input = IntakeTicketSchema.parse(req.body);
    const assignee = await agents.pickAssignee();
    const id = generateTicketId(new Date(), () => randomUUID().replace(/-/g, ''));
    const ticket = newIntakeTicket(id, new Date().toISOString(), input, assignee ?? '');
    // Atomic create + creation audit, same as the dashboard create path.
    const created = await repo.createWithAudit(ticket, {
      ticketId: id,
      actor: 'whatsapp-bot',
      action: 'TICKET_CREATED',
      newStatus: ticket.status,
    });
    if (!assignee) app.log.warn({ ticketId: id }, 'no active agent available — ticket created unassigned');

    reply.code(201);
    return {
      success: true,
      ticketId: id,
      status: created.status,
      assignedAgent: assignee ? agentDisplayName(assignee) : 'Unassigned',
      channel: 'whatsapp',
      message: `Ticket ${id} created. Reply with this reference to check its status.`,
    };
  });

  // Status lookup for the customer/teammate. Requires the ticket reference AND a
  // matching phone — so one customer can't read another's ticket by guessing ids.
  app.get('/intake/tickets/:id/status', { preHandler: guard }, async (req) => {
    const { id } = req.params as { id: string };
    const { phone } = req.query as { phone?: string };
    const ticket = await repo.getById(id);
    // Same response for "not found" and "phone mismatch" — don't leak existence.
    if (!ticket || !phone || !phoneMatches(ticket.phone, phone)) {
      throw notFound('No ticket matches that reference and phone number');
    }
    return { success: true, data: toPublicStatus(ticket) };
  });
}
