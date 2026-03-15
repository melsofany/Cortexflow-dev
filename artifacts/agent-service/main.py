"""
CortexFlow Agent Service — Python Backend
Uses LangGraph (langchain-ai/langgraph) + Ollama local models
Supports: Meta Llama, Mistral, QwenLM, and more
"""

import os
import json
import asyncio
import subprocess
import httpx
from typing import TypedDict, Annotated, Sequence
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn

# LangGraph & LangChain
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langchain_core.language_models import BaseChatModel
from langchain_core.outputs import ChatResult, ChatGeneration
from langchain_core.messages import AIMessageChunk
import langgraph
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
PORT = int(os.getenv("AGENT_SERVICE_PORT", "8090"))

app = FastAPI(title="CortexFlow Agent Service")

# ── Available Models Registry ─────────────────────────────────────────────────
PROVIDER_MODELS = {
    "QwenLM":     ["qwen2:0.5b", "qwen2.5:0.5b", "qwen2:1.5b"],
    "meta-llama": ["llama3.2:1b", "llama3.2:3b", "llama3:8b"],
    "mistralai":  ["mistral:7b-instruct-q2_K", "mistral:latest", "mistral:7b"],
    "AutoGPT":    ["qwen2:0.5b", "llama3.2:1b"],   # AutoGPT uses best available
    "LangGraph":  ["qwen2:0.5b", "llama3.2:1b"],   # LangGraph orchestration
}


async def get_available_models() -> list[str]:
    """Fetch locally installed Ollama models."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags", timeout=5)
            return [m["name"] for m in resp.json().get("models", [])]
    except Exception:
        return []


async def pick_best_model(preferred: list[str], available: list[str]) -> str | None:
    for m in preferred:
        if m in available:
            return m
    return available[0] if available else None


async def ollama_chat(model: str, messages: list[dict], max_tokens: int = 500) -> str:
    """Call Ollama chat API."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": model,
                "messages": messages,
                "stream": False,
                "options": {"num_predict": max_tokens, "temperature": 0.3},
            },
            timeout=120,
        )
        return resp.json().get("message", {}).get("content", "")


# ── LangGraph Agent State ─────────────────────────────────────────────────────

class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    task: str
    model: str
    steps: list[str]
    result: str
    done: bool


def build_agent_graph(model_name: str):
    """Build a LangGraph multi-step agent graph."""

    async def observe_node(state: AgentState) -> AgentState:
        msgs = [
            {"role": "system", "content": "أنت وكيل ذكاء اصطناعي. حلل المهمة وحدد المتطلبات."},
            {"role": "user", "content": f"المهمة: {state['task']}\nما المتطلبات الرئيسية؟"},
        ]
        response = await ollama_chat(model_name, msgs, max_tokens=300)
        state["steps"].append(f"[OBSERVE] {response}")
        state["messages"] = list(state["messages"]) + [AIMessage(content=response)]
        return state

    async def think_node(state: AgentState) -> AgentState:
        history = [{"role": "system", "content": "أنت وكيل ذكاء اصطناعي خبير."}]
        for msg in state["messages"][-4:]:
            role = "assistant" if isinstance(msg, AIMessage) else "user"
            history.append({"role": role, "content": msg.content})
        history.append({"role": "user", "content": "ما أفضل طريقة لتنفيذ هذه المهمة؟"})
        response = await ollama_chat(model_name, history, max_tokens=300)
        state["steps"].append(f"[THINK] {response}")
        state["messages"] = list(state["messages"]) + [AIMessage(content=response)]
        return state

    async def plan_node(state: AgentState) -> AgentState:
        msgs = [
            {"role": "system", "content": "أنت مخطط مهام. اذكر الخطوات بإيجاز."},
            {"role": "user", "content": f"المهمة: {state['task']}\nاذكر الخطوات المتسلسلة."},
        ]
        response = await ollama_chat(model_name, msgs, max_tokens=250)
        state["steps"].append(f"[PLAN] {response}")
        state["messages"] = list(state["messages"]) + [AIMessage(content=response)]
        return state

    async def act_node(state: AgentState) -> AgentState:
        msgs = [
            {"role": "system", "content": "أنت منفذ مهام. نفّذ وقدّم النتيجة الفعلية."},
            {"role": "user", "content": f"نفّذ هذه المهمة: {state['task']}"},
        ]
        response = await ollama_chat(model_name, msgs, max_tokens=500)
        state["steps"].append(f"[ACT] {response}")
        state["result"] = response
        state["messages"] = list(state["messages"]) + [AIMessage(content=response)]
        return state

    async def verify_node(state: AgentState) -> AgentState:
        msgs = [
            {"role": "system", "content": "تحقق من اكتمال المهمة ولخّص النتيجة."},
            {"role": "user", "content": f"المهمة: {state['task']}\nالنتيجة: {state['result']}\nهل اكتملت؟"},
        ]
        response = await ollama_chat(model_name, msgs, max_tokens=200)
        state["steps"].append(f"[VERIFY] {response}")
        state["done"] = True
        state["result"] = response
        return state

    # Build the graph
    graph = StateGraph(AgentState)
    graph.add_node("observe", observe_node)
    graph.add_node("think", think_node)
    graph.add_node("plan", plan_node)
    graph.add_node("act", act_node)
    graph.add_node("verify", verify_node)

    graph.set_entry_point("observe")
    graph.add_edge("observe", "think")
    graph.add_edge("think", "plan")
    graph.add_edge("plan", "act")
    graph.add_edge("act", "verify")
    graph.add_edge("verify", END)

    return graph.compile()


