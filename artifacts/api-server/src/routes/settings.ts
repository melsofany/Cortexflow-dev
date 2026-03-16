import { Router, type IRouter } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";

const router: IRouter = Router();

const ENV_FILE = path.resolve(process.cwd(), ".env.local");

function loadEnvLocal() {
  try {
    if (!fs.existsSync(ENV_FILE)) return;
    const lines = fs.readFileSync(ENV_FILE, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {}
}

loadEnvLocal();

function saveToEnvLocal(key: string, value: string) {
  let content = "";
  try {
    if (fs.existsSync(ENV_FILE)) content = fs.readFileSync(ENV_FILE, "utf-8");
  } catch {}

  const lines = content.split("\n").filter(l => !l.startsWith(`${key}=`));
  lines.push(`${key}=${value}`);
  fs.writeFileSync(ENV_FILE, lines.filter(Boolean).join("\n") + "\n", "utf-8");
}

async function testDeepSeekKey(apiKey: string): Promise<boolean> {
  try {
    const res = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-chat",
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
        temperature: 0,
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        timeout: 8000,
      }
    );
    return res.status === 200;
  } catch {
    return false;
  }
}

router.get("/settings/deepseek", (_req, res) => {
  const configured = !!process.env.DEEPSEEK_API_KEY;
  const maskedKey = configured
    ? process.env.DEEPSEEK_API_KEY!.slice(0, 6) + "..." + process.env.DEEPSEEK_API_KEY!.slice(-4)
    : null;
  res.json({ configured, maskedKey, model: "deepseek-chat" });
});

router.post("/settings/deepseek", async (req, res) => {
  const { apiKey } = req.body as { apiKey?: string };

  if (!apiKey || apiKey.trim().length < 10) {
    res.status(400).json({ success: false, error: "مفتاح API غير صالح" });
    return;
  }

  const trimmed = apiKey.trim();
  const valid = await testDeepSeekKey(trimmed);

  if (!valid) {
    res.status(400).json({ success: false, error: "المفتاح غير صحيح أو لا يمكن التحقق منه" });
    return;
  }

  process.env.DEEPSEEK_API_KEY = trimmed;
  saveToEnvLocal("DEEPSEEK_API_KEY", trimmed);

  const maskedKey = trimmed.slice(0, 6) + "..." + trimmed.slice(-4);
  res.json({ success: true, maskedKey });
});

router.delete("/settings/deepseek", (_req, res) => {
  delete process.env.DEEPSEEK_API_KEY;
  try {
    if (fs.existsSync(ENV_FILE)) {
      const lines = fs.readFileSync(ENV_FILE, "utf-8")
        .split("\n")
        .filter(l => !l.startsWith("DEEPSEEK_API_KEY="));
      fs.writeFileSync(ENV_FILE, lines.filter(Boolean).join("\n") + "\n", "utf-8");
    }
  } catch {}
  res.json({ success: true });
});

export default router;
