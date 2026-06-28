import type { FastifyInstance, FastifyReply } from 'fastify';
import '@fastify/cookie'; // augments FastifyReply with setCookie/clearCookie
import { z } from 'zod';
import {
  ACCESS_TOKEN_COOKIE,
  extractToken,
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
  // httpOnly session-cookie attributes. `secure` should be true in production
  // (HTTPS). `sameSite` defaults to 'lax' — same-origin SPA + CSRF protection
  // (Lax blocks cross-site POST). Use 'none' (with secure) for a cross-origin
  // SPA such as the Cloudflare Pages deployment.
  cookieSecure?: boolean;
  cookieSameSite?: 'lax' | 'strict' | 'none';
}

/**
 * Register the auth routes on an existing Fastify instance. The instance MUST
 * have @fastify/cookie registered (buildServer / buildMonolith do this) so the
 * access token can be issued as an httpOnly cookie instead of being handled by
 * JavaScript — the cookie is unreadable by XSS.
 */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void {
  const ttl = deps.tokenTtlSeconds ?? 3600;

  const setSessionCookie = (reply: FastifyReply, token: string) => {
    reply.setCookie(ACCESS_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: deps.cookieSecure ?? false,
      sameSite: deps.cookieSameSite ?? 'lax',
      path: '/',
      maxAge: ttl, // seconds
    });
  };

  // [GAP-01] Issue an access token for an authorized identity.
  // The token is delivered ONLY as an httpOnly cookie — never in the response
  // body — so client JS (and therefore XSS) can't read it. The body carries the
  // non-sensitive user profile for the UI.
  app.post('/auth/token', async (req, reply) => {
    const { email, name, googleIdToken } = TokenRequest.parse(req.body);
    const normalizedEmail = email.toLowerCase();

    if (deps.requireGoogleAuth) {
      if (!googleIdToken) {
        throw unauthorized('Google ID token is required in production');
      }
      const claims = await verifyGoogleIdToken(googleIdToken, deps.googleClientIds ?? []).catch((e) => {
        throw unauthorized(`Google token verification failed: ${(e as Error).message}`);
      });
      if (claims.email.toLowerCase() !== normalizedEmail) {
        throw unauthorized('Token email does not match requested email');
      }
    }

    const found = deps.directory.lookup(normalizedEmail);
    if (!found) throw unauthorized('Email not authorized');
    const user: AuthUser = { sub: normalizedEmail, name: name ?? found.name, role: found.role };
    const token = await signAccessToken(user, deps.jwt, ttl);
    setSessionCookie(reply, token);
    return ok({ user });
  });

  // Validate the session (cookie or bearer) and echo the resolved identity.
  // The SPA calls this on load to restore a session without ever touching the token.
  app.get('/auth/verify', async (req) => {
    const token = extractToken(req);
    if (!token) throw unauthorized();
    const user = await verifyAccessToken(token, deps.jwt);
    return ok({ user });
  });

  // Clear the session cookie. Idempotent — safe to call when not logged in.
  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    return ok({ ok: true });
  });

  // [GAP-04] Agent directory for the Create Ticket dropdown — authenticated
  // (agent PII; the enumeration step for impersonation). The SPA calls it after
  // login, with the session cookie sent automatically.
  app.get('/auth/agents', { preHandler: requireAuth(deps.jwt) }, async () => {
    const agents = deps.directory.listAll();
    return ok({ agents, count: agents.length });
  });
}