# ── AutoGPT-style Agent (iterative goal-seeking) ──────────────────────────────

async def autogpt_style_agent(task: str, model: str, max_iterations: int = 5) -> dict:
    """AutoGPT-inspired iterative agent using local models."""
    SYSTEM = """أنت وكيل ذاتي التشغيل (AutoGPT). لديك هدف تريد تحقيقه.
في كل خطوة اكتب بهذا الشكل:
THOUGHT: تفكيرك
ACTION: ما ستفعله
RESULT: النتيجة المتوقعة
DONE: نعم أو لا"""

    history = [{"role": "system", "content": SYSTEM}]
    steps = []

    for i in range(max_iterations):
        history.append({
            "role": "user",
            "content": f"الهدف: {task}\nالخطوة {i+1}: ماذا ستفعل الآن؟"
        })
        response = await ollama_chat(model, history, max_tokens=300)
        history.append({"role": "assistant", "content": response})
        steps.append(f"خطوة {i+1}: {response}")

        # Check if done
        if "DONE: نعم" in response or "done: yes" in response.lower() or i == max_iterations - 1:
            break

    return {"steps": steps, "result": steps[-1] if steps else ""}


# ── API Endpoints ──────────────────────────────────────────────────────────────

class TaskRequest(BaseModel):
    task: str
    provider: str = "QwenLM"       # QwenLM, meta-llama, mistralai, AutoGPT, LangGraph
    model: str | None = None       # Override model


class TaskResponse(BaseModel):
    provider: str
    model: str
    steps: list[str]
    result: str


@app.get("/health")
async def health():
    models = await get_available_models()
    return {
        "status": "ok",
        "available_models": models,
        "providers": list(PROVIDER_MODELS.keys()),
    }


@app.get("/models")
async def list_models():
    available = await get_available_models()
    result = {}
    for provider, preferred in PROVIDER_MODELS.items():
        installed = [m for m in preferred if m in available]
        result[provider] = {"preferred": preferred, "installed": installed}
    return result


@app.post("/execute", response_model=TaskResponse)
async def execute_task(req: TaskRequest):
    available = await get_available_models()
    if not available:
        raise HTTPException(503, "No Ollama models available. Make sure Ollama is running.")

    # Pick model
    preferred = PROVIDER_MODELS.get(req.provider, list(PROVIDER_MODELS.values())[0])
    model = req.model or await pick_best_model(preferred, available)
    if not model:
        raise HTTPException(503, f"No model available for provider: {req.provider}")

    steps = []
    result = ""

    if req.provider == "AutoGPT":
        # AutoGPT-style iterative agent
        agent_result = await autogpt_style_agent(req.task, model)
        steps = agent_result["steps"]
        result = agent_result["result"]

    elif req.provider == "LangGraph":
        # LangGraph multi-node pipeline
        graph = build_agent_graph(model)
        initial_state: AgentState = {
            "messages": [HumanMessage(content=req.task)],
            "task": req.task,
            "model": model,
            "steps": [],
            "result": "",
            "done": False,
        }
        final_state = await graph.ainvoke(initial_state)
        steps = final_state["steps"]
        result = final_state["result"]

    else:
        # Standard Ollama chat (QwenLM, meta-llama, mistralai)
        msgs = [
            {"role": "system", "content": f"أنت وكيل ذكاء اصطناعي يستخدم نموذج {model}. نفّذ المهام بدقة."},
            {"role": "user", "content": req.task},
        ]
        steps.append(f"[{req.provider}:{model}] جاري التنفيذ...")
        result = await ollama_chat(model, msgs, max_tokens=600)
        steps.append(f"[RESULT] {result}")

    return TaskResponse(provider=req.provider, model=model, steps=steps, result=result)


@app.post("/pull-model")
async def pull_model(body: dict):
    """Pull a new Ollama model."""
    model_name = body.get("model")
    if not model_name:
        raise HTTPException(400, "model name required")

    async def stream_pull():
        proc = await asyncio.create_subprocess_exec(
            "ollama", "pull", model_name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        async for line in proc.stdout:
            yield line.decode()
        await proc.wait()

    return StreamingResponse(stream_pull(), media_type="text/plain")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
