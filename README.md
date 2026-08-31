# Antigravity Bridge (`agy-mcp`)

A Model Context Protocol (MCP) server that empowers **Claude Code** and **Claude Desktop** to act as the primary architect / orchestrator while delegating token-heavy tasks to **Antigravity (`agy`)** headless subagents.

---

## ⚡ Quickstart (Zero-Install via `npx`)

No cloning or building needed. Run directly from GitHub using `npx`:

### For Claude Code
Add to `~/.claude.json` or run:
```bash
claude mcp add antigravity npx -y github:josephjerryrhule/agy-mcp
```

Or configure manually in `~/.claude.json`:
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

### For Claude Desktop
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

Alternatively, double-click the pre-built [`build/agy-mcp.mcpb`](build/agy-mcp.mcpb) bundle to install it into Claude Desktop with 1 click.

---

## 🌟 Why This Exists

When working on large repositories, Claude often runs into token limits when performing heavy operations like:
- Reading dozens of repository files to understand architecture.
- Generating large boilerplate files or multi-file refactors.
- Running long test suites and iterative debugging loops.

### The Division of Labor:
- **Claude (The Lead Architect)**: Maintains high-level context, project structure, and user workflow preferences. Formulates explicit, pixel-perfect instructions.
- **Antigravity (`agy`) (The Execution Engine)**: Spawns in isolated headless mode (`agy -p --dangerously-skip-permissions`), performs all heavy file edits, tool runs, and test executions, and returns a concise status diff.

**Result**: Up to **90%+ token savings** for Claude's context window.

---

## ✨ Features

- **Live Streaming & Real-Time Telemetry**: Live progress logs in the terminal showing reasoning effort, thinking token counts, active tool calls, and completion timers.
- **Zero-Dependency Standalone Bundle**: Pre-compiled with `esbuild`. No external runtime `node_modules` required.
- **Automatic Changelog & Git Intelligence**: Automatically returns git diff statistics and modified file lists after execution.
- **Works Out-of-the-Box**: Compatible with Claude Code CLI and Claude Desktop (`.mcpb` bundle included).

---

## 🛠️ MCP Tools Provided

### 1. `agy_execute`
Spawns a new headless Antigravity subagent with real-time streaming feedback and tool tracing.
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

### 3. `agy_inspect_transcript`
Inspects recent tool calls and step-by-step actions from an Antigravity conversation log without flooding Claude's context with raw terminal logs.
- `conversation_id` *(string, required)*
- `max_steps` *(number, default: `20`)*

### 4. `agy_get_status`
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
