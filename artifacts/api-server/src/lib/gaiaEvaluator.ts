/**
 * gaiaEvaluator.ts — نظام تقييم الأداء (GAIA-inspired)
 * ─────────────────────────────────────────────────────────────────────────────
 * مستوحى من GAIA Benchmark (General AI Assistants)
 * يقيّم أداء CortexFlow على مهام حقيقية بمعايير موضوعية
 *
 * المعايير:
 *   1. دقة الإجابة (Accuracy) — هل الإجابة صحيحة؟
 *   2. الاكتمال (Completeness) — هل تغطي كل المطلوب؟
 *   3. الكفاءة (Efficiency) — كم خطوة؟ كم وقت؟
 *   4. الموثوقية (Reliability) — معدل النجاح عبر الزمن
 *   5. قدرات الأدوات (Tool Usage) — استخدام الأدوات بشكل ذكي
 *
 * يحتفظ بسجل تاريخي لأداء النظام ويُنبّه عند الانحدار
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";

export interface TaskEvaluation {
  taskId: string;
  goal: string;
  category: string;
  timestamp: string;
  durationMs: number;
  toolsUsed: string[];
  agentsUsed: string[];
  iterationsCount: number;
  metrics: {
    accuracy: number;
    completeness: number;
    efficiency: number;
    clarity: number;
    toolUtilization: number;
  };
  overallScore: number;
  grade: "S" | "A" | "B" | "C" | "D" | "F";
  strengths: string[];
  weaknesses: string[];
  approach: string;
}

export interface BenchmarkReport {
  generatedAt: string;
  totalEvaluations: number;
  averageScore: number;
  gradeDistribution: Record<string, number>;
  categoryPerformance: Record<string, { avg: number; count: number }>;
  trendLast7Days: number[];
  bestPerformingCategory: string;
  worstPerformingCategory: string;
  recommendations: string[];
  systemHealth: "excellent" | "good" | "fair" | "poor";
}

interface EvalStore {
  evaluations: TaskEvaluation[];
  lastReset: string;
  totalSessions: number;
}

const EVAL_FILE = path.join(process.cwd(), ".memory", "gaia_evaluations.json");
const MAX_EVALUATIONS = 500;

type LLMFn = (messages: Array<{ role: string; content: string }>, maxTokens?: number) => Promise<string>;

const EVALUATION_PROMPT = `أنت مقيّم موضوعي لأداء وكلاء الذكاء الاصطناعي.

قيّم الإجابة على المهمة وفق هذه المعايير (كل معيار من 0 إلى 100):
1. **الدقة (accuracy)**: هل المعلومات صحيحة ودقيقة؟
2. **الاكتمال (completeness)**: هل تغطي الإجابة كل ما طُلب؟
3. **الكفاءة (efficiency)**: هل الأسلوب المُستخدم مناسب للمهمة؟
4. **الوضوح (clarity)**: هل الإجابة منظمة وسهلة الفهم؟
5. **استخدام الأدوات (toolUtilization)**: هل استُخدمت الأدوات بذكاء؟

أجب بـ JSON فقط:
{
  "accuracy": <0-100>,
  "completeness": <0-100>,
  "efficiency": <0-100>,
  "clarity": <0-100>,
  "toolUtilization": <0-100>,
  "strengths": ["نقطة قوة 1", "نقطة قوة 2"],
  "weaknesses": ["نقطة ضعف 1"],
  "approach": "وصف النهج المُستخدم"
}`;

class GAIAEvaluator {
  private store: EvalStore;
  private dirty = false;

  constructor() {
    this.store = this.loadStore();
    setInterval(() => { if (this.dirty) this.saveStore(); }, 30000);
    console.log(`[GAIA] تم التحميل: ${this.store.evaluations.length} تقييم`);
  }

  private loadStore(): EvalStore {
    try {
      const dir = path.dirname(EVAL_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(EVAL_FILE)) {
        return JSON.parse(fs.readFileSync(EVAL_FILE, "utf-8"));
      }
    } catch {}
    return { evaluations: [], lastReset: new Date().toISOString(), totalSessions: 0 };
  }

  private saveStore(): void {
    try {
      fs.writeFileSync(EVAL_FILE, JSON.stringify(this.store, null, 2), "utf-8");
      this.dirty = false;
    } catch (e) {
      console.warn("[GAIA] فشل الحفظ:", e);
    }
  }

  private calcGrade(score: number): "S" | "A" | "B" | "C" | "D" | "F" {
    if (score >= 90) return "S";
    if (score >= 80) return "A";
    if (score >= 70) return "B";
    if (score >= 60) return "C";
    if (score >= 50) return "D";
    return "F";
  }

  async evaluateTask(
    taskId: string,
    goal: string,
    category: string,
    answer: string,
    toolsUsed: string[],
    agentsUsed: string[],
    iterationsCount: number,
    durationMs: number,
    callLLM: LLMFn,
  ): Promise<TaskEvaluation> {
    const efficiencyBase = Math.max(0, 100 - (iterationsCount * 5) - (durationMs / 1000));
    const efficiency = Math.min(100, efficiencyBase);

    let metrics = {
      accuracy: 70,
      completeness: 70,
      efficiency: Math.round(efficiency),
      clarity: 70,
      toolUtilization: toolsUsed.length > 0 ? 80 : 50,
    };
    let strengths: string[] = [];
    let weaknesses: string[] = [];
    let approach = "نهج متعدد الوكلاء";

    try {
      const raw = await callLLM([
        { role: "system", content: EVALUATION_PROMPT },
        {
          role: "user",
          content: `**الهدف:** ${goal}\n\n**الإجابة:**\n${answer.substring(0, 2000)}\n\n**الأدوات المستخدمة:** ${toolsUsed.join(", ") || "لا شيء"}\n**التكرارات:** ${iterationsCount}\n**الوقت:** ${Math.round(durationMs / 1000)}ث`,
        },
      ], 600);

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        metrics = {
          accuracy: Number(parsed.accuracy || 70),
          completeness: Number(parsed.completeness || 70),
          efficiency: Number(parsed.efficiency || Math.round(efficiency)),
          clarity: Number(parsed.clarity || 70),
          toolUtilization: Number(parsed.toolUtilization || 70),
        };
        strengths = Array.isArray(parsed.strengths) ? parsed.strengths : [];
        weaknesses = Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [];
        approach = parsed.approach || approach;
      }
    } catch (e) {
      console.warn("[GAIA] فشل التقييم بالنموذج، استخدام التقييم الافتراضي");
      const wordCount = answer.trim().split(/\s+/).length;
      metrics.accuracy = wordCount > 100 ? 75 : 60;
      metrics.completeness = wordCount > 200 ? 80 : 65;
    }

    const overallScore = Math.round(
      metrics.accuracy * 0.30 +
      metrics.completeness * 0.25 +
      metrics.efficiency * 0.20 +
      metrics.clarity * 0.15 +
      metrics.toolUtilization * 0.10
    );

    const evaluation: TaskEvaluation = {
      taskId,
      goal: goal.substring(0, 200),
      category,
      timestamp: new Date().toISOString(),
      durationMs,
      toolsUsed,
      agentsUsed,
      iterationsCount,
      metrics,
      overallScore,
      grade: this.calcGrade(overallScore),
      strengths,
      weaknesses,
      approach,
    };

    this.store.evaluations.unshift(evaluation);
    if (this.store.evaluations.length > MAX_EVALUATIONS) {
      this.store.evaluations = this.store.evaluations.slice(0, MAX_EVALUATIONS);
    }
    this.store.totalSessions++;
    this.dirty = true;
    setTimeout(() => this.saveStore(), 2000);

    return evaluation;
  }

  generateReport(): BenchmarkReport {
    const evals = this.store.evaluations;

    if (evals.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        totalEvaluations: 0,
        averageScore: 0,
        gradeDistribution: {},
        categoryPerformance: {},
        trendLast7Days: [],
        bestPerformingCategory: "—",
        worstPerformingCategory: "—",
        recommendations: ["لا توجد بيانات كافية بعد"],
        systemHealth: "fair",
      };
    }

    const avgScore = evals.reduce((s, e) => s + e.overallScore, 0) / evals.length;

    const gradeDistribution: Record<string, number> = {};
    evals.forEach(e => {
      gradeDistribution[e.grade] = (gradeDistribution[e.grade] || 0) + 1;
    });

    const categoryPerf: Record<string, { total: number; count: number }> = {};
    evals.forEach(e => {
      if (!categoryPerf[e.category]) categoryPerf[e.category] = { total: 0, count: 0 };
      categoryPerf[e.category].total += e.overallScore;
      categoryPerf[e.category].count++;
    });

    const categoryPerformance: Record<string, { avg: number; count: number }> = {};
    Object.entries(categoryPerf).forEach(([cat, { total, count }]) => {
      categoryPerformance[cat] = { avg: Math.round(total / count), count };
    });

    const last7Days: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date();
      day.setDate(day.getDate() - i);
      const dayStr = day.toISOString().substring(0, 10);
      const dayEvals = evals.filter(e => e.timestamp.startsWith(dayStr));
      last7Days.push(dayEvals.length > 0 ? Math.round(dayEvals.reduce((s, e) => s + e.overallScore, 0) / dayEvals.length) : 0);
    }

    const sortedCats = Object.entries(categoryPerformance).sort((a, b) => b[1].avg - a[1].avg);
    const bestCat = sortedCats[0]?.[0] || "—";
    const worstCat = sortedCats[sortedCats.length - 1]?.[0] || "—";

    const recommendations: string[] = [];
    if (avgScore < 70) recommendations.push("تحسين دقة الإجابات — النتيجة أقل من المستهدف");
    if (categoryPerformance["browser"]?.avg < 70) recommendations.push("تحسين وكيل المتصفح");
    if (categoryPerformance["research"]?.avg < 75) recommendations.push("تعزيز قدرات البحث");
    const avgIterations = evals.reduce((s, e) => s + e.iterationsCount, 0) / evals.length;
    if (avgIterations > 8) recommendations.push("تقليل عدد التكرارات — الكفاءة منخفضة");
    if (recommendations.length === 0) recommendations.push("الأداء مقبول — استمر في التحسين");

    let systemHealth: "excellent" | "good" | "fair" | "poor" = "poor";
    if (avgScore >= 85) systemHealth = "excellent";
    else if (avgScore >= 75) systemHealth = "good";
    else if (avgScore >= 60) systemHealth = "fair";

    return {
      generatedAt: new Date().toISOString(),
      totalEvaluations: evals.length,
      averageScore: Math.round(avgScore),
      gradeDistribution,
      categoryPerformance,
      trendLast7Days: last7Days,
      bestPerformingCategory: bestCat,
      worstPerformingCategory: worstCat,
      recommendations,
      systemHealth,
    };
  }

  getRecentEvaluations(limit = 10): TaskEvaluation[] {
    return this.store.evaluations.slice(0, limit);
  }

  formatEvaluationSummary(eval_: TaskEvaluation): string {
    const gradeColors: Record<string, string> = { S: "🏆", A: "⭐", B: "✅", C: "🟡", D: "🟠", F: "❌" };
    return `${gradeColors[eval_.grade] || "📊"} **درجة: ${eval_.overallScore}/100 (${eval_.grade})**
📊 الدقة: ${eval_.metrics.accuracy}% | الاكتمال: ${eval_.metrics.completeness}% | الكفاءة: ${eval_.metrics.efficiency}%
${eval_.strengths.length > 0 ? `✅ نقاط قوة: ${eval_.strengths.join("، ")}` : ""}
${eval_.weaknesses.length > 0 ? `⚠️ للتحسين: ${eval_.weaknesses.join("، ")}` : ""}`;
  }

  getStats() {
    return {
      totalEvaluations: this.store.evaluations.length,
      totalSessions: this.store.totalSessions,
      lastEval: this.store.evaluations[0]?.timestamp || "لا يوجد",
    };
  }
}

export const gaiaEvaluator = new GAIAEvaluator();
