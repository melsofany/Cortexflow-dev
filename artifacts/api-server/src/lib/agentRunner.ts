import { EventEmitter } from "events";
import { ollamaClient, ChatMessage } from "./ollamaClient.js";
import { taskStore, Task } from "./taskStore.js";
import { browserAgent } from "./browserAgent.js";
import { selectBestModel, formatModelSelection } from "./modelSelector.js";

const MAX_ITERATIONS = 20;
const MAX_RETRIES = 2;

// ── Action prompt with few-shot examples ──────────────────────────────────────
const ACTION_SYSTEM_PROMPT = `You are a browser automation agent. You control a real browser.
Respond with EXACTLY one line using this format:
ACTION: <action> | PARAM: <value>

Available actions:
  navigate  - go to a URL
  click     - click element by visible text
  fill      - fill input: fieldname=value
  type      - type text into focused element
  key       - press key: Enter, Tab, Escape, Space
  scroll    - scroll: up or down
  wait      - wait a moment
  done      - task complete (use ONLY when fully done)

EXAMPLES:
User: go to facebook.com
ACTION: navigate | PARAM: https://www.facebook.com

User: click the signup button
ACTION: click | PARAM: Create new account

User: fill the email field with test@mail.com
ACTION: fill | PARAM: email=test@mail.com

User: submit the form
ACTION: key | PARAM: Enter

RULES:
- Output ONLY the ACTION line, nothing else
- Never say you cannot do something
- Never explain or apologize
- Use "done" ONLY after task is fully complete`;

class AgentRunner extends EventEmitter {
  private systemPrompt = `أنت CortexFlow، وكيل ذكاء اصطناعي يتحكم في المتصفح.
نفّذ المهام خطوة بخطوة حتى الاكتمال الكامل. رد بإيجاز بنفس لغة المستخدم.`;

