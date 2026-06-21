import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ok, requireAuth, unauthorized, type JwtConfig, type Role } from '@billfree/service-common';
import {
  CreateCallEventSchema,
  ListCallQuerySchema,
  generateCallEventId,
} from './domain.js';
import { newCallEvent, type CallEventRepository, type ListScope } from './repository.js';

const WRITER_ROLES: Role[] = ['admin', 'manager', 'agent'];
const MANAGER_ROLES = new Set<Role>(['admin', 'manager']);

export function registerCallLogRoutes(
  app: FastifyInstance,
  deps: { repo: CallEventRepository; jwt: JwtConfig },
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

    const id = generateCallEventId(new Date(), () => randomUUID().replace(/-/g, ''));
    const created = await repo.create(
      newCallEvent(
        id,
        new Date().toISOString(),
        { ...input, agentEmail },
        { agentName: user.name || null, role: user.role },
      ),
    );
    reply.code(201);
    return ok(created);
  });
}
