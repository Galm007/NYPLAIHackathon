import {
  CACHE_COLLECTION,
  CACHE_COORD_PRECISION,
  CACHE_TTL_SECONDS,
  BUCKET_NAMES,
} from "../config/constants.js";
import { getDb, isMongoConfigured } from "./mongo.js";

// Read/write for `complaint_cache`.
//
// Two rules shape this file:
//
// 1. A cache is an optimisation. Every function here degrades to "miss" if Mongo
//    is unconfigured, unreachable, or slow — a cache outage must never turn into
//    a 500 on the score endpoint mid-demo.
// 2. NO 2dsphere index. Spatial filtering is Socrata's job; the cache lookup is
//    an exact match on rounded coordinates (see CLAUDE.md).

/** Rounds one coordinate to the cache-key precision (~11m at 4dp). */
export function roundCoord(value) {
  // Number(...toFixed) rather than Math.round(v*1e4)/1e4: the latter leaves
  // float dust (40.7484000000001) that would never match a stored key.
  return Number(value.toFixed(CACHE_COORD_PRECISION));
}

/** The exact-match key for one point at one radius tier. */
export function cacheKey(lat, lng, radiusTier) {
  return { lat: roundCoord(lat), lng: roundCoord(lng), radiusTier };
}

let indexPromise = null;

/**
 * Creates the compound lookup index and the TTL index. Idempotent, and
 * memoized so it costs one round trip per process rather than one per request.
 */
export async function ensureCacheIndexes() {
  if (!indexPromise) {
    indexPromise = (async () => {
      const db = await getDb();
      if (!db) return false;
      const collection = db.collection(CACHE_COLLECTION);
      await collection.createIndexes([
        {
          key: { lat: 1, lng: 1, radiusTier: 1 },
          name: "coord_tier",
          // Unique so a race between two concurrent misses cannot leave two
          // documents for the same circle, with reads flipping between them.
          unique: true,
        },
        {
          key: { createdAt: 1 },
          name: "createdAt_ttl",
          expireAfterSeconds: CACHE_TTL_SECONDS,
        },
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
export function resetCacheIndexMemo() {
  indexPromise = null;
}

function isCompleteCounts(counts, radiusTier) {
  if (!counts || typeof counts !== "object") return false;
  // A partially-written document (schema change, interrupted write) would put a
  // missing bucket into the scoring mean as NaN. Treat it as a miss instead.
  return BUCKET_NAMES[radiusTier].every((bucket) =>
    Number.isFinite(counts[bucket])
  );
}

/**
 * Looks up several tiers for one point in a single query.
 *
 * @returns {Promise<Record<string, object|null>>} counts per requested tier;
 *   `null` for any tier that was not cached.
 */
export async function readCounts(lat, lng, radiusTiers) {
  const result = Object.fromEntries(radiusTiers.map((tier) => [tier, null]));
  if (!isMongoConfigured()) return result;

  try {
    const db = await getDb();
    if (!db) return result;

    const keyLat = roundCoord(lat);
    const keyLng = roundCoord(lng);
    const docs = await db
      .collection(CACHE_COLLECTION)
      .find({ lat: keyLat, lng: keyLng, radiusTier: { $in: radiusTiers } })
      .toArray();

    for (const doc of docs) {
      if (isCompleteCounts(doc.counts, doc.radiusTier)) {
        result[doc.radiusTier] = doc.counts;
      }
    }
    return result;
  } catch (err) {
    console.warn("[cache] read failed, treating as miss:", err.message);
    return result;
  }
}

/**
 * Upserts one tier's counts. Refreshing `createdAt` on every write is what makes
 * the TTL a sliding 24h window rather than a hard expiry on first insert.
 *
 * Returns true if the write landed; false if it was skipped or failed. Callers
 * do not branch on this — a failed cache write must not fail the request.
 */
export async function writeCounts(lat, lng, radiusTier, counts, { now } = {}) {
  if (!isMongoConfigured()) return false;

  try {
    const db = await getDb();
    if (!db) return false;

    const key = cacheKey(lat, lng, radiusTier);
    await db.collection(CACHE_COLLECTION).replaceOne(
      key,
      // createdAt must be a BSON Date; a string is silently ignored by the TTL
      // monitor and the document would live forever.
      { ...key, counts, createdAt: now ?? new Date() },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.warn("[cache] write failed, continuing uncached:", err.message);
    return false;
  }
}
