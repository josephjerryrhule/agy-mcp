import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

// Append-only JSONL feed of subagent activity. The MCP server's stderr is swallowed
// by the MCP client, so this file is what `agy-mcp watch` tails to show work live.

export type FeedAgent = 'antigravity' | 'codex' | 'chatgpt'

export type FeedKind =
  | 'start' // task opened: instructions, workspace, model
  | 'thinking' // reasoning step: tokens, duration
  | 'tool' // tool call started
  | 'tool_done' // tool call finished
  | 'text' // streamed agent text (may be a partial delta)
  | 'message' // complete agent message
  | 'info' // misc status line (thread id, quota, etc.)
  | 'finish' // task closed: status, duration, tokens, files changed

export interface FeedEvent {
  ts: number
  task: string
  agent: FeedAgent
  kind: FeedKind
  [key: string]: unknown
}

const MAX_BYTES = 20 * 1024 * 1024

export function feedDir(): string {
  return process.env.AGY_MCP_FEED_DIR || path.join(os.homedir(), '.agy-mcp')
}

export function feedPath(): string {
  return path.join(feedDir(), 'live.jsonl')
}

let dirReady = false

function append(event: FeedEvent): void {
  try {
    const file = feedPath()
    if (!dirReady) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      dirReady = true
    }
    try {
      if (fs.statSync(file).size > MAX_BYTES) {
        fs.renameSync(file, `${file}.1`)
      }
    } catch {
      // File does not exist yet
    }
    fs.appendFileSync(file, JSON.stringify(event) + '\n')
  } catch {
    // The feed is best-effort; never let it break a task
  }
}

export interface Feed {
  task: string
  emit(kind: FeedKind, data?: Record<string, unknown>): void
  // Buffer a streamed text delta; flushed on newline, after a pause, or before the next event
  text(delta: string): void
}

export function createFeed(agent: FeedAgent, taskId?: string): Feed {
  const task = taskId || randomUUID()
  let pending = ''
  let timer: NodeJS.Timeout | undefined

  const write = (kind: FeedKind, data: Record<string, unknown>) =>
    append({ ts: Date.now(), task, agent, kind, ...data })

  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    if (pending) {
      write('text', { text: pending })
      pending = ''
    }
  }

  return {
    task,
    emit(kind, data = {}) {
      flush()
      write(kind, data)
    },
    text(delta) {
      pending += delta
      const cut = pending.lastIndexOf('\n')
      if (cut >= 0) {
        const ready = pending.slice(0, cut + 1)
        pending = pending.slice(cut + 1)
        write('text', { text: ready })
      }
      if (pending && !timer) {
        timer = setTimeout(flush, 600)
        timer.unref?.()
      }
    },
  }
}