  async executeTask(task: Task): Promise<void> {
    const start = Date.now();
    taskStore.updateTask(task.taskId, { status: "running" });
    this.emit("taskStart", { taskId: task.taskId, description: task.description });

    try {
      const { model, category, reason } = await selectBestModel(task.description, task.type);
      this.emitStep(task.taskId, "MODEL", formatModelSelection(model, category, reason));
      await sleep(200);

      if (task.type === "browser") {
        await this.executeBrowserTask(task, start, model);
      } else if (ollamaClient.isAvailable()) {
        await this.runWithOllama(task, start, model);
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
    taskStore.addLog({
      taskId,
      agentType: "AgentRunner",
      action: `step_${step.toLowerCase()}`,
      output: content.substring(0, 300),
    });
  }

  private async executeBrowserTask(task: Task, start: number, model: string): Promise<void> {
    const taskId = task.taskId;

    this.emitStep(taskId, "OBSERVE", `تحليل المهمة: "${task.description}"`);
    await sleep(300);

    const ready = await browserAgent.initialize();
    if (!ready) {
      this.emitStep(taskId, "OBSERVE", "تعذّر تشغيل المتصفح — وضع المحاكاة.");
      await this.simulateWithSteps(task, start);
      return;
    }

    const useOllama = ollamaClient.isAvailable();

    // ── THINK ─────────────────────────────────────────────────────────────
    if (useOllama) {
      const thought = await ollamaClient.chat([
        { role: "system", content: this.systemPrompt },
        { role: "user", content: `المهمة: "${task.description}"\nما الموقع المستهدف وما الخطوات الكاملة اللازمة لإنجاز المهمة بالكامل؟` },
      ], { temperature: 0.4, max_tokens: 250, model }).catch(() => "سأنفذ المهمة خطوة بخطوة");
      this.emitStep(taskId, "THINK", thought);
    } else {
      this.emitStep(taskId, "THINK", `خطة تنفيذ: "${task.description}"`);
    }
    await sleep(200);

    // ── PLAN ──────────────────────────────────────────────────────────────
    const targetUrl = extractUrl(task.description) || task.url;
    if (useOllama) {
      const plan = await ollamaClient.chat([
        { role: "system", content: this.systemPrompt },
        { role: "user", content: `المهمة: "${task.description}". اذكر خطوات التنفيذ بإيجاز.` },
      ], { temperature: 0.3, max_tokens: 200, model }).catch(() => "");
      this.emitStep(taskId, "PLAN", plan || `الانتقال إلى الموقع وتنفيذ الإجراءات المطلوبة`);
    } else {
      this.emitStep(taskId, "PLAN", targetUrl
        ? `1. الانتقال إلى ${targetUrl}\n2. تنفيذ الإجراءات\n3. التحقق`
        : `1. البحث عن الموقع\n2. تنفيذ المهمة\n3. التحقق`);
    }
    await sleep(200);

    // ── ACT: اجبر التنقل أولاً قبل دخول الحلقة ───────────────────────────
    this.emitStep(taskId, "ACT", `بدء التنفيذ بنموذج ${model}...`);

    let finalResult = "";

    if (!useOllama) {
      // بدون Ollama: فقط انتقل للموقع
      if (targetUrl) {
        this.emitStep(taskId, "ACT", `الانتقال إلى: ${targetUrl}`);
        await browserAgent.navigate(targetUrl).catch(() => {});
        finalResult = `تم الانتقال إلى: ${await browserAgent.getCurrentUrl()}`;
        this.emitStep(taskId, "ACT", finalResult);
      }
    } else {
      // ── الخطوة 0: انتقل للموقع مباشرة إن كنا نعرفه ─────────────────
      if (targetUrl) {
        this.emitStep(taskId, "ACT", `خطوة 0: navigate → ${targetUrl}`);
        await browserAgent.navigate(targetUrl).catch(() => {});
        await sleep(1500);
      }

      // ── حلقة الوكيل ────────────────────────────────────────────────
      const history: ChatMessage[] = [{ role: "system", content: ACTION_SYSTEM_PROMPT }];
      let consecutiveFails = 0;

      for (let i = 1; i <= MAX_ITERATIONS; i++) {
        const url     = await browserAgent.getCurrentUrl();
        const struct  = await browserAgent.getPageStructure();
        const content = await browserAgent.getPageContent();

        // وصف الحالة بالإنجليزية ليفهمه النموذج بشكل أفضل
        const pageState = [
          `Task: ${task.description}`,
          `Current URL: ${url}`,
          `Page structure: ${struct.substring(0, 600)}`,
          `Visible text: ${content.substring(0, 400)}`,
          `Step ${i}/${MAX_ITERATIONS}: Output ONE action line only.`,
        ].join("\n");

        history.push({ role: "user", content: pageState });

        let raw = "";
        for (let retry = 0; retry < MAX_RETRIES; retry++) {
          try {
            raw = await ollamaClient.chat(history, { temperature: 0.15, max_tokens: 60, model });
            break;
          } catch (err: any) {
            if (retry === MAX_RETRIES - 1) {
              this.emitStep(taskId, "ACT", `خطأ في النموذج: ${err.message}`);
            }
          }
        }

        history.push({ role: "assistant", content: raw });

        const parsed = parseAction(raw);

        if (!parsed) {
          consecutiveFails++;
          this.emitStep(taskId, "ACT", `(رد غير منظّم — محاولة تصحيح...)`);

          // حاول استخراج URL مباشر من الرد
          const fallbackUrl = extractUrlFromText(raw);
          if (fallbackUrl) {
            this.emitStep(taskId, "ACT", `خطوة ${i}: navigate → ${fallbackUrl}`);
            await browserAgent.navigate(fallbackUrl).catch(() => {});
            consecutiveFails = 0;
          } else if (consecutiveFails >= 3) {
            // أرسل تصحيحاً صارماً للنموذج
            history.push({
              role: "user",
              content: `IMPORTANT: You must respond with EXACTLY this format:\nACTION: navigate | PARAM: https://...\nDo NOT explain. ONE line only.`,
            });
            consecutiveFails = 0;
          }
          await sleep(500);
          continue;
        }

        consecutiveFails = 0;
        const { action, param } = parsed;
        this.emitStep(taskId, "ACT", `خطوة ${i}: ${action} → ${param}`);

        if (action === "done") {
          finalResult = param || "اكتملت المهمة بنجاح";
          break;
        }

        try {
          await executeAction(action, param);
        } catch (err: any) {
          this.emitStep(taskId, "ACT", `تحذير: ${err.message}`);
        }

        await sleep(1000);

        if (i === MAX_ITERATIONS) {
          finalResult = `اكتمل التنفيذ. الموقع الأخير: ${await browserAgent.getCurrentUrl()}`;
        }
      }

      if (!finalResult) {
        finalResult = `اكتمل التنفيذ. الموقع: ${await browserAgent.getCurrentUrl()}`;
      }
    }

    // ── VERIFY ────────────────────────────────────────────────────────────
    let verifyResult = finalResult;
    if (useOllama) {
      const url = await browserAgent.getCurrentUrl();
      verifyResult = await ollamaClient.chat([
        { role: "system", content: "لخّص نتيجة المهمة بجملة أو جملتين." },
        { role: "user", content: `المهمة: "${task.description}"\nالنتيجة: ${finalResult}\nURL الحالي: ${url}\nهل اكتملت؟ لخّص ما تم.` },
      ], { max_tokens: 150, model }).catch(() => finalResult);
    }

    this.emitStep(taskId, "VERIFY", verifyResult);
    taskStore.updateTask(taskId, { status: "completed", result: verifyResult });
    taskStore.addLog({ taskId, agentType: "AgentRunner", action: "task_complete", output: verifyResult.substring(0, 300), durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId, result: verifyResult });
  }

  private async runWithOllama(task: Task, start: number, model: string): Promise<void> {
    const steps = ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"];
    const prompts: Record<string, string> = {
      OBSERVE: `المهمة: "${task.description}"\nحلّل المتطلبات.`,
      THINK:   `ما أفضل طريقة لتنفيذ المهمة بالكامل؟`,
      PLAN:    `خطة تنفيذ مفصّلة لـ: "${task.description}"`,
      ACT:     `نفّذ المهمة وقدّم النتيجة الفعلية.`,
      VERIFY:  `هل اكتملت المهمة؟ لخّص ما تم.`,
    };
    const messages: ChatMessage[] = [{ role: "system", content: this.systemPrompt }];
    let finalResult = "";

    for (const step of steps) {
      messages.push({ role: "user", content: prompts[step] });
      try {
        const resp = await ollamaClient.chat(messages, { temperature: 0.4, max_tokens: 400, model });
        messages.push({ role: "assistant", content: resp });
        this.emitStep(task.taskId, step, resp);
        if (step === "ACT" || step === "VERIFY") finalResult = resp;
      } catch {
        this.emitStep(task.taskId, step, "جاري المعالجة...");
      }
      await sleep(200);
    }

    taskStore.updateTask(task.taskId, { status: "completed", result: finalResult });
    taskStore.addLog({ taskId: task.taskId, agentType: "AgentRunner", action: "task_complete", output: finalResult.substring(0, 300), durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId: task.taskId, result: finalResult });
  }

  private async simulateWithSteps(task: Task, start: number): Promise<void> {
    const content: Record<string, string> = {
      OBSERVE: `تحليل المهمة: "${task.description}".`,
      THINK:   `التفكير في طريقة التنفيذ.`,
      PLAN:    `الخطة:\n1. تهيئة الأدوات\n2. تنفيذ الإجراءات\n3. التحقق`,
      ACT:     `وضع المحاكاة. لتفعيل التنفيذ الحقيقي، تأكد من تشغيل Ollama.`,
      VERIFY:  `اكتملت المحاكاة. الوكيل جاهز.`,
    };
    for (const step of ["OBSERVE", "THINK", "PLAN", "ACT", "VERIFY"]) {
      await sleep(500);
      this.emitStep(task.taskId, step, content[step]);
    }
    const result = content["VERIFY"];
    taskStore.updateTask(task.taskId, { status: "completed", result });
    taskStore.addLog({ taskId: task.taskId, agentType: "AgentRunner", action: "task_complete", output: result, durationMs: Date.now() - start });
    this.emit("taskSuccess", { taskId: task.taskId, result });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function parseAction(text: string): { action: string; param: string } | null {
  if (!text) return null;

  // الصيغة الرسمية
  const m = text.match(/ACTION:\s*(\w+)\s*\|\s*PARAM:\s*(.+)/i);
  if (m) {
    const action = m[1].toLowerCase().trim();
    let param = m[2].trim().split("\n")[0].trim(); // سطر واحد فقط

    if (action === "navigate") {
      param = cleanUrl(param);
      if (!param || isBlank(param)) return null;
    }
    return { action, param };
  }

  // done بدون صيغة
  if (/\b(task complete|task done|completed|done)\b/i.test(text)) {
    return { action: "done", param: text.substring(0, 100) };
  }

  return null;
}

function cleanUrl(raw: string): string {
  let url = raw.replace(/^(url:|param:)\s*/i, "").trim();
  url = url.split(/[\s"'<>]/)[0];
  if (!url) return "";
  if (!url.startsWith("http")) url = "https://" + url;
  return url;
}

function isBlank(url: string): boolean {
  return url === "about:blank" || url === "https://about:blank" || url === "https://";
}

function extractUrlFromText(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (m) return m[0];
  const domain = text.match(/\b([a-z0-9-]+\.(com|org|net|io|dev))\b/i);
  if (domain) return `https://${domain[0]}`;
  return null;
}

async function executeAction(action: string, param: string): Promise<void> {
  switch (action) {
    case "navigate":
      await browserAgent.navigate(param);
      break;
    case "click":
      await browserAgent.clickByText(param);
      break;
    case "fill": {
      const eqIdx = param.indexOf("=");
      if (eqIdx === -1) break;
      const field = param.substring(0, eqIdx).trim();
      const value = param.substring(eqIdx + 1).trim();
      const filled = await browserAgent.fillField(`#${field}`, value) ||
        await browserAgent.fillField(`[name="${field}"]`, value) ||
        await browserAgent.fillField(`[name*="${field}"]`, value) ||
        await browserAgent.fillField(`[placeholder*="${field}"]`, value) ||
        await browserAgent.fillField(`[type="${field}"]`, value);
      if (!filled) await browserAgent.fillField(`input`, value);
      break;
    }
    case "type":
      await browserAgent.type(param);
      break;
    case "key":
      await browserAgent.pressKey(param);
      break;
    case "scroll":
      await browserAgent.scroll(0, param === "up" ? -400 : 400);
      break;
    case "wait":
      await sleep(2000);
      break;
  }
}

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
    "ريديت": "https://www.reddit.com",
    "reddit": "https://www.reddit.com",
    "تيك توك": "https://www.tiktok.com",
    "tiktok": "https://www.tiktok.com",
    "أمازون": "https://www.amazon.com",
    "amazon": "https://www.amazon.com",
    "واتساب": "https://web.whatsapp.com",
    "whatsapp": "https://web.whatsapp.com",
  };

  const lower = text.toLowerCase();
  for (const [key, url] of Object.entries(siteMap)) {
    if (lower.includes(key.toLowerCase())) return url;
  }

  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (urlMatch) return urlMatch[0];

  const domainMatch = text.match(/(?:افتح|اذهب|تصفح|open|visit|go to)\s+([a-z0-9.-]+\.[a-z]{2,})/i);
  if (domainMatch) return `https://${domainMatch[1]}`;

  return null;
}

export const agentRunner = new AgentRunner();
