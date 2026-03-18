/**
 * memory.ts — نظام الذاكرة الأساسي المحسّن
 * ─────────────────────────────────────────────────────────────────────────────
 * محسّن بـ:
 *   - حفظ دائم على الديسك (بين إعادة التشغيل)
 *   - بحث أفضل بالكلمات المفتاحية + الأوزان
 *   - ذاكرة إخفاق مُعزَّزة للتعلم من الأخطاء
 *   - تسجيل نجاح المهام لتحسين الدقة
 *   - حد موسّع للذاكرة (500 → من 100)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";

export interface MemoryEntry {
  id: string;
  type: "task" | "result" | "preference" | "fact" | "failure" | "success";
  content: string;
  tags: string[];
  timestamp: Date;
  taskId?: string;
  importance: number;
  failureReason?: string;
  failureStrategy?: string;
  score?: number;
}

export interface ShortTermMemory {
  taskId: string;
  messages: Array<{ role: string; content: string }>;
  context: string;
  stepResults: Record<string, string>;
}

const DATA_DIR  = path.resolve(process.cwd(), "data");
const LONG_TERM_FILE = path.join(DATA_DIR, "long_term_memory.json");
const MAX_LONG_TERM = 500;
const MAX_SHORT_TERM_MESSAGES = 25;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadLongTerm(): MemoryEntry[] {
  ensureDir();
  try {
    if (fs.existsSync(LONG_TERM_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LONG_TERM_FILE, "utf8"));
      return (raw as any[]).map(e => ({ ...e, timestamp: new Date(e.timestamp) }));
    }
  } catch {}
  return [];
}

function saveLongTerm(entries: MemoryEntry[]) {
  ensureDir();
  try {
    fs.writeFileSync(LONG_TERM_FILE, JSON.stringify(entries, null, 2));
  } catch (e: any) {
    console.error("[Memory] فشل الحفظ:", e.message);
  }
}

class MemorySystem {
  private longTermMemory: MemoryEntry[] = loadLongTerm();
  private shortTermMemory: Map<string, ShortTermMemory> = new Map();

  constructor() {
    console.log(`[Memory] تم تحميل ${this.longTermMemory.length} ذكرى طويلة الأمد`);
  }

  initSession(taskId: string, goal: string): void {
    this.shortTermMemory.set(taskId, {
      taskId,
      messages: [],
      context: goal,
      stepResults: {},
    });
  }

  addToShortTerm(
    taskId: string,
    role: "user" | "assistant" | "system",
    content: string,
  ): void {
    const session = this.shortTermMemory.get(taskId);
    if (!session) return;

    session.messages.push({ role, content });

    if (session.messages.length > MAX_SHORT_TERM_MESSAGES) {
      const systemMsgs = session.messages.filter((m) => m.role === "system");
      const otherMsgs = session.messages
        .filter((m) => m.role !== "system")
        .slice(-MAX_SHORT_TERM_MESSAGES + systemMsgs.length);
      session.messages = [...systemMsgs, ...otherMsgs];
    }
  }

  addStepResult(taskId: string, step: string, result: string): void {
    const session = this.shortTermMemory.get(taskId);
    if (!session) return;
    session.stepResults[step] = result;
  }

  getShortTerm(taskId: string): ShortTermMemory | null {
    return this.shortTermMemory.get(taskId) || null;
  }

  getSessionContext(taskId: string): string {
    const session = this.shortTermMemory.get(taskId);
    if (!session) return "";

    const stepSummary = Object.entries(session.stepResults)
      .map(([step, result]) => `${step}: ${result.substring(0, 150)}`)
      .join("\n");

    return stepSummary
      ? `السياق السابق:\n${stepSummary}`
      : "";
  }

  clearSession(taskId: string): void {
    const session = this.shortTermMemory.get(taskId);
    if (session) {
      this.saveToLongTerm(session);
      this.shortTermMemory.delete(taskId);
    }
  }

  private saveToLongTerm(session: ShortTermMemory): void {
    const results = Object.values(session.stepResults);
    if (results.length === 0) return;

    const entry: MemoryEntry = {
      id: `mem_${Date.now()}`,
      type: "task",
      content: `المهمة: ${session.context}\nالنتيجة: ${results[results.length - 1]?.substring(0, 200) || ""}`,
      tags: this.extractTags(session.context),
      timestamp: new Date(),
      taskId: session.taskId,
      importance: this.calculateImportance(session),
    };

    this.longTermMemory.unshift(entry);
    this.pruneAndSave();
  }

  private pruneAndSave() {
    if (this.longTermMemory.length > MAX_LONG_TERM) {
      this.longTermMemory = this.longTermMemory
        .sort((a, b) => b.importance - a.importance)
        .slice(0, MAX_LONG_TERM);
    }
    saveLongTerm(this.longTermMemory);
  }

  searchMemory(query: string, limit = 5): MemoryEntry[] {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length === 0) return this.longTermMemory.slice(0, limit);

    return this.longTermMemory
      .map((entry) => {
        const contentLower = entry.content.toLowerCase();
        const score = queryWords.reduce((acc, w) => {
          if (contentLower.includes(w)) acc += 2;
          if (entry.tags.some((t) => t.includes(w))) acc += 3;
          return acc;
        }, 0);
        return { entry, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.importance - a.entry.importance)
      .slice(0, limit)
      .map((r) => r.entry);
  }

  getRecentMemory(limit = 5): MemoryEntry[] {
    return this.longTermMemory.slice(0, limit);
  }

  buildContextFromMemory(goal: string): string {
    const relevant = this.searchMemory(goal, 3);
    if (relevant.length === 0) return "";
    return `ذاكرة طويلة الأمد (مهام سابقة مشابهة):\n${relevant.map((e) => `• ${e.content.substring(0, 120)}`).join("\n")}`;
  }

  private extractTags(text: string): string[] {
    const tags: string[] = [];
    const keywords = [
      "يوتيوب", "youtube",
      "فيسبوك", "facebook", "ميتا", "meta",
      "جوجل", "google",
      "github", "جيتهاب",
      "كود", "برمجة", "code", "programming",
      "بحث", "research",
      "تسجيل", "دخول", "login",
      "تحميل", "download",
      "إنشاء", "create",
      "واتساب", "whatsapp",
      "متصفح", "browser",
      "api", "تطبيق",
      "تحليل", "analyze",
      "ترجمة", "translate",
    ];
    for (const kw of keywords) {
      if (text.toLowerCase().includes(kw.toLowerCase())) tags.push(kw);
    }
    return tags;
  }

  private calculateImportance(session: ShortTermMemory): number {
    let score = 1;
    const stepCount = Object.keys(session.stepResults).length;
    if (stepCount > 5) score += 3;
    else if (stepCount > 3) score += 2;
    else if (stepCount > 0) score += 1;
    if (session.context.length > 100) score += 1;
    if (session.context.length > 200) score += 1;
    return score;
  }

  recordFailure(taskId: string, goal: string, reason: string, strategy: string): void {
    const entry: MemoryEntry = {
      id: `fail_${Date.now()}`,
      type: "failure",
      content: `فشلت المهمة: ${goal.substring(0, 150)}\nالسبب: ${reason.substring(0, 150)}`,
      tags: this.extractTags(goal),
      timestamp: new Date(),
      taskId,
      importance: 4,
      failureReason: reason.substring(0, 300),
      failureStrategy: strategy.substring(0, 200),
    };
    this.longTermMemory.unshift(entry);
    this.pruneAndSave();
  }

  recordSuccess(taskId: string, goal: string, result: string, score = 0.8): void {
    const entry: MemoryEntry = {
      id: `succ_${Date.now()}`,
      type: "success",
      content: `نجحت المهمة: ${goal.substring(0, 150)}\nالنتيجة: ${result.substring(0, 200)}`,
      tags: this.extractTags(goal),
      timestamp: new Date(),
      taskId,
      importance: 3 + Math.round(score * 2),
      score,
    };
    this.longTermMemory.unshift(entry);
    this.pruneAndSave();
    console.log(`[Memory] ✅ نجاح محفوظ: ${goal.substring(0, 50)}`);
  }

  getFailureHints(goal: string): string {
    const queryWords = goal.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const failures = this.longTermMemory
      .filter(e => e.type === "failure")
      .map(e => ({
        entry: e,
        score: queryWords.filter(w =>
          e.content.toLowerCase().includes(w) ||
          e.tags.some(t => t.includes(w))
        ).length,
      }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    if (failures.length === 0) return "";
    return `⚠️ تحذير من أخطاء سابقة مشابهة:\n${failures.map(f => `• ${f.entry.content.substring(0, 120)} → تجنّب: ${f.entry.failureStrategy || "نفس النهج"}`).join("\n")}`;
  }

  getSuccessHints(goal: string): string {
    const queryWords = goal.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const successes = this.longTermMemory
      .filter(e => e.type === "success")
      .map(e => ({
        entry: e,
        score: queryWords.filter(w =>
          e.content.toLowerCase().includes(w) ||
          e.tags.some(t => t.includes(w))
        ).length,
      }))
      .filter(r => r.score > 1)
      .sort((a, b) => b.score - a.score || (b.entry.score || 0) - (a.entry.score || 0))
      .slice(0, 2);

    if (successes.length === 0) return "";
    return `💡 مهام ناجحة مشابهة:\n${successes.map(s => `• ${s.entry.content.substring(0, 100)}`).join("\n")}`;
  }

  getStats() {
    const byType = this.longTermMemory.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      longTermCount: this.longTermMemory.length,
      activeSessionsCount: this.shortTermMemory.size,
      byType,
      successRate: byType.success && (byType.success + (byType.failure || 0)) > 0
        ? Math.round((byType.success / (byType.success + (byType.failure || 0))) * 100)
        : 0,
    };
  }
}

export const memorySystem = new MemorySystem();
