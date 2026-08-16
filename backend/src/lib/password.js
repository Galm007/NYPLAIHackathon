import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SCRYPT_PARAMS } from "../config/constants.js";

// Password hashing via node:crypto scrypt — no dependency, no native build step
// (which matters: the image is alpine/musl, see Dockerfile).
//
// Stored format is self-describing so parameters can be raised later without
// invalidating existing hashes:
//   scrypt$<N>$<r>$<p>$<saltHex>$<keyHex>

const scryptAsync = promisify(scrypt);

const PREFIX = "scrypt";

async function derive(password, salt, { N, r, p, keyLength }) {
  // maxmem must be raised above the default 32MB: scrypt needs roughly
  // 128 * N * r bytes (~16MB at N=16384, r=8) and the default leaves no room,
  // so the call fails outright rather than running slowly.
  return scryptAsync(password.normalize("NFKC"), salt, keyLength, {
    N,
    r,
    p,
    maxmem: 256 * N * r,
  });
}

/** Hashes a plaintext password into the storable string above. */
export async function hashPassword(password) {
  const { N, r, p, keyLength, saltBytes } = SCRYPT_PARAMS;
  const salt = randomBytes(saltBytes);
  const key = await derive(password, salt, { N, r, p, keyLength });
  return [PREFIX, N, r, p, salt.toString("hex"), key.toString("hex")].join("$");
}

/**
 * Constant-time verification against a stored hash.
 *
 * Returns false rather than throwing on a malformed or missing hash: a corrupt
 * user document should fail the login, not 500 the endpoint.
 */
export async function verifyPassword(password, stored) {
  if (typeof stored !== "string" || typeof password !== "string") return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const [, N, r, p, saltHex, keyHex] = parts;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  if (!Object.values(params).every(Number.isInteger)) return false;

  // Both halves must be non-empty hex. An empty key field is the dangerous
  // case: keyLength would be 0, scrypt would return an empty buffer, and
  // timingSafeEqual on two empty buffers is TRUE — a truncated stored hash
  // would authenticate every password. Rejecting it here is the guard.
  const isHex = (s) => typeof s === "string" && s.length > 0 && /^[a-f0-9]+$/i.test(s);
  if (!isHex(saltHex) || !isHex(keyHex)) return false;

  try {
    const expected = Buffer.from(keyHex, "hex");
    if (expected.length === 0) return false;

    const actual = await derive(password, Buffer.from(saltHex, "hex"), {
      ...params,
      keyLength: expected.length,
    });
    // Lengths are equal by construction (keyLength is taken FROM expected), but
    // timingSafeEqual throws on a mismatch, so a malformed stored hash would
    // otherwise escape as a 500.
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
