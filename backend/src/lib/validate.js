import {
  NYC_BOUNDS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RADIUS_TIERS,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
  USER_ROLE_VALUES,
} from "../config/constants.js";

/**
 * Thrown for bad client input. Routes translate this into a 400 rather than
 * each one re-implementing the same checks.
 */
export class BadRequestError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "BadRequestError";
    this.status = 400;
    this.details = details;
  }
}

function toFiniteNumber(value, field) {
  // Reject "" and null early: Number("") === 0, which would silently pass as
  // a valid coordinate on the equator.
  if (value === undefined || value === null || value === "") {
    throw new BadRequestError(`missing_${field}`, `${field} is required`);
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new BadRequestError(`invalid_${field}`, `${field} must be a number`);
  }
  return n;
}

/**
 * Validates a {lat, lng} pair (numbers or numeric strings) and asserts it falls
 * inside the NYC bounding box. Returns the parsed numbers.
 */
export function validateCoords({ lat, lng }) {
  const parsedLat = toFiniteNumber(lat, "lat");
  const parsedLng = toFiniteNumber(lng, "lng");

  const { minLat, maxLat, minLng, maxLng } = NYC_BOUNDS;
  if (
    parsedLat < minLat ||
    parsedLat > maxLat ||
    parsedLng < minLng ||
    parsedLng > maxLng
  ) {
    throw new BadRequestError(
      "out_of_bounds",
      `coordinate must be within NYC (lat ${minLat}-${maxLat}, lng ${minLng} to ${maxLng})`
    );
  }

  return { lat: parsedLat, lng: parsedLng };
}

/** Required radius tier for /api/explanation. */
export function validateTier(value) {
  const tiers = Object.keys(RADIUS_TIERS);
  if (value === undefined || value === null || value === "") {
    throw new BadRequestError("missing_tier", `tier is required (${tiers.join(" or ")})`);
  }
  if (!tiers.includes(value)) {
    throw new BadRequestError("invalid_tier", `tier must be one of: ${tiers.join(", ")}`);
  }
  return value;
}

/** Optional positive integer row cap, bounded so one request cannot pull the dataset. */
export function validateLimit(value, { fallback, max }) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = toFiniteNumber(value, "limit");
  if (!Number.isInteger(n) || n <= 0 || n > max) {
    throw new BadRequestError(
      "invalid_limit",
      `limit must be a whole number between 1 and ${max}`
    );
  }
  return n;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * The single canonical form of a username — the ONE place this rule lives.
 *
 * Storage, lookup, and validation must all agree on it: if registration stored
 * a differently-normalized string than login looks up, the account becomes
 * unreachable. `providers/users.js` imports this rather than repeating it.
 */
export function normalizeUsername(username) {
  return String(username).trim().toLowerCase();
}

function requireString(value, field) {
  // Guard the type, not just emptiness: Express parses JSON, so `password` can
  // arrive as an object or array, and `{"$ne": null}` reaching a Mongo query as
  // an operator is the classic NoSQL injection. Rejecting non-strings here is
  // what stops that, for every auth field, in one place.
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestError(`missing_${field}`, `${field} is required`);
  }
  return value;
}

/**
 * Validates a username for REGISTRATION, where the rules are enforced.
 * Returns the normalized (trimmed, lowercased) form that gets stored.
 */
export function validateNewUsername(value) {
  const username = normalizeUsername(requireString(value, "username"));

  if (username.length < USERNAME_MIN_LENGTH || username.length > USERNAME_MAX_LENGTH) {
    throw new BadRequestError(
      "invalid_username",
      `username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters`
    );
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw new BadRequestError(
      "invalid_username",
      "username may contain only letters, numbers, dot, dash, and underscore"
    );
  }
  return username;
}

/**
 * Validates the account role chosen at registration.
 *
 * Required, with no default: "tenant" would be the obvious one, but silently
 * assigning it to a landlord who forgot the field is worse than a 400 telling
 * them to pick.
 */
export function validateRole(value) {
  const role = requireString(value, "role").trim().toLowerCase();
  if (!USER_ROLE_VALUES.includes(role)) {
    throw new BadRequestError(
      "invalid_role",
      `role must be one of: ${USER_ROLE_VALUES.join(", ")}`
    );
  }
  return role;
}

/** Validates a password for REGISTRATION. Length only — see constants.js. */
export function validateNewPassword(value) {
  const password = requireString(value, "password");
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new BadRequestError(
      "invalid_password",
      `password must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters`
    );
  }
  return password;
}

/**
 * Validates credentials for LOGIN.
 *
 * Deliberately NOT the registration rules. Applying them here would turn a
 * 400 "invalid_username" into an oracle that tells an attacker which of their
 * guesses could even be a real account — and it would lock out any user whose
 * account predates a future tightening of the rules. Login checks only that
 * both fields are present strings; the password check decides everything else.
 */
export function validateCredentials({ username, password }) {
  return {
    username: normalizeUsername(requireString(username, "username")),
    password: requireString(password, "password"),
  };
}

/** The refresh token in a POST /api/auth/refresh body. */
export function validateRefreshToken(value) {
  return requireString(value, "refreshToken");
}

/** Optional positive radius in meters, capped to keep Socrata queries sane. */
export function validateRadius(value, { fallback, max = 2000 }) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = toFiniteNumber(value, "radius");
  if (n <= 0 || n > max) {
    throw new BadRequestError(
      "invalid_radius",
      `radius must be between 1 and ${max} meters`
    );
  }
  return n;
}
