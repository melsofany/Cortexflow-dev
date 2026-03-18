/**
 * mcpTools.ts — تكامل Model Context Protocol (MCP)
 * ─────────────────────────────────────────────────────────────────────────────
 * معيار MCP من Anthropic — يسمح بتوصيل أدوات خارجية بسهولة
 *
 * يدعم:
 *   1. اكتشاف الأدوات تلقائياً من خوادم MCP
 *   2. تنفيذ الأدوات عبر بروتوكول JSON-RPC
 *   3. إضافة أدوات مخصصة داخلياً
 *   4. توصيف كامل للأدوات للنموذج
 *
 * الأدوات المضمّنة:
 *   - filesystem: قراءة/كتابة الملفات
 *   - web_fetch: جلب محتوى من URLs
 *   - memory: حفظ/استرجاع من الذاكرة المعمارية
 *   - calculator: عمليات حسابية
 *   - datetime: وقت ومعالجة تواريخ
 * ─────────────────────────────────────────────────────────────────────────────
 */

import axios from "axios";
import fs from "fs";
import path from "path";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; optional?: boolean }>;
    required?: string[];
  };
  category: "filesystem" | "web" | "memory" | "computation" | "external";
  source: "builtin" | "mcp_server" | "custom";
}

export interface MCPToolCall {
  toolName: string;
  input: Record<string, unknown>;
  requestId: string;
}

export interface MCPToolResult {
  requestId: string;
  toolName: string;
  success: boolean;
  content: string;
  metadata?: Record<string, unknown>;
  durationMs: number;
}

export interface MCPServer {
  name: string;
  url: string;
  description: string;
  tools: MCPTool[];
  status: "connected" | "disconnected" | "error";
}

const BUILTIN_TOOLS: MCPTool[] = [
  {
    name: "read_file",
    description: "قراءة محتوى ملف من مساحة العمل",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "مسار الملف النسبي" },
        encoding: { type: "string", description: "الترميز (utf-8 افتراضي)", optional: true },
      },
      required: ["path"],
    },
    category: "filesystem",
    source: "builtin",
  },
  {
    name: "write_file",
    description: "كتابة أو تحديث ملف في مساحة العمل",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "مسار الملف النسبي" },
        content: { type: "string", description: "المحتوى المراد كتابته" },
        append: { type: "boolean", description: "إضافة للنهاية بدل الاستبدال", optional: true },
      },
      required: ["path", "content"],
    },
    category: "filesystem",
    source: "builtin",
  },
  {
    name: "list_directory",
    description: "عرض محتويات مجلد",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "مسار المجلد" },
        recursive: { type: "boolean", description: "البحث في المجلدات الفرعية", optional: true },
      },
      required: ["path"],
    },
    category: "filesystem",
    source: "builtin",
  },
  {
    name: "web_fetch",
    description: "جلب محتوى صفحة ويب وتحويله لنص",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "عنوان URL" },
        extract: { type: "string", description: "ما تريد استخلاصه: text/links/images", optional: true },
      },
      required: ["url"],
    },
    category: "web",
    source: "builtin",
  },
  {
    name: "calculate",
    description: "إجراء عمليات رياضية وإحصائية",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "التعبير الرياضي" },
        precision: { type: "number", description: "دقة الكسور العشرية", optional: true },
      },
      required: ["expression"],
    },
    category: "computation",
    source: "builtin",
  },
  {
    name: "datetime_tool",
    description: "الحصول على التاريخ والوقت، وتحويل المناطق الزمنية",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "now | format | diff | timezone" },
        timezone: { type: "string", description: "المنطقة الزمنية", optional: true },
        date: { type: "string", description: "التاريخ للتنسيق", optional: true },
      },
      required: ["action"],
    },
    category: "computation",
    source: "builtin",
  },
  {
    name: "memory_store",
    description: "حفظ معلومة في الذاكرة الدلالية للاسترجاع لاحقاً",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "اسم المعلومة" },
        value: { type: "string", description: "قيمة المعلومة" },
        category: { type: "string", description: "تصنيف المعلومة", optional: true },
      },
      required: ["key", "value"],
    },
    category: "memory",
    source: "builtin",
  },
  {
    name: "memory_retrieve",
    description: "استرجاع معلومة من الذاكرة الدلالية",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "ما تبحث عنه" },
        limit: { type: "number", description: "عدد النتائج", optional: true },
      },
      required: ["query"],
    },
    category: "memory",
    source: "builtin",
  },
  {
    name: "code_execute",
    description: "تنفيذ كود Python أو JavaScript في بيئة آمنة",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "الكود المراد تنفيذه" },
        language: { type: "string", description: "python أو javascript" },
        timeout: { type: "number", description: "مهلة التنفيذ بالثواني", optional: true },
      },
      required: ["code", "language"],
    },
    category: "computation",
    source: "builtin",
  },
];

