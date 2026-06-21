import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ok,
  registerErrorHandler,
  registerHealth,
  registerMetrics,
  signAccessToken,
  unauthorized,
  verifyAccessToken,
  type AuthUser,
  type JwtConfig,
  type Role,
} from '@billfree/service-common';

export interface Directory {
  lookup(email: string): { name: string; role: Role } | null;
}

const TokenRequest = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
});

export interface AuthServerDeps {
  jwt: JwtConfig;
  directory: Directory;
  tokenTtlSeconds?: number;
  logger?: FastifyBaseLogger | boolean;
}

export function buildServer(deps: AuthServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  registerErrorHandler(app);
  registerMetrics(app, 'auth-service');
  registerHealth(app);

  // Issue an access token for an authorized identity. In production this would
  // verify a Google ID token; for the showcase we authorize against the
  // directory and mint the same JWT the gateway + services validate.
  app.post('/auth/token', async (req) => {
    const { email, name } = TokenRequest.parse(req.body);
    const found = deps.directory.lookup(email.toLowerCase());
    if (!found) throw unauthorized('Email not authorized');
    const user: AuthUser = { sub: email.toLowerCase(), name: name ?? found.name, role: found.role };
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

  return app;
}
