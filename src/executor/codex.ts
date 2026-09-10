import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { getGitSummary, type GitSummary } from '../utils/git.js'

export interface CodexExecuteOptions {
  instructions: string
  workspaceDir?: string
  threadId?: string
  model?: string
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  timeoutSeconds?: number
  includeGitDiff?: boolean
  onStreamEvent?: (event: any) => void
}

export interface CodexUsage {
  input_tokens?: number
  output_tokens?: number
  reasoning_output_tokens?: number
  cached_input_tokens?: number
  total_tokens?: number
}

export interface CodexStepTrace {
  stepIndex: number
  type: string
  name?: string
  details?: string
  durationSeconds?: number
}

export interface CodexExecuteResult {
  success: boolean
  threadId?: string
  status: string
  response: string
  durationSeconds?: number
  numTurns?: number
  usage?: CodexUsage
  executionTrace?: CodexStepTrace[]
  gitChanges?: GitSummary
  error?: string
  rawStderr?: string
}

// ANSI styling for live terminal output
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const CYAN = '\x1b[38;2;80;220;255m'
const GREEN = '\x1b[38;2;80;235;150m'
const YELLOW = '\x1b[38;2;255;210;70m'
const ORANGE = '\x1b[38;2;255;160;70m'

export function getEnhancedPath(): string {
  const extraPaths = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.gemini', 'antigravity-cli', 'bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
  ]
  const currentPath = process.env.PATH || ''
  return `${extraPaths.join(path.delimiter)}${path.delimiter}${currentPath}`
}

