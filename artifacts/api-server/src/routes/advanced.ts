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
import { semanticMemory } from "../lib/semanticMemory.js";
import { proceduralMemory } from "../lib/proceduralMemory.js";

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

// ── Semantic Memory ────────────────────────────────────────────────────────────

router.get("/memory/semantic/stats", (_req, res) => {
  res.json(semanticMemory.getStats());
});

router.get("/memory/semantic/search", (req, res) => {
  const query = String(req.query.q || "");
  const type = req.query.type as any;
  const limit = parseInt(String(req.query.limit || "10"), 10);
  if (!query) { res.status(400).json({ error: "q مطلوب" }); return; }
  const results = semanticMemory.search(query, { type, limit });
  res.json({ results, total: results.length });
});

router.post("/memory/semantic/store", (req, res) => {
  const { type, subject, content, confidence, source, tags } = req.body;
  if (!type || !subject || !content) {
    res.status(400).json({ error: "type و subject و content مطلوبة" });
    return;
  }
  const entry = semanticMemory.store_entry({ type, subject, content, confidence, source, tags });
  res.json({ success: true, entry });
});

router.get("/memory/semantic/by-type/:type", (req, res) => {
  const entries = semanticMemory.getByType(req.params.type as any, 30);
  res.json({ entries, total: entries.length });
});

// ── Procedural Memory ──────────────────────────────────────────────────────────

router.get("/memory/procedural/stats", (_req, res) => {
  res.json(proceduralMemory.getStats());
});

router.get("/memory/procedural/skills", (_req, res) => {
  const skills = proceduralMemory.getAllSkills();
  res.json({ skills, total: skills.length });
});

router.get("/memory/procedural/find", (req, res) => {
  const task = String(req.query.task || "");
  if (!task) { res.status(400).json({ error: "task مطلوب" }); return; }
  const matches = proceduralMemory.findRelevantSkills(task, 5);
  res.json({ matches, total: matches.length });
});

export default router;
