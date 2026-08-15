import { Router } from "express";

// Used by deploy health checks and keep-warm pings. Must stay dependency-free:
// it has to answer 200 even when Mongo or Socrata are down, otherwise a host
// will recycle the instance mid-demo.
export const healthRouter = Router();

healthRouter.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
});
