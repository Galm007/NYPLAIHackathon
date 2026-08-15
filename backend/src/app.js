import express from "express";
import { healthRouter } from "./routes/health.js";
import { scoreRouter } from "./routes/score.js";
import { complaintsRouter } from "./routes/complaints.js";

/** Custom response headers the browser must be allowed to read cross-origin. */
const COMPLAINTS_HEADERS = ["X-Complaints-Truncated", "X-Complaints-Limit"];

/**
 * Builds the Express app without starting a listener, so tests and the entry
 * point share exactly one wiring path.
 */
export function createApp() {
  const app = express();
  app.use(express.json());

  // Frontend is served from a different origin during development.
  app.use((req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    // Without this, browser JS cannot READ our custom headers even though they
    // arrive — /api/complaints reports its truncation there, and the frontend
    // would silently see `undefined` instead.
    res.set("Access-Control-Expose-Headers", COMPLAINTS_HEADERS.join(","));
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use(healthRouter);
  app.use(scoreRouter);
  app.use(complaintsRouter);

  app.use((req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // Central error handler. Routes throw BadRequestError (status 400) via the
  // shared validator; anything else is a 500 with no internals leaked.
  app.use((err, req, res, next) => {
    if (err?.status === 400) {
      return res.status(400).json({ error: err.message, details: err.details });
    }
    // The upstream being down is not our bug, and a 500 tells the frontend
    // nothing it can act on. 503 + a distinct code lets it say "NYC's data
    // service is unavailable, try again" instead of "something broke".
    if (err?.name === "SocrataError") {
      console.error("[upstream]", err.message);
      return res.status(503).json({
        error: "upstream_unavailable",
        details: "NYC Open Data is not responding; try again shortly.",
      });
    }
    console.error("[error]", err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
