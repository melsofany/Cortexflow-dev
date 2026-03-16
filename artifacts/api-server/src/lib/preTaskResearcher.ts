/**
 * preTaskResearcher.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * نظام البحث المسبق قبل تنفيذ المهام ومكافحة الهلوسة
 *
 * المبدأ: الوكيل يجب أن يعرف ما لا يعرفه قبل البدء.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface TaskComplexityScore {
  score: number;          // 1-10
  isComplex: boolean;     // score >= 7
  reasons: string[];
  category: "simple" | "moderate" | "complex" | "multi-step-auth";
}

export interface KnowledgeAudit {
  known: string[];        // ما نعرفه بيقين
  assumed: string[];      // ما نفترضه ولم نتحقق منه
  unknown: string[];      // ما لا نعرفه ويجب السؤال عنه
  prerequisites: string[]; // متطلبات يجب توافرها قبل البدء
  knownFailurePoints: string[]; // أسباب فشل معروفة لهذا النوع
}

export interface RealityChecklist {
  items: RealityCheckItem[];
}

export interface RealityCheckItem {
  criterion: string;
  howToVerify: string;   // كيف تتحقق من تحقق هذا المعيار على الشاشة
  mustBeVisible: string; // ما يجب أن يكون مرئياً على الشاشة كدليل
}

export interface ErrorPattern {
  errorText: string;
  count: number;
  firstSeen: number;
  category: "auth" | "permission" | "not_found" | "ui" | "network" | "unknown";
  suggestedAction: string;
}

/**
 * حساب درجة تعقيد المهمة
 */
export function analyzeTaskComplexity(taskDescription: string): TaskComplexityScore {
  const desc = taskDescription.toLowerCase();
  let score = 1;
  const reasons: string[] = [];

  // مؤشرات التعقيد
  const complexitySignals: Array<{ keywords: string[]; points: number; reason: string }> = [
    { keywords: ["تسجيل دخول", "login", "sign in", "بريد", "كلمة مرور", "password"], points: 2, reason: "تتطلب مصادقة" },
    { keywords: ["أنشئ", "create", "register", "سجّل", "إنشاء"], points: 1, reason: "تتطلب إنشاء شيء" },
    { keywords: ["api", "مفتاح", "token", "access token", "webhook"], points: 2, reason: "تتطلب بيانات API" },
    { keywords: ["meta", "facebook", "ميتا", "فيسبوك"], points: 2, reason: "منصة Meta لها تحقق متعدد المراحل" },
    { keywords: ["google", "جوجل", "gmail"], points: 2, reason: "Google لها حماية متقدمة" },
    { keywords: ["whatsapp", "واتساب", "business"], points: 2, reason: "WhatsApp Business له متطلبات تحقق خاصة" },
    { keywords: ["captcha", "recaptcha", "تحقق"], points: 2, reason: "قد تحتاج تحقق بشري" },
    { keywords: ["رقم هاتف", "phone number", "otp", "sms"], points: 2, reason: "تتطلب تحقق برقم الهاتف" },
    { keywords: ["دفع", "payment", "credit card", "billing"], points: 3, reason: "تتطلب بيانات دفع" },
    { keywords: ["واتساب أعمال", "whatsapp business api"], points: 3, reason: "WhatsApp Business API له متطلبات تجارية معقدة" },
    { keywords: ["ثم", "بعد ذلك", "ثم انتقل", "خطوات"], points: 1, reason: "مهمة متعددة الخطوات" },
    { keywords: ["انشاء تطبيق", "create app", "new app"], points: 1, reason: "إنشاء تطبيق على منصة" },
  ];

  for (const signal of complexitySignals) {
    if (signal.keywords.some(k => desc.includes(k))) {
      score += signal.points;
      reasons.push(signal.reason);
    }
  }

  score = Math.min(10, score);

  let category: TaskComplexityScore["category"] = "simple";
  if (score >= 3 && score < 6) category = "moderate";
  if (score >= 6 && score < 8) category = "complex";
  if (score >= 8) category = "multi-step-auth";

  return {
    score,
    isComplex: score >= 6,
    reasons: [...new Set(reasons)],
    category,
  };
}

/**
 * مراجعة المعرفة: ما نعرفه vs ما نفترضه vs ما لا نعرفه
 */
