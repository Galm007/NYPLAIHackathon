import { MongoMemoryServer } from "mongodb-memory-server";
import { closeMongo } from "../../src/providers/mongo.js";
import { resetCacheIndexMemo } from "../../src/providers/cache.js";

/**
 * Boots a real in-memory mongod and points the app's provider at it via
 * MONGODB_URI. Real mongod, not a stub: the two things worth testing here are
 * index behaviour and TTL semantics, and a hand-rolled fake would assert
 * nothing about either.
 */
export async function startMongo() {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  process.env.MONGODB_DB = "cache_test";
  resetCacheIndexMemo();

  return {
    uri: mongod.getUri(),
    async stop() {
      await closeMongo();
      await mongod.stop();
      delete process.env.MONGODB_URI;
      delete process.env.MONGODB_DB;
      resetCacheIndexMemo();
    },
  };
}
