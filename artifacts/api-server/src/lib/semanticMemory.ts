/**
 * semanticMemory.ts — الذاكرة الدلالية (Semantic Memory)
 * ─────────────────────────────────────────────────────────────────────────────
 * تخزّن الحقائق الدائمة وتفضيلات المستخدم مع بحث بالتشابه الدلالي.
 *
 * الأنواع:
 *   - Fact: حقيقة عامة (مثل: "Python أفضل للذكاء الاصطناعي")
 *   - Preference: تفضيل مستخدم (مثل: "المستخدم يفضل العربية")
 *   - Concept: مفهوم تقني (مثل: "LangGraph = DAG + State Machine")
 *   - Relationship: علاقة بين كيانين
 *
 * البحث: TF-IDF بسيط + مطابقة الكلمات المفتاحية (بدون نماذج embedding)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";

export type MemoryType = "fact" | "preference" | "concept" | "relationship" | "skill";

export interface SemanticEntry {
  id: string;
  type: MemoryType;
  subject: string;
  content: string;
  keywords: string[];
  confidence: number;
  accessCount: number;
  createdAt: string;
  lastAccessedAt: string;
  source?: string;
  tags?: string[];
}

export interface MemorySearchResult {
  entry: SemanticEntry;
  score: number;
  matchedKeywords: string[];
}

interface MemoryStore {
  entries: SemanticEntry[];
  version: number;
  totalAccesses: number;
}

const MEMORY_FILE = path.join(process.cwd(), "data", "semantic_memory.json");
const MAX_ENTRIES = 500;

function ensureDir() {
  const dir = path.dirname(MEMORY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore(): MemoryStore {
  ensureDir();
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    }
  } catch {}
  return { entries: [], version: 1, totalAccesses: 0 };
}

function saveStore(store: MemoryStore) {
  ensureDir();
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2)); } catch {}
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "في", "من", "إلى", "على", "مع", "هو", "هي", "هم", "كان", "كانت", "أن", "إن",
    "and", "the", "is", "in", "of", "to", "a", "for", "that", "with", "this", "it"
  ]);
  return text
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 30);
}

function scoreEntry(entry: SemanticEntry, queryKeywords: string[]): number {
  if (queryKeywords.length === 0) return 0;
  const matched = queryKeywords.filter(k =>
    entry.keywords.includes(k) ||
    entry.content.toLowerCase().includes(k) ||
    entry.subject.toLowerCase().includes(k)
  );
  return matched.length / queryKeywords.length;
}

class SemanticMemory {
  private store: MemoryStore;

  constructor() {
    this.store = loadStore();
    console.log(`[SemanticMemory] تم التحميل: ${this.store.entries.length} سجل دلالي`);
  }

  store_entry(input: {
    type: MemoryType;
    subject: string;
    content: string;
    confidence?: number;
    source?: string;
    tags?: string[];
  }): SemanticEntry {
    const keywords = extractKeywords(`${input.subject} ${input.content}`);

    const existing = this.store.entries.find(e =>
      e.subject.toLowerCase() === input.subject.toLowerCase() && e.type === input.type
    );

    if (existing) {
      existing.content = input.content;
      existing.keywords = keywords;
      existing.confidence = input.confidence ?? existing.confidence;
      existing.tags = input.tags ?? existing.tags;
      existing.source = input.source ?? existing.source;
      saveStore(this.store);
      return existing;
    }

    const entry: SemanticEntry = {
      id: `sem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: input.type,
      subject: input.subject,
      content: input.content,
      keywords,
      confidence: input.confidence ?? 0.8,
      accessCount: 0,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      source: input.source,
      tags: input.tags,
    };

    this.store.entries.unshift(entry);
    if (this.store.entries.length > MAX_ENTRIES) {
      this.store.entries = this.store.entries
        .sort((a, b) => b.accessCount - a.accessCount)
        .slice(0, MAX_ENTRIES);
    }

    saveStore(this.store);
    return entry;
  }

  search(query: string, options?: {
    type?: MemoryType;
    limit?: number;
    minScore?: number;
  }): MemorySearchResult[] {
    const { type, limit = 10, minScore = 0.1 } = options || {};
    const queryKeywords = extractKeywords(query);
    this.store.totalAccesses++;

    let candidates = this.store.entries;
    if (type) candidates = candidates.filter(e => e.type === type);

    const results: MemorySearchResult[] = candidates
      .map(entry => {
        const score = scoreEntry(entry, queryKeywords);
        const matched = queryKeywords.filter(k =>
          entry.keywords.includes(k) || entry.content.toLowerCase().includes(k)
        );
        return { entry, score, matchedKeywords: matched };
      })
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    results.forEach(r => {
      r.entry.accessCount++;
      r.entry.lastAccessedAt = new Date().toISOString();
    });

    if (results.length > 0) saveStore(this.store);
    return results;
  }

  getByType(type: MemoryType, limit = 20): SemanticEntry[] {
    return this.store.entries
      .filter(e => e.type === type)
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit);
  }

  extractAndStore(text: string, source?: string): number {
    let stored = 0;
    const lines = text.split(/[.\n]/).map(l => l.trim()).filter(l => l.length > 20);

    for (const line of lines.slice(0, 10)) {
      const prefPhrases = ["أفضل", "تفضيل", "prefer", "like", "يحب", "يريد"];
      const factPhrases = ["هو", "is", "تعني", "means", "يُعرَّف", "defined as", "=", "يساوي"];
      const skillPhrases = ["كيف", "how to", "خطوات", "steps", "طريقة", "method"];

      let type: MemoryType = "fact";
      if (prefPhrases.some(p => line.includes(p))) type = "preference";
      else if (skillPhrases.some(p => line.includes(p))) type = "skill";
      else if (!factPhrases.some(p => line.includes(p))) continue;

      const subject = line.split(/[،,]|هو|is|means/)[0].trim().slice(0, 50);
      if (subject.length < 5) continue;

      this.store_entry({ type, subject, content: line, confidence: 0.6, source });
      stored++;
    }
    return stored;
  }

  formatForContext(query: string, maxEntries = 5): string {
    const results = this.search(query, { limit: maxEntries, minScore: 0.15 });
    if (results.length === 0) return "";

    const lines = results.map(r => {
      const typeLabel = {
        fact: "📌 حقيقة", preference: "⭐ تفضيل", concept: "💡 مفهوم",
        relationship: "🔗 علاقة", skill: "🛠️ مهارة"
      }[r.entry.type];
      return `${typeLabel} [${r.entry.subject}]: ${r.entry.content}`;
    });

    return `\n[الذاكرة الدلالية ذات الصلة]\n${lines.join("\n")}`;
  }

  getStats() {
    const byType = this.store.entries.reduce((acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      total: this.store.entries.length,
      byType,
      totalAccesses: this.store.totalAccesses,
      mostAccessed: this.store.entries
        .sort((a, b) => b.accessCount - a.accessCount)
        .slice(0, 5)
        .map(e => ({ subject: e.subject, count: e.accessCount })),
    };
  }

  clear() {
    this.store.entries = [];
    saveStore(this.store);
  }
}

export const semanticMemory = new SemanticMemory();
