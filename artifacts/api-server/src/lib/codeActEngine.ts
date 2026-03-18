/**
 * codeActEngine.ts — محرك CodeAct (مستوحى من Manus AI)
 * ─────────────────────────────────────────────────────────────────────────────
 * بدلاً من استدعاء أدوات ثابتة (web_search, execute_code...)،
 * يقوم CodeAct بتوليد كود Python قابل للتنفيذ كإجراء مرن وقوي.
 *
 * المميزات:
 *   1. يجمع عدة أدوات في سكريبت واحد
 *   2. يتعامل مع الحالات الشرطية والحلقات
 *   3. يستخدم كامل بيئة Python
 *   4. نتائج أعلى جودة على المهام المعقدة
 *
 * المصدر: "Executable Code Actions Elicit Better LLM Agents" (ICML 2024)
 *         Manus AI Architecture Paper (arXiv 2505.02024)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import axios from "axios";
import { EventEmitter } from "events";

export interface CodeActAction {
  id: string;
  thought: string;
  code: string;
  language: "python" | "javascript" | "shell";
  expectedOutput: string;
  iteration: number;
}

export interface CodeActResult {
  success: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
  codeGenerated: string;
}

export interface CodeActSession {
  sessionId: string;
  goal: string;
  iteration: number;
  maxIterations: number;
  history: Array<{
    action: CodeActAction;
    result: CodeActResult;
  }>;
  completed: boolean;
  finalAnswer?: string;
  todoList: DynamicTodoList;
}

export interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "done" | "failed";
  priority: "high" | "medium" | "low";
  createdAt: string;
  completedAt?: string;
  notes?: string;
}

export interface DynamicTodoList {
  items: TodoItem[];
  lastUpdated: string;
  completionRate: number;
}

type LLMFn = (messages: Array<{ role: string; content: string }>, maxTokens?: number) => Promise<string>;

const AGENT_SERVICE = process.env.AGENT_SERVICE_URL || "http://localhost:8090";

const CODE_ACT_SYSTEM_PROMPT = `أنت وكيل CodeAct — متخصص في توليد كود Python قابل للتنفيذ كإجراءات.

قواعد أساسية:
1. كل إجراء = كود Python واحد منظّم
2. استخدم المكتبات المتاحة: requests, json, os, re, datetime, math, pathlib
3. الكود يُعالج الأخطاء داخلياً (try/except)
4. اطبع النتيجة النهائية بـ print()
5. الكود يجب أن يكون مكتفياً بذاته (self-contained)

التنسيق المطلوب:
THOUGHT: <تفكيرك في الخطوة التالية>
CODE:
\`\`\`python
<كود Python قابل للتنفيذ>
\`\`\`
EXPECTED: <ما تتوقع رؤيته في المخرجات>

قواعد التوقف:
- إذا حصلت على المعلومات المطلوبة → ابنِ الإجابة النهائية
- إذا فشل الكود 3 مرات → اعتذر وقدّم أفضل إجابة ممكنة
- لا تتجاوز 10 تكرارات في حالة واحدة`;

class CodeActEngine extends EventEmitter {
  private sessions: Map<string, CodeActSession> = new Map();

  createSession(sessionId: string, goal: string): CodeActSession {
    const session: CodeActSession = {
      sessionId,
      goal,
      iteration: 0,
      maxIterations: 10,
      history: [],
      completed: false,
      todoList: {
        items: [],
        lastUpdated: new Date().toISOString(),
        completionRate: 0,
      },
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  async generateAction(
    session: CodeActSession,
    callLLM: LLMFn,
    observation?: string,
  ): Promise<CodeActAction> {
    const historyText = session.history.map((h, i) =>
      `[تكرار ${i + 1}]\nتفكير: ${h.action.thought}\nكود:\n\`\`\`python\n${h.action.code}\n\`\`\`\nمخرجات: ${h.result.output.substring(0, 500)}\n${h.result.error ? `خطأ: ${h.result.error}` : ""}`
    ).join("\n\n---\n\n");

    const todoStatus = session.todoList.items.length > 0
      ? `\n\nقائمة المهام الحالية:\n${session.todoList.items.map(item =>
          `${item.status === "done" ? "✅" : item.status === "in_progress" ? "🔄" : item.status === "failed" ? "❌" : "⬜"} ${item.title}`
        ).join("\n")}`
      : "";

    const messages = [
      { role: "system", content: CODE_ACT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `**الهدف:** ${session.goal}${todoStatus}

**التكرار الحالي:** ${session.iteration + 1} من ${session.maxIterations}

${historyText ? `**التاريخ السابق:**\n${historyText}\n\n` : ""}${observation ? `**آخر ملاحظة:** ${observation}\n\n` : ""}الخطوة التالية?`,
      },
    ];

    const raw = await callLLM(messages, 1500);
    return this.parseAction(raw, session.iteration);
  }

  private parseAction(raw: string, iteration: number): CodeActAction {
    const thoughtMatch = raw.match(/THOUGHT:\s*(.+?)(?=CODE:|$)/s);
    const codeMatch = raw.match(/```(?:python|javascript|shell)?\s*([\s\S]+?)```/);
    const expectedMatch = raw.match(/EXPECTED:\s*(.+?)(?=\n\n|$)/s);

    const thought = thoughtMatch?.[1]?.trim() || raw.substring(0, 200);
    const code = codeMatch?.[1]?.trim() || this.extractBestCode(raw);
    const expectedOutput = expectedMatch?.[1]?.trim() || "نتيجة الكود";

    return {
      id: `codeact_${Date.now()}_${iteration}`,
      thought,
      code,
      language: "python",
      expectedOutput,
      iteration,
    };
  }

  private extractBestCode(raw: string): string {
    const lines = raw.split("\n");
    const codeLines = lines.filter(l =>
      l.match(/^(import |from |def |class |print|result =|data =|response =|output =)/),
    );

    if (codeLines.length > 0) return codeLines.join("\n");

    return `print("لم يتم توليد كود صحيح. الإجابة المباشرة:")
print("""${raw.substring(0, 500)}""")`;
  }

  async executeAction(action: CodeActAction): Promise<CodeActResult> {
    const start = Date.now();

    try {
      const res = await axios.post(`${AGENT_SERVICE}/execute`, {
        code: action.code,
        language: action.language,
      }, { timeout: 30000 });

      const output = res.data?.output || res.data?.result || "تم التنفيذ بنجاح";
      return {
        success: true,
        output: String(output),
        executionTimeMs: Date.now() - start,
        codeGenerated: action.code,
      };
    } catch (err: any) {
      const pyError = err.response?.data?.error || err.message;

      return {
        success: false,
        output: "",
        error: pyError || "فشل التنفيذ",
        executionTimeMs: Date.now() - start,
        codeGenerated: action.code,
      };
    }
  }

  async runSession(
    sessionId: string,
    goal: string,
    callLLM: LLMFn,
    onStep?: (action: CodeActAction, result: CodeActResult, iteration: number) => void,
  ): Promise<{ finalAnswer: string; session: CodeActSession }> {
    const session = this.createSession(sessionId, goal);

    session.todoList = await this.initializeTodoList(goal, callLLM);
    this.emit("todoUpdate", { sessionId, todoList: session.todoList });

    let observation: string | undefined;
    let consecutiveFailures = 0;

    while (session.iteration < session.maxIterations && !session.completed) {
      const action = await this.generateAction(session, callLLM, observation);

      if (this.isCompletionSignal(action.thought, action.code)) {
        session.completed = true;
        session.finalAnswer = this.extractFinalAnswer(action.thought, observation || "");
        break;
      }

      this.updateTodoInProgress(session, session.iteration);

      const result = await this.executeAction(action);
      session.history.push({ action, result });

      if (result.success) {
        consecutiveFailures = 0;
        observation = result.output;
        this.markTodoDone(session, session.iteration, result.output.substring(0, 200));
      } else {
        consecutiveFailures++;
        observation = `فشل التنفيذ: ${result.error}\nالكود:\n${action.code.substring(0, 200)}`;
        this.markTodoFailed(session, session.iteration, result.error || "");
      }

      session.todoList.completionRate = this.calcCompletionRate(session.todoList);
      session.todoList.lastUpdated = new Date().toISOString();

      this.emit("todoUpdate", { sessionId, todoList: session.todoList });
      this.emit("actionComplete", { sessionId, action, result, iteration: session.iteration });

      if (onStep) onStep(action, result, session.iteration);

      session.iteration++;

      if (consecutiveFailures >= 3) {
        observation = `تحذير: فشل ${consecutiveFailures} مرات متتالية. قدّم أفضل إجابة ممكنة من المعلومات المتوفرة.`;
      }
    }

    if (!session.finalAnswer) {
      session.finalAnswer = await this.synthesizeFinalAnswer(session, callLLM);
    }

    session.completed = true;
    this.sessions.set(sessionId, session);

    return { finalAnswer: session.finalAnswer, session };
  }

  private async initializeTodoList(goal: string, callLLM: LLMFn): Promise<DynamicTodoList> {
    try {
      const raw = await callLLM([
        {
          role: "system",
          content: "أنت مخطط مهام. قسّم الهدف إلى 3-6 خطوات واضحة. أجب بـ JSON فقط.",
        },
        {
          role: "user",
          content: `قسّم هذا الهدف إلى خطوات:
"${goal}"

أجب بـ JSON:
{
  "items": [
    {"title": "الخطوة 1", "priority": "high"},
    {"title": "الخطوة 2", "priority": "medium"}
  ]
}`,
        },
      ], 600);

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const items: TodoItem[] = (parsed.items || []).map((item: { title: string; priority?: string }, i: number) => ({
          id: `todo_${Date.now()}_${i}`,
          title: item.title,
          status: "pending" as const,
          priority: (item.priority || "medium") as "high" | "medium" | "low",
          createdAt: new Date().toISOString(),
        }));

        return {
          items,
          lastUpdated: new Date().toISOString(),
          completionRate: 0,
        };
      }
    } catch (e) {
      console.warn("[CodeActEngine] فشل إنشاء قائمة المهام:", e);
    }

    return {
      items: [{
        id: `todo_${Date.now()}_0`,
        title: goal.substring(0, 100),
        status: "pending",
        priority: "high",
        createdAt: new Date().toISOString(),
      }],
      lastUpdated: new Date().toISOString(),
      completionRate: 0,
    };
  }

  private updateTodoInProgress(session: CodeActSession, iteration: number): void {
    const item = session.todoList.items[iteration];
    if (item && item.status === "pending") {
      item.status = "in_progress";
    }
  }

  private markTodoDone(session: CodeActSession, iteration: number, notes: string): void {
    const item = session.todoList.items[iteration];
    if (item) {
      item.status = "done";
      item.completedAt = new Date().toISOString();
      item.notes = notes;
    }
  }

  private markTodoFailed(session: CodeActSession, iteration: number, error: string): void {
    const item = session.todoList.items[iteration];
    if (item) {
      item.status = "failed";
      item.notes = error.substring(0, 200);
    }
  }

  private calcCompletionRate(todoList: DynamicTodoList): number {
    if (todoList.items.length === 0) return 0;
    const done = todoList.items.filter(i => i.status === "done").length;
    return Math.round((done / todoList.items.length) * 100);
  }

  private isCompletionSignal(thought: string, code: string): boolean {
    const completionWords = ["اكتملت", "انتهيت", "النتيجة النهائية", "الإجابة هي", "DONE", "COMPLETE", "FINAL_ANSWER"];
    return completionWords.some(w => thought.toLowerCase().includes(w.toLowerCase())) ||
      code.includes("FINAL_ANSWER") || code.includes("# DONE");
  }

  private extractFinalAnswer(thought: string, lastObservation: string): string {
    if (thought.length > 50) return thought;
    return lastObservation.substring(0, 2000);
  }

  private async synthesizeFinalAnswer(session: CodeActSession, callLLM: LLMFn): Promise<string> {
    const allOutputs = session.history
      .filter(h => h.result.success && h.result.output.length > 10)
      .map(h => h.result.output.substring(0, 400))
      .join("\n\n---\n\n");

    if (!allOutputs) {
      return "لم أتمكن من إكمال المهمة. يرجى المحاولة مرة أخرى.";
    }

    const raw = await callLLM([
      {
        role: "system",
        content: "اجمع النتائج في إجابة شاملة ومنسّقة باللغة العربية.",
      },
      {
        role: "user",
        content: `**الهدف:** ${session.goal}\n\n**المخرجات المجمّعة:**\n${allOutputs.substring(0, 3000)}\n\nأعطِ إجابة نهائية شاملة:`,
      },
    ], 1500);

    return raw;
  }

  getSession(sessionId: string): CodeActSession | undefined {
    return this.sessions.get(sessionId);
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  formatTodoList(todoList: DynamicTodoList): string {
    if (todoList.items.length === 0) return "";
    const icons: Record<string, string> = {
      done: "✅",
      in_progress: "🔄",
      failed: "❌",
      pending: "⬜",
    };
    const lines = todoList.items.map(item =>
      `${icons[item.status] || "⬜"} ${item.title}${item.notes ? ` — ${item.notes.substring(0, 80)}` : ""}`
    );
    return `📋 قائمة المهام (${todoList.completionRate}% مكتمل):\n${lines.join("\n")}`;
  }
}

export const codeActEngine = new CodeActEngine();
