import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { forbidden, unauthorized } from './errors.js';

export type Role = 'admin' | 'manager' | 'agent' | 'viewer';

export interface AuthUser {
  sub: string; // email
  name: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export interface JwtConfig {
  secret: string;
  issuer: string;
}

/**
 * Name of the httpOnly cookie that carries the access token. Using a cookie
 * (not a JS-readable store) is what keeps the token out of reach of XSS.
 */
export const ACCESS_TOKEN_COOKIE = 'bt_token';

/**
 * Extract the bearer token from a request: the `Authorization: Bearer` header
 * (machine clients, tests) OR the httpOnly `bt_token` cookie (browser SPA). The
 * cookie is parsed straight off the raw header so this works on any service
 * without registering a cookie plugin.
 */
export function extractToken(req: FastifyRequest): string {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) {
    const t = header.slice(7).trim();
    if (t) return t;
  }
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      if (key === ACCESS_TOKEN_COOKIE) {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
  }
  return '';
}

const enc = (s: string) => new TextEncoder().encode(s);

/** Mint a short-lived access token (used by auth-service / tests). */
export async function signAccessToken(
  user: AuthUser,
  cfg: JwtConfig,
  ttlSeconds = 3600,
): Promise<string> {
  return new SignJWT({ name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.sub)
    .setIssuer(cfg.issuer)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(enc(cfg.secret));
}

/** Verify a bearer token and return the user, or throw AppError(401). */
export async function verifyAccessToken(token: string, cfg: JwtConfig): Promise<AuthUser> {
  try {
    const { payload } = await jwtVerify(token, enc(cfg.secret), { issuer: cfg.issuer });
    return { sub: String(payload.sub), name: String(payload.name ?? ''), role: payload.role as Role };
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

/**
 * Fastify preHandler that authenticates the request (Bearer token) and, if
 * `roles` is given, authorizes the user's role. Attaches `req.user`.
 */
export function requireAuth(cfg: JwtConfig, roles?: Role[]): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = extractToken(req);
    if (!token) throw unauthorized();
    const user = await verifyAccessToken(token, cfg);
    if (roles && roles.length > 0 && !roles.includes(user.role)) throw forbidden();
    req.user = user;
  };
}

/** Constant-time string compare — avoids leaking the key via timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Fastify preHandler for machine-to-machine callers (e.g. the WhatsApp chatbot)
 * that authenticate with a shared API key in a header instead of a user JWT.
 * Distinct from `requireAuth` because there is no user/role — just a trusted
 * integration. Compared in constant time.
 */
export function requireApiKey(expectedKey: string, headerName = 'x-api-key'): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const raw = req.headers[headerName];
    const provided = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
    if (!expectedKey || !safeEqual(provided, expectedKey)) throw unauthorized('Invalid API key');
  };
}
