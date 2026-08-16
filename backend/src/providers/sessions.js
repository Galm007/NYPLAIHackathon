import { REFRESH_TOKEN_TTL_SECONDS, SESSIONS_COLLECTION } from "../config/constants.js";
import { hashRefreshToken } from "../lib/tokens.js";
import { getDb, requireDb } from "./mongo.js";

// The `auth_sessions` collection — one document per active login.
//
//   { _id: sid, userId, username, refreshTokenHash, createdAt, lastUsedAt,
//     expiresAt }
//
// This is what makes logout real. The access token is a 7-day JWT and nothing
// can un-sign it, so instead every access token carries the `sid` of the
// session that issued it and requireAuth checks that session still exists.
// Deleting the document invalidates the access token and the refresh token in
// one write, immediately.
//
// The cost is one indexed lookup by _id per authenticated request. That is the
// price of a revocable 7-day token, and it is the right trade here.

let indexPromise = null;

/**
 * TTL index on `expiresAt` with expireAfterSeconds 0 — Mongo deletes each
 * document at the instant stored in that field, so sessions clean themselves up
 * rather than accumulating forever.
 *
 * The refresh-hash index is unique so a rotated token can never collide with a
 * live one, and sparse-free because every session always has a hash.
 */
export async function ensureSessionIndexes() {
  if (!indexPromise) {
    indexPromise = (async () => {
      const db = await getDb();
      if (!db) return false;
      await db.collection(SESSIONS_COLLECTION).createIndexes([
        { key: { expiresAt: 1 }, name: "expiresAt_ttl", expireAfterSeconds: 0 },
        { key: { refreshTokenHash: 1 }, name: "refresh_hash_unique", unique: true },
        { key: { userId: 1 }, name: "user_sessions" },
      ]);
      return true;
    })().catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

/** Test seam: forget the memoized index promise between in-memory servers. */
export function resetSessionIndexMemo() {
  indexPromise = null;
}

function refreshExpiry(now) {
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
}

/** Creates the session an access token and refresh token will both point at. */
export async function createSession({
  sessionId,
  userId,
  username,
  refreshToken,
  now = new Date(),
}) {
  const db = await requireDb();
  const doc = {
    _id: sessionId,
    userId,
    username,
    refreshTokenHash: hashRefreshToken(refreshToken),
    createdAt: now,
    lastUsedAt: now,
    expiresAt: refreshExpiry(now),
  };
  await db.collection(SESSIONS_COLLECTION).insertOne(doc);
  return doc;
}

/**
 * Looks up a session by id, treating an expired one as absent.
 *
 * The explicit `expiresAt` filter is not redundant with the TTL index: Mongo's
 * TTL monitor only runs about once a minute, so an expired document is
 * routinely still readable. Trusting the index alone would extend every session
 * by up to a minute — small, but it is the difference between "revoked" and
 * "revoked eventually", which is the whole point of this collection.
 */
export async function findActiveSession(sessionId, { now = new Date() } = {}) {
  const db = await requireDb();
  return db
    .collection(SESSIONS_COLLECTION)
    .findOne({ _id: sessionId, expiresAt: { $gt: now } });
}

/**
 * Atomically swaps a refresh token for a new one — the whole of refresh-token
 * rotation, in one round trip.
 *
 * `findOneAndUpdate` matching on the OLD hash is what makes this safe under
 * concurrency: two clients replaying the same refresh token race for one
 * document, and exactly one of them matches. The loser gets null and a 401
 * rather than both walking away with valid sessions.
 *
 * @returns the updated document, or null if the token was unknown/expired/already used.
 */
export async function rotateRefreshToken({
  oldRefreshToken,
  newRefreshToken,
  now = new Date(),
}) {
  const db = await requireDb();
  return db.collection(SESSIONS_COLLECTION).findOneAndUpdate(
    { refreshTokenHash: hashRefreshToken(oldRefreshToken), expiresAt: { $gt: now } },
    {
      $set: {
        refreshTokenHash: hashRefreshToken(newRefreshToken),
        lastUsedAt: now,
        // Sliding window: an actively-used session keeps renewing, and one that
        // goes quiet for the full refresh TTL is dropped.
        expiresAt: refreshExpiry(now),
      },
    },
    { returnDocument: "after" }
  );
}

/** Ends one session. Idempotent — logging out twice is not an error. */
export async function deleteSession(sessionId) {
  const db = await requireDb();
  const result = await db.collection(SESSIONS_COLLECTION).deleteOne({ _id: sessionId });
  return result.deletedCount > 0;
}

/** Ends every session for a user ("log out everywhere", password change). */
export async function deleteUserSessions(userId) {
  const db = await requireDb();
  const result = await db.collection(SESSIONS_COLLECTION).deleteMany({ userId });
  return result.deletedCount;
}
