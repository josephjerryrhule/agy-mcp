import fs from 'node:fs'
import os from 'node:os'
import { feedPath, type FeedEvent } from '../utils/livefeed.js'

// `agy-mcp watch`: tails the live feed and renders each delegated task as a thread,
// the way the themewire-pm bot threads its Slack work: a root post for the task,
// replies for each step, and a closing status mark.

const HELP = `agy-mcp watch: live view of Antigravity / Codex / ChatGPT subagent work

Usage: agy-mcp watch [options]

  (no options)       Replay tasks still running, then follow new activity
  -n, --history N    Replay the last N tasks in full before following
  -t, --task ID      Only show the task whose id starts with ID
  -l, --list         List recent tasks and exit
  -q, --quiet        Hide streamed agent text (show steps only)
      --no-follow    Print and exit instead of following
  -h, --help         Show this help

Feed file: ${feedPath()}`

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = paint('1')
const dim = paint('2')
const red = paint('38;2;255;95;95')
const green = paint('38;2;80;235;150')
const yellow = paint('38;2;255;210;70')

const AGENT_STYLE: Record<string, { label: string; color: (s: string) => string; icon: string }> = {
  antigravity: { label: 'antigravity', color: paint('38;2;180;120;255'), icon: '🟣' },
  codex: { label: 'codex', color: paint('38;2;255;160;70'), icon: '🟠' },
  chatgpt: { label: 'chatgpt', color: paint('38;2;90;170;255'), icon: '🔵' },
}

interface Options {
  history: number
  task?: string
  list: boolean
  quiet: boolean
  follow: boolean
}

function parseArgs(argv: string[]): Options | null {
  const opts: Options = { history: 0, list: false, quiet: false, follow: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') return null
    else if (a === '-n' || a === '--history') opts.history = Math.max(0, parseInt(argv[++i] || '0', 10) || 0)
    else if (a === '-t' || a === '--task') opts.task = argv[++i]
    else if (a === '-l' || a === '--list') opts.list = true
    else if (a === '-q' || a === '--quiet') opts.quiet = true
    else if (a === '--no-follow') opts.follow = false
    else {
      process.stderr.write(`Unknown option: ${a}\n\n`)
      return null
    }
  }
  return opts
}

// Returns the events plus the byte length read from the live file, so following resumes exactly there
function readEvents(file: string): { events: FeedEvent[]; liveBytes: number } {
  const events: FeedEvent[] = []
  let liveBytes = 0
  for (const f of [`${file}.1`, file]) {
    let raw: Buffer
    try {
      raw = fs.readFileSync(f)
    } catch {
      continue
    }
    let content = raw.toString('utf8')
    if (f === file) {
      // Leave a half-written trailing line for the follower to pick up
      const end = content.lastIndexOf('\n') + 1
      content = content.slice(0, end)
      liveBytes = Buffer.byteLength(content)
    }
    for (const line of content.split('\n')) {
      if (!line) continue
      try {
        events.push(JSON.parse(line))
      } catch {
        // Skip a torn line
      }
    }
  }
  return { events, liveBytes }
}

const shortId = (id: string) => id.slice(0, 8)
const clock = (ts: number) => new Date(ts).toTimeString().slice(0, 8)
const home = os.homedir()
const tildify = (p: unknown) => (typeof p === 'string' ? p.replace(home, '~') : '')

function formatDuration(seconds: unknown): string {
  if (typeof seconds !== 'number' || !isFinite(seconds)) return ''
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  return `${m}m ${Math.round(seconds - m * 60)}s`
}

interface ThreadState {
  agent: string
  start: number
  partial: string
  lastSeen: number
}

class Renderer {
  private threads = new Map<string, ThreadState>()
  private lastTask: string | null = null
  private width = Math.max(40, (process.stdout.columns || 100) - 4)

  constructor(private quiet: boolean) {
    process.stdout.on?.('resize', () => {
      this.width = Math.max(40, (process.stdout.columns || 100) - 4)
    })
  }

  get running(): number {
    return this.threads.size
  }

  private style(agent: string) {
    return AGENT_STYLE[agent] || { label: agent, color: (s: string) => s, icon: '⚪' }
  }

  private gutter(task: string): string {
    const t = this.threads.get(task)
    return this.style(t?.agent || '').color('│')
  }

  private line(task: string, text: string) {
    const g = this.gutter(task)
    for (const raw of text.split('\n')) {
      let rest = raw
      do {
        process.stdout.write(`${g} ${rest.slice(0, this.width)}\n`)
        rest = rest.slice(this.width)
      } while (rest.length > 0)
    }
  }

  // When several tasks run at once, mark which thread the next lines belong to
  private switchTo(task: string) {
    if (this.lastTask === task) return
    const t = this.threads.get(task)
    if (this.lastTask !== null && t) {
      const s = this.style(t.agent)
      process.stdout.write(`${s.color('↳')} ${dim(`${s.label} ${shortId(task)}`)}\n`)
    }
    this.lastTask = task
  }

