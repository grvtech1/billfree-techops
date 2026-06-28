// Library entry for composition into the modular monolith.
export { registerTicketRoutes } from './routes.js';
export { registerIntakeRoutes } from './intake.js';
export {
  PgTicketRepository,
  PgAuditRepository,
  PgAgentRepository,
} from './repository.js';
