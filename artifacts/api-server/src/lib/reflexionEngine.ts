/**
 * reflexionEngine.ts — محرك Reflexion (التعلم الذاتي من الأخطاء)
 * ─────────────────────────────────────────────────────────────────────────────
 * مستوحى من:
 *   - Reflexion: Language Agents with Verbal Reinforcement Learning (2023)
 *   - NeurIPS 2025: Self-Improving AI Agents
 *   - SEAL: Self-Adapting Language Models
 *
 * الفكرة الجوهرية:
 *   1. ينفذ Agent مهمة → يحلل النتيجة بموضوعية
 *   2. يولد "تأمل ذاتي" (Reflection) يصف ما أخطأ وكيف يصلح
 *   3. يحفظ التأمل في ذاكرة نصية (Episodic Reflection Buffer)
 *   4. في المحاولة القادمة → يستخدم التأملات لتجنب نفس الأخطاء
 *
 * يرفع الدقة من ~24% → 51%+ وفقاً لأبحاث MIPROv2
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";

export interface Reflection {
  id: string;
  taskPattern: string;
  taskCategory: string;
  attempt: number;
  outcome: "success" | "failure" | "partial";
  score: number;
  reflection: string;
  keyLearnings: string[];
  avoidStrategies: string[];
  betterApproach: string;
  timestamp: string;
  usedCount: number;
}

export interface ReflexionSession {
  taskId: string;
  goal: string;
  attempts: ReflexionAttempt[];
  bestScore: number;
  finalAnswer: string;
  totalReflections: number;
}

export interface ReflexionAttempt {
  attemptNumber: number;
  answer: string;
  score: number;
  reflection: string;
  improved: boolean;
}

interface ReflexionStore {
  reflections: Reflection[];
  totalReflections: number;
  averageImprovementPerReflection: number;
  version: number;
}

const STORE_FILE = path.join(process.cwd(), "data", "reflexion_memory.json");
const MAX_REFLECTIONS = 300;

function ensureDir() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore(): ReflexionStore {
  ensureDir();
  try {
    if (fs.existsSync(STORE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    }
  } catch {}
  return { reflections: [], totalReflections: 0, averageImprovementPerReflection: 0, version: 1 };
}

function saveStore(store: ReflexionStore) {
  ensureDir();
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  } catch {}
}

function normalizePattern(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 100);
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set(["في", "من", "إلى", "على", "هو", "هي", "the", "is", "in", "of", "to", "a"]);
  return text
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 20);
}

// ── System Prompts للتأمل ──────────────────────────────────────────────────

const REFLECTION_PROMPT = `أنت محلل خبير تقيّم أداء وكيل ذكاء اصطناعي.

المهمة: {goal}
محاولة رقم: {attempt}
الإجابة المقدمة: {answer}
النتيجة: {outcome}

قدّم تحليلاً عميقاً بهذا التنسيق الصارم:

**SCORE:** [0.0 إلى 1.0 — مدى اكتمال الإجابة وجودتها]
**REFLECTION:** [تحليل موضوعي: ما الذي نجح؟ ما الذي فشل؟ لماذا؟]
**KEY_LEARNINGS:** [3 دروس مستفادة محددة مفصولة بفاصل |]
**AVOID:** [استراتيجيتان يجب تجنبهما في المحاولة القادمة مفصولتان بـ |]
**BETTER_APPROACH:** [الخطة المحسّنة للمحاولة القادمة في 2-3 جمل]

كن محدداً وعملياً — لا تذكر الأخطاء العامة فقط.`;

const RETRY_WITH_REFLECTION_PROMPT = `أنت وكيل ذكاء اصطناعي متقدم تحاول مهمة للمرة {attempt}.

المهمة: {goal}

📚 تأملات من محاولات سابقة:
{reflections}

⚠️ استراتيجيات يجب تجنبها:
{avoidStrategies}

✅ النهج المحسّن المقترح:
{betterApproach}

الآن نفّذ المهمة مع مراعاة هذه الدروس. كن أدق وأكثر شمولاً من المحاولات السابقة.`;

// ── محلّل استجابة التأمل ─────────────────────────────────────────────────

interface ParsedReflection {
  score: number;
  reflection: string;
  keyLearnings: string[];
  avoidStrategies: string[];
  betterApproach: string;
}

function parseReflectionResponse(response: string): ParsedReflection {
  const extract = (key: string): string => {
    const regex = new RegExp(`\\*\\*${key}:\\*\\*\\s*([\\s\\S]*?)(?=\\*\\*[A-Z_]+:\\*\\*|$)`, 'i');
    const match = response.match(regex);
    return match ? match[1].trim() : "";
  };

  const scoreStr = extract("SCORE") || "0.5";
  const score = Math.min(1, Math.max(0, parseFloat(scoreStr) || 0.5));
  const reflection = extract("REFLECTION") || "لا تأمل متاح";
  const keyLearningsStr = extract("KEY_LEARNINGS") || "";
  const avoidStr = extract("AVOID") || "";
  const betterApproach = extract("BETTER_APPROACH") || "جرّب نهجاً أكثر تفصيلاً";

  const keyLearnings = keyLearningsStr.split("|").map(s => s.trim()).filter(Boolean).slice(0, 3);
  const avoidStrategies = avoidStr.split("|").map(s => s.trim()).filter(Boolean).slice(0, 2);

  return { score, reflection, keyLearnings, avoidStrategies, betterApproach };
}

// ── فئة محرك Reflexion ───────────────────────────────────────────────────

class ReflexionEngine {
  private store: ReflexionStore;
  private activeSessions: Map<string, ReflexionSession> = new Map();

  constructor() {
    this.store = loadStore();
    console.log(`[Reflexion] تم التحميل: ${this.store.reflections.length} تأمل محفوظ`);
  }

  // ── البحث عن التأملات ذات الصلة ──────────────────────────────────────
  getRelevantReflections(goal: string, limit = 3): Reflection[] {
    if (this.store.reflections.length === 0) return [];

    const queryKw = extractKeywords(goal);
    return this.store.reflections
      .map(r => ({
        r,
        score: queryKw.filter(k =>
          r.taskPattern.includes(k) ||
          r.reflection.toLowerCase().includes(k) ||
          r.keyLearnings.some(l => l.toLowerCase().includes(k))
        ).length,
      }))
      .filter(x => x.score > 0 && x.r.outcome !== "success" || x.r.score > 0.7)
      .sort((a, b) => b.score - a.score || b.r.usedCount - a.r.usedCount)
      .slice(0, limit)
      .map(x => { x.r.usedCount++; return x.r; });
  }

  // ── بناء سياق التأمل للمحاولة الجديدة ───────────────────────────────
  buildReflexionContext(goal: string, attemptNumber: number): string {
    const relevant = this.getRelevantReflections(goal);
    if (relevant.length === 0 && attemptNumber === 1) return "";

    const reflectionLines = relevant.map((r, i) =>
      `[تأمل ${i + 1} - مهمة مشابهة]:\n  المشكلة: ${r.reflection.substring(0, 150)}\n  الدروس: ${r.keyLearnings.slice(0, 2).join(" | ")}`
    ).join("\n\n");

    const avoidStrategies = [...new Set(relevant.flatMap(r => r.avoidStrategies))].slice(0, 4);
    const betterApproach = relevant.find(r => r.betterApproach)?.betterApproach || "";

    if (!reflectionLines && !betterApproach) return "";

    return RETRY_WITH_REFLECTION_PROMPT
      .replace("{attempt}", String(attemptNumber))
      .replace("{goal}", goal)
      .replace("{reflections}", reflectionLines || "لا توجد تأملات سابقة")
      .replace("{avoidStrategies}", avoidStrategies.map(s => `• ${s}`).join("\n") || "لا توجد")
      .replace("{betterApproach}", betterApproach || "تابع بنهج أكثر تفصيلاً");
  }

  // ── توليد تأمل جديد ─────────────────────────────────────────────────
  async generateReflection(
    taskId: string,
    goal: string,
    answer: string,
    outcome: "success" | "failure" | "partial",
    attemptNumber: number,
    callLLM: (messages: Array<{role: string; content: string}>) => Promise<string>,
    category = "general",
  ): Promise<Reflection> {
    const prompt = REFLECTION_PROMPT
      .replace("{goal}", goal.substring(0, 300))
      .replace("{attempt}", String(attemptNumber))
      .replace("{answer}", answer.substring(0, 400))
      .replace("{outcome}", outcome === "success" ? "نجاح" : outcome === "failure" ? "فشل" : "نجاح جزئي");

    let parsed: ParsedReflection;
    try {
      const response = await callLLM([{ role: "user", content: prompt }]);
      parsed = parseReflectionResponse(response);
    } catch {
      parsed = {
        score: outcome === "success" ? 0.8 : 0.3,
        reflection: `المحاولة ${attemptNumber}: ${outcome === "success" ? "اكتملت بنجاح" : "تحتاج تحسين"}`,
        keyLearnings: ["حلل المهمة بعمق أكبر", "تحقق من النتيجة", "استخدم أدوات متعددة"],
        avoidStrategies: ["التسرع في الإجابة", "افتراض النتيجة دون تحقق"],
        betterApproach: "تقسيم المهمة لخطوات أصغر والتحقق من كل خطوة",
      };
    }

    const reflection: Reflection = {
      id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      taskPattern: normalizePattern(goal),
      taskCategory: category,
      attempt: attemptNumber,
      outcome,
      score: parsed.score,
      reflection: parsed.reflection,
      keyLearnings: parsed.keyLearnings,
      avoidStrategies: parsed.avoidStrategies,
      betterApproach: parsed.betterApproach,
      timestamp: new Date().toISOString(),
      usedCount: 0,
    };

    // حفظ التأمل (الفاشلة والجزئية أهم للتعلم)
    if (outcome !== "success" || parsed.score > 0.75) {
      this.store.reflections.unshift(reflection);
      this.store.totalReflections++;

      // الاحتفاظ بالتأملات الأكثر قيمة
      if (this.store.reflections.length > MAX_REFLECTIONS) {
        this.store.reflections = this.store.reflections
          .sort((a, b) => {
            const scoreA = a.usedCount * 2 + (a.outcome !== "success" ? 1 : 0);
            const scoreB = b.usedCount * 2 + (b.outcome !== "success" ? 1 : 0);
            return scoreB - scoreA;
          })
          .slice(0, MAX_REFLECTIONS);
      }

      saveStore(this.store);
      console.log(`[Reflexion] ✓ تأمل جديد محفوظ: ${outcome} (نقاط: ${parsed.score.toFixed(2)})`);
    }

    // تحديث الجلسة
    const session = this.activeSessions.get(taskId);
    if (session) {
      session.attempts.push({
        attemptNumber,
        answer: answer.substring(0, 200),
        score: parsed.score,
        reflection: parsed.reflection,
        improved: attemptNumber > 1 && parsed.score > (session.attempts[session.attempts.length - 2]?.score || 0),
      });
      session.totalReflections++;
      if (parsed.score > session.bestScore) {
        session.bestScore = parsed.score;
        session.finalAnswer = answer;
      }
    }

    return reflection;
  }

  // ── تشغيل حلقة Reflexion الكاملة ────────────────────────────────────
  async runReflexionLoop(
    taskId: string,
    goal: string,
    executeAttempt: (enrichedGoal: string, attemptNum: number) => Promise<{ answer: string; success: boolean; score?: number }>,
    callLLM: (messages: Array<{role: string; content: string}>) => Promise<string>,
    options: {
      maxAttempts?: number;
      targetScore?: number;
      category?: string;
    } = {},
  ): Promise<{ finalAnswer: string; attempts: number; improved: boolean; bestScore: number }> {
    const { maxAttempts = 3, targetScore = 0.85, category = "general" } = options;

    this.activeSessions.set(taskId, {
      taskId,
      goal,
      attempts: [],
      bestScore: 0,
      finalAnswer: "",
      totalReflections: 0,
    });

    let bestAnswer = "";
    let bestScore = 0;
    let improved = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // بناء السياق المُحسَّن
      const reflexionContext = attempt > 1
        ? this.buildReflexionContext(goal, attempt)
        : "";

      const enrichedGoal = reflexionContext
        ? `${reflexionContext}\n\nالمهمة الأصلية: ${goal}`
        : goal;

      console.log(`[Reflexion] محاولة ${attempt}/${maxAttempts} للمهمة: ${goal.substring(0, 50)}`);

      // تنفيذ المحاولة
      const result = await executeAttempt(enrichedGoal, attempt);

      const currentScore = result.score ?? (result.success ? 0.85 : 0.3);

      if (currentScore > bestScore) {
        bestScore = currentScore;
        bestAnswer = result.answer;
        if (attempt > 1) improved = true;
      }

      // توليد تأمل
      const outcome = currentScore >= 0.85 ? "success" : currentScore >= 0.5 ? "partial" : "failure";
      await this.generateReflection(
        taskId, goal, result.answer, outcome, attempt, callLLM, category
      );

      // إذا وصلنا للهدف، نتوقف
      if (currentScore >= targetScore) {
        console.log(`[Reflexion] ✅ وصلنا للهدف في المحاولة ${attempt} (نقاط: ${currentScore.toFixed(2)})`);
        break;
      }

      // لا نكمل إذا كانت المحاولة الأخيرة
      if (attempt === maxAttempts) {
        console.log(`[Reflexion] انتهت المحاولات. أفضل نقاط: ${bestScore.toFixed(2)}`);
      }
    }

    this.activeSessions.delete(taskId);
    return { finalAnswer: bestAnswer, attempts: maxAttempts, improved, bestScore };
  }

  // ── إحصائيات ────────────────────────────────────────────────────────
  getStats() {
    const total = this.store.reflections.length;
    const byOutcome = this.store.reflections.reduce((acc, r) => {
      acc[r.outcome] = (acc[r.outcome] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const avgScore = total > 0
      ? this.store.reflections.reduce((s, r) => s + r.score, 0) / total
      : 0;

    return {
      totalReflections: total,
      byOutcome,
      averageScore: Math.round(avgScore * 100),
      mostUsed: this.store.reflections
        .sort((a, b) => b.usedCount - a.usedCount)
        .slice(0, 3)
        .map(r => ({ pattern: r.taskPattern.substring(0, 40), used: r.usedCount })),
    };
  }

  formatReflexionSummary(taskId: string): string {
    const session = this.activeSessions.get(taskId);
    if (!session) return "";

    const lines = [`🔄 **Reflexion Loop** — ${session.attempts.length} محاولة`];
    session.attempts.forEach(a => {
      const icon = a.score >= 0.85 ? "✅" : a.score >= 0.5 ? "⚠️" : "❌";
      lines.push(`  ${icon} محاولة ${a.attemptNumber}: نقاط ${Math.round(a.score * 100)}%${a.improved ? " ↑ تحسّن" : ""}`);
    });
    lines.push(`  🏆 أفضل نقاط: ${Math.round(session.bestScore * 100)}%`);
    return lines.join("\n");
  }
}

export const reflexionEngine = new ReflexionEngine();
