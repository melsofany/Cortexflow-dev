import { Router } from "express";
import { techIntelligence } from "../lib/techIntelligence.js";

const router = Router();

// GET /api/tech/knowledge — قاعدة المعرفة التقنية
router.get("/tech/knowledge", (_req, res) => {
  res.json(techIntelligence.researcher.getData());
});

// POST /api/tech/research — إجبار البحث التقني فوراً
router.post("/tech/research", async (_req, res) => {
  res.json({ message: "بدأ البحث التقني، سيكتمل خلال دقيقة..." });
  techIntelligence.forceResearch().catch(console.error);
});

// GET /api/tech/improvements — قائمة تحسينات الكود
router.get("/tech/improvements", (_req, res) => {
  res.json(techIntelligence.improver.getData());
});

// GET /api/tech/improvements/pending — التحسينات المعلقة فقط
router.get("/tech/improvements/pending", (_req, res) => {
  res.json(techIntelligence.improver.getPending());
});

// POST /api/tech/improvements/:id/apply — تطبيق تحسين محدد
router.post("/tech/improvements/:id/apply", (req, res) => {
  const result = techIntelligence.improver.applyImprovement(req.params.id);
  res.status(result.success ? 200 : 400).json(result);
});

// POST /api/tech/improvements/:id/reject — رفض تحسين
router.post("/tech/improvements/:id/reject", (req, res) => {
  const ok = techIntelligence.improver.rejectImprovement(req.params.id);
  res.json({ success: ok });
});

// GET /api/tech/performance — بيانات الأداء
router.get("/tech/performance", (_req, res) => {
  res.json(techIntelligence.monitor.getData());
});

// GET /api/tech/performance/latest — آخر لقطة أداء
router.get("/tech/performance/latest", (_req, res) => {
  res.json(techIntelligence.monitor.getLatestSnapshot());
});

// POST /api/tech/performance/check — فحص صحة فوري
router.post("/tech/performance/check", async (_req, res) => {
  await techIntelligence.monitor.checkHealth();
  res.json(techIntelligence.monitor.getLatestSnapshot());
});

// GET /api/tech/report — تقرير شامل من DeepSeek
router.get("/tech/report", async (_req, res) => {
  const report = await techIntelligence.getFullReport();
  res.json({ report, timestamp: new Date().toISOString() });
});

export default router;