export function buildKnowledgeAudit(taskDescription: string, complexity: TaskComplexityScore): KnowledgeAudit {
  const desc = taskDescription.toLowerCase();

  const audit: KnowledgeAudit = {
    known: [],
    assumed: [],
    unknown: [],
    prerequisites: [],
    knownFailurePoints: [],
  };

  // ─── معرفة عامة ثابتة ───
  audit.known.push("الوكيل يتحكم في متصفح حقيقي");
  audit.known.push("الإجراءات مبنية على ما يظهر على الشاشة فعلاً");

  // ─── منصة Meta ───
  if (desc.includes("meta") || desc.includes("ميتا") || desc.includes("facebook") || desc.includes("فيسبوك")) {
    audit.known.push("Meta Developers تتطلب حسابًا Facebook نشطًا ومربوطًا بحساب Business");
    audit.assumed.push("المستخدم لديه حساب Facebook مفعّل ومعتمد كمطوّر");
    audit.unknown.push("بيانات الدخول (البريد + كلمة المرور)");
    audit.prerequisites.push("حساب Facebook نشط ومعتمد");
    audit.prerequisites.push("حساب Meta Business موجود مسبقًا");
    audit.knownFailurePoints.push("طلب إعادة إدخال كلمة المرور عند حساسية أمنية");
    audit.knownFailurePoints.push("قيود على إنشاء تطبيقات جديدة للحسابات الجديدة");
    audit.knownFailurePoints.push("CAPTCHA أو تحقق بالهاتف قد يظهر بدون تحذير");
  }

  // ─── WhatsApp Business API ───
  if (desc.includes("whatsapp") || desc.includes("واتساب") || desc.includes("waba")) {
    audit.known.push("WhatsApp Business API يتطلب حساب WhatsApp Business مسجلاً رسميًا");
    audit.assumed.push("المستخدم لديه رقم هاتف يدعم WhatsApp Business");
    audit.unknown.push("رقم الهاتف التجاري المراد ربطه");
    audit.prerequisites.push("رقم هاتف نشط يمكن استخدامه مع WhatsApp Business");
    audit.prerequisites.push("حساب WhatsApp Business Manager مربوط بـ Meta Business");
    audit.knownFailurePoints.push("الأرقام الشخصية لا تعمل مع Business API");
    audit.knownFailurePoints.push("التحقق من رقم الهاتف يستغرق وقتًا");
    audit.knownFailurePoints.push("صفحة App Publish Status قد تظهر حتى بدون نشر - هذا طبيعي");
  }

  // ─── إنشاء API ───
  if (desc.includes("api") || desc.includes("مفتاح")) {
    audit.assumed.push("الـ API سيُتاح فور إنشاء التطبيق");
    audit.knownFailurePoints.push("بعض الـ APIs تحتاج مراجعة من المنصة قبل التفعيل");
    audit.knownFailurePoints.push("الـ Access Token يتغير وله صلاحية محدودة");
  }

  // ─── Google ───
  if (desc.includes("google") || desc.includes("gmail") || desc.includes("جوجل")) {
    audit.known.push("Google تستخدم 2FA بشكل شبه إلزامي");
    audit.unknown.push("بيانات الدخول لحساب Google");
    audit.prerequisites.push("حساب Google مفعّل");
    audit.knownFailurePoints.push("قد تطلب رمز تحقق على الهاتف");
    audit.knownFailurePoints.push("حماية reCAPTCHA قد تظهر");
  }

  // ─── مهمة متعددة الخطوات ───
  if (complexity.score >= 6) {
    audit.assumed.push("كل الخطوات ستكتمل بنجاح بالترتيب");
    audit.knownFailurePoints.push("الفشل في خطوة مبكرة يُعطّل كل الخطوات اللاحقة");
  }

  return audit;
}

/**
 * بناء قائمة التحقق الواقعية: ما يجب أن يكون مرئيًا على الشاشة لإثبات الاكتمال
 */
