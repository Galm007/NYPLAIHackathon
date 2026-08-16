import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { ConflictError, UnauthorizedError } from "../lib/errors.js";
import {
  generateRefreshToken,
  newSessionId,
  signAccessToken,
  verifyAccessToken,
} from "../lib/tokens.js";
import {
  findUserById,
  findUserByUsername,
  insertUser,
  publicUser,
} from "../providers/users.js";
import {
  createSession,
  deleteSession,
  findActiveSession,
  rotateRefreshToken,
} from "../providers/sessions.js";

// Orchestration for register / login / refresh / logout. Routes do HTTP,
// providers do storage, tokens.js does crypto; this file is the only place that
// knows how the three fit together.

const MONGO_DUPLICATE_KEY = 11000;

/**
 * A dummy scrypt hash, verified against when no such user exists.
 *
 * Without it, a login for an unknown username returns in ~0ms while a login for
 * a real one takes the ~80ms scrypt costs — a timing side channel that lets an
 * attacker enumerate valid usernames without ever guessing a password. Doing
 * the same work in both branches removes the signal.
 */
let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) {
    // Clear the memo on failure, matching cache.js / mongo.js: a rejected
    // promise cached for the process lifetime would make every later
    // unknown-user login throw instead of retrying.
    dummyHashPromise = hashPassword(randomUUID()).catch((err) => {
      dummyHashPromise = null;
      throw err;
    });
  }
  return dummyHashPromise;
}

/**
 * Burns the same CPU a real password check would, and swallows any failure.
 *
 * The timing defence is a defence, not a feature: if it breaks, the answer is
 * still "invalid credentials". Letting it throw would turn every login attempt
 * for a non-existent user into a 500 — louder, and a far better oracle than the
 * timing gap it exists to hide.
 */
async function burnEquivalentWork(password) {
  try {
    await verifyPassword(password, await getDummyHash());
  } catch {
    // Intentionally ignored — see above.
  }
}

/** Builds the token pair for a freshly-authenticated user. */
async function issueSession(user) {
  const sessionId = newSessionId();
  const refreshToken = generateRefreshToken();

  await createSession({
    sessionId,
    userId: user._id,
    username: user.username,
    refreshToken,
  });

  const access = signAccessToken({
    userId: user._id,
    username: user.username,
    role: user.role,
    sessionId,
  });

  return {
    accessToken: access.token,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: access.expiresInSeconds,
    expiresAt: access.expiresAt.toISOString(),
    user: publicUser(user),
  };
}

/**
 * Creates an account and logs it straight in — a client that just registered
 * should not have to immediately POST the same credentials again.
 */
export async function registerUser({ username, password, role }) {
  const passwordHash = await hashPassword(password);

  let user;
  try {
    user = await insertUser({ id: randomUUID(), username, passwordHash, role });
  } catch (err) {
    // The unique index is the authority, not a pre-check: two simultaneous
    // registrations of the same name both pass a "does it exist" query, and
    // only this catch stops the second one.
    if (err?.code === MONGO_DUPLICATE_KEY) {
      throw new ConflictError("username_taken", "That username is already registered.");
    }
    throw err;
  }

  return issueSession(user);
}

/**
 * Verifies credentials and opens a session.
 *
 * Both failure modes — unknown user and wrong password — return the identical
 * `invalid_credentials` 401. Telling them apart is a free username-enumeration
 * tool for an attacker and buys a legitimate user nothing.
 */
export async function loginUser({ username, password }) {
  const user = await findUserByUsername(username);

  if (!user) {
    await burnEquivalentWork(password);
    throw new UnauthorizedError(
      "invalid_credentials",
      "Username or password is incorrect."
    );
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new UnauthorizedError(
      "invalid_credentials",
      "Username or password is incorrect."
    );
  }

  return issueSession(user);
}

/**
 * Exchanges a refresh token for a new access token, rotating the refresh token
 * in the process.
 *
 * Rotation means a refresh token is single-use: the value the client just sent
 * is dead the moment this returns, so a copy captured in transit or from a log
 * is worthless once the real client has refreshed once.
 */
export async function refreshSession({ refreshToken }) {
  const newRefreshToken = generateRefreshToken();
  const session = await rotateRefreshToken({
    oldRefreshToken: refreshToken,
    newRefreshToken,
  });

  if (!session) {
    throw new UnauthorizedError(
      "invalid_refresh_token",
      "That refresh token is expired, already used, or revoked. Log in again."
    );
  }

  // Re-read the user rather than trusting the session's cached username, so a
  // deleted account cannot keep refreshing its way to fresh access tokens.
  const user = await findUserById(session.userId);
  if (!user) {
    await deleteSession(session._id);
    throw new UnauthorizedError("invalid_refresh_token", "Account no longer exists.");
  }

  // Role is taken from the freshly-read user, not the old token, so a refresh
  // is what picks up a role changed in the database.
  const access = signAccessToken({
    userId: user._id,
    username: user.username,
    role: user.role,
    sessionId: session._id,
  });

  return {
    accessToken: access.token,
    // The client MUST store this one; the token it sent no longer works.
    refreshToken: newRefreshToken,
    tokenType: "Bearer",
    expiresIn: access.expiresInSeconds,
    expiresAt: access.expiresAt.toISOString(),
    user: publicUser(user),
  };
}

/**
 * Ends the session behind an access token, killing that token and its refresh
 * token together.
 *
 * Idempotent by design — a client logging out twice, or with an already-expired
 * session, gets a 200. There is no useful sense in which the second call
 * "failed": the user is logged out either way, and returning an error only
 * invites the frontend to leave stale tokens in local storage.
 */
export async function logoutSession({ sessionId }) {
  const ended = await deleteSession(sessionId);
  return { ended };
}

/**
 * Resolves a bearer token to a live session + user.
 *
 * Two independent checks, and both must pass: the JWT signature/expiry (cheap,
 * stateless) AND the session document (the revocation half). Signature alone
 * would mean logout does nothing for up to seven days.
 */
export async function authenticateAccessToken(token) {
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch (err) {
    if (err.name !== "TokenError") throw err; // AuthConfigError -> 500, correctly
    throw new UnauthorizedError(
      err.expired ? "token_expired" : "invalid_token",
      err.expired
        ? "Access token has expired; use the refresh token."
        : "Access token is not valid."
    );
  }

  const session = await findActiveSession(claims.sessionId);
  if (!session) {
    throw new UnauthorizedError(
      "session_revoked",
      "This session has ended; log in again."
    );
  }

  return {
    userId: claims.userId,
    username: claims.username ?? session.username,
    role: claims.role,
    sessionId: claims.sessionId,
  };
}
