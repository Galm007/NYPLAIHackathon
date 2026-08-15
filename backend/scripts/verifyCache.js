/**
 * End-to-end check of the M3 cache path against the LIVE Socrata API.
 *
 *   node --env-file-if-exists=.env scripts/verifyCache.js
 *
 * The unit tests cover cache semantics with a fake Socrata; this covers the one
 * thing they cannot — that a cold call really does reach the live API, that the
 * warm call really is faster, and that the indexes really are on the collection.
 *
 * If MONGODB_URI is unset it starts an in-memory mongod, so this runs today,
 * before Atlas credentials exist. Point MONGODB_URI at Atlas to verify the real
 * cluster instead (do that once before the demo).
 */

import { getCounts } from "../src/services/scoreService.js";
import { ensureCacheIndexes } from "../src/providers/cache.js";
import { getDb, closeMongo } from "../src/providers/mongo.js";
import { CACHE_COLLECTION, CACHE_TTL_SECONDS } from "../src/config/constants.js";

// Real building rooftop coordinates taken from 311 records, not points picked
// off a map — a mid-street coordinate returns zero building complaints (M2).
const SAMPLES = [
  ["Bushwick, Brooklyn", 40.698, -73.921],
  ["Midtown, Manhattan", 40.7549, -73.984],
];

let memoryServer = null;

async function ensureMongo() {
  if (process.env.MONGODB_URI) {
    console.log(`Mongo: using MONGODB_URI (${process.env.MONGODB_URI.split("@").pop()})`);
    return;
  }
  const { MongoMemoryServer } = await import("mongodb-memory-server");
  memoryServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = memoryServer.getUri();
  process.env.MONGODB_DB = "verify_cache";
  console.log("Mongo: MONGODB_URI unset — started an in-memory mongod");
}

async function timed(label, fn) {
  const start = performance.now();
  const value = await fn();
  const ms = Math.round(performance.now() - start);
  console.log(`  ${label.padEnd(28)} ${String(ms).padStart(6)} ms`);
  return { value, ms };
}

await ensureMongo();

if (!process.env.SOCRATA_APP_TOKEN) {
  console.warn("WARNING: SOCRATA_APP_TOKEN unset — expect throttling\n");
}

await ensureCacheIndexes();
const db = await getDb();

// Clear ONLY the sample coordinates. This can be pointed at a real cluster, and
// a blanket deleteMany would throw away a pre-warmed demo cache.
await db.collection(CACHE_COLLECTION).deleteMany({
  $or: SAMPLES.map(([, lat, lng]) => ({
    lat: Number(lat.toFixed(4)),
    lng: Number(lng.toFixed(4)),
  })),
});

console.log("\n=== Indexes on complaint_cache ===");
for (const index of await db.collection(CACHE_COLLECTION).indexes()) {
  const ttl =
    index.expireAfterSeconds === undefined
      ? ""
      : `  TTL=${index.expireAfterSeconds}s (${index.expireAfterSeconds / 3600}h)`;
  console.log(
    `  ${index.name.padEnd(16)} ${JSON.stringify(index.key)}${
      index.unique ? "  unique" : ""
    }${ttl}`
  );
}

let failures = 0;
let socrataDown = false;

for (const [label, lat, lng] of SAMPLES) {
  console.log(`\n=== ${label} (${lat}, ${lng}) ===`);

  let cold;
  try {
    cold = await timed("cold (Socrata)", () => getCounts(lat, lng));
  } catch (err) {
    // Socrata goes down (it was fully 503 during M3). Report it as an outage
    // rather than a stack trace — the Mongo half of this script already ran and
    // its results above are still valid.
    console.log(`  SKIP  live API unavailable: ${err.message.slice(0, 120)}`);
    console.log("        Re-run when data.cityofnewyork.us is back.");
    socrataDown = true;
    break;
  }
  const warm = await timed("warm (cache)", () => getCounts(lat, lng));
  const nearby = await timed("nearby coord (same key)", () =>
    getCounts(lat + 0.00002, lng - 0.00002)
  );

  console.log(`  building: ${JSON.stringify(cold.value.counts.building)}`);
  console.log(`  block:    ${JSON.stringify(cold.value.counts.block)}`);
  console.log(
    `  cache:    cold=${JSON.stringify(cold.value.cache)} warm=${JSON.stringify(
      warm.value.cache
    )}`
  );

  const checks = [
    ["cold reports both tiers as misses", cold.value.cache.building === "miss" && cold.value.cache.block === "miss"],
    ["warm reports both tiers as hits", warm.value.cache.building === "hit" && warm.value.cache.block === "hit"],
    ["warm returns identical counts", JSON.stringify(warm.value.counts) === JSON.stringify(cold.value.counts)],
    ["warm is faster than cold", warm.ms < cold.ms],
    ["nearby coord hits the same key", nearby.value.cache.building === "hit"],
  ];

  for (const [name, ok] of checks) {
    if (!ok) failures++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  }
}

const docs = await db.collection(CACHE_COLLECTION).find({}).toArray();
console.log(`\n=== Stored documents (${docs.length}) ===`);
for (const doc of docs) {
  console.log(
    `  ${doc.radiusTier.padEnd(9)} ${doc.lat},${doc.lng}  createdAt=${
      doc.createdAt instanceof Date ? doc.createdAt.toISOString() : "NOT A DATE"
    }`
  );
  if (!(doc.createdAt instanceof Date)) failures++;
}
console.log(
  `\nTTL: documents self-expire ${CACHE_TTL_SECONDS / 3600}h after their last write.`
);

await closeMongo();
if (memoryServer) await memoryServer.stop();

if (socrataDown) {
  console.log(
    "\nINCOMPLETE: Mongo/index checks ran; live cold-vs-warm checks did not " +
      "(Socrata unavailable)."
  );
  process.exit(2);
}
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
