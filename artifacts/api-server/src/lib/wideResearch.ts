/**
 * wideResearch.ts — نظام البحث الموسّع (Wide Research System)
 * ─────────────────────────────────────────────────────────────────────────────
 * مستوحى من Manus AI 1.6 — "Wide Research: 100× Parallel Agents"
 *
 * بدلاً من وكيل واحد يبحث بالتسلسل، يُطلق هذا النظام عدة وكلاء كاملة
 * تعمل بالتوازي على أجزاء مختلفة من المهمة البحثية الكبيرة.
 *
 * البنية:
 *   1. ResearchOrchestrator — يقسّم المهمة ويوزّع على الفرق
 *   2. ResearchTeam[] — كل فريق يحل جزءاً مستقلاً
 *   3. SynthesisAgent — يجمع النتائج في تقرير موحّد
 *
 * Patterns: Swarm + Hierarchical (Hybrid Production Standard)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from "events";
import axios from "axios";

export interface ResearchSubTask {
  id: string;
  title: string;
  query: string;
  angle: string;
  assignedTo: string;
  status: "pending" | "running" | "done" | "failed";
  result?: string;
  sources?: string[];
  startedAt?: string;
  completedAt?: string;
}

export interface WideResearchPlan {
  mainGoal: string;
  subTasks: ResearchSubTask[];
  strategy: "parallel" | "hierarchical" | "swarm";
  estimatedAgents: number;
}

export interface WideResearchResult {
  goal: string;
  subResults: Array<{ task: ResearchSubTask; result: string }>;
  synthesizedReport: string;
  totalDurationMs: number;
  agentsUsed: number;
  coverageScore: number;
}

type LLMFn = (messages: Array<{ role: string; content: string }>, maxTokens?: number) => Promise<string>;

const DECOMPOSE_PROMPT = `أنت منسّق بحثي متخصص. قسّم المهمة البحثية الكبيرة إلى 4-8 محاور بحثية مستقلة يمكن البحث فيها بالتوازي.

قواعد التقسيم:
- كل محور يجب أن يكون مستقلاً تماماً
- تغطية شاملة للموضوع من زوايا مختلفة
- لا تكرار بين المحاور
- كل محور قابل للبحث والإجابة عنه في 2-3 دقائق

أجب بـ JSON فقط:
{
  "subTasks": [
    {
      "title": "اسم المحور",
      "query": "استعلام البحث التفصيلي",
      "angle": "الزاوية التحليلية (مثل: تاريخي، تقني، مقارن، اقتصادي)"
    }
  ],
  "strategy": "parallel"
}`;

const RESEARCHER_PROMPT = `أنت باحث متخصص. مهمتك البحث في محور محدد وتقديم تقرير شامل ومفصّل.

المتطلبات:
- معلومات دقيقة ومحدّثة
- نقاط رئيسية واضحة
- أرقام وإحصاءات عند الإمكان
- مصادر مقترحة
- تنسيق Markdown احترافي

الطول: 300-500 كلمة للمحور الواحد`;

class WideResearchSystem extends EventEmitter {
  private activeResearches: Map<string, WideResearchPlan> = new Map();

  async shouldUseWideResearch(goal: string): Promise<boolean> {
    const keywords = [
      "ابحث", "بحث شامل", "تحليل معمق", "دراسة", "مقارنة مفصلة",
      "research", "comprehensive", "in-depth", "compare", "analyze",
    ];
    const wordCount = goal.split(/\s+/).length;
    return wordCount > 15 || keywords.some(k => goal.toLowerCase().includes(k.toLowerCase()));
  }

  async decompose(goal: string, callLLM: LLMFn): Promise<WideResearchPlan> {
    const raw = await callLLM([
      { role: "system", content: DECOMPOSE_PROMPT },
      { role: "user", content: `**المهمة البحثية:**\n${goal}` },
    ], 1200);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let subTasks: ResearchSubTask[] = [];

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        subTasks = (parsed.subTasks || []).map((st: { title: string; query: string; angle: string }, i: number) => ({
          id: `rt_${Date.now()}_${i}`,
          title: st.title || `محور ${i + 1}`,
          query: st.query || goal,
          angle: st.angle || "عام",
          assignedTo: `researcher_${i}`,
          status: "pending" as const,
        }));
      } catch {
        console.warn("[WideResearch] فشل تحليل JSON");
      }
    }

    if (subTasks.length === 0) {
      subTasks = this.generateDefaultSubTasks(goal);
    }

    const plan: WideResearchPlan = {
      mainGoal: goal,
      subTasks,
      strategy: "parallel",
      estimatedAgents: subTasks.length,
    };

    this.activeResearches.set(goal.substring(0, 50), plan);
    return plan;
  }

  private generateDefaultSubTasks(goal: string): ResearchSubTask[] {
    const angles = ["تعريف وخلفية", "الوضع الراهن والتطورات", "التحديات والفرص", "مقارنة وتحليل", "التوقعات المستقبلية"];
    return angles.map((angle, i) => ({
      id: `rt_default_${i}`,
      title: `${angle}: ${goal.substring(0, 40)}`,
      query: `${goal} - ${angle}`,
      angle,
      assignedTo: `researcher_${i}`,
      status: "pending" as const,
    }));
  }

  async executeSubTask(
    task: ResearchSubTask,
    callLLM: LLMFn,
    onProgress?: (taskId: string, status: string) => void,
  ): Promise<string> {
    task.status = "running";
    task.startedAt = new Date().toISOString();
    if (onProgress) onProgress(task.id, "running");

    const messages = [
      { role: "system", content: RESEARCHER_PROMPT },
      {
        role: "user",
        content: `**محور البحث:** ${task.title}\n**الزاوية:** ${task.angle}\n**الاستعلام:** ${task.query}\n\nاكتب تقرير بحثي شامل:`,
      },
    ];

    try {
      const result = await callLLM(messages, 1500);
      task.status = "done";
      task.completedAt = new Date().toISOString();
      task.result = result;
      if (onProgress) onProgress(task.id, "done");
      return result;
    } catch (err: any) {
      task.status = "failed";
      task.completedAt = new Date().toISOString();
      if (onProgress) onProgress(task.id, "failed");
      return `فشل البحث في: ${task.title}`;
    }
  }

  async executeParallel(
    plan: WideResearchPlan,
    callLLM: LLMFn,
    onTaskUpdate?: (taskId: string, status: string, result?: string) => void,
  ): Promise<Array<{ task: ResearchSubTask; result: string }>> {
    this.emit("researchStart", {
      goal: plan.mainGoal,
      totalTasks: plan.subTasks.length,
    });

    const BATCH_SIZE = 3;
    const allResults: Array<{ task: ResearchSubTask; result: string }> = [];

    for (let i = 0; i < plan.subTasks.length; i += BATCH_SIZE) {
      const batch = plan.subTasks.slice(i, i + BATCH_SIZE);

      this.emit("batchStart", {
        batchIndex: Math.floor(i / BATCH_SIZE),
        tasks: batch.map(t => t.title),
      });

      const batchResults = await Promise.all(
        batch.map(async task => {
          const result = await this.executeSubTask(task, callLLM, (taskId, status) => {
            this.emit("taskUpdate", { taskId, status, taskTitle: task.title });
            if (onTaskUpdate) onTaskUpdate(taskId, status, task.result);
          });
          return { task, result };
        }),
      );

      allResults.push(...batchResults);

      this.emit("batchComplete", {
        batchIndex: Math.floor(i / BATCH_SIZE),
        completed: allResults.length,
        total: plan.subTasks.length,
      });
    }

    return allResults;
  }

  async synthesize(
    goal: string,
    subResults: Array<{ task: ResearchSubTask; result: string }>,
    callLLM: LLMFn,
  ): Promise<string> {
    const resultsText = subResults
      .filter(r => r.task.status === "done")
      .map((r, i) =>
        `## ${i + 1}. ${r.task.title} (${r.task.angle})\n${r.result.substring(0, 800)}`
      )
      .join("\n\n---\n\n");

    const synthesisPrompt = `أنت وكيل التوليف. لديك نتائج بحثية من ${subResults.length} وكيل متخصص.
اجمعها في تقرير شامل ومترابط يعالج الهدف الأصلي بعمق.

**الهدف الأصلي:** ${goal}

**النتائج البحثية:**
${resultsText.substring(0, 4000)}

أكتب تقرير موحّد احترافي بتنسيق Markdown:
- مقدمة شاملة
- أقسام منظمة
- جداول مقارنة عند الحاجة
- خلاصة وتوصيات
- لا تكرار للمعلومات`;

    const synthesized = await callLLM([
      {
        role: "system",
        content: "أنت وكيل توليف متخصص في دمج نتائج بحثية متعددة في تقارير موحدة.",
      },
      { role: "user", content: synthesisPrompt },
    ], 2000);

    return synthesized;
  }

  async run(
    goal: string,
    callLLM: LLMFn,
    onProgress?: (event: string, data: unknown) => void,
  ): Promise<WideResearchResult> {
    const startTime = Date.now();

    if (onProgress) onProgress("decomposing", { goal });
    const plan = await this.decompose(goal, callLLM);

    if (onProgress) onProgress("plan_ready", {
      subTasks: plan.subTasks.map(t => ({ id: t.id, title: t.title, angle: t.angle })),
      totalAgents: plan.estimatedAgents,
    });

    const subResults = await this.executeParallel(plan, callLLM, (taskId, status, result) => {
      if (onProgress) onProgress("task_update", { taskId, status, result });
    });

    if (onProgress) onProgress("synthesizing", { completedTasks: subResults.filter(r => r.task.status === "done").length });
    const synthesizedReport = await this.synthesize(goal, subResults, callLLM);

    const doneCount = subResults.filter(r => r.task.status === "done").length;
    const coverageScore = Math.round((doneCount / plan.subTasks.length) * 100);

    const result: WideResearchResult = {
      goal,
      subResults,
      synthesizedReport,
      totalDurationMs: Date.now() - startTime,
      agentsUsed: plan.subTasks.length,
      coverageScore,
    };

    if (onProgress) onProgress("complete", result);
    this.emit("researchComplete", result);

    return result;
  }

  getPlan(goalKey: string): WideResearchPlan | undefined {
    return this.activeResearches.get(goalKey);
  }

  formatProgressReport(plan: WideResearchPlan): string {
    const icons: Record<string, string> = {
      done: "✅",
      running: "🔄",
      failed: "❌",
      pending: "⏳",
    };

    const taskLines = plan.subTasks.map(t =>
      `${icons[t.status] || "⏳"} [${t.angle}] ${t.title}`
    );

    const done = plan.subTasks.filter(t => t.status === "done").length;
    return `🔬 **البحث الموسّع** (${done}/${plan.subTasks.length} مكتمل)\n${taskLines.join("\n")}`;
  }
}

export const wideResearch = new WideResearchSystem();