export async function runCodex(options: CodexExecuteOptions): Promise<CodexExecuteResult> {
  const cwd = path.resolve(options.workspaceDir || process.cwd())
  const timeoutMs = (options.timeoutSeconds || 600) * 1000
  const startTime = Date.now()

  const tempOutputFile = path.join(os.tmpdir(), `codex-out-${randomUUID()}.txt`)

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
${options.instructions}`

  const modelToUse = options.model || 'gpt-5.6-luna'
  const args: string[] = []

  if (options.threadId) {
    args.push(
      'exec',
      'resume',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '-m',
      modelToUse
    )
    if (options.reasoningEffort) {
      args.push('-c', `model_reasoning_effort="${options.reasoningEffort}"`)
    }
    args.push('-o', tempOutputFile)
    args.push(options.threadId)
    args.push(options.instructions)
  } else {
    args.push(
      'exec',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '-C',
      cwd,
      '-m',
      modelToUse
    )
    if (options.reasoningEffort) {
      args.push('-c', `model_reasoning_effort="${options.reasoningEffort}"`)
    }
    if (options.sandbox) {
      args.push('-s', options.sandbox)
    }
    args.push('-o', tempOutputFile)
    args.push(formattedInstructions)
  }

  return new Promise<CodexExecuteResult>((resolve) => {
    let stdoutBuffer = ''
    let stderr = ''
    let isTimedOut = false
    let isQuotaExhausted = false
    let quotaErrorReason = ''

    let threadId = options.threadId
    let accumulatedResponse = ''
    let usage: CodexUsage | undefined
    let numTurns = 0
    const executionTrace: CodexStepTrace[] = []

    process.stderr.write(
      `\n${ORANGE}${BOLD}🚀 [Codex Worker Initialized]${RESET} ${DIM}in ${cwd} (model: ${modelToUse})${RESET}\n`
    )

    const enhancedPath = getEnhancedPath()

    const proc = spawn('codex', args, {
      cwd,
      env: {
        ...process.env,
        PATH: enhancedPath,
        PAGER: 'cat',
      },
    })

    // Prevent hanging child process waiting on stdin
    if (proc.stdin) {
      proc.stdin.end()
    }

    const timer = setTimeout(() => {
      isTimedOut = true
      proc.kill('SIGTERM')
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL')
      }, 3000)
    }, timeoutMs)

    const checkAndHandleQuotaExhaustion = (text: string) => {
      if (isQuotaExhausted) return
      const match = text.match(
        /(?:resource[_\s]exhausted|quota[_\s]exceeded|exceeded.*quota|insufficient.*quota|rate[_\s]limit|too many requests|status[:\s]*429|code[:\s]*429|usage[_\s]limit|credit[_\s]limit|out of credits|insufficient credits|daily.*limit.*reached|capacity exceeded)/i
      )
      if (match) {
        isQuotaExhausted = true
        quotaErrorReason = text.trim().slice(0, 400)
        process.stderr.write(`\n\x1b[31m\x1b[1m⛔ [Codex Usage/Quota Exhausted]\x1b[0m ${quotaErrorReason}\n`)
        clearTimeout(timer)
        proc.kill('SIGTERM')
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL')
        }, 1000)
      }
    }

    proc.stdout.on('data', (data) => {
      stdoutBuffer += data.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          if (options.onStreamEvent) {
            options.onStreamEvent(parsed)
          }

          if (parsed.type === 'thread.started' && parsed.thread_id) {
            threadId = parsed.thread_id
            process.stderr.write(`${CYAN}🧵 [Codex Thread: ${threadId}]${RESET}\n`)
          } else if (parsed.type === 'turn.started') {
            numTurns += 1
          } else if (parsed.type === 'turn.completed' && parsed.usage) {
            const u = parsed.usage
            usage = {
              input_tokens: u.input_tokens,
              output_tokens: u.output_tokens,
              reasoning_output_tokens: u.reasoning_output_tokens,
              cached_input_tokens: u.cached_input_tokens,
              total_tokens: (u.input_tokens || 0) + (u.output_tokens || 0),
            }
          } else if (parsed.type === 'item.completed' && parsed.item) {
            const item = parsed.item
            if (item.type === 'agent_message' && item.text) {
              accumulatedResponse = item.text
              process.stderr.write(`${DIM}${item.text}${RESET}\n`)
            } else if (item.type === 'tool' || item.type === 'command_execution') {
              const toolName = item.name || item.tool || item.command || 'tool_call'
              process.stderr.write(`${YELLOW}⚡ [Codex Action: ${toolName}]${RESET}\n`)
              executionTrace.push({
                stepIndex: executionTrace.length,
                type: 'tool',
                name: toolName,
                details: item.args ? JSON.stringify(item.args) : undefined,
              })
            }
          } else if (parsed.type === 'error' && parsed.message) {
            checkAndHandleQuotaExhaustion(parsed.message)
          }
        } catch {
          checkAndHandleQuotaExhaustion(trimmed)
        }
      }
    })

    proc.stderr.on('data', (data) => {
      const chunk = data.toString()
      stderr += chunk
      checkAndHandleQuotaExhaustion(chunk)
    })

    proc.on('close', async (code) => {
      clearTimeout(timer)
      const durationSeconds = Math.round((Date.now() - startTime) / 100) / 10

      // Read final output message from temp file if codex generated it
      let finalResponse = accumulatedResponse
      try {
        const fileContent = await fs.readFile(tempOutputFile, 'utf-8')
        if (fileContent.trim()) {
          finalResponse = fileContent.trim()
        }
      } catch {
        // Fallback to accumulated response
      } finally {
        // Clean up temp file
        await fs.unlink(tempOutputFile).catch(() => {})
      }

      let gitChanges: GitSummary | undefined
      if (options.includeGitDiff !== false) {
        gitChanges = await getGitSummary(cwd)
      }

      if (isQuotaExhausted) {
        resolve({
          success: false,
          threadId,
          status: 'USAGE_LIMIT_EXHAUSTED',
          response: '',
          durationSeconds,
          numTurns,
          usage,
          error: `Codex model quota or usage limit was exhausted: ${quotaErrorReason || 'Rate limit / quota exceeded'}. Process terminated.`,
          rawStderr: stderr.slice(-1000),
          executionTrace,
          gitChanges,
        })
        return
      }

      if (isTimedOut) {
        resolve({
          success: false,
          threadId,
          status: 'TIMEOUT',
          response: finalResponse,
          durationSeconds,
          numTurns,
          usage,
          error: `Codex task timed out after ${options.timeoutSeconds || 600} seconds`,
          rawStderr: stderr.slice(-1000),
          executionTrace,
          gitChanges,
        })
        return
      }

      const success = code === 0
      process.stderr.write(
        `\n${GREEN}${BOLD}✨ [Codex Finished]${RESET} ${DIM}Status: ${success ? 'SUCCESS' : 'FAILED'}, Duration: ${durationSeconds}s${RESET}\n`
      )

      resolve({
        success,
        threadId,
        status: success ? 'SUCCESS' : 'FAILED',
        response: finalResponse || (success ? '(Task completed with no final text)' : 'Codex execution failed'),
        durationSeconds,
        numTurns,
        usage,
        executionTrace,
        gitChanges,
        error: !success ? `Process exited with code ${code}${stderr ? `: ${stderr.slice(-300)}` : ''}` : undefined,
        rawStderr: stderr.trim() ? stderr.slice(-1000) : undefined,
      })
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        success: false,
        status: 'SPAWN_ERROR',
        response: '',
        error: `Failed to spawn codex process: ${err.message}`,
      })
    })
  })
}
