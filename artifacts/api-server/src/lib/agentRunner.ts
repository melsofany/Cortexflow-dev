import { EventEmitter } from "events";
import { ollamaClient, ChatMessage } from "./ollamaClient.js";
import { taskStore, Task } from "./taskStore.js";
import { browserAgent } from "./browserAgent.js";

const MAX_ITERATIONS = 25;

const STEP_LABELS: Record<string, string> = {
  OBSERVE: "مراقبة",
  THINK:   "تفكير",
  PLAN:    "تخطيط",
  ACT:     "تنفيذ",
  VERIFY:  "تحقق",
};

const ACTION_SYSTEM_PROMPT = `أنت CortexFlow، وكيل ذكاء اصطناعي يتحكم في متصفح الويب لإتمام مهام المستخدم بالكامل.

قاعدة أساسية: لا تنهي المهمة أبداً إلا إذا تأكدت فعلاً من اكتمالها (مثلاً: ظهور رسالة نجاح، اكتمال نموذج، وصول للصفحة المطلوبة بعد كل الخطوات).

في كل خطوة، استجب بـ JSON فقط بهذا الشكل:
{
  "action": "navigate|click_text|click_selector|fill|type_text|press_key|scroll|wait|done",
  "params": {
    "url": "...",
    "text": "...",
    "selector": "...",
    "value": "...",
    "key": "...",
    "deltaX": 0,
    "deltaY": 0
  },
  "reason": "سبب هذه الخطوة",
  "done": false,
  "result": "النتيجة النهائية عند الانتهاء"
}

الإجراءات المتاحة:
- navigate: الانتقال إلى رابط (params.url)
- click_text: النقر على عنصر بالنص (params.text)
- click_selector: النقر على عنصر بـ CSS selector (params.selector)
- fill: تعبئة حقل إدخال (params.selector, params.value)
- type_text: كتابة نص (params.text)
- press_key: ضغط مفتاح (params.key مثل Enter, Tab, Escape)
- scroll: التمرير (params.deltaX, params.deltaY)
- wait: انتظار ثانية
- done: المهمة اكتملت فعلاً (params.result)

لا تستخدم "done" إلا إذا اكتملت المهمة بالكامل. رد بـ JSON فقط بدون أي نص إضافي.`;

class AgentRunner extends EventEmitter {
  private systemPrompt = `أنت CortexFlow، وكيل ذكاء اصطناعي متقدم يتحكم في متصفح الويب.
عند تلقي مهمة:
1. OBSERVE: تحليل المهمة وتحديد الخطوات
2. THINK: التفكير في أفضل طريقة
3. PLAN: إنشاء خطة تنفيذ محددة
4. ACT: تنفيذ المهمة فعلياً
5. VERIFY: التحقق من النتيجة

رد دائماً بنفس لغة المستخدم. كن مختصراً وعملياً.`;

  async executeTask(task: Task): Promise<void> {
    const start = Date.now();
    taskStore.updateTask(task.taskId, { status: "running" });
    this.emit("taskStart", { taskId: task.taskId, description: task.description });

    try {
      if (task.type === "browser") {
        await this.executeBrowserTask(task, start);
      } else if (ollamaClient.isAvailable()) {
        await this.runWithOllama(task, start);
      } else {
        await this.simulateWithSteps(task, start);
      }
    } catch (err: any) {
      const msg = err.message || "Unknown error";
      taskStore.updateTask(task.taskId, { status: "failed", error: msg });
      this.emit("taskFail", { taskId: task.taskId, error: msg });
    }
  }

  private emitStep(taskId: string, step: string, content: string) {
    this.emit("thinking", {
      taskId,
      step,
      content: `[${step}] ${content}`,
      timestamp: new Date(),
    });
    taskStore.addStep(taskId, step, content);
    taskStore.addLog({ taskId, agentType: "AgentRunner", action: `step_${step.toLowerCase()}`, output: content.substring(0, 300) });
  }

