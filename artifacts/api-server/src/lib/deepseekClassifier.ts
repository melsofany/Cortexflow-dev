import axios from "axios";
import { TaskCategory } from "./modelSelector.js";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const OLLAMA_BASE_URL = process.env.OLLAMA_URL || "http://localhost:11434";

const CLASSIFY_PROMPT = `You are a task classifier for an AI agent system. Classify the user's task into EXACTLY ONE of these categories:

- browser    → web browsing, visiting sites, clicking, filling forms, logging in, navigating
- code       → programming, writing scripts, debugging, APIs, databases, functions
- research   → searching info, explaining concepts, summarizing, analyzing data
- creative   → writing stories, articles, poems, marketing copy, dialogues
- math       → calculations, equations, statistics, numerical problems
- translation → translating text between languages
- reasoning  → complex logic, comparisons, strategic planning, decision making
- file       → reading/writing files, parsing data files (json/csv/txt)
- agent      → multi-step goal completion, complex projects requiring planning
- simple     → short casual questions, greetings, basic lookups

Respond with ONLY the category name in lowercase, nothing else. No explanation.`;

const VALID_CATEGORIES: TaskCategory[] = [
  "browser", "code", "research", "creative", "math",
  "translation", "reasoning", "file", "agent", "simple",
];

let cloudAvailable: boolean | null = null;
let localDeepSeekModel: string | null = null;
let lastCheck = 0;

async function getLocalDeepSeekModel(): Promise<string | null> {
  const now = Date.now();
  if (localDeepSeekModel !== null && now - lastCheck < 30000) return localDeepSeekModel;
  try {
    const res = await axios.get(`${OLLAMA_BASE_URL}/api/tags`, { timeout: 3000 });
    const models: Array<{ name: string }> = res.data?.models || [];
    const ds = models.find(m => m.name.startsWith("deepseek"));
    localDeepSeekModel = ds?.name || null;
    lastCheck = now;
    return localDeepSeekModel;
  } catch {
    return null;
  }
}

async function classifyViaCloudDeepSeek(taskDescription: string): Promise<TaskCategory | null> {
  if (!DEEPSEEK_API_KEY) return null;

  if (cloudAvailable === false) return null;

  try {
    const response = await axios.post(
      `${DEEPSEEK_BASE_URL}/chat/completions`,
      {
        model: "deepseek-chat",
        messages: [
          { role: "system", content: CLASSIFY_PROMPT },
          { role: "user", content: taskDescription },
        ],
        max_tokens: 10,
        temperature: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      }
    );
    const raw = response.data?.choices?.[0]?.message?.content?.trim().toLowerCase() ?? "";
    cloudAvailable = true;
    const matched = VALID_CATEGORIES.find(c => raw.includes(c));
    if (matched) {
      console.log(`[DeepSeek Cloud] Classified "${taskDescription.slice(0, 50)}" → ${matched}`);
      return matched;
    }
    return null;
  } catch {
    cloudAvailable = false;
    return null;
  }
}

async function classifyViaLocalDeepSeek(taskDescription: string): Promise<TaskCategory | null> {
  const model = await getLocalDeepSeekModel();
  if (!model) return null;

  try {
    const response = await axios.post(
      `${OLLAMA_BASE_URL}/api/chat`,
      {
        model,
        messages: [
          { role: "system", content: CLASSIFY_PROMPT },
          { role: "user", content: taskDescription },
        ],
        stream: false,
        options: { temperature: 0, num_predict: 20 },
      },
      { timeout: 15000 }
    );
    const raw: string = response.data?.message?.content?.trim().toLowerCase() ?? "";
    const matched = VALID_CATEGORIES.find(c => raw.includes(c));
    if (matched) {
      console.log(`[DeepSeek Local (${model})] Classified "${taskDescription.slice(0, 50)}" → ${matched}`);
      return matched;
    }
    return null;
  } catch (err: any) {
    console.warn(`[DeepSeek Local] Classification error: ${err.message}`);
    return null;
  }
}

export async function classifyWithDeepSeek(
  taskDescription: string
): Promise<{ category: TaskCategory; confidence: "high" | "low"; source: "deepseek" | "fallback" }> {
  const cloudResult = await classifyViaCloudDeepSeek(taskDescription);
  if (cloudResult) return { category: cloudResult, confidence: "high", source: "deepseek" };

  const localResult = await classifyViaLocalDeepSeek(taskDescription);
  if (localResult) return { category: localResult, confidence: "high", source: "deepseek" };

  return { category: "simple", confidence: "low", source: "fallback" };
}

export function isDeepSeekConfigured(): boolean {
  return !!DEEPSEEK_API_KEY;
}

export { DEEPSEEK_API_KEY };
