import { createHash, randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  ACCESS_TOKEN_TYPE,
  JWT_ALGORITHM,
  JWT_ISSUER,
  REFRESH_TOKEN_BYTES,
} from "../config/constants.js";

// Token minting and verification. Two different kinds of token, deliberately:
//
//   ACCESS  — a signed JWT. Stateless to verify, carries the user identity, and
//             is what every protected route reads.
//   REFRESH — an opaque random string, never a JWT. There is nothing for a
//             client to read in it, and the only copy we keep is a SHA-256
//             hash, so a database leak does not hand out working sessions.
//
// Both are tied to one `sid` (session id) so a single logout kills the pair.

/**
 * The signing secret, read at call time rather than import time so tests and
 * scripts can set it after the module graph is loaded.
 *
 * Throws when unset. This is the one piece of config with no safe default: a
 * fallback secret would mean anyone holding the source could mint valid tokens
 * for a deployment, which is worse than failing to boot.
 *
 * Deliberately NOT exported — nothing outside this module has a reason to read
 * the raw secret, and the narrower that surface stays, the fewer places it can
 * be logged or leaked from.
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    const err = new Error(
      "JWT_SECRET must be set to at least 32 characters. " +
        "Generate one with: node -e \"console.log(require('node:crypto').randomBytes(48).toString('base64url'))\""
    );
    err.name = "AuthConfigError";
    throw err;
  }
  return secret;
}

/** Whether auth can operate at all. Used to fail loudly at boot, not at 3am. */
export function isJwtConfigured() {
  try {
    getJwtSecret();
    return true;
  } catch {
    return false;
  }
}

/** A fresh session id, shared by an access token and its refresh token. */
export function newSessionId() {
  return randomUUID();
}

/**
 * Signs an access token for one user + session.
 *
 * @returns {{token: string, expiresAt: Date, expiresInSeconds: number}}
 */
export function signAccessToken({ userId, username, role, sessionId }) {
  const expiresInSeconds = ACCESS_TOKEN_TTL_SECONDS;
  const token = jwt.sign(
    // `role` rides in the token so a future role check costs no extra lookup.
    // The trade: a role changed in the database is not reflected until the
    // token is refreshed. Fine while nothing branches on it; revisit before
    // anything does, because a demoted landlord would keep landlord access for
    // up to 7 days.
    { username, role, sid: sessionId, type: ACCESS_TOKEN_TYPE },
    getJwtSecret(),
    {
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      subject: String(userId),
      expiresIn: expiresInSeconds,
    }
  );
  return {
    token,
    expiresInSeconds,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  };
}

/**
 * Verifies signature, expiry, issuer, and token type.
 *
 * `algorithms` is pinned on purpose: without it a token whose header says
 * `alg: none` — or HS256 forged against a public key in an RS256 setup — is
 * accepted by the verifier. This is the single most common JWT vulnerability.
 *
 * @returns {{userId: string, username: string, role: string|null, sessionId: string}}
 * @throws  {Error} with `name: "TokenError"` on any invalid token
 */
export function verifyAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret(), {
      algorithms: [JWT_ALGORITHM],
      issuer: JWT_ISSUER,
    });
  } catch (err) {
    // jsonwebtoken's own messages ("jwt expired", "invalid signature") are
    // useful to us and harmless to the client, but the distinction that
    // matters downstream is expired-vs-not, so it is preserved as a flag.
    const wrapped = new Error(err.message);
    wrapped.name = "TokenError";
    wrapped.expired = err.name === "TokenExpiredError";
    throw wrapped;
  }

  // A refresh token is opaque and can never reach here, but if this codebase
  // ever signs a second JWT kind with the same secret, this stops it being
  // replayed as an access token.
  if (payload.type !== ACCESS_TOKEN_TYPE || !payload.sub || !payload.sid) {
    const err = new Error("malformed token payload");
    err.name = "TokenError";
    throw err;
  }

  return {
    userId: payload.sub,
    username: payload.username,
    role: payload.role ?? null,
    sessionId: payload.sid,
  };
}

/** A new opaque refresh token. Returned to the client exactly once. */
export function generateRefreshToken() {
  return randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
}

/**
 * The only form of a refresh token we ever persist.
 *
 * Plain SHA-256 with no salt, unlike passwords: the input is 256 bits of
 * uniform randomness we generated ourselves, so there is no dictionary to
 * attack and nothing for a slow KDF to buy. It also has to be deterministic —
 * lookup is by hash equality.
 */
export function hashRefreshToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