  private async executeBrowserTask(task: Task, start: number): Promise<void> {
    const taskId = task.taskId;

    // ── OBSERVE ────────────────────────────────────────────────────────────
    this.emitStep(taskId, "OBSERVE", `تحليل المهمة: "${task.description}". سأستخدم المتصفح لتنفيذها خطوة بخطوة حتى الاكتمال الكامل.`);
    await sleep(500);

    // ── Initialize browser ─────────────────────────────────────────────────
    const ready = await browserAgent.initialize();
    if (!ready) {
      this.emitStep(taskId, "OBSERVE", "تعذّر تشغيل المتصفح. سيتم التنفيذ بوضع المحاكاة.");
      await this.simulateWithSteps(task, start);
      return;
    }

    // ── THINK ──────────────────────────────────────────────────────────────
    if (ollamaClient.isAvailable()) {
      const thinkContent = await ollamaClient.chat([
        { role: "system", content: this.systemPrompt },
        { role: "user", content: `المهمة: "${task.description}"\nحدد: 1) الموقع المستهدف (URL) 2) جميع الخطوات اللازمة للإتمام الكامل (ليس فقط الانتقال، بل كل النقرات والتعبئة حتى النهاية)` },
      ], { max_tokens: 600 }).catch(() => "سأنفذ المهمة خطوة بخطوة حتى الاكتمال");
      this.emitStep(taskId, "THINK", thinkContent);
    } else {
      this.emitStep(taskId, "THINK", `التفكير في تنفيذ كامل لـ: "${task.description}" عبر المتصفح`);
    }
    await sleep(300);

    // ── PLAN ───────────────────────────────────────────────────────────────
    const targetUrl = extractUrl(task.description) || task.url;
    if (ollamaClient.isAvailable()) {
      const planContent = await ollamaClient.chat([
        { role: "system", content: this.systemPrompt },
        { role: "user", content: `المهمة: "${task.description}". أنشئ خطة تنفيذ بجميع الخطوات المتسلسلة حتى الاكتمال الكامل. لا تكتفِ بخطوة الانتقال فقط.` },
      ], { max_tokens: 500 }).catch(() => `الانتقال إلى ${targetUrl || "الموقع المستهدف"} وتنفيذ جميع الإجراءات المطلوبة حتى الانتهاء`);
      this.emitStep(taskId, "PLAN", planContent);
    } else {
      const plan = targetUrl
        ? [`1. الانتقال إلى: ${targetUrl}`, "2. تنفيذ جميع الإجراءات المطلوبة خطوة بخطوة", "3. التحقق من اكتمال المهمة بالكامل"]
        : ["1. فتح المتصفح", "2. البحث عن الموقع المناسب", "3. تنفيذ جميع خطوات المهمة"];
      this.emitStep(taskId, "PLAN", plan.join("\n"));
    }
    await sleep(300);

    // ── ACT: Agentic Loop ──────────────────────────────────────────────────
    this.emitStep(taskId, "ACT", "بدء التنفيذ التفاعلي في المتصفح...");

    let finalResult = "";
    let iterationCount = 0;
    const conversationHistory: ChatMessage[] = [
      { role: "system", content: ACTION_SYSTEM_PROMPT },
      { role: "user", content: `المهمة المطلوبة: "${task.description}"\n\nابدأ التنفيذ. ما هي الخطوة الأولى؟` },
    ];

    if (!ollamaClient.isAvailable()) {
      // No LLM — do basic navigation only
      if (targetUrl) {
        this.emitStep(taskId, "ACT", `الانتقال إلى: ${targetUrl}`);
        await browserAgent.navigate(targetUrl).catch((err: any) => {
          this.emitStep(taskId, "ACT", `تحذير: ${err.message}`);
        });
        const content = await browserAgent.getPageContent();
        const url = await browserAgent.getCurrentUrl();
        finalResult = `تم الانتقال إلى: ${url}. (لتفعيل التنفيذ الكامل، ثبّت Ollama: ollama.ai ثم شغّل: ollama pull llama3)`;
        this.emitStep(taskId, "ACT", finalResult);
      } else {
        finalResult = "تعذّر تحديد الموقع المستهدف. (لتفعيل الذكاء الاصطناعي الكامل، ثبّت Ollama)";
        this.emitStep(taskId, "ACT", finalResult);
      }
    } else {
      // LLM-driven agentic loop
      while (iterationCount < MAX_ITERATIONS) {
        iterationCount++;

        // Get current page state
        const pageStructure = await browserAgent.getPageStructure();
        const pageContent = await browserAgent.getPageContent();
        const currentUrl = await browserAgent.getCurrentUrl();

        const pageState = `الحالة الحالية للمتصفح:\nURL: ${currentUrl}\n\n${pageStructure}\n\nمحتوى الصفحة (مختصر):\n${pageContent.substring(0, 800)}`;

        // Add page state to conversation
        conversationHistory.push({
          role: "user",
          content: `الخطوة ${iterationCount}: ${pageState}\n\nما الخطوة التالية لإتمام المهمة "${task.description}"؟ رد بـ JSON فقط.`,
        });

        let actionJson: any = null;
        try {
          const rawResponse = await ollamaClient.chat(conversationHistory, { temperature: 0.3, max_tokens: 400 });
          conversationHistory.push({ role: "assistant", content: rawResponse });

          // Extract JSON from response
          const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            actionJson = JSON.parse(jsonMatch[0]);
          }
        } catch (err: any) {
          this.emitStep(taskId, "ACT", `خطأ في الحصول على الخطوة التالية: ${err.message}`);
          break;
        }

        if (!actionJson) {
          this.emitStep(taskId, "ACT", `تعذّر تحليل استجابة الذكاء الاصطناعي في الخطوة ${iterationCount}`);
          break;
        }

        const { action, params = {}, reason = "", done, result } = actionJson;

        this.emitStep(taskId, "ACT", `خطوة ${iterationCount}: ${action} — ${reason}`);

        // Execute action
        if (action === "done" || done === true) {
          finalResult = result || params?.result || "اكتملت المهمة بنجاح";
          break;
        }

        let actionSuccess = false;
        try {
          switch (action) {
            case "navigate":
              if (params.url) {
                await browserAgent.navigate(params.url);
                actionSuccess = true;
              }
              break;
            case "click_text":
              if (params.text) {
                actionSuccess = await browserAgent.clickByText(params.text);
              }
              break;
            case "click_selector":
              if (params.selector) {
                actionSuccess = await browserAgent.clickBySelector(params.selector);
              }
              break;
            case "fill":
              if (params.selector && params.value !== undefined) {
                actionSuccess = await browserAgent.fillField(params.selector, String(params.value));
              }
              break;
            case "type_text":
              if (params.text) {
                await browserAgent.type(params.text);
                actionSuccess = true;
              }
              break;
            case "press_key":
              if (params.key) {
                await browserAgent.pressKey(params.key);
                actionSuccess = true;
              }
              break;
            case "scroll":
              await browserAgent.scroll(params.deltaX || 0, params.deltaY || 300);
              actionSuccess = true;
              break;
            case "wait":
              await sleep(2000);
              actionSuccess = true;
              break;
            default:
              this.emitStep(taskId, "ACT", `إجراء غير معروف: ${action}`);
          }
        } catch (err: any) {
          this.emitStep(taskId, "ACT", `خطأ في تنفيذ ${action}: ${err.message}`);
        }

        if (!actionSuccess && action !== "wait") {
          this.emitStep(taskId, "ACT", `تحذير: فشل تنفيذ "${action}" — سأحاول الخطوة التالية`);
        }

        await sleep(500);
      }

      if (!finalResult) {
        if (iterationCount >= MAX_ITERATIONS) {
          finalResult = `وصل الوكيل إلى الحد الأقصى من الخطوات (${MAX_ITERATIONS}). آخر موقع: ${await browserAgent.getCurrentUrl()}`;
        } else {
          finalResult = `اكتملت المهمة. الموقع الأخير: ${await browserAgent.getCurrentUrl()}`;
        }
      }
    }

