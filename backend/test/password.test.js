import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/password.js";

// No Mongo, no HTTP. Just the hashing primitive, including the malformed-input
// paths that must return false rather than throwing — a corrupt user document
// should fail one login, not 500 the endpoint.

describe("hashPassword", () => {
  it("produces a self-describing scrypt string", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const [algorithm, N, r, p, salt, key] = hash.split("$");

    expect(algorithm).toBe("scrypt");
    expect(Number(N)).toBeGreaterThanOrEqual(16384);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
    expect(salt).toMatch(/^[a-f0-9]+$/);
    expect(key).toMatch(/^[a-f0-9]+$/);
  });

  it("never contains the plaintext", async () => {
    const password = "hunter2-is-a-classic";
    expect(await hashPassword(password)).not.toContain(password);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
  });
});

describe("verifyPassword", () => {
  it("accepts the right password", async () => {
    const hash = await hashPassword("the right one");
    expect(await verifyPassword("the right one", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("the right one");
    expect(await verifyPassword("the wrong one", hash)).toBe(false);
  });

  it("is case sensitive", async () => {
    const hash = await hashPassword("CaseMatters");
    expect(await verifyPassword("casematters", hash)).toBe(false);
  });

  it("handles unicode consistently via NFKC normalization", async () => {
    // é composed vs decomposed: the same password as far as any user is
    // concerned, and typed either way depending on the keyboard.
    const hash = await hashPassword("café-password");
    expect(await verifyPassword("café-password", hash)).toBe(true);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    for (const bad of [
      "",
      "not-a-hash",
      "scrypt$1$2$3",
      "bcrypt$16384$8$1$aa$bb",
      "scrypt$x$8$1$aa$bb",
      "scrypt$16384$8$1$aa$",
      null,
      undefined,
      12345,
    ]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });

  it("returns false for a non-string password", async () => {
    const hash = await hashPassword("real");
    expect(await verifyPassword(undefined, hash)).toBe(false);
    expect(await verifyPassword({ $ne: null }, hash)).toBe(false);
  });
});
