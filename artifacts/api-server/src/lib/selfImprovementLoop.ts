/**
 * selfImprovementLoop.ts — حلقة التحسين الذاتي المستمر
 * ─────────────────────────────────────────────────────────────────────────────
 * مستوحى من:
 *   - SEAL: Self-Adapting Language Models (NeurIPS 2025)
 *   - STaSC: Self-Taught Self-Correction
 *   - OpenAI Self-Evolving Agents Cookbook
 *   - Generator-Verifier-Updater (GVU) Operator
 *
 * ما يفعله هذا النظام:
 *   1. بعد كل مهمة، يحلل الأداء ويستخرج الدروس
 *   2. يبني "قاعدة معرفة" من الأنماط الناجحة والفاشلة
 *   3. يولد "قواعد سلوك" محسّنة تلقائياً
 *   4. يطبّق التحسينات على دورة المهام القادمة
 *   5. يشغّل دورة تحسين دورية كل N مهمة
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";

export interface BehaviorRule {
  id: string;
  rule: string;
  category: string;
  confidence: number;
  supportingEvidence: number;
  contradictingEvidence: number;
  generatedAt: string;
  active: boolean;
}

export interface PerformanceMetric {
  timestamp: string;
  category: string;
  taskDesc: string;
  score: number;
  success: boolean;
  duration: number;
  toolsUsed: string[];
  reflexionUsed: boolean;
}

export interface ImprovementInsight {
  id: string;
  type: "pattern_success" | "pattern_failure" | "tool_preference" | "strategy_insight";
  insight: string;
  frequency: number;
  impact: number;
  examples: string[];
  generatedAt: string;
}

interface SelfImprovementStore {
  metrics: PerformanceMetric[];
  rules: BehaviorRule[];
  insights: ImprovementInsight[];
  improvementCycles: number;
  lastCycleAt: string;
  overallTrend: number[];
  version: number;
}

const STORE_FILE = path.join(process.cwd(), "data", "self_improvement.json");
const CYCLE_INTERVAL = 10;
const MAX_METRICS = 200;
const MAX_RULES = 50;
const MAX_INSIGHTS = 100;

function ensureDir() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore(): SelfImprovementStore {
  ensureDir();
  try {
    if (fs.existsSync(STORE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    }
  } catch {}
  return {
    metrics: [],
    rules: getBuiltinRules(),
    insights: [],
    improvementCycles: 0,
    lastCycleAt: new Date().toISOString(),
    overallTrend: [],
    version: 1,
  };
}

function saveStore(store: SelfImprovementStore) {
  ensureDir();
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  } catch {}
}

function getBuiltinRules(): BehaviorRule[] {
  const now = new Date().toISOString();
  return [
    {
      id: "rule_verify_before_done",
      rule: "تحقق دائماً من اكتمال المهمة قبل إعلان النجاح — اقرأ الحالة الفعلية لا تفترضها",
      category: "general",
      confidence: 0.95,
      supportingEvidence: 10,
      contradictingEvidence: 0,
      generatedAt: now,
      active: true,
    },
    {
      id: "rule_use_multiple_sources",
      rule: "للمهام البحثية، استخدم مصادر متعددة وتحقق من التقاطع بين النتائج",
      category: "research",
      confidence: 0.9,
      supportingEvidence: 8,
      contradictingEvidence: 1,
      generatedAt: now,
      active: true,
    },
    {
      id: "rule_error_handling",
      rule: "عند الفشل، لا تكرر نفس الأسلوب — غيّر الاستراتيجية كلياً أو اطلب توضيحاً",
      category: "general",
      confidence: 0.92,
      supportingEvidence: 12,
      contradictingEvidence: 1,
      generatedAt: now,
      active: true,
    },
    {
      id: "rule_code_test",
      rule: "للكود البرمجي، اختبر دائماً بمدخلات بسيطة أولاً قبل المدخلات المعقدة",
      category: "code",
      confidence: 0.88,
      supportingEvidence: 7,
      contradictingEvidence: 2,
      generatedAt: now,
      active: true,
    },
    {
      id: "rule_break_complex",
      rule: "المهام المعقدة يجب تقسيمها لخطوات واضحة قبل التنفيذ",
      category: "general",
      confidence: 0.93,
      supportingEvidence: 15,
      contradictingEvidence: 0,
      generatedAt: now,
      active: true,
    },
  ];
}

const GENERATE_INSIGHTS_PROMPT = `أنت خبير تحليل الأداء للذكاء الاصطناعي.

**البيانات (آخر {count} مهمة):**
- معدل النجاح: {successRate}%
- متوسط النقاط: {avgScore}%
- أسرع الفئات: {fastCategories}
- أبطأ الفئات: {slowCategories}

**المهام الناجحة:**
{successPatterns}

**المهام الفاشلة:**
{failurePatterns}

استخرج:
1. أبرز نمطين ناجحين يمكن تكثيفهما
2. أبرز نمطين فاشلين يجب تجنبهما
3. توصية واحدة لرفع الدقة فوق 90%

أجب بنقاط موجزة، 3 أسطر كحد أقصى لكل قسم.`;

const GENERATE_RULE_PROMPT = `بناءً على هذه الملاحظات من مهام ذكاء اصطناعي:

**الأنماط الملاحظة:**
{patterns}

**النتائج:**
{outcomes}

اكتب قاعدة سلوكية واحدة محددة وقابلة للتطبيق في جملة واحدة.
القاعدة يجب أن تكون:
- محددة (لا عامة)
- قابلة للتنفيذ (بها فعل واضح)
- مبنية على الأدلة

اكتب القاعدة فقط، بدون شرح.`;

// ── فئة حلقة التحسين الذاتي ─────────────────────────────────────────────

class SelfImprovementLoop {
  private store: SelfImprovementStore;
  private tasksCompletedSinceLastCycle = 0;

  constructor() {
    this.store = loadStore();
    console.log(`[SelfImprovement] تم التحميل: ${this.store.metrics.length} مقياس، ${this.store.rules.length} قاعدة`);
  }

  // ── تسجيل نتيجة مهمة ─────────────────────────────────────────────────
  recordTaskCompletion(metric: Omit<PerformanceMetric, "timestamp">): void {
    const fullMetric: PerformanceMetric = {
      ...metric,
      timestamp: new Date().toISOString(),
    };

    this.store.metrics.unshift(fullMetric);
    if (this.store.metrics.length > MAX_METRICS) {
      this.store.metrics = this.store.metrics.slice(0, MAX_METRICS);
    }

    // تحديث اتجاه الأداء العام
    this.store.overallTrend.push(metric.score);
    if (this.store.overallTrend.length > 50) {
      this.store.overallTrend = this.store.overallTrend.slice(-50);
    }

    this.tasksCompletedSinceLastCycle++;
    saveStore(this.store);

    console.log(`[SelfImprovement] 📊 مهمة مسجّلة: ${metric.category} | ${metric.success ? "✅" : "❌"} | نقاط: ${Math.round(metric.score * 100)}%`);
  }

  // ── الحصول على قواعد السلوك الفعّالة ──────────────────────────────────
  getActiveRules(category?: string): BehaviorRule[] {
    return this.store.rules
      .filter(r => r.active && (!category || r.category === category || r.category === "general"))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 8);
  }

  // ── بناء سياق القواعد للبرومبت ────────────────────────────────────────
  buildRulesContext(category?: string): string {
    const rules = this.getActiveRules(category);
    if (rules.length === 0) return "";

    const ruleLines = rules
      .slice(0, 5)
      .map(r => `• ${r.rule} [ثقة: ${Math.round(r.confidence * 100)}%]`);

    return `\n[قواعد السلوك المُكتسبة]\n${ruleLines.join("\n")}`;
  }

  // ── تحديث ثقة القاعدة بناءً على الأداء ──────────────────────────────
  updateRuleEvidence(ruleId: string, success: boolean): void {
    const rule = this.store.rules.find(r => r.id === ruleId);
    if (!rule) return;

    if (success) {
      rule.supportingEvidence++;
      rule.confidence = Math.min(0.99, rule.confidence + 0.01);
    } else {
      rule.contradictingEvidence++;
      rule.confidence = Math.max(0.1, rule.confidence - 0.02);
    }

    // إذا انخفضت الثقة كثيراً، تعطيل القاعدة
    if (rule.confidence < 0.3 || rule.contradictingEvidence > rule.supportingEvidence * 2) {
      rule.active = false;
      console.log(`[SelfImprovement] ⚠️ تم تعطيل قاعدة ضعيفة: ${rule.rule.substring(0, 50)}`);
    }

    saveStore(this.store);
  }

  // ── تشغيل دورة التحسين ────────────────────────────────────────────────
  async runImprovementCycle(
    callLLM: (messages: Array<{role: string; content: string}>) => Promise<string>,
  ): Promise<{ newRules: number; newInsights: number; summary: string }> {
    if (this.store.metrics.length < CYCLE_INTERVAL) {
      return { newRules: 0, newInsights: 0, summary: "بيانات غير كافية" };
    }

    console.log(`[SelfImprovement] 🔄 بدء دورة التحسين الذاتي #${this.store.improvementCycles + 1}...`);

    const recentMetrics = this.store.metrics.slice(0, 30);
    const successRate = Math.round((recentMetrics.filter(m => m.success).length / recentMetrics.length) * 100);
    const avgScore = Math.round((recentMetrics.reduce((s, m) => s + m.score, 0) / recentMetrics.length) * 100);

    // تجميع الأنماط
    const successPatterns = recentMetrics
      .filter(m => m.success && m.score > 0.8)
      .slice(0, 5)
      .map(m => `[${m.category}] ${m.taskDesc}`)
      .join("\n");

    const failurePatterns = recentMetrics
      .filter(m => !m.success || m.score < 0.5)
      .slice(0, 5)
      .map(m => `[${m.category}] ${m.taskDesc}`)
      .join("\n");

    const byCategory = recentMetrics.reduce((acc, m) => {
      if (!acc[m.category]) acc[m.category] = { total: 0, success: 0, duration: 0 };
      acc[m.category].total++;
      if (m.success) acc[m.category].success++;
      acc[m.category].duration += m.duration;
      return acc;
    }, {} as Record<string, { total: number; success: number; duration: number }>);

    const catPerf = Object.entries(byCategory)
      .map(([cat, d]) => ({ cat, rate: Math.round((d.success / d.total) * 100), avgDuration: d.duration / d.total }))
      .sort((a, b) => b.rate - a.rate);

    let newRules = 0;
    let newInsights = 0;

    try {
      // توليد رؤى جديدة
      const insightPrompt = GENERATE_INSIGHTS_PROMPT
        .replace("{count}", String(recentMetrics.length))
        .replace("{successRate}", String(successRate))
        .replace("{avgScore}", String(avgScore))
        .replace("{fastCategories}", catPerf.slice(0, 2).map(c => `${c.cat}(${c.rate}%)`).join(", ") || "N/A")
        .replace("{slowCategories}", catPerf.slice(-2).map(c => `${c.cat}(${c.rate}%)`).join(", ") || "N/A")
        .replace("{successPatterns}", successPatterns || "لا توجد")
        .replace("{failurePatterns}", failurePatterns || "لا توجد");

      const insightResponse = await callLLM([{ role: "user", content: insightPrompt }]);

      if (insightResponse && insightResponse.length > 30) {
        const insight: ImprovementInsight = {
          id: `insight_${Date.now()}`,
          type: successRate > 70 ? "pattern_success" : "pattern_failure",
          insight: insightResponse.substring(0, 400),
          frequency: recentMetrics.length,
          impact: Math.abs(successRate - 70) / 100,
          examples: [successPatterns.substring(0, 100)],
          generatedAt: new Date().toISOString(),
        };

        this.store.insights.unshift(insight);
        if (this.store.insights.length > MAX_INSIGHTS) {
          this.store.insights = this.store.insights.slice(0, MAX_INSIGHTS);
        }
        newInsights++;
      }

      // توليد قاعدة سلوك جديدة من الأنماط
      if (failurePatterns && successRate < 80) {
        const rulePrompt = GENERATE_RULE_PROMPT
          .replace("{patterns}", failurePatterns)
          .replace("{outcomes}", `معدل النجاح ${successRate}% — يحتاج تحسين`);

        const newRule = await callLLM([{ role: "user", content: rulePrompt }]);

        if (newRule && newRule.length > 20 && newRule.length < 200) {
          const rule: BehaviorRule = {
            id: `rule_gen_${Date.now()}`,
            rule: newRule.trim(),
            category: catPerf.find(c => c.rate < 70)?.cat || "general",
            confidence: 0.65,
            supportingEvidence: 0,
            contradictingEvidence: 0,
            generatedAt: new Date().toISOString(),
            active: true,
          };

          this.store.rules.push(rule);

          if (this.store.rules.length > MAX_RULES) {
            this.store.rules = this.store.rules
              .sort((a, b) => b.confidence * b.supportingEvidence - a.confidence * a.supportingEvidence)
              .slice(0, MAX_RULES);
          }

          newRules++;
          console.log(`[SelfImprovement] ✅ قاعدة جديدة: "${newRule.substring(0, 60)}"`);
        }
      }

    } catch (e: any) {
      console.log(`[SelfImprovement] ⚠️ خطأ في دورة التحسين: ${e.message}`);
    }

    this.store.improvementCycles++;
    this.store.lastCycleAt = new Date().toISOString();
    this.tasksCompletedSinceLastCycle = 0;
    saveStore(this.store);

    const summary = `دورة #${this.store.improvementCycles}: معدل النجاح ${successRate}% | نقاط ${avgScore}% | +${newRules} قاعدة | +${newInsights} رؤية`;
    console.log(`[SelfImprovement] 🏁 ${summary}`);

    return { newRules, newInsights, summary };
  }

  // ── التحقق من الحاجة لدورة تحسين ─────────────────────────────────────
  shouldRunCycle(): boolean {
    return this.tasksCompletedSinceLastCycle >= CYCLE_INTERVAL &&
      this.store.metrics.length >= CYCLE_INTERVAL;
  }

  // ── تقرير الاتجاه ─────────────────────────────────────────────────────
  getTrend(): { direction: "up" | "down" | "stable"; recentAvg: number; overallAvg: number } {
    if (this.store.overallTrend.length < 5) {
      return { direction: "stable", recentAvg: 0, overallAvg: 0 };
    }

    const recent = this.store.overallTrend.slice(-5);
    const older = this.store.overallTrend.slice(0, -5);
    const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
    const overallAvg = this.store.overallTrend.reduce((s, v) => s + v, 0) / this.store.overallTrend.length;

    let direction: "up" | "down" | "stable" = "stable";
    if (older.length > 0) {
      const olderAvg = older.reduce((s, v) => s + v, 0) / older.length;
      if (recentAvg > olderAvg + 0.03) direction = "up";
      else if (recentAvg < olderAvg - 0.03) direction = "down";
    }

    return {
      direction,
      recentAvg: Math.round(recentAvg * 100),
      overallAvg: Math.round(overallAvg * 100),
    };
  }

  // ── إحصائيات شاملة ────────────────────────────────────────────────────
  getStats() {
    const total = this.store.metrics.length;
    const success = this.store.metrics.filter(m => m.success).length;

    return {
      totalTasks: total,
      successRate: total > 0 ? Math.round((success / total) * 100) : 0,
      avgScore: total > 0
        ? Math.round((this.store.metrics.reduce((s, m) => s + m.score, 0) / total) * 100)
        : 0,
      improvementCycles: this.store.improvementCycles,
      activeRules: this.store.rules.filter(r => r.active).length,
      insights: this.store.insights.length,
      trend: this.getTrend(),
      topRules: this.store.rules
        .filter(r => r.active)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3)
        .map(r => ({ rule: r.rule.substring(0, 80), confidence: Math.round(r.confidence * 100) })),
    };
  }

  // ── الحصول على آخر رؤية مفيدة ─────────────────────────────────────────
  getLatestInsight(): string {
    const latest = this.store.insights[0];
    if (!latest) return "";
    return latest.insight.substring(0, 200);
  }
}

export const selfImprovementLoop = new SelfImprovementLoop();
