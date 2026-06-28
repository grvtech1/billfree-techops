import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ok,
  requireAuth,
  signAccessToken,
  unauthorized,
  verifyAccessToken,
  type AuthUser,
  type JwtConfig,
  type Role,
} from '@billfree/service-common';
import { verifyGoogleIdToken } from './googleAuth.js';

/** Identity directory abstraction (static map today; an IdP/table in future). */
export interface Directory {
  lookup(email: string): { name: string; role: Role } | null;
  listAll(): Array<{ name: string; email: string; role: Role }>;
}

const TokenRequest = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  // [GAP-01] Google ID token — required in production, optional in dev.
  googleIdToken: z.string().optional(),
});

export interface AuthRoutesDeps {
  jwt: JwtConfig;
  directory: Directory;
  tokenTtlSeconds?: number;
  // [GAP-01] Accepted Google OAuth Client IDs (from GOOGLE_CLIENT_IDS env var).
  googleClientIds?: string[];
  // Whether to enforce Google ID-token verification before issuing a JWT.
  requireGoogleAuth: boolean;
}

/**
 * Register the auth routes (/auth/token, /auth/verify, /auth/agents) on an
 * existing Fastify instance. Extracted from buildServer so the same routes can
 * be mounted standalone (the auth-service) OR composed into the modular monolith.
 */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void {
  // [GAP-01] Issue an access token for an authorized identity.
  // Production: verify the Google ID token first, then authorize against directory.
  // Development: allow bare email login for iteration against mock data.
  app.post('/auth/token', async (req) => {
    const { email, name, googleIdToken } = TokenRequest.parse(req.body);
    const normalizedEmail = email.toLowerCase();

    // ── Production: require Google OAuth verification ────────────────────
    if (deps.requireGoogleAuth) {
      if (!googleIdToken) {
        throw unauthorized('Google ID token is required in production');
      }
      const claims = await verifyGoogleIdToken(
        googleIdToken,
        deps.googleClientIds ?? [],
      ).catch((e) => {
        throw unauthorized(`Google token verification failed: ${(e as Error).message}`);
      });
      // The verified email must match the requested email.
      if (claims.email.toLowerCase() !== normalizedEmail) {
        throw unauthorized('Token email does not match requested email');
      }
    }

    // ── Directory authorization (both prod and dev) ────────────────────
    const found = deps.directory.lookup(normalizedEmail);
    if (!found) throw unauthorized('Email not authorized');
    const user: AuthUser = { sub: normalizedEmail, name: name ?? found.name, role: found.role };
    const token = await signAccessToken(user, deps.jwt, deps.tokenTtlSeconds ?? 3600);
    return ok({ token, user });
  });

  // Validate a bearer token and echo the resolved identity.
  app.get('/auth/verify', async (req) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw unauthorized();
    const user = await verifyAccessToken(token, deps.jwt);
    return ok({ user });
  });

  // [GAP-04] Return the agent directory for the Create Ticket dropdown.
  // Authenticated: the directory contains agent PII (names, emails, roles) and
  // is the enumeration step for any impersonation attack, so it requires a valid
  // bearer token. The SPA calls this after login, not on anonymous bootstrap.
  app.get('/auth/agents', { preHandler: requireAuth(deps.jwt) }, async () => {
    const agents = deps.directory.listAll();
    return ok({ agents, count: agents.length });
  });
}
