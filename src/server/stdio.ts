#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { runAgy, getEnhancedPath } from '../executor/agy.js'
import { inspectTranscript } from '../utils/transcript.js'
import { calculateAndRecordSavings, getSavingsSummary } from '../utils/savings.js'

const execAsync = promisify(exec)

interface BackgroundTask {
  id: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'TIMEOUT'
  instructions: string
  workspaceDir: string
  startTime: number
  endTime?: number
  result?: any
  executionTrace: any[]
}

const backgroundTasks = new Map<string, BackgroundTask>()

function formatPayload(result: any, savings: any, customConversationId?: string) {
  return {
    success: result.success,
    status: result.status,
    conversation_id: result.conversationId || customConversationId,
    response: result.response,
    duration_seconds: result.durationSeconds,
    num_turns: result.numTurns,
    token_savings_metrics: {
      tokens_processed_by_antigravity: savings.tokensProcessedByAntigravity,
      tokens_ingested_by_claude: savings.tokensIngestedByClaude,
      net_tokens_saved_in_claude_context: savings.tokensSavedInClaudeContext,
      task_savings_percentage: savings.savingsPercentage,
      lifetime_claude_context_saved: savings.lifetimeClaudeContextSaved,
      total_tasks_delegated: savings.totalTasksDelegated,
    },
    tokens_used_by_agy: result.usage,
    usage_limit_alert:
      result.status === 'USAGE_LIMIT_EXHAUSTED'
        ? '⛔ ANTIGRAVITY USAGE LIMIT EXHAUSTED: Antigravity/Gemini model quota or account usage limit is exhausted (429 / Resource Exhausted). Do NOT retry or spawn Claude subagents without explicit user authorization.'
        : undefined,
    execution_trace: result.executionTrace && result.executionTrace.length > 0 ? result.executionTrace : undefined,
    git_changes: result.gitChanges?.hasChanges
      ? {
          modified: result.gitChanges.modifiedFiles,
          untracked: result.gitChanges.untrackedFiles,
          diff_stat: result.gitChanges.diffStat,
        }
      : 'No uncommitted file changes detected in git.',
    error: result.error,
    stderr: result.rawStderr,
  }
}

const server = new McpServer({
  name: 'antigravity-bridge',
  version: '1.3.1',
})

// Tool 1: agy_execute
server.tool(
  'agy_execute',
  'Spins up a headless Antigravity (agy) agent to autonomously execute heavy coding, editing, refactoring, research, or testing tasks with live streaming progress, thinking token logs, tool tracing, and token savings metrics.',
  {
    instructions: z.string().describe('Detailed step-by-step instructions for agy. Specify target file paths, constraints, test commands, and exact functional requirements.'),
    workspace_dir: z.string().optional().describe('Target workspace directory path (MANDATORY in Claude Desktop to point to the project repo, otherwise agy runs inside Claude desktop internal directory). Defaults to current working directory.'),
    async: z.boolean().optional().default(false).describe('Run task asynchronously in background. RECOMMENDED in Claude Desktop for any real coding tasks (>45s) to prevent Claude Desktop 60-second MCP client timeouts. Check status with agy_check_task.'),
    effort: z.enum(['low', 'medium', 'high']).optional().default('high').describe('Reasoning effort (low, medium, high). Default is high.'),
    mode: z.enum(['accept-edits', 'plan']).optional().default('accept-edits').describe('Execution mode: accept-edits (standard autonomous editing) or plan (planning mode).'),
    model: z.string().optional().describe('Optional specific model identifier for agy.'),
    timeout_seconds: z.number().optional().default(600).describe('Max execution time in seconds (default 600 = 10 minutes).'),
    include_git_diff: z.boolean().optional().default(true).describe('Include git status and diff statistics of files modified during execution.'),
  },
  async (args) => {
    if (args.async) {
      const taskId = randomUUID()
      const task: BackgroundTask = {
        id: taskId,
        status: 'RUNNING',
        instructions: args.instructions,
        workspaceDir: args.workspace_dir || process.cwd(),
        startTime: Date.now(),
        executionTrace: [],
      }
      backgroundTasks.set(taskId, task)

      runAgy({
        instructions: args.instructions,
        workspaceDir: args.workspace_dir,
        effort: args.effort,
        mode: args.mode,
        model: args.model,
        timeoutSeconds: args.timeout_seconds,
        includeGitDiff: args.include_git_diff,
        onStreamEvent: (event) => {
          if (event.event === 'step_update' && event.step_update) {
            const step = event.step_update
            if (step.step_type === 'agent_response' && step.usage?.thinking_tokens) {
              task.executionTrace.push({
                type: 'thinking',
                thinkingTokens: step.usage.thinking_tokens,
                durationSeconds: step.duration_seconds,
              })
            } else if (step.step_type === 'tool' && step.state === 'DONE') {
              task.executionTrace.push({
                type: 'tool',
                name: step.tool_name || step.tool_info?.name,
                durationSeconds: step.duration_seconds,
              })
            }
          }
        },
      })
        .then(async (result) => {
          task.endTime = Date.now()
          task.status = result.success ? 'SUCCESS' : (result.status as any) || 'FAILED'
          const totalAgyTokens = result.usage?.total_tokens || 0
          const savings = await calculateAndRecordSavings(
            totalAgyTokens,
            args.instructions.length,
            result.response.length,
            result.conversationId
          )

          task.result = formatPayload(result, savings)
        })
        .catch((err) => {
          task.endTime = Date.now()
          task.status = 'FAILED'
          task.result = {
            success: false,
            status: 'ERROR',
            error: err instanceof Error ? err.message : String(err),
          }
        })

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'RUNNING',
                task_id: taskId,
                message:
                  'Antigravity task launched in background to avoid Claude Desktop 60-second MCP client timeouts. Call agy_check_task with this task_id to check progress or get final results.',
                workspace_dir: task.workspaceDir,
              },
              null,
              2
            ),
          },
        ],
      }
    }
    const result = await runAgy({
      instructions: args.instructions,
      workspaceDir: args.workspace_dir,
      effort: args.effort,
      mode: args.mode,
      model: args.model,
      timeoutSeconds: args.timeout_seconds,
      includeGitDiff: args.include_git_diff,
    })

    const totalAgyTokens = result.usage?.total_tokens || 0
    const savings = await calculateAndRecordSavings(
      totalAgyTokens,
      args.instructions.length,
      result.response.length,
      result.conversationId
    )

    const payload = formatPayload(result, savings)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    }
  }
)