  private flushPartial(task: string) {
    const t = this.threads.get(task)
    if (t?.partial) {
      this.line(task, dim(t.partial))
      t.partial = ''
    }
  }

  // Called on a timer while following: a quiet task gets a "still working" reply every 30s
  heartbeat(now: number) {
    for (const [task, t] of this.threads) {
      if (now - t.lastSeen < 30_000) continue
      if (now - t.start > 2 * 60 * 60 * 1000) continue
      this.flushPartial(task)
      this.switchTo(task)
      this.line(task, dim(`⏳ still working · ${formatDuration((now - t.start) / 1000)} elapsed`))
      t.lastSeen = now
    }
  }

  handle(e: FeedEvent) {
    if (e.kind === 'start') {
      this.threads.set(e.task, { agent: e.agent, start: e.ts, partial: '', lastSeen: e.ts })
      const s = this.style(e.agent)
      const meta = [e.model, e.effort, e.mode].filter(Boolean).join(' · ')
      const resumed = e.conversation || e.thread ? dim(' (continued)') : ''
      process.stdout.write(
        `\n${s.color('┌')} ${s.icon} ${bold(s.color(s.label))} ${dim(shortId(e.task))}  ${dim(clock(e.ts))}${resumed}\n`
      )
      this.lastTask = e.task
      if (e.workspace) this.line(e.task, dim(`📁 ${tildify(e.workspace)}${meta ? `   ${meta}` : ''}`))
      else if (meta) this.line(e.task, dim(meta))
      const instructions = String(e.instructions || '').trim().split('\n').filter(Boolean)
      const preview = instructions.slice(0, 4).map((l) => (l.length > this.width - 4 ? l.slice(0, this.width - 5) + '…' : l))
      for (const l of preview) this.line(e.task, `${bold('›')} ${l}`)
      if (instructions.length > 4) this.line(e.task, dim(`  … ${instructions.length - 4} more lines`))
      this.line(e.task, `${yellow('👀')} ${dim('working…')}`)
      return
    }

    // Events for a task whose start is outside the replay window still get a thread
    if (!this.threads.has(e.task)) {
      if (e.kind === 'finish') return
      this.threads.set(e.task, { agent: e.agent, start: e.ts, partial: '', lastSeen: e.ts })
      const s = this.style(e.agent)
      process.stdout.write(`\n${s.color('┌')} ${s.icon} ${bold(s.color(s.label))} ${dim(shortId(e.task))}  ${dim('(joined mid-task)')}\n`)
      this.lastTask = e.task
    }

    this.switchTo(e.task)
    const t = this.threads.get(e.task)!
    t.lastSeen = e.ts
    const elapsed = dim(`+${formatDuration((e.ts - t.start) / 1000)}`)

    switch (e.kind) {
      case 'text': {
        if (this.quiet) return
        const text = t.partial + String(e.text || '')
        const lines = text.split('\n')
        t.partial = lines.pop() || ''
        for (const l of lines) this.line(e.task, dim(l))
        return
      }
      case 'thinking': {
        this.flushPartial(e.task)
        const parts = [
          typeof e.tokens === 'number' ? `${e.tokens.toLocaleString()} tokens` : '',
          formatDuration(e.duration),
        ].filter(Boolean)
        this.line(e.task, `🧠 ${paint('38;2;80;220;255')('thinking')} ${dim(parts.join(' · '))} ${elapsed}`)
        if (e.text && !this.quiet) {
          const text = String(e.text).trim()
          this.line(e.task, dim(text.length > 400 ? text.slice(0, 400) + '…' : text))
        }
        return
      }
      case 'tool': {
        this.flushPartial(e.task)
        const detail = e.detail ? ` ${dim(String(e.detail).split('\n')[0].slice(0, 160))}` : ''
        this.line(e.task, `⚡ ${yellow(String(e.name))}${detail} ${elapsed}`)
        return
      }
      case 'tool_done': {
        this.flushPartial(e.task)
        const failed = typeof e.exitCode === 'number' && e.exitCode !== 0
        const mark = failed ? red(`✗ exit ${e.exitCode}`) : green('✓')
        const detail = e.detail ? ` ${dim(String(e.detail))}` : ''
        const dur = e.duration ? dim(` ${formatDuration(e.duration)}`) : ''
        this.line(e.task, `   ${mark} ${dim(String(e.name))}${detail}${dur}`)
        return
      }
      case 'message': {
        this.flushPartial(e.task)
        if (this.quiet) return
        this.line(e.task, `💬 ${String(e.text || '').trim()}`)
        return
      }
      case 'info': {
        this.flushPartial(e.task)
        const text = String(e.text || '')
        this.line(e.task, e.level === 'error' ? red(`⛔ ${text}`) : dim(`ℹ ${text}`))
        return
      }
      case 'finish': {
        this.flushPartial(e.task)
        const s = this.style(t.agent)
        const ok = e.success === true
        const status = String(e.status || (ok ? 'SUCCESS' : 'FAILED'))
        const duration = formatDuration(typeof e.duration === 'number' ? e.duration : (e.ts - t.start) / 1000)
        const facts = [
          duration,
          typeof e.tokens === 'number' && e.tokens > 0 ? `${e.tokens.toLocaleString()} tokens` : '',
          Array.isArray(e.files) && e.files.length ? `${e.files.length} file${e.files.length === 1 ? '' : 's'} changed` : '',
        ].filter(Boolean)
        if (Array.isArray(e.files) && e.files.length) {
          for (const f of e.files.slice(0, 12)) this.line(e.task, dim(`   ± ${f}`))
          if (e.files.length > 12) this.line(e.task, dim(`   … ${e.files.length - 12} more`))
        }
        if (!ok && e.error) this.line(e.task, red(String(e.error).slice(0, 500)))
        const mark = ok ? green(`✅ ${status}`) : red(`⚠️  ${status}`)
        process.stdout.write(`${s.color('└')} ${mark} ${dim(facts.join(' · '))}\n`)
        this.threads.delete(e.task)
        // Force a thread marker before the next reply from any other open task
        this.lastTask = ''
        return
      }
    }
  }
}

