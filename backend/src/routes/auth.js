import { Router } from "express";
import {
  validateCredentials,
  validateNewPassword,
  validateNewUsername,
  validateRefreshToken,
  validateRole,
} from "../lib/validate.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
} from "../services/authService.js";
import { findUserById, publicUser } from "../providers/users.js";
import { UnauthorizedError } from "../lib/errors.js";

export const authRouter = Router();

// All four token-issuing routes are unauthenticated by necessity — you cannot
// require a token from someone asking for their first one. They are the app's
// only public attack surface, which is why validate.js types every field before
// it reaches Mongo.

/**
 * POST /api/auth/register  body: { username, password, role }
 * -> 201 { accessToken, refreshToken, tokenType, expiresIn, expiresAt, user }
 *
 * `role` is "tenant" or "landlord", required — see validateRole for why there
 * is no default.
 *
 * Returns a live session, not just "created": a client that registers is
 * logged in, with no second round trip.
 */
authRouter.post("/api/auth/register", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const username = validateNewUsername(body.username);
    const password = validateNewPassword(body.password);
    const role = validateRole(body.role);
    res.status(201).json(await registerUser({ username, password, role }));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login  body: { username, password }
 * -> 200 { accessToken, refreshToken, tokenType, expiresIn, expiresAt, user }
 *
 * 401 `invalid_credentials` covers both a wrong password and an unknown user,
 * on purpose (see authService.loginUser).
 */
authRouter.post("/api/auth/login", async (req, res, next) => {
  try {
    const { username, password } = validateCredentials(req.body ?? {});
    res.json(await loginUser({ username, password }));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/refresh  body: { refreshToken }
 * -> 200 { accessToken, refreshToken, ... }
 *
 * Takes the refresh token in the BODY, not the Authorization header: the
 * expired access token is what the client still holds in that header, and
 * refresh must work precisely when that token is dead.
 *
 * The returned refreshToken is NEW and the submitted one is now dead — the
 * client has to store the new one or its next refresh fails.
 */
authRouter.post("/api/auth/refresh", async (req, res, next) => {
  try {
    const refreshToken = validateRefreshToken((req.body ?? {}).refreshToken);
    res.json(await refreshSession({ refreshToken }));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/logout   (requires a valid access token)
 * -> 200 { ended: boolean }
 *
 * Deletes the session, so the caller's access token AND refresh token both stop
 * working immediately rather than at their natural expiry.
 *
 * Requiring a valid token here means an expired-but-not-logged-out client
 * cannot clean up server-side; it should refresh first. The alternative —
 * accepting an unverified token — would let anyone terminate a session they
 * merely observed.
 */
authRouter.post("/api/auth/logout", requireAuth, async (req, res, next) => {
  try {
    res.json(await logoutSession({ sessionId: req.auth.sessionId }));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me   (requires a valid access token)
 * -> 200 { user }
 *
 * Lets the frontend answer "is my stored token still good?" on page load
 * without guessing from a data endpoint's failure.
 */
authRouter.get("/api/auth/me", requireAuth, async (req, res, next) => {
  try {
    const user = await findUserById(req.auth.userId);
    if (!user) {
      // The session outlived the account. Thrown rather than sent directly, so
      // it picks up the WWW-Authenticate header and the `details` field that
      // every other 401 in this API carries.
      throw new UnauthorizedError(
        "session_revoked",
        "This session has ended; log in again."
      );
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});
