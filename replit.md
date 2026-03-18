# CortexFlow AI Agent Platform

## Overview

CortexFlow is a professional multi-agent AI platform inspired by Manus AI's architecture. It implements:
- **DAG-based Task Planning**: Tasks as Directed Acyclic Graphs with parallel execution of independent steps
- **ReAct Engine**: Explicit Thought → Action → Observation loop for complex reasoning
- **CodeAct Paradigm**: Generates executable Python code as actions (ICML 2024 paper)
- **Wide Research**: Parallel full-agent instances for large-scale research tasks (Manus AI-inspired)
- **Parallel Execution**: Multiple agents running simultaneously for speed
- **Context Manager**: Smart context window compression to avoid token overflow
- **Tool Orchestrator**: Unified tool registry with caching and intelligent selection
- **MCP Tools**: Model Context Protocol integration (Anthropic standard)
- **GAIA Evaluator**: Automatic task quality scoring with historical tracking
- **Semantic Memory**: TF-IDF based semantic fact/preference storage with similarity search
- **Procedural Memory**: Skill/workflow learning from successful tasks
- **Episodic Memory**: Historical task context retrieval
- **Hybrid AI**: Ollama (local) → DeepSeek (cloud) → fallback chain
- **Reflexion Engine**: Verbal reinforcement learning — generates self-critiques after each task, stores them, and uses them to improve future attempts (inspired by Reflexion 2023 paper)
- **Prompt Optimizer**: DSPy/MIPROv2-inspired automatic prompt improvement — tracks success rates per category, generates improved variants, selects best performers
- **Self-Improvement Loop**: Continuous self-learning system — generates behavior rules from patterns, detects performance trends, runs optimization cycles every 10 tasks
- **Persistent Long-Term Memory**: Memory now saved to disk (data/long_term_memory.json), persists across server restarts, with success/failure tracking

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5 + Socket.io
- **Frontend**: React + Vite + Tailwind CSS + Framer Motion
- **AI Runtime**: Ollama (local CPU inference) → Python FastAPI agent service
- **Agent Loops**: DAG+Parallel (Manus-inspired), ReAct, OODA, LangGraph
- **Agent Tools**: execute_code, calculate, read_file, write_file, web_search, browser_navigate, shell_run, summarize_text, extract_info

## Architecture

```text
User (Frontend App.tsx)
  ↓  socket.io /api/socket
API Server (Express, port 8080)
  ↓  agentRunner.ts → classifies task
  ├── Simple chat → Direct Response (fast path)
  ├── Browser tasks → Playwright/Chromium browser agent
  ├── Math tasks → Python Agent Service (port 8090)
  └── Complex tasks → Manus-inspired DAG Pipeline:
        ↓
      DAGPlanner → DAGPlan (nodes + dependencies + parallel groups)
        ↓
      ParallelExecutor → runs independent nodes simultaneously:
        ├── ResearcherAgent (information gathering)
        ├── CoderAgent (programming tasks)
        ├── BrowserAgent (web navigation)
        ├── ExecutorAgent (tool execution)
        ├── ReviewerAgent (quality review)
        └── GeneralAgent (miscellaneous)
        ↓
      ContextManager → sliding window compression + pinned facts
        ↓
      ToolOrchestrator → web_search, execute_code, calculate, etc.
        ↓
      ReviewAgent → merge + synthesize parallel results
        ↓
      Ollama (port 11434) + DeepSeek API
```

## Core Components (Manus AI-inspired)

- `dagPlanner.ts` — DAG-based task decomposition with dependency tracking
- `parallelExecutor.ts` — Concurrent execution of independent DAG nodes
- `reactEngine.ts` — ReAct loop (Thought→Action→Observation) with self-verification
- `contextManager.ts` — Smart context compression and working memory
- `toolOrchestrator.ts` — Unified tool registry with caching and intelligent selection
- `dag-view.tsx` — Real-time DAG visualization in the frontend

