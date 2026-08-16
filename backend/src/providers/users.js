import { USERS_COLLECTION } from "../config/constants.js";
import { normalizeUsername } from "../lib/validate.js";
import { getDb, requireDb } from "./mongo.js";

// The `users` collection.
//
// Note the contrast with cache.js: that file degrades every failure to "miss",
// because a missing cache is only slow. This one uses requireDb() and throws.
// An unreachable database during a login must not be silently treated as "no
// such user" (which reads as a wrong password), and above all must never be
// treated as success.

let indexPromise = null;

/**
 * Unique index on `username`. This is the real guard against duplicate
 * accounts — the existence check in authService is a race, and two simultaneous
 * registrations for the same name are resolved here, by the database.
 */
export async function ensureUserIndexes() {
  if (!indexPromise) {
    indexPromise = (async () => {
      const db = await getDb();
      if (!db) return false;
      await db
        .collection(USERS_COLLECTION)
        .createIndexes([{ key: { username: 1 }, name: "username_unique", unique: true }]);
      return true;
    })().catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

/** Test seam: forget the memoized index promise between in-memory servers. */
export function resetUserIndexMemo() {
  indexPromise = null;
}

/** @returns the raw user document, or null. Includes the password hash. */
export async function findUserByUsername(username) {
  const db = await requireDb();
  return db.collection(USERS_COLLECTION).findOne({ username: normalizeUsername(username) });
}

/** @returns the raw user document by id, or null. */
export async function findUserById(id) {
  const db = await requireDb();
  return db.collection(USERS_COLLECTION).findOne({ _id: id });
}

/**
 * Inserts a user. Callers must pass an already-hashed password.
 *
 * A duplicate username surfaces as the driver's raw duplicate-key error
 * (`code: 11000`); translating it into an HTTP error is authService's job, not
 * a provider's.
 *
 * @returns {Promise<object>} the created document
 */
export async function insertUser({ id, username, passwordHash, role, now = new Date() }) {
  const db = await requireDb();
  const doc = {
    _id: id,
    username: normalizeUsername(username),
    passwordHash,
    role,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection(USERS_COLLECTION).insertOne(doc);
  return doc;
}

/** Replaces a user's password hash. Used by scripts/createUser.js --force. */
export async function updatePasswordHash(username, passwordHash) {
  const db = await requireDb();
  const result = await db
    .collection(USERS_COLLECTION)
    .updateOne(
      { username: normalizeUsername(username) },
      { $set: { passwordHash, updatedAt: new Date() } }
    );
  return result.matchedCount > 0;
}

/** The safe projection: everything a client may see, and nothing else. */
export function publicUser(user) {
  return {
    id: user._id,
    username: user.username,
    role: user.role ?? null,
    createdAt: user.createdAt,
  };
}