export function buildRealityChecklist(taskDescription: string): RealityChecklist {
  const desc = taskDescription.toLowerCase();
  const items: RealityCheckItem[] = [];

  if (desc.includes("meta") || desc.includes("facebook") || desc.includes("ميتا")) {
    if (desc.includes("تطبيق") || desc.includes("app")) {
      items.push({
        criterion: "تم إنشاء التطبيق",
        howToVerify: "يظهر رقم App ID في صفحة الإعدادات",
        mustBeVisible: "App ID: [أرقام] في صفحة developers.facebook.com/apps/",
      });
    }
    if (desc.includes("api") || desc.includes("واتساب") || desc.includes("whatsapp")) {
      items.push({
        criterion: "تم إضافة منتج WhatsApp",
        howToVerify: "WhatsApp يظهر في القائمة الجانبية اليسرى للتطبيق",
        mustBeVisible: "WhatsApp في sidebar داخل صفحة التطبيق في developers.facebook.com",
      });
      items.push({
        criterion: "ظهر رمز الوصول (Access Token)",
        howToVerify: "نص طويل يبدأ بـ EAA أو حقل يحتوي على Access Token",
        mustBeVisible: "Temporary Access Token أو حقل token في صفحة WhatsApp API Setup",
      });
    }
  }

  if (desc.includes("تسجيل دخول") || desc.includes("login") || desc.includes("sign in")) {
    items.push({
      criterion: "تم تسجيل الدخول بنجاح",
      howToVerify: "ظهور اسم المستخدم أو صورة الملف الشخصي في الصفحة",
      mustBeVisible: "اسم المستخدم أو أيقونة الحساب في الشريط العلوي",
    });
  }

  // عنصر عام دائمًا
  items.push({
    criterion: "الصفحة الحالية تُثبت اكتمال المهمة",
    howToVerify: "الـ URL الحالي والمحتوى المرئي يتطابقان مع هدف المهمة",
    mustBeVisible: "رسالة نجاح أو عنصر يدل على اكتمال ما طُلب",
  });

  return { items };
}

/**
 * نظام تتبع أنماط الأخطاء
 */
export class ErrorPatternTracker {
  private patterns: Map<string, ErrorPattern> = new Map();
  private readonly MAX_SAME_ERROR = 3;

  record(errorText: string): ErrorPattern {
    const key = this.normalizeError(errorText);
    const existing = this.patterns.get(key);

    if (existing) {
      existing.count++;
      return existing;
    }

    const pattern: ErrorPattern = {
      errorText,
      count: 1,
      firstSeen: Date.now(),
      category: this.categorizeError(errorText),
      suggestedAction: this.suggestAction(errorText),
    };
    this.patterns.set(key, pattern);
    return pattern;
  }

  isRepeating(errorText: string): boolean {
    const key = this.normalizeError(errorText);
    const p = this.patterns.get(key);
    return (p?.count ?? 0) >= this.MAX_SAME_ERROR;
  }

  getEscalationMessage(errorText: string): string {
    const p = this.patterns.get(this.normalizeError(errorText));
    if (!p) return "";
    return [
      `⛔ الخطأ "${errorText.substring(0, 80)}" ظهر ${p.count} مرات.`,
      `التصنيف: ${p.category}`,
      `الإجراء المقترح: ${p.suggestedAction}`,
      `لا يمكن المتابعة بنفس النهج — يجب التوقف والتبليغ للمستخدم.`,
    ].join("\n");
  }

  private normalizeError(text: string): string {
    return text.toLowerCase().replace(/\s+/g, " ").substring(0, 60);
  }

  private categorizeError(text: string): ErrorPattern["category"] {
    const t = text.toLowerCase();
    if (t.includes("password") || t.includes("login") || t.includes("unauthorized") || t.includes("كلمة مرور")) return "auth";
    if (t.includes("permission") || t.includes("صلاحية") || t.includes("not allowed") || t.includes("forbidden")) return "permission";
    if (t.includes("not found") || t.includes("404") || t.includes("لم يُعثر")) return "not_found";
    if (t.includes("network") || t.includes("timeout") || t.includes("connection")) return "network";
    return "ui";
  }

  private suggestAction(text: string): string {
    const cat = this.categorizeError(text);
    const suggestions: Record<ErrorPattern["category"], string> = {
      auth: "اطلب من المستخدم إعادة إدخال بيانات الدخول",
      permission: "هذه المهمة تتطلب صلاحيات إضافية — أبلغ المستخدم",
      not_found: "الصفحة أو العنصر غير موجود — تحقق من الرابط أو الخطوة",
      network: "مشكلة اتصال — انتظر وأعد المحاولة مرة واحدة فقط",
      ui: "العنصر غير موجود في الصفحة — راجع هيكل الصفحة من جديد",
      unknown: "خطأ غير معروف — أبلغ المستخدم بالخطأ الكامل",
    };
    return suggestions[cat] || suggestions.unknown;
  }
}

/**
 * كاشف الروابط المخترعة
 * يتحقق ما إذا كان الوكيل يحاول الانتقال لرابط بناه من ذاكرته
 * بدلاً من رابط رآه فعلاً على الشاشة
 */
