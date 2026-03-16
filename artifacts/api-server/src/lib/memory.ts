export interface MemoryEntry {
  id: string;
  type: "task" | "result" | "preference" | "fact" | "failure";
  content: string;
  tags: string[];
  timestamp: Date;
  taskId?: string;
  importance: number;
  failureReason?: string;
  failureStrategy?: string;
}

export interface ShortTermMemory {
  taskId: string;
  messages: Array<{ role: string; content: string }>;
  context: string;
  stepResults: Record<string, string>;
}

class MemorySystem {
  private longTermMemory: MemoryEntry[] = [];
  private shortTermMemory: Map<string, ShortTermMemory> = new Map();
  private readonly MAX_LONG_TERM = 100;
  private readonly MAX_SHORT_TERM_MESSAGES = 20;

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

    if (session.messages.length > this.MAX_SHORT_TERM_MESSAGES) {
      const systemMsgs = session.messages.filter((m) => m.role === "system");
      const otherMsgs = session.messages
        .filter((m) => m.role !== "system")
        .slice(-this.MAX_SHORT_TERM_MESSAGES + systemMsgs.length);
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

    if (this.longTermMemory.length > this.MAX_LONG_TERM) {
      this.longTermMemory = this.longTermMemory
        .sort((a, b) => b.importance - a.importance)
        .slice(0, this.MAX_LONG_TERM);
    }
  }

  searchMemory(query: string, limit = 5): MemoryEntry[] {
    const queryWords = query.toLowerCase().split(/\s+/);
    return this.longTermMemory
      .map((entry) => ({
        entry,
        score: queryWords.filter(
          (w) =>
            entry.content.toLowerCase().includes(w) ||
            entry.tags.some((t) => t.includes(w)),
        ).length,
      }))
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
    return `ذاكرة طويلة الأمد (مهام سابقة مشابهة):\n${relevant.map((e) => `• ${e.content.substring(0, 100)}`).join("\n")}`;
  }

  private extractTags(text: string): string[] {
    const tags: string[] = [];
    const keywords = [
      "يوتيوب", "youtube",
      "فيسبوك", "facebook", "ميتا", "meta",
      "جوجل", "google",
      "github", "جيتهاب",
      "كود", "برمجة",
      "بحث", "research",
      "تسجيل", "دخول", "login",
      "تحميل", "download",
      "إنشاء", "create",
      "واتساب", "whatsapp",
      "متصفح", "browser",
      "api", "تطبيق",
    ];
    for (const kw of keywords) {
      if (text.toLowerCase().includes(kw.toLowerCase())) tags.push(kw);
    }
    return tags;
  }

  private calculateImportance(session: ShortTermMemory): number {
    let score = 1;
    if (Object.keys(session.stepResults).length > 3) score += 2;
    if (session.context.length > 50) score += 1;
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
      importance: 3,
      failureReason: reason.substring(0, 300),
      failureStrategy: strategy.substring(0, 200),
    };
    this.longTermMemory.unshift(entry);
    if (this.longTermMemory.length > this.MAX_LONG_TERM) {
      this.longTermMemory = this.longTermMemory
        .sort((a, b) => b.importance - a.importance)
        .slice(0, this.MAX_LONG_TERM);
    }
  }

  getFailureHints(goal: string): string {
    const queryWords = goal.toLowerCase().split(/\s+/);
    const failures = this.longTermMemory
      .filter(e => e.type === "failure")
      .map(e => ({
        entry: e,
        score: queryWords.filter(w => e.content.toLowerCase().includes(w) || e.tags.some(t => t.includes(w))).length,
      }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);

    if (failures.length === 0) return "";
    return `⚠️ تحذير من أخطاء سابقة مشابهة:\n${failures.map(f => `• ${f.entry.content.substring(0, 120)} → تجنّب: ${f.entry.failureStrategy || "نفس النهج"}`).join("\n")}`;
  }

  getStats() {
    return {
      longTermCount: this.longTermMemory.length,
      activeSessionsCount: this.shortTermMemory.size,
    };
  }
}

export const memorySystem = new MemorySystem();
