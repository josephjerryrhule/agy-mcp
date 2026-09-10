# Omni-Bridge (`agy-mcp`)

[![Version](https://img.shields.io/badge/version-1.4.0-blue.svg)](https://github.com/josephjerryrhule/agy-mcp/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](package.json)

A Model Context Protocol (MCP) server that transforms **Claude Code** and **Claude Desktop** into an omni-agent orchestrator. Claude acts as the lead architect, delegating token-heavy operations and specialized tasks to **Antigravity (`agy`)**, **OpenAI Codex (`codex`)**, and **ChatGPT** subagents.

```
                         ┌───► Antigravity (`agy_execute`) [Google Gemini]
                         │     Heavy edits, repository exploration, and long test suites
                         │
Claude Code / Desktop ───┼───► OpenAI Codex (`codex_execute`) [Codex CLI]
(Lead Architect)         │     Autonomous coding, terminal actions, and script executions
                         │
                         └───► ChatGPT (`chatgpt_consult`) [OpenAI o3 / GPT-4o]
                               System design advice, math, and adversarial code reviews
```

---

## 🚀 Quick Setup

### 1. Claude Code CLI (Automatic Updates)
Run once in your terminal:
```bash
claude mcp add antigravity npx -y github:josephjerryrhule/agy-mcp
```
Or add directly to `~/.claude.json`:
```json
{
  "mcpServers": {
    "antigravity": {
      "command": "npx",
      "args": ["-y", "github:josephjerryrhule/agy-mcp"]
    }
  }
}
```

### 2. Claude Desktop (Automatic Updates)
Add to your `claude_desktop_config.json`:
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "antigravity": {
      "command": "npx",
      "args": ["-y", "github:josephjerryrhule/agy-mcp"]
    }
  }
}
```

### 3. Direct 1-Click `.mcpb` Download (Claude Desktop)
If you prefer installing a standalone bundle without npm:

👉 **[Download Latest `agy-mcp.mcpb`](https://github.com/josephjerryrhule/agy-mcp/releases/latest/download/agy-mcp.mcpb)**

Double-click the downloaded `.mcpb` file to import it into Claude Desktop.

---

## 🌟 How It Works: Division of Labor

Large coding tasks quickly exhaust Claude's context window. Instead of loading dozens of files or running multi-turn loops directly in Claude, Claude delegates the work:

1. **Claude (The Lead Architect)**:
   * Keeps high-level context, architecture, schema design, and strategy.
   * Formulates explicit, pixel-perfect implementation instructions.
   * Performs final review and quality assurance.

2. **Antigravity (`agy`) (The Volume Execution Engine)**:
   * Runs headless via Google Gemini (`agy -p --dangerously-skip-permissions`).
   * Handles multi-file implementations, wide repo sweeps, boilerplate generation, and iterative test loops.
   * Returns a concise summary, git diff, and token analytics back to Claude.

3. **OpenAI Codex (`codex`) (The Autonomous Coding Agent)**:
   * Runs headless via OpenAI Codex CLI (`codex exec --dangerously-bypass-approvals-and-sandbox`).
   * Reuses your existing ChatGPT subscription (no per-token API billing required).
   * Executes terminal commands, bash scripts, and code refactors in an isolated workspace.
   * Has built-in image generation capabilities to create and place project assets.

4. **ChatGPT Consulting (`chatgpt`) (The Advisory Specialist)**:
   * Provides adversarial code reviews on git diffs (security, performance, architecture).
   * Delivers second opinions on complex algorithms, state machines, and system trade-offs.

---

## ✨ Core Features

* **Real-Time Terminal Telemetry**: Colored live progress banners showing active tool calls, thinking tokens, and execution durations.
* **Exact Token Savings Calculator**: Computes exact tokens processed by workers versus tokens returned to Claude, recording lifetime metrics.
* **Claude Desktop 60-Second Timeout Immunity**: Background execution mode (`async: true`) with polling (`agy_check_task` / `codex_check_task`) prevents Claude Desktop client timeouts on long runs.
* **Automatic Git Intelligence**: Automatically returns git diff statistics and modified file lists upon task completion.
* **Zero-Dependency Standalone Bundle**: Pre-compiled with `esbuild`. Runs out of the box with zero runtime `node_modules`.

---

## 🛠️ MCP Tool Reference

### 🪐 Antigravity Delegation (`agy`)

* **`agy_execute`**: Spawns a headless Antigravity subagent for heavy coding, wide exploration, or test runs.
  * `instructions` *(string, required)*: Step-by-step implementation plan.
  * `workspace_dir` *(string, optional)*: Target directory (mandatory in Claude Desktop).
  * `async` *(boolean, default: `false`)*: Runs in background to avoid 60s client timeouts.
  * `effort` *(enum: `low`, `medium`, `high`, default: `high`)*: Reasoning effort.
  * `mode` *(enum: `accept-edits`, `plan`, default: `accept-edits`)*: Execution mode.
  * `timeout_seconds` *(number, default: `600`)*: Execution timeout.
  * `include_git_diff` *(boolean, default: `true`)*: Returns modified files and git diff statistics.

* **`agy_continue`**: Continues an existing Antigravity conversation for follow-up fixes or iterative adjustments.
  * `conversation_id` *(string, required)*: Prior conversation ID.
  * `instructions` *(string, required)*: Follow-up feedback or bugfix instructions.
  * `workspace_dir` *(string, optional)*
  * `async` *(boolean, default: `false`)*

* **`agy_check_task`**: Polls the execution status, trace, and final output of an async task (`agy` or `codex`).
  * `task_id` *(string, required)*: The task ID returned by an async execution.

* **`agy_get_token_savings`**: Returns lifetime context window tokens saved across all sessions.

* **`agy_inspect_transcript`**: Inspects step-by-step tool actions and responses from a prior conversation log.

* **`agy_get_status`**: Verifies that the Antigravity CLI is installed and responsive.

---

### ⚡ OpenAI Codex Delegation (`codex`)

* **`codex_execute`**: Spawns an autonomous OpenAI Codex subagent to execute code modifications, scripts, or tests.
  * `instructions` *(string, required)*: Implementation prompt for Codex.
  * `workspace_dir` *(string, optional)*: Working directory for execution.
  * `async` *(boolean, default: `false`)*: Runs in background (recommended for long runs in Claude Desktop).
  * `model` *(string, default: `'gpt-5.6-luna'`)*: Codex model (`gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-reserve`).
  * `reasoning_effort` *(enum: `low`, `medium`, `high`, `xhigh`, optional)*: Reasoning effort.
  * `sandbox` *(enum: `read-only`, `workspace-write`, `danger-full-access`, default: `danger-full-access`)*
  * `timeout_seconds` *(number, default: `600`)*
  * `include_git_diff` *(boolean, default: `true`)*

* **`codex_continue`**: Resumes an existing Codex conversation thread (`codex exec resume`) for iterative bugfixing.
  * `thread_id` *(string, required)*: Prior thread ID returned from `codex_execute`.
  * `instructions` *(string, required)*: Next steps or corrections.
  * `workspace_dir` *(string, optional)*
  * `async` *(boolean, default: `false`)*

* **`codex_check_task`**: Checks background status and results of an async Codex task.
  * `task_id` *(string, required)*

* **`codex_get_status`**: Reports installed Codex CLI version and authentication status.

---

### 💬 ChatGPT Consulting & Review (`chatgpt`)

* **`chatgpt_consult`**: Consults ChatGPT for high-level technical advice, architectural trade-offs, or second opinions.
  * `prompt` *(string, required)*: Question or design problem.
  * `context` *(string, optional)*: Code snippets, log outputs, or requirements.
  * `model` *(string, default: `'o3-mini'`)*: Model to consult (`o3-mini`, `gpt-4o`, `o1`).
  * `reasoning_effort` *(enum: `low`, `medium`, `high`, optional)*: Reasoning effort for o-series models.
  * `system_prompt` *(string, optional)*: Custom persona or guidance.

* **`chatgpt_review`**: Performs an adversarial review on a git diff or code snippet.
  * `diff_or_code` *(string, required)*: Code or git diff to review.
  * `focus` *(enum: `security`, `performance`, `architecture`, `thorough`, default: `thorough`)*: Review focus area.
  * `instructions` *(string, optional)*: Specific review criteria.
  * `model` *(string, default: `'o3-mini'`)*

---

## 📋 Recommended Rules for `CLAUDE.md`

Add this section to your `~/.claude/CLAUDE.md` (or project `CLAUDE.md`) so Claude automatically knows when and how to delegate:

```markdown
## Subagent Delegation Guidelines
Claude acts as the Lead Architect / Orchestrator. Delegate execution to specialized subagents:

1. Antigravity (`agy_execute` / `agy_continue`):
   - Best for: Reading dozens of files, large multi-file edits, running test suites, or broad repository exploration.
   - For operations taking more than 45 seconds in Claude Desktop, use async: true and poll with agy_check_task.

2. OpenAI Codex (`codex_execute` / `codex_continue`):
   - Best for: Autonomous coding tasks, script execution, or when OpenAI code models (gpt-5.6-luna, gpt-5.6-terra) excel at the problem.
   - Pass thread_id to codex_continue for follow-up adjustments.

3. ChatGPT Consulting (`chatgpt_consult` / `chatgpt_review`):
   - Best for: High-level architectural second opinions (o3-mini, gpt-4o) or adversarial security and performance reviews on git diffs.
```

---

## 🔧 Building from Source

```bash
# Clone the repository
git clone https://github.com/josephjerryrhule/agy-mcp.git
cd agy-mcp

# Install dependencies
npm install

# Compile TypeScript and bundle with esbuild
npm run build

# Package standalone .mcpb bundle for Claude Desktop
npm run bundle:mcpb
```

---

## 📄 License
MIT (c) Joseph Jerry Rhule
