import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { getGitSummary } from '../utils/git.js';
// ANSI styling for live terminal output
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const CYAN = '\x1b[38;2;80;220;255m';
const GREEN = '\x1b[38;2;80;235;150m';
const YELLOW = '\x1b[38;2;255;210;70m';
const PURPLE = '\x1b[38;2;180;120;255m';
export function getEnhancedPath() {
    const extraPaths = [
        path.join(os.homedir(), '.local', 'bin'),
        path.join(os.homedir(), '.gemini', 'antigravity-cli', 'bin'),
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/usr/local/bin',
    ];
    const currentPath = process.env.PATH || '';
    return `${extraPaths.join(path.delimiter)}${path.delimiter}${currentPath}`;
}
export async function runAgy(options) {
    const cwd = path.resolve(options.workspaceDir || process.cwd());
    const timeoutMs = (options.timeoutSeconds || 600) * 1000;
    const timeoutFlag = `${options.timeoutSeconds || 600}s`;
    const mode = options.mode || 'accept-edits';
    const formattedInstructions = `[AUTONOMOUS EXECUTION MODE]
You are running as an unattended background worker delegated by Claude.
- Do NOT ask interactive questions, request confirmation, or pause for feedback.
- Autonomously perform all necessary file reads, edits, creations, and command executions.
- Verify changes where applicable (e.g. running tests, typechecks, or builds).
- Conclude with a clear, concise summary of what was completed and verified.

[TARGET WORKSPACE]
Workspace Directory: ${cwd}
All project files, edits, creations, and commands must be scoped within this workspace directory.

[TASK INSTRUCTIONS]
${options.instructions}`;
    const args = [
        '--print',
        formattedInstructions,
        '--dangerously-skip-permissions',
        '--add-dir',
        cwd,
        '--mode',
        mode,
        '--output-format',
        'stream-json',
        '--print-timeout',
        timeoutFlag,
    ];
    if (options.conversationId) {
        args.push('--conversation', options.conversationId);
    }
    if (options.effort) {
        args.push('--effort', options.effort);
    }
    if (options.model) {
        args.push('--model', options.model);
    }
    return new Promise((resolve) => {
        let stdoutBuffer = '';
        let stderr = '';
        let isTimedOut = false;
        let parsedResult = null;
        const executionTrace = [];
        process.stderr.write(`\n${PURPLE}${BOLD}🚀 [Antigravity Worker Initialized]${RESET} ${DIM}in ${cwd}${RESET}\n`);
        const enhancedPath = getEnhancedPath();
        const proc = spawn('agy', args, {
            cwd,
            env: {
                ...process.env,
                PATH: enhancedPath,
                PAGER: 'cat',
            },
        });
        // Prevent hanging child process on unclosed stdin
        if (proc.stdin) {
            proc.stdin.end();
        }
        const timer = setTimeout(() => {
            isTimedOut = true;
            proc.kill('SIGTERM');
            setTimeout(() => {
                if (!proc.killed)
                    proc.kill('SIGKILL');
            }, 3000);
        }, timeoutMs);
        let isQuotaExhausted = false;
        let quotaErrorReason = '';
        const checkAndHandleQuotaExhaustion = (text) => {
            if (isQuotaExhausted)
                return;
            const match = text.match(/(?:resource[_\s]exhausted|quota[_\s]exceeded|exceeded.*quota|insufficient.*quota|rate[_\s]limit|too many requests|status[:\s]*429|code[:\s]*429|usage[_\s]limit|credit[_\s]limit|out of credits|insufficient credits|daily.*limit.*reached|capacity exceeded)/i);
            if (match) {
                isQuotaExhausted = true;
                quotaErrorReason = text.trim().slice(0, 400);
                process.stderr.write(`\n\x1b[31m\x1b[1m⛔ [Antigravity Usage/Quota Exhausted]\x1b[0m ${quotaErrorReason}\n`);
                clearTimeout(timer);
                proc.kill('SIGTERM');
                setTimeout(() => {
                    if (!proc.killed)
                        proc.kill('SIGKILL');
                }, 1000);
            }
        };
        proc.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const parsed = JSON.parse(line);
                    if (options.onStreamEvent) {
                        options.onStreamEvent(parsed);
                    }
                    // Handle step updates
                    if (parsed.event === 'step_update' && parsed.step_update) {
                        const step = parsed.step_update;
                        const idx = step.step_index ?? executionTrace.length;
                        if (step.step_type === 'agent_response') {
                            const thinking = step.usage?.thinking_tokens || 0;
                            if (thinking > 0) {
                                process.stderr.write(`${CYAN}🧠 [Antigravity Thinking]${RESET} ${DIM}${thinking.toLocaleString()} tokens${step.duration_seconds ? ` in ${step.duration_seconds.toFixed(1)}s` : ''}${RESET}\n`);
                                executionTrace.push({
                                    stepIndex: idx,
                                    type: 'thinking',
                                    thinkingTokens: thinking,
                                    durationSeconds: step.duration_seconds,
                                });
                            }
                            if (step.text_delta) {
                                process.stderr.write(`${DIM}${step.text_delta}${RESET}`);
                            }
                        }
                        else if (step.step_type === 'tool') {
                            const toolName = step.tool_name || step.tool_info?.name || 'unknown_tool';
                            const params = step.tool_info?.parameters || {};
                            const paramPreview = params.TargetFile ||
                                params.CommandLine ||
                                params.Query ||
                                params.DirectoryPath ||
                                params.AbsolutePath ||
                                params.Url ||
                                '';
                            if (step.state === 'ACTIVE') {
                                process.stderr.write(`${YELLOW}⚡ [Antigravity Tool: ${toolName}]${RESET} ${DIM}${paramPreview}${RESET}\n`);
                            }
                            else if (step.state === 'DONE') {
                                process.stderr.write(`${GREEN}✅ [Tool Completed]${RESET} ${DIM}${toolName}${step.duration_seconds ? ` (${step.duration_seconds.toFixed(2)}s)` : ''}${RESET}\n`);
                                executionTrace.push({
                                    stepIndex: idx,
                                    type: 'tool',
                                    name: toolName,
                                    details: paramPreview ? String(paramPreview) : undefined,
                                    durationSeconds: step.duration_seconds,
                                });
                            }
                        }
                    }
                    else if (parsed.event === 'result' && parsed.result) {
                        parsedResult = parsed.result;
                        if (parsed.result.status === 'ERROR' && parsed.result.error) {
                            checkAndHandleQuotaExhaustion(parsed.result.error);
                        }
                        process.stderr.write(`\n${GREEN}${BOLD}✨ [Antigravity Finished]${RESET} ${DIM}Status: ${parsed.result.status}, Duration: ${parsed.result.duration_seconds?.toFixed(1) || 0}s${RESET}\n`);
                    }
                }
                catch {
                    checkAndHandleQuotaExhaustion(line);
                }
            }
        });
        proc.stderr.on('data', (data) => {
            const chunk = data.toString();
            stderr += chunk;
            checkAndHandleQuotaExhaustion(chunk);
        });
        proc.on('close', async (code) => {
            clearTimeout(timer);
            let gitChanges;
            if (options.includeGitDiff !== false) {
                gitChanges = await getGitSummary(cwd);
            }
            if (isQuotaExhausted) {
                resolve({
                    success: false,
                    status: 'USAGE_LIMIT_EXHAUSTED',
                    response: '',
                    error: `Antigravity model quota or usage limit has been exhausted: ${quotaErrorReason || '429 Too Many Requests / Resource Exhausted'}. Process terminated immediately to avoid background hanging.`,
                    rawStderr: stderr.slice(-1000),
                    executionTrace,
                    gitChanges,
                });
                return;
            }
            if (isTimedOut) {
                const hasExhaustion = /(?:resource[_\s]exhausted|quota[_\s]exceeded|rate[_\s]limit|429|usage[_\s]limit|credit[_\s]limit)/i.test(stderr);
                resolve({
                    success: false,
                    status: hasExhaustion ? 'USAGE_LIMIT_EXHAUSTED' : 'TIMEOUT',
                    response: '',
                    error: hasExhaustion
                        ? `Antigravity usage limit was exhausted during execution, causing retry loops that timed out.`
                        : `Task timed out after ${options.timeoutSeconds || 600} seconds`,
                    rawStderr: stderr.slice(-1000),
                    executionTrace,
                    gitChanges,
                });
                return;
            }
            if (parsedResult) {
                const hasExhaustion = parsedResult.error && /(?:resource[_\s]exhausted|quota[_\s]exceeded|rate[_\s]limit|429|usage[_\s]limit|credit[_\s]limit)/i.test(parsedResult.error);
                resolve({
                    success: !hasExhaustion && (parsedResult.status === 'SUCCESS' || code === 0),
                    conversationId: parsedResult.conversation_id,
                    status: hasExhaustion ? 'USAGE_LIMIT_EXHAUSTED' : (parsedResult.status || (code === 0 ? 'SUCCESS' : 'FAILED')),
                    response: parsedResult.response || '',
                    durationSeconds: parsedResult.duration_seconds,
                    numTurns: parsedResult.num_turns,
                    usage: parsedResult.usage,
                    executionTrace,
                    gitChanges,
                    error: parsedResult.error,
                    rawStderr: stderr.trim() ? stderr.slice(-1000) : undefined,
                });
                return;
            }
            // Fallback
            resolve({
                success: code === 0,
                status: code === 0 ? 'SUCCESS' : 'FAILED',
                response: stdoutBuffer.trim() || '(No output produced)',
                error: code !== 0 ? `Process exited with code ${code}` : undefined,
                rawStderr: stderr.trim() ? stderr.slice(-1000) : undefined,
                executionTrace,
                gitChanges,
            });
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            resolve({
                success: false,
                status: 'SPAWN_ERROR',
                response: '',
                error: `Failed to start agy process: ${err.message}`,
            });
        });
    });
}
