import { Router } from "express";
import { validateCoords } from "../lib/validate.js";
import { buildScoreReport } from "../services/scoreService.js";

export const scoreRouter = Router();

/**
 * POST /api/score  body: { lat, lng }
 *
 * Response shape is FROZEN (see CLAUDE.md); M5 swapped the mock for real
 * Socrata + baseline data without changing any existing field. The additive
 * `confidence` / `bucketConfidence` / `bucketScores` / `meta` fields are safe
 * for a frontend to ignore.
 */
scoreRouter.post("/api/score", async (req, res, next) => {
  try {
    const { lat, lng } = validateCoords(req.body ?? {});
    res.json(await buildScoreReport(lat, lng));
  } catch (err) {
    next(err);
  }
});