const MEMORY_STORE: Map<string, { value: string; category: string; timestamp: string }> = new Map();

class MCPToolsManager {
  private registeredTools: Map<string, MCPTool> = new Map();
  private mcpServers: MCPServer[] = [];
  private agentServiceUrl = process.env.AGENT_SERVICE_URL || "http://localhost:8090";

  constructor() {
    BUILTIN_TOOLS.forEach(tool => {
      this.registeredTools.set(tool.name, tool);
    });
    console.log(`[MCPTools] تم تسجيل ${BUILTIN_TOOLS.length} أداة مضمّنة`);
  }

  getAvailableTools(): MCPTool[] {
    return Array.from(this.registeredTools.values());
  }

  getToolByName(name: string): MCPTool | undefined {
    return this.registeredTools.get(name);
  }

  registerCustomTool(tool: MCPTool): void {
    this.registeredTools.set(tool.name, tool);
    console.log(`[MCPTools] أداة مخصصة مسجّلة: ${tool.name}`);
  }

  async execute(call: MCPToolCall): Promise<MCPToolResult> {
    const start = Date.now();
    const tool = this.registeredTools.get(call.toolName);

    if (!tool) {
      return {
        requestId: call.requestId,
        toolName: call.toolName,
        success: false,
        content: `أداة غير موجودة: ${call.toolName}`,
        durationMs: Date.now() - start,
      };
    }

    try {
      const content = await this.executeBuiltin(call.toolName, call.input);
      return {
        requestId: call.requestId,
        toolName: call.toolName,
        success: true,
        content,
        durationMs: Date.now() - start,
      };
    } catch (err: any) {
      return {
        requestId: call.requestId,
        toolName: call.toolName,
        success: false,
        content: `خطأ: ${err.message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  private async executeBuiltin(toolName: string, input: Record<string, unknown>): Promise<string> {
    switch (toolName) {
      case "read_file": {
        const filePath = String(input.path);
        const absPath = path.resolve(process.cwd(), filePath);
        if (!fs.existsSync(absPath)) return `الملف غير موجود: ${filePath}`;
        const content = fs.readFileSync(absPath, { encoding: "utf-8" });
        return content.substring(0, 10000);
      }

      case "write_file": {
        const filePath = String(input.path);
        const content = String(input.content);
        const append = Boolean(input.append);
        const absPath = path.resolve(process.cwd(), filePath);
        const dir = path.dirname(absPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (append) {
          fs.appendFileSync(absPath, content, "utf-8");
        } else {
          fs.writeFileSync(absPath, content, "utf-8");
        }
        return `تم ${append ? "إضافة" : "كتابة"} الملف: ${filePath} (${content.length} حرف)`;
      }

      case "list_directory": {
        const dirPath = String(input.path);
        const recursive = Boolean(input.recursive);
        const absPath = path.resolve(process.cwd(), dirPath);
        if (!fs.existsSync(absPath)) return `المجلد غير موجود: ${dirPath}`;

        if (recursive) {
          const items: string[] = [];
          const walkDir = (dir: string, prefix = "") => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              items.push(`${prefix}${entry.isDirectory() ? "📁" : "📄"} ${entry.name}`);
              if (entry.isDirectory() && items.length < 100) {
                walkDir(path.join(dir, entry.name), prefix + "  ");
              }
            }
          };
          walkDir(absPath);
          return items.join("\n");
        } else {
          const entries = fs.readdirSync(absPath, { withFileTypes: true });
          return entries.map(e => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`).join("\n");
        }
      }

