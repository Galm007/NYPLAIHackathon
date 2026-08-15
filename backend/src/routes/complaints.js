import { Router } from "express";
import { validateCoords, validateRadius, validateLimit } from "../lib/validate.js";
import { fetchComplaintPoints } from "../services/scoreService.js";
import {
  RADIUS_TIERS,
  COMPLAINTS_DEFAULT_LIMIT,
  COMPLAINTS_MAX_LIMIT,
} from "../config/constants.js";

export const complaintsRouter = Router();

/**
 * GET /api/complaints?lat=&lng=&radius=&limit=
 * Individual complaint points for the frontend heatmap.
 *
 * The body stays a bare JSON array — that is the frozen contract. Truncation is
 * reported in HEADERS instead, because a dense block returns only its most
 * recent months at the row cap (Bushwick at 350m: 1000 rows covering 148 of 730
 * days) and a frontend that counted from this array would disagree with the
 * score. Wrapping the array in an object would have been cleaner and would have
 * broken every existing caller, so: headers.
 *
 *   X-Complaints-Truncated: true|false
 *   X-Complaints-Limit:     the row cap actually applied
 */
complaintsRouter.get("/api/complaints", async (req, res, next) => {
  try {
    const { lat, lng } = validateCoords(req.query);
    const radius = validateRadius(req.query.radius, {
      fallback: RADIUS_TIERS.block.radiusMeters,
    });
    const limit = validateLimit(req.query.limit, {
      fallback: COMPLAINTS_DEFAULT_LIMIT,
      max: COMPLAINTS_MAX_LIMIT,
    });

    const { points, truncated } = await fetchComplaintPoints(lat, lng, radius, {
      limit,
    });

    res.set("X-Complaints-Truncated", String(truncated));
    res.set("X-Complaints-Limit", String(limit));
    res.json(points);
  } catch (err) {
    next(err);
  }
});
