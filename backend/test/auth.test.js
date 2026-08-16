import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import jwt from "jsonwebtoken";
import { startMongo } from "./helpers/mongoTestServer.js";
import { startTestServer } from "./helpers/testServer.js";
import { ensureUserIndexes } from "../src/providers/users.js";
import { ensureSessionIndexes } from "../src/providers/sessions.js";
import { getDb } from "../src/providers/mongo.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_ALGORITHM,
  JWT_ISSUER,
  SESSIONS_COLLECTION,
  USERS_COLLECTION,
} from "../src/config/constants.js";

// The real auth stack end to end: real mongod, real scrypt, real JWTs, over
// real HTTP. Nothing in this file is stubbed except Socrata, which is only
// present because one test needs a protected route to succeed.
//
// routes.test.js stubs the auth middleware to keep its contract assertions
// focused; this file is where "the routes are actually protected" is proven.

const TEST_SECRET = "test-secret-that-is-comfortably-over-32-chars-long";

const { countsSpy } = vi.hoisted(() => ({ countsSpy: vi.fn() }));

vi.mock("../src/providers/socrata.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchCountsForTier: countsSpy };
});

const COUNTS = {
  building: { heatHotWater: 12, unsanitaryCondition: 3, plumbing: 1 },
  block: { noise: 1653, parking: 402, streetCondition: 88 },
};

const CREDENTIALS = { username: "renter", password: "a-good-enough-password" };
const REGISTRATION = { ...CREDENTIALS, role: "tenant" };
const NYC = { lat: 40.7484, lng: -73.9857 };

let mongo;
let server;

beforeAll(async () => {
  process.env.JWT_SECRET = TEST_SECRET;
  mongo = await startMongo();
  await Promise.all([ensureUserIndexes(), ensureSessionIndexes()]);
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
  await mongo.stop();
  delete process.env.JWT_SECRET;
});

beforeEach(async () => {
  countsSpy.mockReset();
  countsSpy.mockImplementation(async (lat, lng, tier) => COUNTS[tier]);

  const db = await getDb();
  await db.collection(USERS_COLLECTION).deleteMany({});
  await db.collection(SESSIONS_COLLECTION).deleteMany({});
});

/** Registers the standard user and returns the issued token pair. */
async function register(overrides = {}) {
  const { status, body } = await server.request("/api/auth/register", {
    method: "POST",
    body: { ...REGISTRATION, ...overrides },
  });
  return { status, body };
}

function authed(token) {
  return { Authorization: `Bearer ${token}` };
}

describe("POST /api/auth/register", () => {
  it("creates an account and returns a usable session", async () => {
    const { status, body } = await register();

    expect(status).toBe(201);
    expect(body.accessToken).toBeTypeOf("string");
    expect(body.refreshToken).toBeTypeOf("string");
    expect(body.tokenType).toBe("Bearer");
    expect(body.user).toEqual({
      id: expect.any(String),
      username: "renter",
      role: "tenant",
      createdAt: expect.any(String),
    });
  });

  it("stores the chosen role and carries it in the token", async () => {
    const { body } = await register({ username: "owner", role: "landlord" });

    expect(body.user.role).toBe("landlord");
    expect(jwt.decode(body.accessToken).role).toBe("landlord");

    const db = await getDb();
    const user = await db.collection(USERS_COLLECTION).findOne({ username: "owner" });
    expect(user.role).toBe("landlord");
  });

  it("accepts both roles", async () => {
    const tenant = await register({ username: "a-tenant", role: "tenant" });
    const landlord = await register({ username: "a-landlord", role: "landlord" });

    expect(tenant.status).toBe(201);
    expect(landlord.status).toBe(201);
  });

  it("rejects an unknown role with 400", async () => {
    const { status, body } = await register({ role: "broker" });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_role");
  });

  it("requires a role rather than defaulting to one", async () => {
    // Silently assigning "tenant" to a landlord who omitted the field is worse
    // than a 400 telling them to pick.
    const { status, body } = await server.request("/api/auth/register", {
      method: "POST",
      body: CREDENTIALS,
    });

    expect(status).toBe(400);
    expect(body.error).toBe("missing_role");
  });

  it("normalizes role case", async () => {
    const { status, body } = await register({ role: "LANDLORD" });
    expect(status).toBe(201);
    expect(body.user.role).toBe("landlord");
  });

  it("never returns the password hash", async () => {
    const { body } = await register();
    expect(JSON.stringify(body)).not.toContain("scrypt$");
    expect(body.user.passwordHash).toBeUndefined();
  });

  it("stores the password hashed, not in plaintext", async () => {
    await register();
    const db = await getDb();
    const user = await db.collection(USERS_COLLECTION).findOne({ username: "renter" });

    expect(user.passwordHash).toMatch(/^scrypt\$/);
    expect(user.passwordHash).not.toContain(CREDENTIALS.password);
  });

  it("rejects a duplicate username with 409", async () => {
    await register();
    const { status, body } = await register();

    expect(status).toBe(409);
    expect(body.error).toBe("username_taken");
  });

  it("treats usernames case-insensitively so two accounts cannot collide", async () => {
    await register();
    const { status } = await register({ username: "RENTER" });
    expect(status).toBe(409);
  });

  it("rejects a short password with 400", async () => {
    const { status, body } = await register({ password: "short" });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_password");
  });

  it("rejects a username with illegal characters", async () => {
    const { status, body } = await register({ username: "bad name!" });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_username");
  });
});