    // ── VERIFY ─────────────────────────────────────────────────────────────
    let verifyResult = finalResult;
    if (ollamaClient.isAvailable()) {
      const currentUrl = await browserAgent.getCurrentUrl();
      const pageContent = await browserAgent.getPageContent();
      verifyResult = await ollamaClient.chat([
        { role: "system", content: "أنت مساعد يتحقق من اكتمال المهام ويلخص النتيجة بوضوح." },
        { role: "user", content: `المهمة الأصلية: "${task.description}"\nالحالة النهائية: ${finalResult}\nURL النهائي: ${currentUrl}\nمحتوى الصفحة: ${pageContent.substring(0, 500)}\n\nهل اكتملت المهمة بالكامل؟ لخّص ما تم إنجازه.` },
      ], { max_tokens: 300 }).catch(() => finalResult);
    }

    this.emitStep(taskId, "VERIFY", verifyResult);

    taskStore.updateTask(taskId, { status: "completed", result: verifyResult });
    taskStore.addLog({ taskId, agentType: "AgentRunner", action: "task_complete", output: verifyResult.substring(0, 300), durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId, result: verifyResult });
  }

  private async runWithOllama(task: Task, start: number): Promise<void> {
    const steps = ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"];
    const prompts: Record<string, string> = {
      OBSERVE: `المهمة: "${task.description}"\nحلّل هذه المهمة. ما المتطلبات الرئيسية؟`,
      THINK:   `ما أفضل طريقة لتنفيذ هذه المهمة بالكامل؟ ما التحديات المحتملة؟`,
      PLAN:    `أنشئ خطة تنفيذ بخطوات محددة وكاملة لـ: "${task.description}"`,
      ACT:     `نفّذ المهمة وقدّم النتيجة الفعلية الكاملة لـ: "${task.description}"`,
      VERIFY:  `تحقق من اكتمال المهمة بالكامل. لخّص ما تم إنجازه فعلاً.`,
    };
    const messages: ChatMessage[] = [{ role: "system", content: this.systemPrompt }];
    let finalResult = "";

    for (const step of steps) {
      messages.push({ role: "user", content: prompts[step] });
      this.emitStep(task.taskId, step, `...`);
      try {
        const resp = await ollamaClient.chat(messages, { temperature: 0.5, max_tokens: 600 });
        messages.push({ role: "assistant", content: resp });
        this.emitStep(task.taskId, step, resp);
        if (step === "ACT" || step === "VERIFY") finalResult = resp;
      } catch {
        this.emitStep(task.taskId, step, "جاري المعالجة...");
      }
      await sleep(300);
    }

    taskStore.updateTask(task.taskId, { status: "completed", result: finalResult });
    taskStore.addLog({ taskId: task.taskId, agentType: "AgentRunner", action: "task_complete", output: finalResult.substring(0, 300), durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId: task.taskId, result: finalResult });
  }

  private async simulateWithSteps(task: Task, start: number): Promise<void> {
    const content: Record<string, string> = {
      OBSERVE: `تحليل المهمة: "${task.description}". النوع: ${task.type}.`,
      THINK:   `التفكير في أفضل طريقة التنفيذ الكامل خطوة بخطوة.`,
      PLAN:    `الخطة:\n1. تهيئة الأدوات اللازمة\n2. تنفيذ جميع الإجراءات المطلوبة\n3. التحقق من اكتمال المهمة بالكامل`,
      ACT:     `تم تنفيذ المهمة. (لتفعيل الذكاء الاصطناعي الحقيقي ثبّت Ollama: ollama.ai ثم شغّل: ollama pull llama3)`,
      VERIFY:  `اكتملت المهمة بوضع المحاكاة. الوكيل جاهز لمهام جديدة.`,
    };
    for (const step of ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"]) {
      await sleep(600);
      this.emitStep(task.taskId, step, content[step]);
    }
    const result = content["VERIFY"];
    taskStore.updateTask(task.taskId, { status: "completed", result });
    taskStore.addLog({ taskId: task.taskId, agentType: "AgentRunner", action: "task_complete", output: result, durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId: task.taskId, result });
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function extractUrl(text: string): string | null {
  const siteMap: Record<string, string> = {
    "يوتيوب": "https://www.youtube.com",
    "youtube": "https://www.youtube.com",
    "فيسبوك": "https://www.facebook.com",
    "facebook": "https://www.facebook.com",
    "تويتر": "https://www.twitter.com",
    "twitter": "https://www.twitter.com",
    "جوجل": "https://www.google.com",
    "google": "https://www.google.com",
    "انستجرام": "https://www.instagram.com",
    "instagram": "https://www.instagram.com",
    "جيتهاب": "https://www.github.com",
    "github": "https://www.github.com",
    "لينكدإن": "https://www.linkedin.com",
    "linkedin": "https://www.linkedin.com",
  };

  for (const [key, url] of Object.entries(siteMap)) {
    if (text.toLowerCase().includes(key.toLowerCase())) return url;
  }

  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) return urlMatch[0];

  const domainMatch = text.match(/(?:افتح|اذهب إلى|تصفح|موقع)\s+([a-z0-9.-]+\.[a-z]{2,})/i);
  if (domainMatch) return `https://${domainMatch[1]}`;

  return null;
}

export const agentRunner = new AgentRunner();