## Advanced Systems (Phase 1-3)

### Phase 1: Action Paradigm + Memory Management
- `codeActEngine.ts` — CodeAct: generates executable Python code as actions (ICML 2024)
  - Dynamic todo list management (rewrites task list each iteration)
  - Integrates with Python agent service for code execution
- `preTaskResearcher.ts` — Pre-task analysis: complexity scoring, knowledge audit, platform playbooks
- `verificationAgent.ts` — Quality verification: scores output 1-10, flags gaps, triggers replanning

### Phase 2: Memory Layers
- `episodicMemory.ts` — Episodic memory: past task history + procedural patterns
- `semanticMemory.ts` — Semantic memory: facts/preferences/concepts with TF-IDF similarity search
  - Auto-extracts facts from task outputs
  - Injects relevant context into each task
- `proceduralMemory.ts` — Procedural memory: skill/workflow learning
  - 5 built-in skills (web research, debugging, API integration, data analysis, file processing)
  - Auto-learns new skills from successful tasks
  - Routes relevant skills into task context

### Phase 3: Scale + Evaluation + Integration
- `wideResearch.ts` — Wide Research System: parallel full-agent instances for large tasks
  - Decomposes into 4-8 independent research threads
  - Synthesis agent merges results into unified report
- `mcpTools.ts` — MCP (Model Context Protocol) integration
  - 9 built-in tools registered
  - Supports external MCP server connections
- `gaiaEvaluator.ts` — GAIA-inspired benchmark evaluator
  - Scores every task on: accuracy, completeness, efficiency, clarity, tool utilization
  - Tracks performance history with A/B/C/S grade distribution
  - Generates system health reports + trend analysis

### Advanced API Routes (`/api/`)
- `/codeact/stats` — CodeAct engine stats
- `/research/wide/stats` — Wide Research stats
- `/mcp/tools`, `/mcp/execute`, `/mcp/connect` — MCP tools management
- `/gaia/report`, `/gaia/evaluations` — GAIA benchmark data
- `/memory/semantic/stats`, `/memory/semantic/search`, `/memory/semantic/store` — Semantic memory
- `/memory/semantic/by-type/:type` — Filter by memory type
- `/memory/procedural/stats`, `/memory/procedural/skills` — Procedural skills
- `/memory/procedural/find?task=...` — Find relevant skills for task

### AdvancedPanel UI (لوحة الأنظمة المتقدمة)
- Toggle with "متقدم" button in header
- 5 sections: 📊 تقييم GAIA | 📋 مهام CodeAct | 🔧 أدوات MCP | 💡 دلالي | 🛠️ مهارات
- Mobile: dedicated "متقدم" tab with badge on active CodeAct todos

## Structure

```text
artifacts/
├── agent-service/          # Python FastAPI — OODA/LangGraph/AutoGPT/tools
│   └── main.py
├── api-server/             # Express 5 + Socket.io backend
│   └── src/
│       ├── lib/            # ollamaClient, taskStore, agentRunner, modelSelector
│       └── routes/         # health, tasks, ai, providers, logs
└── cortexflow/             # React + Vite frontend
    └── src/
        ├── components/     # chat-interface, thinking-steps, browser-view, task-sidebar
        └── App.tsx         # Main app with auto task classification
lib/
├── api-spec/               # OpenAPI spec + Orval codegen config
├── api-client-react/       # Generated React Query hooks
└── api-zod/                # Generated Zod schemas
```

## Key Features

- **Auto task classification**: browser / system / research / ai — no manual selection needed
- **OODA Loop**: Observe → Orient → Decide → Act loop with tool calls
- **Self-improvement**: PerformanceMemory records success/failure/quality per model per category
- **Smart model routing**: SelfImprovingModelSelector with 9 task categories and dynamic learned scores
- **Agent tools**: execute_code, calculate, read_file, write_file, web_search, run_shell
- **Real-time updates**: Socket.io streaming with thinking steps display
- **Arabic + English UI** support