describe("POST /api/auth/login", () => {
  it("returns a token pair for correct credentials", async () => {
    await register();
    const { status, body } = await server.request("/api/auth/login", {
      method: "POST",
      body: CREDENTIALS,
    });

    expect(status).toBe(200);
    expect(body.accessToken).toBeTypeOf("string");
    expect(body.refreshToken).toBeTypeOf("string");
    expect(body.user.role).toBe("tenant");
  });

  it("issues a token that expires in 7 days", async () => {
    const { body } = await register();

    expect(body.expiresIn).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(body.expiresIn).toBe(7 * 24 * 60 * 60);

    const { iat, exp } = jwt.decode(body.accessToken);
    expect(exp - iat).toBe(7 * 24 * 60 * 60);
  });

  it("rejects a wrong password with 401", async () => {
    await register();
    const { status, body } = await server.request("/api/auth/login", {
      method: "POST",
      body: { ...CREDENTIALS, password: "not-the-password" },
    });

    expect(status).toBe(401);
    expect(body.error).toBe("invalid_credentials");
  });

  it("gives an unknown user the SAME error as a wrong password", async () => {
    // Different codes here would let an attacker enumerate valid usernames.
    await register();
    const wrongPassword = await server.request("/api/auth/login", {
      method: "POST",
      body: { ...CREDENTIALS, password: "not-the-password" },
    });
    const unknownUser = await server.request("/api/auth/login", {
      method: "POST",
      body: { username: "nobody", password: "not-the-password" },
    });

    expect(unknownUser.status).toBe(wrongPassword.status);
    expect(unknownUser.body).toEqual(wrongPassword.body);
  });

  it("rejects a non-string password instead of passing it to Mongo", async () => {
    // `{"$ne": null}` reaching a query as an operator is the NoSQL injection
    // this guard exists for.
    await register();
    const { status } = await server.request("/api/auth/login", {
      method: "POST",
      body: { username: "renter", password: { $ne: null } },
    });
    expect(status).toBe(400);
  });

  it("opens a second independent session rather than replacing the first", async () => {
    const first = await register();
    const second = await server.request("/api/auth/login", {
      method: "POST",
      body: CREDENTIALS,
    });

    // Logging in on a phone must not sign you out on a laptop.
    const me = await server.request("/api/auth/me", {
      headers: authed(first.body.accessToken),
    });
    expect(me.status).toBe(200);
    expect(second.body.accessToken).not.toBe(first.body.accessToken);
  });
});

