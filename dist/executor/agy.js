import { spawn } from 'node:child_process';
import { getGitSummary } from '../utils/git.js';
export async function runAgy(options) {
    const cwd = options.workspaceDir || process.cwd();
    const timeoutMs = (options.timeoutSeconds || 600) * 1000;
    const timeoutFlag = `${options.timeoutSeconds || 600}s`;
    const args = [
        '--print',
        options.instructions,
        '--dangerously-skip-permissions',
        '--output-format',
        'json',
        '--print-timeout',
        timeoutFlag,
    ];
    if (options.conversationId) {
        args.push('--conversation', options.conversationId);
    }
    if (options.effort) {
        args.push('--effort', options.effort);
    }
    if (options.mode) {
        args.push('--mode', options.mode);
    }
    if (options.model) {
        args.push('--model', options.model);
    }
    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let isTimedOut = false;
        const proc = spawn('agy', args, {
            cwd,
            env: {
                ...process.env,
                PAGER: 'cat',
            },
        });
        const timer = setTimeout(() => {
            isTimedOut = true;
            proc.kill('SIGTERM');
            setTimeout(() => {
                if (!proc.killed)
                    proc.kill('SIGKILL');
            }, 3000);
        }, timeoutMs);
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        proc.on('close', async (code) => {
            clearTimeout(timer);
            let gitChanges;
            if (options.includeGitDiff !== false) {
                gitChanges = await getGitSummary(cwd);
            }
            if (isTimedOut) {
                resolve({
                    success: false,
                    status: 'TIMEOUT',
                    response: '',
                    error: `Task timed out after ${options.timeoutSeconds || 600} seconds`,
                    rawStderr: stderr.slice(-1000),
                    gitChanges,
                });
                return;
            }
            // Parse JSON output from agy
            try {
                const trimmed = stdout.trim();
                // Sometimes leading/trailing non-JSON logs exist; find the outer JSON block
                const startIdx = trimmed.indexOf('{');
                const endIdx = trimmed.lastIndexOf('}');
                if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                    const jsonStr = trimmed.slice(startIdx, endIdx + 1);
                    const parsed = JSON.parse(jsonStr);
                    resolve({
                        success: parsed.status === 'SUCCESS' || code === 0,
                        conversationId: parsed.conversation_id,
                        status: parsed.status || (code === 0 ? 'SUCCESS' : 'FAILED'),
                        response: parsed.response || stdout,
                        durationSeconds: parsed.duration_seconds,
                        numTurns: parsed.num_turns,
                        usage: parsed.usage,
                        gitChanges,
                        rawStderr: stderr.trim() ? stderr.slice(-1000) : undefined,
                    });
                    return;
                }
            }
            catch {
                // fallback if JSON parse fails
            }
            resolve({
                success: code === 0,
                status: code === 0 ? 'SUCCESS' : 'FAILED',
                response: stdout.trim() || '(No output produced)',
                error: code !== 0 ? `Process exited with code ${code}` : undefined,
                rawStderr: stderr.trim() ? stderr.slice(-1000) : undefined,
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
