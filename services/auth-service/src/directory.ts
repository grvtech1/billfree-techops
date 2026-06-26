import type { Role } from '@billfree/service-common';
import type { Directory } from './server.js';

/**
 * Static identity directory for the showcase. In production this would be a
 * table/IdP lookup; here it maps known BillFree emails to roles (RBAC source).
 */
const USERS: Record<string, { name: string; role: Role }> = {
  'admin@billfree.in': { name: 'Admin', role: 'admin' },
  'manager@billfree.in': { name: 'Ops Manager', role: 'manager' },
  'agent1@billfree.in': { name: 'Agent One', role: 'agent' },
  'agent2@billfree.in': { name: 'Agent Two', role: 'agent' },
  'viewer@billfree.in': { name: 'Viewer', role: 'viewer' },
};

export const staticDirectory: Directory = {
  lookup: (email) => USERS[email] ?? null,
  listAll: () =>
    Object.entries(USERS).map(([email, info]) => ({
      name: info.name,
      email,
      role: info.role,
    })),
};