export function detectFabricatedUrl(url: string, pageContent: string, pageStructure: string): boolean {
  if (!url || !url.startsWith("http")) return false;

  // إذا كان الرابط يحتوي على معرّفات رقمية طويلة (App IDs, User IDs)
  // لكن هذه المعرفات لا تظهر في محتوى الصفحة الحالي → محتمل أنه مخترع
  const urlIdMatch = url.match(/\/(\d{10,})\//);
  if (urlIdMatch) {
    const id = urlIdMatch[1];
    const appearsInPage = pageContent.includes(id) || pageStructure.includes(id);
    if (!appearsInPage) {
      return true; // الرابط يحتوي على ID غير مرئي في الصفحة الحالية
    }
  }

  return false;
}

/**
 * بناء system prompt لمرحلة ما قبل التنفيذ
 * يُستخدم مع DeepSeek لتوليد تقرير شامل قبل بدء أي مهمة معقدة
 */
export function buildPreResearchPrompt(
  taskDescription: string,
  complexity: TaskComplexityScore,
  audit: KnowledgeAudit,
  checklist: RealityChecklist,
): string {
  return `أنت محلل مهام خبير. قبل تنفيذ المهمة التالية، قم بتحليل شامل.

## المهمة
${taskDescription}

## درجة التعقيد: ${complexity.score}/10 (${complexity.category})
أسباب التعقيد: ${complexity.reasons.join(" | ")}

## ما نعرفه بيقين
${audit.known.map(k => `✓ ${k}`).join("\n")}

## ما نفترضه (يجب التحقق منه)
${audit.assumed.map(a => `? ${a}`).join("\n")}

## ما لا نعرفه (يجب السؤال عنه)
${audit.unknown.map(u => `❓ ${u}`).join("\n")}

## نقاط الفشل المعروفة لهذا النوع من المهام
${audit.knownFailurePoints.map(f => `⚠️ ${f}`).join("\n")}

## ما يجب أن يكون مرئيًا لإثبات الاكتمال
${checklist.items.map(i => `- ${i.criterion}: ${i.mustBeVisible}`).join("\n")}

## المطلوب منك الآن
قدّم JSON فقط بالشكل التالي:
{
  "preChecks": ["الأشياء التي يجب التحقق منها أو سؤال المستخدم عنها قبل البدء"],
  "warningToUser": "تحذير موجز للمستخدم إذا كانت المهمة معقدة بشكل قد يمنع اكتمالها",
  "realSteps": ["خطوات واقعية مبنية على كيفية عمل المنصة فعلاً"],
  "completionProof": ["ما يجب أن يكون مرئيًا على الشاشة كدليل ملموس على الاكتمال — كن دقيقاً جداً"],
  "cannotBeAutomated": ["جوانب المهمة التي لا يمكن أتمتتها ويحتاجها المستخدم يدويًا"]
}`;
}

/**
 * منطق التحقق المُعزَّز عند "done"
 * يتطلب دليلاً مرئيًا فعلياً قبل قبول الاكتمال
 */
export function buildDoneVerificationPrompt(
  taskDescription: string,
  checklist: RealityChecklist,
  currentUrl: string,
  pageContent: string,
): string {
  return `أنت محكّم صارم للتحقق من اكتمال المهام. لا تقبل الاكتمال بناءً على الافتراض.

## المهمة الأصلية
${taskDescription}

## الحالة الحالية
URL: ${currentUrl}
محتوى الصفحة (أول 1000 حرف):
${pageContent.substring(0, 1000)}

## قائمة التحقق الواقعي — لكل عنصر، هل هو مرئي فعلاً في محتوى الصفحة أعلاه؟
${checklist.items.map((item, i) => `
[${i + 1}] المعيار: ${item.criterion}
     الدليل المطلوب: ${item.mustBeVisible}
     طريقة التحقق: ${item.howToVerify}
`).join("\n")}

## قاعدة صارمة
- "مرئي" يعني النص يظهر حرفيًا في محتوى الصفحة المعطى أعلاه
- "مكتمل" لا يعني "وصلنا للموقع" أو "نفّذنا الخطوات"
- إذا المعلومة غير موجودة في النص أعلاه → لم تتحقق بعد

أجب بـ JSON فقط:
{
  "completed": true/false,
  "evidence": "الدليل الملموس المرئي الذي يثبت الاكتمال أو سببه عدم الاكتمال",
  "missingItems": ["ما لم يتحقق بعد"],
  "nextAction": "الخطوة التالية إن لم تكتمل"
}`;
}