## Tech Intelligence System (ذكاء التقنية)

A fully integrated self-learning and self-optimization system:

### 3 Core Modules (techIntelligence.ts)

1. **TechResearcher** — Searches for the latest AI/tech libraries and frameworks every 6h
   - Topics: LangChain/LangGraph/AutoGen/CrewAI updates, Playwright best practices, DeepSeek models, Node.js/TypeScript patterns
   - Injects tech context into every agent system prompt

2. **CodeSelfImprover** — Analyzes key codebase files every 12h using DeepSeek
   - Files analyzed: agentRunner.ts, browserAgent.ts, learningEngine.ts, modelSelector.ts, main.py
   - Suggests specific improvements (performance, security, modernization, best-practice, bug-fix)
   - Each improvement can be applied or rejected from the UI

3. **PerformanceMonitor** — Checks system health every 5min
   - Monitors: DeepSeek API latency, Ollama availability, Agent Service, task success rate, avg duration
   - Generates scored snapshots (0-100) and alerts

### TechPanel UI (لوحة ذكاء التقنية)
- Available on **desktop** (toggle "ذكاء التقنية" button in header, shows as right sidebar)
- Available on **mobile** (dedicated "الذكاء" tab in bottom navigation)
- Live score shown in header button, auto-refreshes every 30s
- Sections: 📊 Performance | 🔬 Technologies | 🔧 Code Improvements

### Tech Intelligence API Routes (/api/tech/*)
- `GET /api/tech/knowledge` — tech knowledge base
- `POST /api/tech/research` — trigger immediate research
- `GET /api/tech/improvements/pending` — pending code suggestions
- `POST /api/tech/improvements/:id/apply` — apply a code improvement
- `POST /api/tech/improvements/:id/reject` — reject a suggestion
- `GET /api/tech/performance` — full performance data
- `GET /api/tech/report` — AI-generated performance report

### Socket.io Events
- `techUpdate` — emitted on connection and every 60s with live performance score + API health

## Services & Ports

| Service            | Port  | Notes                           |
|--------------------|-------|---------------------------------|
| Ollama             | 11434 | Local LLM inference (CPU)       |
| Python Agent       | 8090  | FastAPI OODA/LangGraph/AutoGPT  |
| API Server         | 8080  | Express + Socket.io             |
| CortexFlow UI      | 18188 | React + Vite                    |

## AI Models (Ollama)

| Model          | Size  | Best For                    |
|----------------|-------|-----------------------------|
| qwen2:0.5b     | 352MB | Quick tasks, chat, math     |
| llama3.2:1b    | 1.3GB | General reasoning, research |
| llama3.2:3b    | 2.0GB | Complex reasoning (DL)      |

## Self-Improvement Endpoints

- `GET /self-improvement` — view performance stats per model per category
- `POST /self-improvement/reset` — reset learned scores
- `GET /self-improvement/report` — generate improvement suggestions

## Known Performance Notes

- All inference runs on CPU (no GPU) — each LLM call takes 15-60s depending on model size
- Multi-agent plan: 1 planning call + N step calls + 1 review call (typically 5-8 total LLM calls)
- Model auto-selection prefers smaller models for speed unless performance data shows better results

## Bug Fixes Applied

- **Socket broadcast fix**: Changed `socket.emit()` → `io.emit()` for task events so results reach ALL connected clients, not just the original socket (fixes results lost on reconnect)
- **Reconnect delivery**: Added `lastCompletedTask` cache to re-deliver results to newly connected clients
- **Task routing**: Code/agent/reasoning tasks now use multi-agent system instead of Python agent (only math still uses Python agent for precise calculation)
- **Tab switching**: Browser tasks auto-switch to browser tab on mobile; task completion switches back to chat tab
