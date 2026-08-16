import { UnauthorizedError } from "../lib/errors.js";
import { authenticateAccessToken } from "../services/authService.js";

/**
 * Pulls the token out of `Authorization: Bearer <token>`.
 *
 * The scheme comparison is case-insensitive because RFC 7235 says it is, and
 * real clients send "bearer" — rejecting those produces a 401 that looks like a
 * bad token and costs an hour to debug.
 */
function readBearerToken(req) {
  const header = req.get("authorization");
  if (!header) return null;

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme.toLowerCase() !== "bearer" || rest.length !== 1) return null;
  return rest[0] || null;
}

/**
 * Gate for protected routes. On success attaches `req.auth`:
 *   { userId, username, sessionId }
 *
 * Every failure is a 401 with a distinct code so the frontend knows what to do:
 *   missing_token / invalid_token  -> send the user to login
 *   token_expired                  -> try POST /api/auth/refresh first
 *   session_revoked                -> clear stored tokens, send to login
 */
export async function requireAuth(req, res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) {
      throw new UnauthorizedError(
        "missing_token",
        "Authorization: Bearer <token> header is required."
      );
    }
    req.auth = await authenticateAccessToken(token);
    next();
  } catch (err) {
    next(err);
  }
}
