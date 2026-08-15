import { MongoClient } from "mongodb";

// Connection management only — no collection logic lives here (that is cache.js).
//
// Mongo is OPTIONAL by design. `MONGODB_URI` is still unset for teammates and on
// a fresh clone, and the app must serve requests without it: an absent cache is
// a slower app, not a broken one. Everything here therefore reports "not
// configured" rather than throwing on startup.

const DEFAULT_DB_NAME = "should_i_live_here";

let connectPromise = null;
let activeClient = null;

/** Read at call time, not import time, so a URI can arrive after boot. */
export function isMongoConfigured() {
  return Boolean(process.env.MONGODB_URI);
}

/**
 * Connects lazily and memoizes. Returns `null` when no URI is configured.
 * A failed connection clears the memo so the next request retries rather than
 * being stuck with a rejected promise for the process lifetime.
 */
export async function getDb() {
  if (!isMongoConfigured()) return null;

  if (!connectPromise) {
    const uri = process.env.MONGODB_URI;
    connectPromise = (async () => {
      // Fail fast. A hung driver would otherwise sit on the request thread well
      // past the point where the user has given up on the page. Overridable so
      // tests can exercise the unreachable-Mongo path without a 5s stall.
      const timeoutMs =
        Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 5000;
      const client = new MongoClient(uri, {
        serverSelectionTimeoutMS: timeoutMs,
        connectTimeoutMS: timeoutMs,
      });
      await client.connect();
      activeClient = client;
      return client.db(process.env.MONGODB_DB || DEFAULT_DB_NAME);
    })().catch((err) => {
      connectPromise = null;
      activeClient = null;
      throw err;
    });
  }

  return connectPromise;
}

/** Closes the pool. Used by tests and by graceful shutdown. */
export async function closeMongo() {
  const client = activeClient;
  connectPromise = null;
  activeClient = null;
  if (client) await client.close();
}