// Tool 2: agy_continue
server.tool(
  'agy_continue',
  'Continues an existing Antigravity conversation for follow-up adjustments, revisions, test fixing, or iterative tasks with real-time streaming and token savings tracking.',
  {
    conversation_id: z.string().describe('The conversation ID returned from a prior agy_execute or agy_continue call.'),
    instructions: z.string().describe('Follow-up instructions, corrections, or next steps for the agent.'),
    workspace_dir: z.string().optional().describe('Target workspace directory path (MANDATORY in Claude Desktop to point to the project repo). Defaults to current working directory.'),
    async: z.boolean().optional().default(false).describe('Run task asynchronously in background. RECOMMENDED in Claude Desktop for any real coding tasks (>45s) to avoid 60s MCP client timeouts. Check status with agy_check_task.'),
    effort: z.enum(['low', 'medium', 'high']).optional().default('high').describe('Reasoning effort.'),
    timeout_seconds: z.number().optional().default(600).describe('Max execution time in seconds.'),
    include_git_diff: z.boolean().optional().default(true).describe('Include git status and diff summary.'),
  },
  async (args) => {
    if (args.async) {
      const taskId = randomUUID()
      const task: BackgroundTask = {
        id: taskId,
        status: 'RUNNING',
        instructions: args.instructions,
        workspaceDir: args.workspace_dir || process.cwd(),
        startTime: Date.now(),
        executionTrace: [],
      }
      backgroundTasks.set(taskId, task)

      runAgy({
        conversationId: args.conversation_id,
        instructions: args.instructions,
        workspaceDir: args.workspace_dir,
        effort: args.effort,
        timeoutSeconds: args.timeout_seconds,
        includeGitDiff: args.include_git_diff,
        onStreamEvent: (event) => {
          if (event.event === 'step_update' && event.step_update) {
            const step = event.step_update
            if (step.step_type === 'agent_response' && step.usage?.thinking_tokens) {
              task.executionTrace.push({
                type: 'thinking',
                thinkingTokens: step.usage.thinking_tokens,
                durationSeconds: step.duration_seconds,
              })
            } else if (step.step_type === 'tool' && step.state === 'DONE') {
              task.executionTrace.push({
                type: 'tool',
                name: step.tool_name || step.tool_info?.name,
                durationSeconds: step.duration_seconds,
              })
            }
          }
        },
      })
        .then(async (result) => {
          task.endTime = Date.now()
          task.status = result.success ? 'SUCCESS' : (result.status as any) || 'FAILED'
          const totalAgyTokens = result.usage?.total_tokens || 0
          const savings = await calculateAndRecordSavings(
            totalAgyTokens,
            args.instructions.length,
            result.response.length,
            result.conversationId || args.conversation_id
          )

          task.result = formatPayload(result, savings, args.conversation_id)
        })
        .catch((err) => {
          task.endTime = Date.now()
          task.status = 'FAILED'
          task.result = {
            success: false,
            status: 'ERROR',
            error: err instanceof Error ? err.message : String(err),
          }
        })

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'RUNNING',
                task_id: taskId,
                conversation_id: args.conversation_id,
                message:
                  'Antigravity follow-up task launched in background to avoid Claude Desktop 60-second MCP client timeouts. Call agy_check_task with this task_id to check progress or get final results.',
                workspace_dir: task.workspaceDir,
              },
              null,
              2
            ),
          },
        ],
      }
    }
    const result = await runAgy({
      conversationId: args.conversation_id,
      instructions: args.instructions,
      workspaceDir: args.workspace_dir,
      effort: args.effort,
      timeoutSeconds: args.timeout_seconds,
      includeGitDiff: args.include_git_diff,
    })

    const totalAgyTokens = result.usage?.total_tokens || 0
    const savings = await calculateAndRecordSavings(
      totalAgyTokens,
      args.instructions.length,
      result.response.length,
      result.conversationId || args.conversation_id
    )

    const payload = formatPayload(result, savings, args.conversation_id)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    }
  }
)