function listTasks(events: FeedEvent[]) {
  const tasks = new Map<string, { start?: FeedEvent; finish?: FeedEvent; steps: number; last: number }>()
  for (const e of events) {
    const t = tasks.get(e.task) || { steps: 0, last: e.ts }
    if (e.kind === 'start') t.start = e
    else if (e.kind === 'finish') t.finish = e
    else if (e.kind === 'tool') t.steps++
    t.last = e.ts
    tasks.set(e.task, t)
  }
  const rows = [...tasks.entries()].slice(-25)
  if (rows.length === 0) {
    process.stdout.write(dim('No tasks recorded yet.\n'))
    return
  }
  for (const [id, t] of rows) {
    const agent = t.start?.agent || t.finish?.agent || '?'
    const s = AGENT_STYLE[agent] || { color: (x: string) => x, icon: '⚪', label: agent }
    const label = String(t.finish ? t.finish.status : 'RUNNING').padEnd(22)
    const status = t.finish ? (t.finish.success ? green(label) : red(label)) : yellow(label)
    const when = t.start ? clock(t.start.ts) : clock(t.last)
    const what = String(t.start?.instructions || '').trim().split('\n')[0].slice(0, 70)
    process.stdout.write(`${s.icon} ${dim(shortId(id))}  ${dim(when)}  ${s.color(agent.padEnd(11))} ${status} ${what}\n`)
  }
}

function follow(file: string, fromOffset: number, onEvent: (e: FeedEvent) => void) {
  let offset = fromOffset
  let carry = ''
  const tick = () => {
    let size: number
    try {
      size = fs.statSync(file).size
    } catch {
      return
    }
    if (size < offset) {
      // Rotated: start the new file from the top
      offset = 0
      carry = ''
    }
    if (size === offset) return
    const fd = fs.openSync(file, 'r')
    try {
      const buf = Buffer.alloc(size - offset)
      fs.readSync(fd, buf, 0, buf.length, offset)
      offset = size
      const lines = (carry + buf.toString('utf8')).split('\n')
      carry = lines.pop() || ''
      for (const line of lines) {
        if (!line) continue
        try {
          onEvent(JSON.parse(line))
        } catch {
          // Skip a torn line
        }
      }
    } finally {
      fs.closeSync(fd)
    }
  }
  setInterval(tick, 250)
}

export async function runWatch(argv: string[]): Promise<void> {
  const opts = parseArgs(argv)
  if (!opts) {
    process.stdout.write(HELP + '\n')
    return
  }

  const file = feedPath()
  const { events, liveBytes } = readEvents(file)

  if (opts.list) {
    listTasks(events)
    return
  }

  const match = (e: FeedEvent) => !opts.task || e.task.startsWith(opts.task)
  const renderer = new Renderer(opts.quiet)

  // Choose which past tasks to replay
  const finished = new Set(events.filter((e) => e.kind === 'finish').map((e) => e.task))
  const staleBefore = Date.now() - 2 * 60 * 60 * 1000
  const starts = events.filter((e) => e.kind === 'start' && match(e))
  const replay = new Set<string>()
  for (const s of starts) {
    if (!finished.has(s.task) && s.ts > staleBefore) replay.add(s.task)
  }
  if (opts.history > 0) for (const s of starts.slice(-opts.history)) replay.add(s.task)
  if (opts.task) for (const s of starts) replay.add(s.task)

  for (const e of events) if (replay.has(e.task)) renderer.handle(e)

  if (!opts.follow) return

  const running = renderer.running
  process.stdout.write(
    dim(`\n⏳ watching ${tildify(file)}${running ? ` · ${running} running` : ''} · ctrl+c to exit\n`)
  )

  follow(file, liveBytes, (e) => {
    if (match(e)) renderer.handle(e)
  })

  setInterval(() => renderer.heartbeat(Date.now()), 5000)

  await new Promise<void>(() => {})
}
