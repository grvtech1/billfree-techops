/**
 * [GAP-01] Google ID-token verification — ported from GAS Auth.gs verifyIdToken_().
 *
 * In production, the auth-service MUST verify Google OAuth credentials before
 * issuing internal JWTs. This module validates ID tokens against Google's public
 * tokeninfo endpoint, checking audience, issuer, email verification, and expiry.
 *
 * In development (NODE_ENV !== 'production'), verification is optional so devs
 * can iterate against mock data without a real Google OAuth flow.
 */

const TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

const VALID_ISSUERS = new Set([
  'accounts.google.com',
  'https://accounts.google.com',
]);

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
 * @throws Error if the token is invalid, expired, or from an untrusted issuer.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  allowedClientIds: string[],
): Promise<GoogleTokenClaims> {
  if (!idToken) throw new Error('No Google ID token provided');

  const res = await fetch(`${TOKEN_INFO_URL}?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google tokeninfo returned ${res.status}: ${body.slice(0, 200)}`);
  }

  const claims = (await res.json()) as Record<string, string>;

  // Audience check — must match one of our registered Client IDs.
  if (allowedClientIds.length > 0 && !allowedClientIds.includes(claims.aud ?? '')) {
    throw new Error(`Token audience '${claims.aud}' not in allowed client IDs`);
  }

  // Issuer check
  if (!VALID_ISSUERS.has(claims.iss ?? '')) {
    throw new Error(`Token issuer '${claims.iss}' is not a trusted Google issuer`);
  }

  // Email verification
  if (claims.email_verified !== 'true') {
    throw new Error('Google email is not verified');
  }

  // Expiry check (tokeninfo returns `exp` as a Unix timestamp string)
  const exp = parseInt(claims.exp ?? '0', 10);
  if (exp > 0 && exp * 1000 < Date.now()) {
    throw new Error('Google ID token has expired');
  }

  return {
    email: claims.email ?? '',
    name: claims.name ?? claims.email ?? '',
    picture: claims.picture,
    email_verified: true,
  };
}