// Tool 3: agy_check_task
server.tool(
  'agy_check_task',
  'Checks the status, running duration, execution trace, and results of an asynchronous Antigravity task started with async: true.',
  {
    task_id: z.string().describe('The task ID returned from agy_execute or agy_continue when async is true.'),
  },
  async (args) => {
    const task = backgroundTasks.get(args.task_id)
    if (!task) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: `Task ID not found: ${args.task_id}`,
                available_tasks: Array.from(backgroundTasks.keys()),
              },
              null,
              2
            ),
          },
        ],
      }
    }

    if (task.status === 'RUNNING') {
      const elapsedSeconds = Math.round((Date.now() - task.startTime) / 1000)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'RUNNING',
                task_id: task.id,
                elapsed_seconds: elapsedSeconds,
                message: `Task is actively executing in background (${elapsedSeconds}s elapsed). Check again shortly.`,
                recent_trace: task.executionTrace.slice(-5),
              },
              null,
              2
            ),
          },
        ],
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              task_id: task.id,
              status: task.status,
              ...task.result,
            },
            null,
            2
          ),
        },
      ],
    }
  }
)

// Tool 4: agy_get_token_savings
server.tool(
  'agy_get_token_savings',
  'Returns lifetime token savings analytics and history of context window saved across all Antigravity delegations.',
  {},
  async () => {
    const summary = await getSavingsSummary()
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(summary, null, 2),
        },
      ],
    }
  }
)

// Tool 5: agy_inspect_transcript
server.tool(
  'agy_inspect_transcript',
  'Inspects the execution trajectory, tool calls, and actions from an Antigravity conversation without filling context with raw logs.',
  {
    conversation_id: z.string().describe('The conversation ID to inspect.'),
    max_steps: z.number().optional().default(20).describe('Number of recent steps to summarize.'),
  },
  async (args) => {
    const inspection = await inspectTranscript(args.conversation_id, args.max_steps)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(inspection, null, 2),
        },
      ],
    }
  }
)

// Tool 6: agy_get_status
server.tool(
  'agy_get_status',
  'Checks whether the Antigravity CLI (agy) is available, responds, and reports current CLI status.',
  {},
  async () => {
    try {
      const { stdout: helpOut } = await execAsync('agy --help', {
        timeout: 5000,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
        },
      })
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                available: true,
                message: 'Antigravity CLI (agy) is installed and available in PATH.',
                cli_preview: helpOut.slice(0, 300),
              },
              null,
              2
            ),
          },
        ],
      }
    } catch (err: any) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                available: false,
                error: err.message,
                message: 'Antigravity CLI (agy) was not found in PATH or failed to respond.',
              },
              null,
              2
            ),
          },
        ],
      }
    }
  }
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  process.stderr.write(`agy-mcp failed to start: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
