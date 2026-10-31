import { Router } from "express";

export interface HealthDeps {
  // Resolves when the database answers a trivial query, rejects otherwise.
  checkDatabase: () => Promise<void>;
}

export function healthRouter({ checkDatabase }: HealthDeps): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const startedAt = performance.now();
    try {
      await checkDatabase();
      res.json({ status: "ok", database: "up", latencyMs: elapsed(startedAt) });
    } catch {
      // 503 tells load balancers and uptime checks to stop routing traffic here.
      res.status(503).json({ status: "degraded", database: "down", latencyMs: elapsed(startedAt) });
    }
  });

  return router;
}

function elapsed(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
