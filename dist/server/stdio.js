#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { runAgy, getEnhancedPath } from '../executor/agy.js';
import { runCodex } from '../executor/codex.js';
import { runChatgptConsult, runChatgptReview } from '../executor/chatgpt.js';
import { inspectTranscript } from '../utils/transcript.js';
import { calculateAndRecordSavings, getSavingsSummary } from '../utils/savings.js';
const execAsync = promisify(exec);
const backgroundTasks = new Map();
function formatPayload(result, savings, customConversationId, workerName = 'antigravity') {
    const convId = result.conversationId || result.threadId || customConversationId;
    return {
        success: result.success,
        status: result.status,
        worker: workerName,
        conversation_id: convId,
        thread_id: result.threadId || convId,
        response: result.response,
        duration_seconds: result.durationSeconds,
        num_turns: result.numTurns,
        token_savings_metrics: {
            tokens_processed_by_worker: savings.tokensProcessedByAntigravity,
            tokens_processed_by_antigravity: savings.tokensProcessedByAntigravity,
            tokens_ingested_by_claude: savings.tokensIngestedByClaude,
            net_tokens_saved_in_claude_context: savings.tokensSavedInClaudeContext,
            task_savings_percentage: savings.savingsPercentage,
            lifetime_claude_context_saved: savings.lifetimeClaudeContextSaved,
            total_tasks_delegated: savings.totalTasksDelegated,
        },
        tokens_used: result.usage,
        tokens_used_by_agy: workerName === 'antigravity' ? result.usage : undefined,
        usage_limit_alert: result.status === 'USAGE_LIMIT_EXHAUSTED'
            ? `⛔ ${workerName.toUpperCase()} USAGE LIMIT EXHAUSTED: Model quota or account usage limit is exhausted (429 / Resource Exhausted). Do NOT retry or spawn Claude subagents without explicit user authorization.`
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
    };
}
function handleCheckTask(taskId) {
    const task = backgroundTasks.get(taskId);
    if (!task) {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        error: `Task ID not found: ${taskId}`,
                        available_tasks: Array.from(backgroundTasks.keys()),
                    }, null, 2),
                },
            ],
        };
    }
    if (task.status === 'RUNNING') {
        const elapsedSeconds = Math.round((Date.now() - task.startTime) / 1000);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: 'RUNNING',
                        task_id: task.id,
                        agent: task.agent,
                        elapsed_seconds: elapsedSeconds,
                        message: `Task is actively executing in background (${elapsedSeconds}s elapsed). Check again shortly.`,
                        recent_trace: task.executionTrace.slice(-5),
                    }, null, 2),
                },
            ],
        };
    }
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    task_id: task.id,
                    agent: task.agent,
                    status: task.status,
                    ...task.result,
                }, null, 2),
            },
        ],
    };
}
const server = new McpServer({
    name: 'omni-bridge',
    version: '1.4.0',
});
// ==========================================
// 1. ANTIGRAVITY TOOLS
// ==========================================
// Tool 1: agy_execute
server.tool('agy_execute', 'Spins up a headless Antigravity (agy) agent to autonomously execute heavy coding, editing, refactoring, research, or testing tasks with live streaming progress, thinking token logs, tool tracing, and token savings metrics.', {
    instructions: z.string().describe('Detailed step-by-step instructions for agy. Specify target file paths, constraints, test commands, and exact functional requirements.'),
    workspace_dir: z.string().optional().describe('Target workspace directory path (MANDATORY in Claude Desktop to point to the project repo, otherwise agy runs inside Claude desktop internal directory). Defaults to current working directory.'),
    async: z.boolean().optional().default(false).describe('Run task asynchronously in background. RECOMMENDED in Claude Desktop for any real coding tasks (>45s) to prevent Claude Desktop 60-second MCP client timeouts. Check status with agy_check_task.'),
    effort: z.enum(['low', 'medium', 'high']).optional().default('high').describe('Reasoning effort (low, medium, high). Default is high.'),
    mode: z.enum(['accept-edits', 'plan']).optional().default('accept-edits').describe('Execution mode: accept-edits (standard autonomous editing) or plan (planning mode).'),
    model: z.string().optional().describe('Optional specific model identifier for agy.'),
    timeout_seconds: z.number().optional().default(600).describe('Max execution time in seconds (default 600 = 10 minutes).'),
    include_git_diff: z.boolean().optional().default(true).describe('Include git status and diff statistics of files modified during execution.'),
}, async (args) => {
    if (args.async) {
        const taskId = randomUUID();
        const task = {
            id: taskId,
            agent: 'antigravity',
            status: 'RUNNING',
            instructions: args.instructions,
            workspaceDir: args.workspace_dir || process.cwd(),
            startTime: Date.now(),
            executionTrace: [],
        };
        backgroundTasks.set(taskId, task);
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
                    const step = event.step_update;
                    if (step.step_type === 'agent_response' && step.usage?.thinking_tokens) {
                        task.executionTrace.push({
                            type: 'thinking',
                            thinkingTokens: step.usage.thinking_tokens,
                            durationSeconds: step.duration_seconds,
                        });
                    }
                    else if (step.step_type === 'tool' && step.state === 'DONE') {
                        task.executionTrace.push({
                            type: 'tool',
                            name: step.tool_name || step.tool_info?.name,
                            durationSeconds: step.duration_seconds,
                        });
                    }
                }
            },
        })
            .then(async (result) => {
            task.endTime = Date.now();
            task.status = result.success ? 'SUCCESS' : result.status || 'FAILED';
            const totalAgyTokens = result.usage?.total_tokens || 0;
            const savings = await calculateAndRecordSavings(totalAgyTokens, args.instructions.length, result.response.length, result.conversationId);
            task.result = formatPayload(result, savings, undefined, 'antigravity');
        })
            .catch((err) => {
            task.endTime = Date.now();
            task.status = 'FAILED';
            task.result = {
                success: false,
                status: 'ERROR',
                error: err instanceof Error ? err.message : String(err),
            };
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: 'RUNNING',
                        task_id: taskId,
                        agent: 'antigravity',
                        message: 'Antigravity task launched in background to avoid Claude Desktop 60-second MCP client timeouts. Call agy_check_task with this task_id to check progress or get final results.',
                        workspace_dir: task.workspaceDir,
                    }, null, 2),
                },
            ],
        };
    }
    const result = await runAgy({
        instructions: args.instructions,
        workspaceDir: args.workspace_dir,
        effort: args.effort,
        mode: args.mode,
        model: args.model,
        timeoutSeconds: args.timeout_seconds,
        includeGitDiff: args.include_git_diff,
    });
    const totalAgyTokens = result.usage?.total_tokens || 0;
    const savings = await calculateAndRecordSavings(totalAgyTokens, args.instructions.length, result.response.length, result.conversationId);
    const payload = formatPayload(result, savings, undefined, 'antigravity');
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(payload, null, 2),
            },
        ],
    };
});
// Tool 2: agy_continue
server.tool('agy_continue', 'Continues an existing Antigravity conversation for follow-up adjustments, revisions, test fixing, or iterative tasks with real-time streaming and token savings tracking.', {
    conversation_id: z.string().describe('The conversation ID returned from a prior agy_execute or agy_continue call.'),
    instructions: z.string().describe('Follow-up instructions, corrections, or next steps for the agent.'),
    workspace_dir: z.string().optional().describe('Target workspace directory path (MANDATORY in Claude Desktop to point to the project repo). Defaults to current working directory.'),
    async: z.boolean().optional().default(false).describe('Run task asynchronously in background. RECOMMENDED in Claude Desktop for any real coding tasks (>45s) to avoid 60s MCP client timeouts. Check status with agy_check_task.'),
    effort: z.enum(['low', 'medium', 'high']).optional().default('high').describe('Reasoning effort.'),
    timeout_seconds: z.number().optional().default(600).describe('Max execution time in seconds.'),
    include_git_diff: z.boolean().optional().default(true).describe('Include git status and diff summary.'),
}, async (args) => {
    if (args.async) {
        const taskId = randomUUID();
        const task = {
            id: taskId,
            agent: 'antigravity',
            status: 'RUNNING',
            instructions: args.instructions,
            workspaceDir: args.workspace_dir || process.cwd(),
            startTime: Date.now(),
            executionTrace: [],
        };
        backgroundTasks.set(taskId, task);
        runAgy({
            conversationId: args.conversation_id,
            instructions: args.instructions,
            workspaceDir: args.workspace_dir,
            effort: args.effort,
            timeoutSeconds: args.timeout_seconds,
            includeGitDiff: args.include_git_diff,
            onStreamEvent: (event) => {
                if (event.event === 'step_update' && event.step_update) {
                    const step = event.step_update;
                    if (step.step_type === 'agent_response' && step.usage?.thinking_tokens) {
                        task.executionTrace.push({
                            type: 'thinking',
                            thinkingTokens: step.usage.thinking_tokens,
                            durationSeconds: step.duration_seconds,
                        });
                    }
                    else if (step.step_type === 'tool' && step.state === 'DONE') {
                        task.executionTrace.push({
                            type: 'tool',
                            name: step.tool_name || step.tool_info?.name,
                            durationSeconds: step.duration_seconds,
                        });
                    }
                }
            },
        })
            .then(async (result) => {
            task.endTime = Date.now();
            task.status = result.success ? 'SUCCESS' : result.status || 'FAILED';
            const totalAgyTokens = result.usage?.total_tokens || 0;
            const savings = await calculateAndRecordSavings(totalAgyTokens, args.instructions.length, result.response.length, result.conversationId || args.conversation_id);
            task.result = formatPayload(result, savings, args.conversation_id, 'antigravity');
        })
            .catch((err) => {
            task.endTime = Date.now();
            task.status = 'FAILED';
            task.result = {
                success: false,
                status: 'ERROR',
                error: err instanceof Error ? err.message : String(err),
            };
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: 'RUNNING',
                        task_id: taskId,
                        agent: 'antigravity',
                        conversation_id: args.conversation_id,
                        message: 'Antigravity follow-up task launched in background to avoid Claude Desktop 60-second MCP client timeouts. Call agy_check_task with this task_id to check progress or get final results.',
                        workspace_dir: task.workspaceDir,
                    }, null, 2),
                },
            ],
        };
    }
    const result = await runAgy({
        conversationId: args.conversation_id,
        instructions: args.instructions,
        workspaceDir: args.workspace_dir,
        effort: args.effort,
        timeoutSeconds: args.timeout_seconds,
        includeGitDiff: args.include_git_diff,
    });
    const totalAgyTokens = result.usage?.total_tokens || 0;
    const savings = await calculateAndRecordSavings(totalAgyTokens, args.instructions.length, result.response.length, result.conversationId || args.conversation_id);
    const payload = formatPayload(result, savings, args.conversation_id, 'antigravity');
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(payload, null, 2),
            },
        ],
    };
});
// Tool 3: agy_check_task (Supports any background task ID)
server.tool('agy_check_task', 'Checks the status, running duration, execution trace, and results of an asynchronous task started with async: true.', {
    task_id: z.string().describe('The task ID returned from execute or continue calls when async is true.'),
}, async (args) => {
    return handleCheckTask(args.task_id);
});
// Tool 4: agy_get_token_savings
server.tool('agy_get_token_savings', 'Returns lifetime token savings analytics and history of context window saved across all delegations.', {}, async () => {
    const summary = await getSavingsSummary();
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(summary, null, 2),
            },
        ],
    };
});
// Tool 5: agy_inspect_transcript
server.tool('agy_inspect_transcript', 'Inspects the execution trajectory, tool calls, and actions from an Antigravity conversation without filling context with raw logs.', {
    conversation_id: z.string().describe('The conversation ID to inspect.'),
    max_steps: z.number().optional().default(20).describe('Number of recent steps to summarize.'),
}, async (args) => {
    const inspection = await inspectTranscript(args.conversation_id, args.max_steps);
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(inspection, null, 2),
            },
        ],
    };
});
// Tool 6: agy_get_status
server.tool('agy_get_status', 'Checks whether the Antigravity CLI (agy) is available, responds, and reports current CLI status.', {}, async () => {
    try {
        const { stdout: helpOut } = await execAsync('agy --help', {
            timeout: 5000,
            env: {
                ...process.env,
                PATH: getEnhancedPath(),
            },
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        available: true,
                        message: 'Antigravity CLI (agy) is installed and available in PATH.',
                        cli_preview: helpOut.slice(0, 300),
                    }, null, 2),
                },
            ],
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        available: false,
                        error: err.message,
                        message: 'Antigravity CLI (agy) was not found in PATH or failed to respond.',
                    }, null, 2),
                },
            ],
        };
    }
});
// ==========================================
// 2. CODEX TOOLS (OpenAI Codex CLI)
// ==========================================
// Tool 7: codex_execute
server.tool('codex_execute', 'Spins up an OpenAI Codex subagent to autonomously execute coding, refactoring, testing, and file editing tasks with live streaming progress and token savings tracking.', {
    instructions: z.string().describe('Detailed step-by-step instructions for Codex subagent. Specify target paths, constraints, and requirements.'),
    workspace_dir: z.string().optional().describe('Target workspace directory path (MANDATORY in Claude Desktop to point to the project repo). Defaults to current working directory.'),
    async: z.boolean().optional().default(false).describe('Run task asynchronously in background. RECOMMENDED in Claude Desktop for tasks taking >45s to avoid 60s client timeouts. Check status with codex_check_task or agy_check_task.'),
    model: z.string().optional().default('gpt-5.6-luna').describe('Model to use for Codex (e.g. gpt-5.6-luna, gpt-5.6-terra, gpt-reserve). Default is gpt-5.6-luna.'),
    reasoning_effort: z.enum(['low', 'medium', 'high', 'xhigh']).optional().describe('Reasoning effort for Codex model.'),
    sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional().default('danger-full-access').describe('Sandbox policy for command execution.'),
    timeout_seconds: z.number().optional().default(600).describe('Max execution time in seconds (default: 600).'),
    include_git_diff: z.boolean().optional().default(true).describe('Include git status and diff statistics of modified files.'),
}, async (args) => {
    if (args.async) {
        const taskId = randomUUID();
        const task = {
            id: taskId,
            agent: 'codex',
            status: 'RUNNING',
            instructions: args.instructions,
            workspaceDir: args.workspace_dir || process.cwd(),
            startTime: Date.now(),
            executionTrace: [],
        };
        backgroundTasks.set(taskId, task);
        runCodex({
            instructions: args.instructions,
            workspaceDir: args.workspace_dir,
            model: args.model,
            reasoningEffort: args.reasoning_effort,
            sandbox: args.sandbox,
            timeoutSeconds: args.timeout_seconds,
            includeGitDiff: args.include_git_diff,
            onStreamEvent: (event) => {
                if (event.type === 'item.completed' && event.item) {
                    const item = event.item;
                    if (item.type === 'tool' || item.type === 'command_execution') {
                        task.executionTrace.push({
                            type: 'tool',
                            name: item.name || item.command || 'tool_call',
                        });
                    }
                }
            },
        })
            .then(async (result) => {
            task.endTime = Date.now();
            task.status = result.success ? 'SUCCESS' : result.status || 'FAILED';
            const totalTokens = result.usage?.total_tokens || 0;
            const savings = await calculateAndRecordSavings(totalTokens, args.instructions.length, result.response.length, result.threadId);
            task.result = formatPayload(result, savings, result.threadId, 'codex');
        })
            .catch((err) => {
            task.endTime = Date.now();
            task.status = 'FAILED';
            task.result = {
                success: false,
                status: 'ERROR',
                error: err instanceof Error ? err.message : String(err),
            };
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: 'RUNNING',
                        task_id: taskId,
                        agent: 'codex',
                        message: 'Codex task launched in background to avoid Claude Desktop 60-second MCP client timeouts. Call codex_check_task or agy_check_task with this task_id to check progress or get final results.',
                        workspace_dir: task.workspaceDir,
                    }, null, 2),
                },
            ],
        };
    }
    const result = await runCodex({
        instructions: args.instructions,
        workspaceDir: args.workspace_dir,
        model: args.model,
        reasoningEffort: args.reasoning_effort,
        sandbox: args.sandbox,
        timeoutSeconds: args.timeout_seconds,
        includeGitDiff: args.include_git_diff,
    });
    const totalTokens = result.usage?.total_tokens || 0;
    const savings = await calculateAndRecordSavings(totalTokens, args.instructions.length, result.response.length, result.threadId);
    const payload = formatPayload(result, savings, result.threadId, 'codex');
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(payload, null, 2),
            },
        ],
    };
});
// Tool 8: codex_continue
server.tool('codex_continue', 'Continues an existing Codex session thread for follow-up adjustments, corrections, or iterative bugfixing.', {
    thread_id: z.string().describe('The thread ID returned from a prior codex_execute or codex_continue call.'),
    instructions: z.string().describe('Follow-up instructions or bugfix feedback for Codex.'),
    workspace_dir: z.string().optional().describe('Target workspace directory path (MANDATORY in Claude Desktop to point to the project repo). Defaults to current working directory.'),
    async: z.boolean().optional().default(false).describe('Run task asynchronously in background.'),
    model: z.string().optional().describe('Model override (e.g. gpt-5.6-luna).'),
    reasoning_effort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
    timeout_seconds: z.number().optional().default(600),
    include_git_diff: z.boolean().optional().default(true),
}, async (args) => {
    if (args.async) {
        const taskId = randomUUID();
        const task = {
            id: taskId,
            agent: 'codex',
            status: 'RUNNING',
            instructions: args.instructions,
            workspaceDir: args.workspace_dir || process.cwd(),
            startTime: Date.now(),
            executionTrace: [],
        };
        backgroundTasks.set(taskId, task);
        runCodex({
            threadId: args.thread_id,
            instructions: args.instructions,
            workspaceDir: args.workspace_dir,
            model: args.model,
            reasoningEffort: args.reasoning_effort,
            timeoutSeconds: args.timeout_seconds,
            includeGitDiff: args.include_git_diff,
            onStreamEvent: (event) => {
                if (event.type === 'item.completed' && event.item) {
                    const item = event.item;
                    if (item.type === 'tool' || item.type === 'command_execution') {
                        task.executionTrace.push({
                            type: 'tool',
                            name: item.name || item.command || 'tool_call',
                        });
                    }
                }
            },
        })
            .then(async (result) => {
            task.endTime = Date.now();
            task.status = result.success ? 'SUCCESS' : result.status || 'FAILED';
            const totalTokens = result.usage?.total_tokens || 0;
            const savings = await calculateAndRecordSavings(totalTokens, args.instructions.length, result.response.length, result.threadId || args.thread_id);
            task.result = formatPayload(result, savings, args.thread_id, 'codex');
        })
            .catch((err) => {
            task.endTime = Date.now();
            task.status = 'FAILED';
            task.result = {
                success: false,
                status: 'ERROR',
                error: err instanceof Error ? err.message : String(err),
            };
        });
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: 'RUNNING',
                        task_id: taskId,
                        agent: 'codex',
                        thread_id: args.thread_id,
                        message: 'Codex follow-up task launched in background to avoid Claude Desktop 60-second MCP client timeouts. Call codex_check_task with this task_id to check progress or get final results.',
                        workspace_dir: task.workspaceDir,
                    }, null, 2),
                },
            ],
        };
    }
    const result = await runCodex({
        threadId: args.thread_id,
        instructions: args.instructions,
        workspaceDir: args.workspace_dir,
        model: args.model,
        reasoningEffort: args.reasoning_effort,
        timeoutSeconds: args.timeout_seconds,
        includeGitDiff: args.include_git_diff,
    });
    const totalTokens = result.usage?.total_tokens || 0;
    const savings = await calculateAndRecordSavings(totalTokens, args.instructions.length, result.response.length, result.threadId || args.thread_id);
    const payload = formatPayload(result, savings, args.thread_id, 'codex');
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(payload, null, 2),
            },
        ],
    };
});
// Tool 9: codex_check_task
server.tool('codex_check_task', 'Checks the status, running duration, execution trace, and results of an asynchronous task (Codex or Antigravity).', {
    task_id: z.string().describe('The task ID returned from execute or continue calls when async is true.'),
}, async (args) => {
    return handleCheckTask(args.task_id);
});
// Tool 10: codex_get_status
server.tool('codex_get_status', 'Checks whether the OpenAI Codex CLI is installed, operational, and reports current authentication status.', {}, async () => {
    try {
        const { stdout: versionOut } = await execAsync('codex --version', {
            timeout: 5000,
            env: {
                ...process.env,
                PATH: getEnhancedPath(),
            },
        });
        let loginInfo = 'Unknown';
        try {
            const { stdout: loginOut } = await execAsync('codex login status', {
                timeout: 5000,
                env: {
                    ...process.env,
                    PATH: getEnhancedPath(),
                },
            });
            loginInfo = loginOut.trim();
        }
        catch {
            // Ignore login check failure
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        available: true,
                        version: versionOut.trim(),
                        auth_status: loginInfo,
                        message: 'Codex CLI is installed and available in PATH.',
                    }, null, 2),
                },
            ],
        };
    }
    catch (err) {
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        available: false,
                        error: err.message,
                        message: 'Codex CLI was not found in PATH or failed to respond.',
                    }, null, 2),
                },
            ],
        };
    }
});
// ==========================================
// 3. CHATGPT TOOLS (Advisory / Consulting)
// ==========================================
// Tool 11: chatgpt_consult
server.tool('chatgpt_consult', 'Consults ChatGPT / OpenAI models (e.g. o3-mini, gpt-4o, o1) for high-level technical advice, architectural review, edge case analysis, or second opinions.', {
    prompt: z.string().describe('The question, design challenge, or architectural question to consult ChatGPT on.'),
    context: z.string().optional().describe('Optional relevant context (code snippets, error logs, requirements).'),
    system_prompt: z.string().optional().describe('Optional custom system prompt directive.'),
    model: z.string().optional().default('o3-mini').describe('Model to consult: o3-mini, gpt-4o, gpt-4o-mini, o1, etc. Default is o3-mini.'),
    reasoning_effort: z.enum(['low', 'medium', 'high']).optional().describe('Reasoning effort for o-series models (low, medium, high).'),
    temperature: z.number().optional().describe('Sampling temperature for non-reasoning models (0.0 to 1.0).'),
}, async (args) => {
    const result = await runChatgptConsult({
        prompt: args.prompt,
        context: args.context,
        systemPrompt: args.system_prompt,
        model: args.model,
        reasoningEffort: args.reasoning_effort,
        temperature: args.temperature,
    });
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(result, null, 2),
            },
        ],
    };
});
// Tool 12: chatgpt_review
server.tool('chatgpt_review', 'Requests an adversarial code review from ChatGPT on a git diff, file content, or code snippet with specialized focus.', {
    diff_or_code: z.string().describe('The code snippet or git diff to review.'),
    focus: z.enum(['security', 'performance', 'architecture', 'thorough']).optional().default('thorough').describe('Review focus area: security, performance, architecture, or thorough. Default is thorough.'),
    instructions: z.string().optional().describe('Specific review instructions or questions.'),
    model: z.string().optional().default('o3-mini').describe('Model to use for review (default: o3-mini).'),
}, async (args) => {
    const result = await runChatgptReview({
        diffOrCode: args.diff_or_code,
        focus: args.focus,
        instructions: args.instructions,
        model: args.model,
    });
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify(result, null, 2),
            },
        ],
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    process.stderr.write(`omni-bridge failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
