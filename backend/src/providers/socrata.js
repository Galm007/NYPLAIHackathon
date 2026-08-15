import {
  SOCRATA_ENDPOINT,
  LOCATION_FIELD,
  RADIUS_TIERS,
  BUCKET_NAMES,
  TYPE_TO_BUCKET,
  SOCRATA_TIMEOUT_MS,
  SOCRATA_MAX_RETRIES,
  SOCRATA_ROW_LIMIT,
  windowCutoffISO,
} from "../config/constants.js";

/** Socrata call failed after exhausting retries. Callers decide whether to fall back to stale cache. */
export class SocrataError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = "SocrataError";
    this.status = status;
    this.cause = cause;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** SoQL string literals use doubled single quotes to escape. */
function soqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function typeInClause(types) {
  return `complaint_type in (${types.map(soqlString).join(",")})`;
}

/**
 * One GET against the dataset with timeout + bounded retry.
 * Retries on 429 and 5xx (transient/throttle) and on network/timeout errors.
 * Does NOT retry 4xx other than 429 — a malformed SoQL query will fail
 * identically on every attempt, so retrying just delays the error.
 *
 * Exported so scripts/ can issue one-off queries (sampling, verification)
 * through the same retry and timeout policy the request path uses, instead of
 * each script hand-rolling a bare fetch. `timeoutMs` is overridable because
 * citywide aggregates are far slower than the 5s request-path budget.
 */
export async function query(
  params,
  { retries = SOCRATA_MAX_RETRIES, timeoutMs = SOCRATA_TIMEOUT_MS } = {}
) {
  const url = `${SOCRATA_ENDPOINT}?${new URLSearchParams(params)}`;
  const headers = { Accept: "application/json" };
  if (process.env.SOCRATA_APP_TOKEN) {
    headers["X-App-Token"] = process.env.SOCRATA_APP_TOKEN;
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // 300ms, 900ms — jittered so concurrent requests don't retry in lockstep.
      await sleep(300 * 3 ** (attempt - 1) * (0.5 + Math.random()));
    }

    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) return res.json();

      const retryable = res.status === 429 || res.status >= 500;
      const body = (await res.text().catch(() => "")).slice(0, 300);
      lastError = new SocrataError(`socrata ${res.status}: ${body}`, {
        status: res.status,
      });
      if (!retryable) throw lastError;
    } catch (err) {
      if (err instanceof SocrataError && !(err.status === 429 || err.status >= 500)) {
        throw err;
      }
      lastError = err;
    }
  }

  throw new SocrataError(
    `socrata request failed after ${retries + 1} attempts: ${lastError?.message}`,
    { cause: lastError }
  );
}

/**
 * Counts complaints for ONE radius tier around a point: a single HTTP call that
 * groups by complaint_type, whose per-string rows are then summed into buckets.
 *
 * Summing into buckets here (rather than scoring per string) is required —
 * buckets hold different numbers of string variants, so per-string averaging
 * would silently underweight noise (4 strings) against plumbing (2).
 *
 * @returns {Promise<Record<string, number>>} every bucket for the tier, zero-filled
 */
export async function fetchCountsForTier(lat, lng, tierName, { now } = {}) {
  const { radiusMeters, buckets } = RADIUS_TIERS[tierName];
  const types = Object.values(buckets).flat();

  const rows = await query({
    $select: "complaint_type, count(*) AS count",
    $where: [
      `within_circle(${LOCATION_FIELD}, ${lat}, ${lng}, ${radiusMeters})`,
      typeInClause(types),
      `created_date > ${soqlString(windowCutoffISO(now))}`,
    ].join(" AND "),
    $group: "complaint_type",
    $limit: String(SOCRATA_ROW_LIMIT),
  });

  // Zero-fill first: a bucket with no complaints returns no row at all, and a
  // missing bucket would otherwise become NaN downstream.
  const counts = Object.fromEntries(BUCKET_NAMES[tierName].map((b) => [b, 0]));
  for (const row of rows) {
    const bucket = TYPE_TO_BUCKET[row.complaint_type];
    if (bucket && bucket in counts) counts[bucket] += Number(row.count);
  }
  return counts;
}

/**
 * Both tiers for one point — the two HTTP calls per uncached address that
 * CLAUDE.md specifies (not six, not twelve). Issued in parallel.
 */
export async function fetchAllCounts(lat, lng, options) {
  const [building, block] = await Promise.all([
    fetchCountsForTier(lat, lng, "building", options),
    fetchCountsForTier(lat, lng, "block", options),
  ]);
  return { building, block };
}

/**
 * Individual complaint points for the frontend heatmap. Unlike the count
 * queries this returns rows, so it is capped well below the row limit.
 */
export async function fetchComplaints(lat, lng, radiusMeters, { now, limit = 1000 } = {}) {
  const types = Object.values(RADIUS_TIERS).flatMap(({ buckets }) =>
    Object.values(buckets).flat()
  );

  const rows = await query({
    $select: "complaint_type, latitude, longitude, created_date, status",
    $where: [
      `within_circle(${LOCATION_FIELD}, ${lat}, ${lng}, ${radiusMeters})`,
      typeInClause(types),
      `created_date > ${soqlString(windowCutoffISO(now))}`,
    ].join(" AND "),
    $order: "created_date DESC",
    $limit: String(limit),
  });

  return rows.map((row) => ({
    type: row.complaint_type,
    lat: Number(row.latitude),
    lng: Number(row.longitude),
    created_date: row.created_date,
    status: row.status ?? null,
  }));
}