describe("protected routes", () => {
  it("401s POST /api/score with no token", async () => {
    const { status, body } = await server.request("/api/score", {
      method: "POST",
      body: NYC,
    });

    expect(status).toBe(401);
    expect(body.error).toBe("missing_token");
    expect(countsSpy).not.toHaveBeenCalled();
  });

  it("401s GET /api/complaints with no token", async () => {
    const { status } = await server.request(
      `/api/complaints?lat=${NYC.lat}&lng=${NYC.lng}`
    );
    expect(status).toBe(401);
  });

  it("401s GET /api/explanation with no token", async () => {
    const { status } = await server.request(
      `/api/explanation?lat=${NYC.lat}&lng=${NYC.lng}&tier=building`
    );
    expect(status).toBe(401);
  });

  it("serves POST /api/score with a valid token", async () => {
    const { body } = await register();
    const { status, body: report } = await server.request("/api/score", {
      method: "POST",
      body: NYC,
      headers: authed(body.accessToken),
    });

    expect(status).toBe(200);
    expect(report.buildingHealth.counts).toEqual(COUNTS.building);
  });

  it("sets WWW-Authenticate on a 401 so clients know the scheme", async () => {
    const { headers } = await server.request("/api/score", {
      method: "POST",
      body: NYC,
    });
    expect(headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  it("accepts a lowercase 'bearer' scheme", async () => {
    const { body } = await register();
    const { status } = await server.request("/api/score", {
      method: "POST",
      body: NYC,
      headers: { Authorization: `bearer ${body.accessToken}` },
    });
    expect(status).toBe(200);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = jwt.sign(
      { username: "renter", sid: "whatever", type: "access" },
      "an-entirely-different-secret-of-sufficient-length",
      { algorithm: JWT_ALGORITHM, issuer: JWT_ISSUER, subject: "x", expiresIn: 3600 }
    );
    const { status, body } = await server.request("/api/score", {
      method: "POST",
      body: NYC,
      headers: authed(forged),
    });

    expect(status).toBe(401);
    expect(body.error).toBe("invalid_token");
  });

  it("rejects an alg:none token", async () => {
    // The classic JWT bypass: strip the signature and claim no algorithm.
    const unsigned = jwt.sign({ username: "renter", sid: "x", type: "access" }, "", {
      algorithm: "none",
      issuer: JWT_ISSUER,
      subject: "x",
      expiresIn: 3600,
    });
    const { status } = await server.request("/api/score", {
      method: "POST",
      body: NYC,
      headers: authed(unsigned),
    });
    expect(status).toBe(401);
  });

  it("reports an expired token with a distinct code so the client can refresh", async () => {
    const { body } = await register();
    const { sub, sid } = jwt.decode(body.accessToken);
    const expired = jwt.sign({ username: "renter", sid, type: "access" }, TEST_SECRET, {
      algorithm: JWT_ALGORITHM,
      issuer: JWT_ISSUER,
      subject: sub,
      expiresIn: -10,
    });

    const { status, body: err } = await server.request("/api/score", {
      method: "POST",
      body: NYC,
      headers: authed(expired),
    });

    expect(status).toBe(401);
    expect(err.error).toBe("token_expired");
  });

  it("leaves /health open for deploy checks", async () => {
    const { status } = await server.request("/health");
    expect(status).toBe(200);
  });
});

describe("POST /api/auth/refresh", () => {
  it("exchanges a refresh token for a new access token", async () => {
    const { body } = await register();
    const { status, body: refreshed } = await server.request("/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: body.refreshToken },
    });

    expect(status).toBe(200);
    expect(refreshed.accessToken).toBeTypeOf("string");
    expect(refreshed.user.username).toBe("renter");
    // The refreshed token must carry the role forward, or a role check would
    // start failing seven days into a session.
    expect(refreshed.user.role).toBe("tenant");
    expect(jwt.decode(refreshed.accessToken).role).toBe("tenant");

    const check = await server.request("/api/auth/me", {
      headers: authed(refreshed.accessToken),
    });
    expect(check.status).toBe(200);
  });

  it("rotates the refresh token and kills the old one", async () => {
    const { body } = await register();
    const first = await server.request("/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: body.refreshToken },
    });

    expect(first.body.refreshToken).not.toBe(body.refreshToken);

    // Replaying the original token must fail — that is what makes a captured
    // refresh token worthless after the real client has used it once.
    const replay = await server.request("/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: body.refreshToken },
    });

    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe("invalid_refresh_token");
  });

  it("survives a concurrent double-refresh with exactly one winner", async () => {
    const { body } = await register();
    const results = await Promise.all([
      server.request("/api/auth/refresh", {
        method: "POST",
        body: { refreshToken: body.refreshToken },
      }),
      server.request("/api/auth/refresh", {
        method: "POST",
        body: { refreshToken: body.refreshToken },
      }),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
  });

  it("rejects an unknown refresh token", async () => {
    const { status, body } = await server.request("/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: "not-a-real-token" },
    });

    expect(status).toBe(401);
    expect(body.error).toBe("invalid_refresh_token");
  });

  it("400s when the refresh token is missing entirely", async () => {
    const { status, body } = await server.request("/api/auth/refresh", {
      method: "POST",
      body: {},
    });

    expect(status).toBe(400);
    expect(body.error).toBe("missing_refreshToken");
  });

  it("stores only a hash of the refresh token", async () => {
    const { body } = await register();
    const db = await getDb();
    const session = await db.collection(SESSIONS_COLLECTION).findOne({});

    expect(session.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(session)).not.toContain(body.refreshToken);
  });
});

describe("POST /api/auth/logout", () => {
  it("invalidates the access token immediately, not in 7 days", async () => {
    const { body } = await register();

    const before = await server.request("/api/auth/me", {
      headers: authed(body.accessToken),
    });
    expect(before.status).toBe(200);

    const logout = await server.request("/api/auth/logout", {
      method: "POST",
      headers: authed(body.accessToken),
    });
    expect(logout.status).toBe(200);

    // The JWT is still perfectly valid and unexpired. The session behind it is
    // gone, which is the entire point of the sid check in requireAuth.
    const after = await server.request("/api/auth/me", {
      headers: authed(body.accessToken),
    });
    expect(after.status).toBe(401);
    expect(after.body.error).toBe("session_revoked");
  });

  it("invalidates the refresh token too", async () => {
    const { body } = await register();
    await server.request("/api/auth/logout", {
      method: "POST",
      headers: authed(body.accessToken),
    });

    const { status } = await server.request("/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: body.refreshToken },
    });
    expect(status).toBe(401);
  });

  it("blocks the protected routes after logout", async () => {
    const { body } = await register();
    await server.request("/api/auth/logout", {
      method: "POST",
      headers: authed(body.accessToken),
    });

    const { status } = await server.request("/api/score", {
      method: "POST",
      body: NYC,
      headers: authed(body.accessToken),
    });
    expect(status).toBe(401);
  });

  it("only ends the session it was called with, not every session", async () => {
    const laptop = await register();
    const phone = await server.request("/api/auth/login", {
      method: "POST",
      body: CREDENTIALS,
    });

    await server.request("/api/auth/logout", {
      method: "POST",
      headers: authed(laptop.body.accessToken),
    });

    const phoneStillWorks = await server.request("/api/auth/me", {
      headers: authed(phone.body.accessToken),
    });
    expect(phoneStillWorks.status).toBe(200);
  });

  it("401s without a token — you cannot end a session you cannot prove is yours", async () => {
    const { status } = await server.request("/api/auth/logout", { method: "POST" });
    expect(status).toBe(401);
  });

  it("deletes the session document", async () => {
    const { body } = await register();
    const db = await getDb();
    expect(await db.collection(SESSIONS_COLLECTION).countDocuments()).toBe(1);

    await server.request("/api/auth/logout", {
      method: "POST",
      headers: authed(body.accessToken),
    });

    expect(await db.collection(SESSIONS_COLLECTION).countDocuments()).toBe(0);
  });
});

