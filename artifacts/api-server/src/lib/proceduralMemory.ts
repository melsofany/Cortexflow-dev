/**
 * proceduralMemory.ts — الذاكرة الإجرائية (Procedural Memory)
 * ─────────────────────────────────────────────────────────────────────────────
 * تحفظ المهارات وسير العمل الناجحة كـ "وصفات" قابلة لإعادة الاستخدام.
 *
 * الفكرة (من Manus AI + AutoGPT):
 *   - عند نجاح مهمة معقدة، يُحفظ مسارها كـ "Skill"
 *   - في المهام المشابهة مستقبلاً، تُستدعى هذه المهارة مباشرة
 *   - يقلل وقت التخطيط بنسبة 60-80% على المهام المتكررة
 *
 * أنواع المهارات:
 *   - workflow: سلسلة خطوات لإنجاز مهمة (مثل: إعداد مشروع Python)
 *   - pattern: نمط حل متكرر (مثل: كيف تتعامل مع API محمية بـ OAuth)
 *   - shortcut: اختصار لعملية (مثل: أوامر git المحددة لعملية معينة)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";

export type SkillType = "workflow" | "pattern" | "shortcut" | "template";

export interface SkillStep {
  order: number;
  action: string;
  tool?: string;
  expectedOutcome: string;
  fallback?: string;
}

export interface Skill {
  id: string;
  type: SkillType;
  name: string;
  description: string;
  triggerKeywords: string[];
  steps: SkillStep[];
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  lastUsedAt: string;
  createdAt: string;
  confidence: number;
  category: string;
  example?: string;
}

export interface SkillMatch {
  skill: Skill;
  relevance: number;
  matchedKeywords: string[];
}

interface ProceduralStore {
  skills: Skill[];
  totalExecutions: number;
  version: number;
}

const STORE_FILE = path.join(process.cwd(), "data", "procedural_memory.json");

function ensureDir() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore(): ProceduralStore {
  ensureDir();
  try {
    if (fs.existsSync(STORE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    }
  } catch {}
  return { skills: getBuiltinSkills(), totalExecutions: 0, version: 1 };
}

function saveStore(store: ProceduralStore) {
  ensureDir();
  try { fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2)); } catch {}
}

function getBuiltinSkills(): Skill[] {
  const now = new Date().toISOString();
  return [
    {
      id: "skill_web_research",
      type: "workflow",
      name: "البحث على الويب",
      description: "خطوات البحث عن معلومات على الإنترنت وتلخيصها",
      triggerKeywords: ["ابحث", "search", "معلومات", "اعثر", "find", "بحث", "research"],
      category: "research",
      steps: [
        { order: 1, action: "تحديد الاستعلامات البحثية الدقيقة", expectedOutcome: "قائمة كلمات مفتاحية" },
        { order: 2, action: "البحث بالأداة web_search عن كل استعلام", tool: "web_search", expectedOutcome: "نتائج خام" },
        { order: 3, action: "تصفية النتائج وإزالة غير الموثوق", expectedOutcome: "نتائج موثوقة" },
        { order: 4, action: "تلخيص المعلومات بشكل منظّم", expectedOutcome: "تقرير مُلخَّص" },
      ],
      successCount: 0, failureCount: 0, avgDurationMs: 45000,
      lastUsedAt: now, createdAt: now, confidence: 0.9, example: "ابحث عن أفضل مكتبات Python للذكاء الاصطناعي",
    },
    {
      id: "skill_code_debug",
      type: "pattern",
      name: "تشخيص الأخطاء البرمجية",
      description: "نمط تشخيص وإصلاح الأخطاء في الكود",
      triggerKeywords: ["خطأ", "error", "bug", "fix", "إصلاح", "مشكلة", "problem", "لا يعمل", "not working"],
      category: "code",
      steps: [
        { order: 1, action: "قراءة رسالة الخطأ كاملة", expectedOutcome: "فهم نوع الخطأ" },
        { order: 2, action: "تتبع مكدس الاستدعاءات (stack trace)", expectedOutcome: "تحديد موقع الخطأ" },
        { order: 3, action: "تنفيذ الكود في sandbox لاختبار الفرضيات", tool: "execute_code", expectedOutcome: "تأكيد السبب" },
        { order: 4, action: "تطبيق الإصلاح وإعادة الاختبار", expectedOutcome: "كود يعمل" },
      ],
      successCount: 0, failureCount: 0, avgDurationMs: 30000,
      lastUsedAt: now, createdAt: now, confidence: 0.85, example: "هذا الكود يعطي خطأ TypeError",
    },
    {
      id: "skill_api_integration",
      type: "workflow",
      name: "ربط API خارجي",
      description: "خطوات ربط واستخدام API خارجي",
      triggerKeywords: ["api", "endpoint", "webhook", "http", "rest", "request", "طلب", "ربط"],
      category: "code",
      steps: [
        { order: 1, action: "قراءة التوثيق الرسمي للـ API", expectedOutcome: "فهم المصادقة والـ endpoints" },
        { order: 2, action: "إعداد رأسيات المصادقة (headers/token)", expectedOutcome: "متغيرات البيئة جاهزة" },
        { order: 3, action: "اختبار طلب بسيط أولاً", tool: "execute_code", expectedOutcome: "رد 200 OK" },
        { order: 4, action: "تنفيذ منطق التكامل الكامل مع معالجة الأخطاء", expectedOutcome: "كود إنتاجي" },
      ],
      successCount: 0, failureCount: 0, avgDurationMs: 60000,
      lastUsedAt: now, createdAt: now, confidence: 0.8,
    },
    {
      id: "skill_data_analysis",
      type: "workflow",
      name: "تحليل البيانات",
      description: "خطوات تحليل مجموعة بيانات",
      triggerKeywords: ["تحليل", "analyze", "data", "بيانات", "إحصاء", "statistics", "csv", "excel", "جدول"],
      category: "research",
      steps: [
        { order: 1, action: "تحميل وفحص البيانات (shape, dtypes, head)", tool: "execute_code", expectedOutcome: "نظرة عامة على البيانات" },
        { order: 2, action: "معالجة القيم المفقودة والتنظيف", expectedOutcome: "بيانات نظيفة" },
        { order: 3, action: "الإحصاءات الوصفية والتوزيعات", expectedOutcome: "فهم البيانات" },
        { order: 4, action: "تلخيص الاستنتاجات الرئيسية", expectedOutcome: "تقرير تحليلي" },
      ],
      successCount: 0, failureCount: 0, avgDurationMs: 90000,
      lastUsedAt: now, createdAt: now, confidence: 0.85,
    },
    {
      id: "skill_file_processing",
      type: "shortcut",
      name: "معالجة الملفات",
      description: "قراءة وكتابة وتحويل الملفات",
      triggerKeywords: ["ملف", "file", "اقرأ", "read", "اكتب", "write", "حوّل", "convert", "pdf", "json", "yaml"],
      category: "system",
      steps: [
        { order: 1, action: "قراءة الملف باستخدام read_file أو execute_code", tool: "read_file", expectedOutcome: "محتوى الملف" },
        { order: 2, action: "معالجة المحتوى حسب التنسيق المطلوب", expectedOutcome: "بيانات معالجة" },
        { order: 3, action: "حفظ النتيجة باستخدام write_file", tool: "write_file", expectedOutcome: "ملف ناتج" },
      ],
      successCount: 0, failureCount: 0, avgDurationMs: 15000,
      lastUsedAt: now, createdAt: now, confidence: 0.95,
    },
  ];
}

function matchSkill(skill: Skill, query: string): SkillMatch {
  const q = query.toLowerCase();
  const matched = skill.triggerKeywords.filter(k => q.includes(k.toLowerCase()));
  const relevance = matched.length === 0 ? 0 : matched.length / skill.triggerKeywords.length;
  return { skill, relevance, matchedKeywords: matched };
}

class ProceduralMemory {
  private store: ProceduralStore;

  constructor() {
    this.store = loadStore();
    console.log(`[ProceduralMemory] تم التحميل: ${this.store.skills.length} مهارة`);
  }

  findRelevantSkills(task: string, limit = 3): SkillMatch[] {
    return this.store.skills
      .map(s => matchSkill(s, task))
      .filter(m => m.relevance > 0)
      .sort((a, b) => {
        const rDiff = b.relevance - a.relevance;
        if (Math.abs(rDiff) > 0.1) return rDiff;
        return b.skill.confidence - a.skill.confidence;
      })
      .slice(0, limit);
  }

  learnFromSuccess(input: {
    taskDescription: string;
    steps: Array<{ action: string; tool?: string; outcome: string }>;
    category: string;
    durationMs: number;
  }): Skill | null {
    if (input.steps.length < 2) return null;

    const existing = this.findRelevantSkills(input.taskDescription, 1)[0];
    if (existing && existing.relevance > 0.6) {
      existing.skill.successCount++;
      existing.skill.avgDurationMs = Math.round(
        (existing.skill.avgDurationMs * 0.7) + (input.durationMs * 0.3)
      );
      existing.skill.lastUsedAt = new Date().toISOString();
      existing.skill.confidence = Math.min(0.98, existing.skill.confidence + 0.02);
      saveStore(this.store);
      return existing.skill;
    }

    const words = input.taskDescription
      .toLowerCase()
      .replace(/[^\u0600-\u06FFa-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 10);

    const skill: Skill = {
      id: `skill_${Date.now()}`,
      type: "workflow",
      name: input.taskDescription.slice(0, 50),
      description: `مهارة مكتسبة: ${input.taskDescription.slice(0, 100)}`,
      triggerKeywords: words,
      category: input.category,
      steps: input.steps.map((s, i) => ({
        order: i + 1,
        action: s.action,
        tool: s.tool,
        expectedOutcome: s.outcome,
      })),
      successCount: 1,
      failureCount: 0,
      avgDurationMs: input.durationMs,
      lastUsedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      confidence: 0.65,
      example: input.taskDescription,
    };

    this.store.skills.unshift(skill);
    if (this.store.skills.length > 200) {
      this.store.skills = this.store.skills
        .sort((a, b) => (b.successCount / (b.successCount + b.failureCount + 1)) - (a.successCount / (a.successCount + a.failureCount + 1)))
        .slice(0, 200);
    }

    saveStore(this.store);
    return skill;
  }

  recordFailure(skillId: string) {
    const skill = this.store.skills.find(s => s.id === skillId);
    if (skill) {
      skill.failureCount++;
      skill.confidence = Math.max(0.1, skill.confidence - 0.05);
      saveStore(this.store);
    }
  }

  formatSkillsForContext(task: string): string {
    const matches = this.findRelevantSkills(task, 2);
    if (matches.length === 0) return "";

    const lines = matches.map(m => {
      const steps = m.skill.steps.map(s => `  ${s.order}. ${s.action}`).join("\n");
      return `🛠️ مهارة: "${m.skill.name}" (نجاح ${m.skill.successCount}×)\nالخطوات:\n${steps}`;
    });

    return `\n[مهارات مكتسبة ذات صلة]\n${lines.join("\n\n")}`;
  }

  getAllSkills(): Skill[] {
    return this.store.skills;
  }

  getStats() {
    const total = this.store.skills.length;
    const avgConfidence = total > 0
      ? Math.round((this.store.skills.reduce((s, e) => s + e.confidence, 0) / total) * 100)
      : 0;

    return {
      totalSkills: total,
      builtinSkills: this.store.skills.filter(s => s.id.startsWith("skill_web") || s.id.startsWith("skill_code") || s.id.startsWith("skill_api") || s.id.startsWith("skill_data") || s.id.startsWith("skill_file")).length,
      learnedSkills: total - 5,
      avgConfidence,
      totalExecutions: this.store.totalExecutions,
      byCategory: this.store.skills.reduce((acc, s) => {
        acc[s.category] = (acc[s.category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };
  }
}

export const proceduralMemory = new ProceduralMemory();
