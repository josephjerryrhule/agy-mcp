# Antigravity Bridge (`agy-mcp`)

A Model Context Protocol (MCP) server that empowers **Claude Code** and **Claude Desktop** to act as the primary architect / orchestrator while delegating token-heavy tasks to **Antigravity (`agy`)** headless subagents.

---

## 🚀 Auto-Updating Setup (Zero-Maintenance)

By using `npx`, Claude automatically fetches and runs the latest version on startup. You never have to manually update or re-download.

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

---

## 📦 Direct 1-Click `.mcpb` Download (Claude Desktop)

If you prefer installing an `.mcpb` bundle directly into Claude Desktop:

👉 **[Download Latest `agy-mcp.mcpb`](https://github.com/josephjerryrhule/agy-mcp/releases/latest/download/agy-mcp.mcpb)**

Double-click the downloaded `.mcpb` file to import it into Claude Desktop.

---

## 🌟 Why This Exists

When working on large repositories, Claude often runs into token limits when performing heavy operations like:
- Reading dozens of repository files to understand architecture.
- Generating large boilerplate files or multi-file refactors.
- Running long test suites and iterative debugging loops.

### The Division of Labor:
- **Claude (The Lead Architect)**: Maintains high-level context, project structure, and user workflow preferences. Formulates explicit, pixel-perfect instructions.
- **Antigravity (`agy`) (The Execution Engine)**: Spawns in isolated headless mode (`agy -p --dangerously-skip-permissions`), performs all heavy file edits, tool runs, and test executions, and returns a concise status diff.

**Result**: Keeps Claude's context window lean and fast while Antigravity handles heavy file edits, exploration, and command executions.

---

## ✨ Features

- **Live Streaming & Real-Time Telemetry**: Live terminal progress logs showing reasoning effort, thinking token counts, active tool calls, and completion timers.
- **Exact Token Savings Calculator**: Computes exact tokens processed by Antigravity vs tokens ingested by Claude, with persistent lifetime analytics.
- **Zero-Dependency Standalone Bundle**: Pre-compiled with `esbuild`. No external runtime `node_modules` required.
- **Automatic Changelog & Git Intelligence**: Returns git diff statistics and modified file lists after execution.
- **Automatic Silent Updates**: Runs the latest release on every launch via `npx`.

---

## 🛠️ MCP Tools Provided

### 1. `agy_execute`
Spawns a new headless Antigravity subagent with real-time streaming feedback, tool tracing, and token savings analytics.
- `instructions` *(string, required)*: Step-by-step implementation instructions.
- `workspace_dir` *(string, optional)*: Working directory (defaults to current project root).
- `effort` *(enum: `low` | `medium` | `high`, default: `high`)*: Reasoning effort for Antigravity.
- `mode` *(enum: `accept-edits` | `plan`, default: `accept-edits`)*: Execution mode.
- `timeout_seconds` *(number, default: `600`)*: Execution timeout in seconds.
- `include_git_diff` *(boolean, default: `true`)*: Returns git status and diff statistics of files modified during execution.

### 2. `agy_continue`
Sends follow-up instructions, corrections, or test feedback to an existing Antigravity conversation with real-time stream updates.
- `conversation_id` *(string, required)*: The conversation ID returned from a prior execution.
- `instructions` *(string, required)*: Follow-up guidance or bugfix instructions.
- `workspace_dir` *(string, optional)*
- `effort` *(enum: `low` | `medium` | `high`)*
- `timeout_seconds` *(number, default: `600`)*

### 3. `agy_get_token_savings`
Returns lifetime token savings metrics and delegation history across all sessions.

### 4. `agy_inspect_transcript`
Inspects recent tool calls and step-by-step actions from an Antigravity conversation log without flooding Claude's context with raw terminal logs.
- `conversation_id` *(string, required)*
- `max_steps` *(number, default: `20`)*

### 5. `agy_get_status`
Verifies that the Antigravity CLI is available and operational.

---

## 📋 Recommended Rules for `CLAUDE.md`

Add this section to `~/.claude/CLAUDE.md` (or your project's `CLAUDE.md`) so Claude knows how and when to offload heavy tasks:

```markdown
## Antigravity Delegation Guidelines
- When a task involves reading many files, large multi-file edits, running test suites, or broad exploration:
  1. Do NOT load all files into context.
  2. Formulate explicit, step-by-step instructions (target file paths, exact schemas, constraints, test commands).
  3. Invoke `agy_execute` to run the task via Antigravity.
  4. Inspect the returned git changes and response summary.
  5. If fixes are needed, invoke `agy_continue` with the returned `conversation_id`.
```

---

## 🔧 Building from Source

```bash
# Clone the repository
git clone https://github.com/josephjerryrhule/agy-mcp.git
cd agy-mcp

# Build standalone bundle
npm run bundle

# Package .mcpb bundle for Claude Desktop
npm run bundle:mcpb
```

---

## 📄 License
MIT © Joseph Jerry Rhule (Theme Wire)