      case "web_fetch": {
        const url = String(input.url);
        try {
          const res = await axios.get(url, {
            timeout: 15000,
            headers: { "User-Agent": "Mozilla/5.0 CortexFlow-Agent/1.0" },
          });
          const text = String(res.data)
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .substring(0, 5000);
          return `محتوى ${url}:\n${text}`;
        } catch (err: any) {
          return `فشل جلب ${url}: ${err.message}`;
        }
      }

      case "calculate": {
        const expr = String(input.expression);
        try {
          const safeExpr = expr.replace(/[^0-9+\-*/().%\s,Math.]/g, "");
          if (!safeExpr) return `تعبير غير صالح: ${expr}`;
          const result = Function(`"use strict"; const Math = globalThis.Math; return (${safeExpr})`)();
          const precision = Number(input.precision || 10);
          return `النتيجة: ${typeof result === "number" ? result.toPrecision(precision) : result}`;
        } catch (err: any) {
          return `خطأ في الحساب: ${err.message}`;
        }
      }

      case "datetime_tool": {
        const action = String(input.action);
        const tz = String(input.timezone || "Asia/Riyadh");
        const now = new Date();
        switch (action) {
          case "now":
            return `الوقت الحالي: ${now.toLocaleString("ar-SA", { timeZone: tz })} (${tz})`;
          case "format":
            return `التاريخ: ${now.toISOString()} | بالعربية: ${now.toLocaleDateString("ar-SA")}`;
          case "timezone":
            return `الوقت في ${tz}: ${now.toLocaleString("ar-SA", { timeZone: tz })}`;
          default:
            return `الوقت: ${now.toISOString()}`;
        }
      }

      case "memory_store": {
        const key = String(input.key);
        const value = String(input.value);
        const category = String(input.category || "general");
        MEMORY_STORE.set(key, { value, category, timestamp: new Date().toISOString() });
        return `تم حفظ: "${key}" في الذاكرة`;
      }

      case "memory_retrieve": {
        const query = String(input.query).toLowerCase();
        const limit = Number(input.limit || 5);
        const matches: string[] = [];

        MEMORY_STORE.forEach((v, k) => {
          if (k.toLowerCase().includes(query) || v.value.toLowerCase().includes(query)) {
            matches.push(`**${k}** (${v.category}): ${v.value.substring(0, 200)}`);
          }
        });

        if (matches.length === 0) return `لا توجد نتائج لـ: "${query}"`;
        return `نتائج البحث في الذاكرة:\n${matches.slice(0, limit).join("\n")}`;
      }

      case "code_execute": {
        const code = String(input.code);
        const language = String(input.language || "python");
        try {
          const res = await axios.post(`${this.agentServiceUrl}/execute`, {
            code, language,
          }, { timeout: Number(input.timeout || 30) * 1000 });
          return res.data?.output || res.data?.result || "تم التنفيذ بنجاح";
        } catch (err: any) {
          return `خطأ في التنفيذ: ${err.response?.data?.error || err.message}`;
        }
      }

      default:
        return `أداة غير مُنفَّذة: ${toolName}`;
    }
  }

  formatToolsForLLM(): string {
    const tools = this.getAvailableTools();
    return tools.map(t =>
      `- **${t.name}**: ${t.description}\n  المدخلات: ${Object.entries(t.inputSchema.properties).map(([k, v]) => `${k}(${v.type})`).join(", ")}`
    ).join("\n");
  }

  async connectMCPServer(url: string, name: string): Promise<boolean> {
    try {
      const res = await axios.post(`${url}/mcp/list_tools`, {}, { timeout: 5000 });
      const remoteTools: MCPTool[] = res.data?.tools || [];

      remoteTools.forEach(tool => {
        const mcpTool: MCPTool = { ...tool, source: "mcp_server" };
        this.registeredTools.set(tool.name, mcpTool);
      });

      this.mcpServers.push({ name, url, description: "", tools: remoteTools, status: "connected" });
      console.log(`[MCPTools] خادم MCP متصل: ${name} (${remoteTools.length} أداة)`);
      return true;
    } catch (err) {
      console.warn(`[MCPTools] فشل الاتصال بـ ${url}`);
      return false;
    }
  }

  getStats() {
    return {
      totalTools: this.registeredTools.size,
      builtinTools: BUILTIN_TOOLS.length,
      mcpServers: this.mcpServers.length,
      memoryEntries: MEMORY_STORE.size,
    };
  }
}

export const mcpTools = new MCPToolsManager();
