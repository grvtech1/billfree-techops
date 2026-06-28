/**
 * [GAP-01] Google ID-token verification — production-grade.
 *
 * The auth-service MUST verify Google OAuth credentials before issuing internal
 * JWTs. This module validates ID tokens **locally** against Google's published
 * JWKS (JSON Web Key Set) using `jose`, checking signature, audience, issuer,
 * email verification, and expiry.
 *
 * Why JWKS, not the tokeninfo endpoint: Google documents
 * `https://oauth2.googleapis.com/tokeninfo` as a debugging aid that is NOT
 * SLA-backed for production traffic — it adds a network round-trip per login,
 * is a single point of failure, and can rate-limit you. `createRemoteJWKSet`
 * fetches and caches Google's signing keys and verifies the RS256 signature
 * offline, which is the approach Google's own client libraries use.
 *
 * Fail-closed: if no allowed client IDs are configured, every token is rejected.
 * An empty allow-list previously skipped the audience check entirely, which
 * meant a Google token minted for *any* application would have been accepted.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

// Google's OpenID Connect signing keys. `createRemoteJWKSet` caches the keys
// and respects the cache-control headers Google sets, refetching only when a
// previously-unseen `kid` appears. One shared instance per process.
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

// Accepted `iss` values per Google's OIDC discovery document.
const VALID_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export interface GoogleTokenClaims {
  email: string;
  name: string;
  picture?: string;
  email_verified: boolean;
}

/**
 * Verify a Google ID token and return the claims.
 * @param idToken  The Google-issued ID token (from Google Sign-In / GSI).
 * @param allowedClientIds  Accepted `aud` values (your Google OAuth Client IDs).
 *                          MUST be non-empty — an empty list rejects all tokens.
 * @throws Error if the token is invalid, expired, mis-audienced, or untrusted.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  allowedClientIds: string[],
): Promise<GoogleTokenClaims> {
  if (!idToken) throw new Error('No Google ID token provided');

  // Fail-closed: refuse to verify if we have no audience to check against.
  if (allowedClientIds.length === 0) {
    throw new Error(
      'No Google client IDs configured (GOOGLE_CLIENT_IDS); refusing to verify token',
    );
  }

  // Verifies RS256 signature against Google's JWKS, plus issuer/audience/expiry
  // in one step. `jose` throws on any failure (bad signature, expired, wrong
  // aud/iss) — no token is trusted unless every check passes.
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
      issuer: VALID_ISSUERS,
      audience: allowedClientIds,
      // Google ID tokens are RS256.
      algorithms: ['RS256'],
    }));
  } catch (e) {
    throw new Error(`Google token verification failed: ${(e as Error).message}`);
  }

  const email = typeof payload.email === 'string' ? payload.email : '';
  if (!email) throw new Error('Google token has no email claim');

  // Google sets email_verified as a boolean in the ID token (string only on the
  // legacy tokeninfo endpoint). Accept either to be safe.
  const emailVerified =
    payload.email_verified === true || payload.email_verified === 'true';
  if (!emailVerified) throw new Error('Google email is not verified');

  const name = typeof payload.name === 'string' ? payload.name : email;
  const picture = typeof payload.picture === 'string' ? payload.picture : undefined;

  return { email, name, picture, email_verified: true };
}
