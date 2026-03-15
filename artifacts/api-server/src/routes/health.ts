import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { ollamaClient } from "../lib/ollamaClient.js";
import { memoryCache } from "../lib/memoryCache.js";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const cacheStats = memoryCache.getStats();
  const data = HealthCheckResponse.parse({
    status: "ok",
    ollamaAvailable: ollamaClient.isAvailable(),
    activeModel: ollamaClient.getCurrentModel(),
  });
  res.json({
    ...data,
    cache: cacheStats,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: process.env.NODE_ENV,
  });
});

export default router;
