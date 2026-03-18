/**
 * advanced.ts — مسارات الأنظمة المتقدمة
 * ─────────────────────────────────────────────────────────────────────────────
 * CodeAct + Wide Research + MCP Tools + GAIA Evaluator
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from "express";
import { codeActEngine } from "../lib/codeActEngine.js";
import { wideResearch } from "../lib/wideResearch.js";
import { mcpTools } from "../lib/mcpTools.js";
import { gaiaEvaluator } from "../lib/gaiaEvaluator.js";

const router = Router();

// ── CodeAct ──────────────────────────────────────────────────────────────────

router.get("/codeact/stats", (_req, res) => {
  res.json({
    status: "active",
    description: "CodeAct Engine — يولّد كود Python قابل للتنفيذ كإجراءات",
    paradigm: "Executable Code Actions (ICML 2024)",
  });
});

// ── Wide Research ─────────────────────────────────────────────────────────────

router.get("/research/wide/stats", (_req, res) => {
  res.json({
    status: "active",
    description: "Wide Research System — وكلاء متوازية للبحث الموسّع",
    maxParallelAgents: 8,
    batchSize: 3,
  });
});

// ── MCP Tools ─────────────────────────────────────────────────────────────────

router.get("/mcp/tools", (_req, res) => {
  const tools = mcpTools.getAvailableTools();
  const stats = mcpTools.getStats();
  res.json({ tools, stats });
});

router.post("/mcp/execute", async (req, res) => {
  const { toolName, input } = req.body;
  if (!toolName) {
    res.status(400).json({ error: "toolName مطلوب" });
    return;
  }

  const result = await mcpTools.execute({
    toolName,
    input: input || {},
    requestId: `api_${Date.now()}`,
  });

  res.json(result);
});

router.post("/mcp/connect", async (req, res) => {
  const { url, name } = req.body;
  if (!url || !name) {
    res.status(400).json({ error: "url و name مطلوبان" });
    return;
  }

  const success = await mcpTools.connectMCPServer(url, name);
  res.json({ success, message: success ? "تم الاتصال بنجاح" : "فشل الاتصال" });
});

router.get("/mcp/stats", (_req, res) => {
  res.json(mcpTools.getStats());
});

// ── GAIA Evaluator ─────────────────────────────────────────────────────────────

router.get("/gaia/report", (_req, res) => {
  const report = gaiaEvaluator.generateReport();
  res.json(report);
});

router.get("/gaia/evaluations", (req, res) => {
  const limit = parseInt(String(req.query.limit || "20"), 10);
  const evaluations = gaiaEvaluator.getRecentEvaluations(limit);
  res.json({ evaluations, total: evaluations.length });
});

router.get("/gaia/stats", (_req, res) => {
  res.json(gaiaEvaluator.getStats());
});

export default router;