describe("GET /api/auth/me", () => {
  it("returns the current user for a valid token", async () => {
    const { body } = await register();
    const { status, body: me } = await server.request("/api/auth/me", {
      headers: authed(body.accessToken),
    });

    expect(status).toBe(200);
    expect(me.user.username).toBe("renter");
    expect(me.user.role).toBe("tenant");
    expect(me.user.passwordHash).toBeUndefined();
  });

  it("401s with no token", async () => {
    const { status } = await server.request("/api/auth/me");
    expect(status).toBe(401);
  });

  it("401s consistently when the account is deleted out from under a live session", async () => {
    const { body } = await register();
    const db = await getDb();
    await db.collection(USERS_COLLECTION).deleteMany({});

    const { status, body: err, headers } = await server.request("/api/auth/me", {
      headers: authed(body.accessToken),
    });

    expect(status).toBe(401);
    expect(err.error).toBe("session_revoked");
    // Must match every other 401 in the API — this path used to hand-roll its
    // response and silently skipped both of these.
    expect(err.details).toBeTypeOf("string");
    expect(headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  it("401s on a malformed Authorization header", async () => {
    const { body } = await register();
    for (const header of [
      body.accessToken, // no scheme
      `Basic ${body.accessToken}`, // wrong scheme
      "Bearer", // no token
    ]) {
      const { status } = await server.request("/api/auth/me", {
        headers: { Authorization: header },
      });
      expect(status).toBe(401);
    }
  });
});
