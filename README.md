# Antigravity Bridge (`agy-mcp`)

A Model Context Protocol (MCP) server that empowers **Claude Code** and **Claude Desktop** to act as the primary architect / orchestrator while delegating token-heavy tasks to **Antigravity (`agy`)** headless subagents.

---

## Features

- **Real-Time Streaming & Telemetry**: Live progress logs showing reasoning effort, thinking token counts, active tool calls, and completion timers.
- **Standalone Distribution**: Zero-dependency executable bundled with `esbuild`. No external runtime `node_modules` required to run the server.
- **Claude Code & Claude Desktop Support**: Native stdio MCP transport + 1-click `.mcpb` bundle installer.
- **Changelog & Git Intelligence**: Automatically returns git diff statistics and modified file lists after execution.

---

## Prerequisites

1. **Node.js**: `v20.0.0` or newer.
2. **Antigravity CLI (`agy`)**: Installed and authenticated on your machine.

---

## Setup for Claude Code

### Method 1: Automatic Configuration (Recommended)
Add the server entry to your global Claude Code settings at `~/.claude.json`:

```json
{
  "mcpServers": {
    "antigravity": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/path/to/agy-mcp/dist/bundle/index.mjs"]
    }
  }
}
```

### Method 2: Via Claude Code CLI
```bash
claude mcp add antigravity node /Users/YOUR_USERNAME/path/to/agy-mcp/dist/bundle/index.mjs
```

---

## Setup for Claude Desktop

### Method 1: 1-Click MCP Bundle (`.mcpb`)
1. Locate the pre-built bundle file in [`build/agy-mcp.mcpb`](build/agy-mcp.mcpb).
2. Double-click or import the `.mcpb` file into Claude Desktop.

### Method 2: Manual Configuration (`claude_desktop_config.json`)
Add the server entry to your Claude Desktop config located at:
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "antigravity": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/path/to/agy-mcp/dist/bundle/index.mjs"]
    }
  }
}
```

Restart Claude Desktop, and the hammer icon will display the `agy-mcp` tools.

---

## MCP Tools Provided

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

## Recommended Rules for `CLAUDE.md`

Add this section to `~/.claude/CLAUDE.md` (or your project's `CLAUDE.md`):

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

## Building from Source

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

## License
MIT
