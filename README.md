# Antigravity Claude Code Bridge (`agy-mcp`)

A Model Context Protocol (MCP) server that empowers **Claude Code** to act as the primary architect / orchestrator and seamlessly spin up **Antigravity (`agy`)** headless subagents for token-heavy execution tasks.

---

## 🎯 Why This Exists

When working on large repositories, Claude Code often exhausts its token context window when performing heavy operations like:
- Reading dozens of repository files to understand architecture.
- Generating large boilerplate files or multi-file refactors.
- Running extensive test suites and iterative debugging loops.

### The Division of Labor:
- **Claude Code (The Lead Architect)**: Keeps high-level context, project structure, and workflow preferences. Formulates explicit, pixel-perfect instructions.
- **Antigravity (`agy`) (The Execution Engine)**: Spawns in isolated headless mode (`agy -p --dangerously-skip-permissions`), performs all heavy file edits, tool runs, and test executions, and returns a concise status diff.

**Result**: Up to **90%+ token savings** for Claude Code's context window.

---

## 🛠️ MCP Tools Provided

### 1. `agy_execute`
Spawns a new headless Antigravity subagent to autonomously perform a task.
- `instructions` *(string, required)*: Step-by-step implementation instructions.
- `workspace_dir` *(string, optional)*: Working directory (defaults to current project root).
- `effort` *(enum: `low` | `medium` | `high`, default: `high`)*: Reasoning effort for Antigravity.
- `mode` *(enum: `accept-edits` | `plan`, default: `accept-edits`)*: Execution mode.
- `timeout_seconds` *(number, default: `600`)*: Execution timeout in seconds.
- `include_git_diff` *(boolean, default: `true`)*: Returns git status and diff statistics of files modified during execution.

### 2. `agy_continue`
Sends follow-up instructions, corrections, or test feedback to an existing Antigravity conversation.
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

## ⚙️ Configuration in Claude Code

The MCP server is configured in `~/.claude.json`:

```json
{
  "mcpServers": {
    "antigravity": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/joeseph/Desktop/dev/agy-mcp/dist/server/stdio.js"]
    }
  }
}
```

---

## 📋 Recommended Rules for `CLAUDE.md`

Add this section to `~/.claude/CLAUDE.md` (or your project's `CLAUDE.md`):

```markdown
## Antigravity Delegation Guidelines
- When a task involves reading many files, large multi-file edits, running test suites, or broad exploration:
  1. Do NOT load all files into context.
  2. Formulate explicit, step-by-step instructions (target file paths, exact schemas, constraints, test commands).
  3. Invoke `mcp__antigravity__agy_execute` to run the task via Antigravity.
  4. Inspect the returned git changes and response summary.
  5. If fixes are needed, invoke `mcp__antigravity__agy_continue` with the returned `conversation_id`.
```

---

## 🚀 Build & Run

```bash
cd /Users/joeseph/Desktop/dev/agy-mcp
npm run build
```
