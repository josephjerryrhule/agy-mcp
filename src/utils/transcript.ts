import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export interface TranscriptStep {
  stepIndex?: number
  type?: string
  source?: string
  toolCalls?: Array<{ name: string; summary?: string }>
  truncatedContent?: string
}

export interface TranscriptInspection {
  conversationId: string
  found: boolean
  totalSteps: number
  steps: TranscriptStep[]
  summary: string
}

export async function inspectTranscript(
  conversationId: string,
  maxSteps: number = 20
): Promise<TranscriptInspection> {
  const homeDir = os.homedir()
  const transcriptPath = path.join(
    homeDir,
    '.gemini',
    'antigravity-cli',
    'brain',
    conversationId,
    '.system_generated',
    'logs',
    'transcript.jsonl'
  )

  try {
    const content = await fs.readFile(transcriptPath, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    const totalSteps = lines.length

    const recentLines = lines.slice(-maxSteps)
    const steps: TranscriptStep[] = []

    for (const line of recentLines) {
      try {
        const obj = JSON.parse(line)
        const toolCalls = Array.isArray(obj.tool_calls)
          ? obj.tool_calls.map((tc: any) => ({
              name: tc.name || tc.toolAction || 'unknown_tool',
              summary: tc.toolSummary || tc.summary || '',
            }))
          : undefined

        let truncated = ''
        if (typeof obj.content === 'string') {
          truncated = obj.content.slice(0, 300)
        }

        steps.push({
          stepIndex: obj.step_index,
          type: obj.type,
          source: obj.source,
          toolCalls,
          truncatedContent: truncated || undefined,
        })
      } catch {
        // ignore parse error on single line
      }
    }

    const summary = `Found transcript for conversation ${conversationId}. Total steps recorded: ${totalSteps}. Returned last ${steps.length} steps.`

    return {
      conversationId,
      found: true,
      totalSteps,
      steps,
      summary,
    }
  } catch (err: any) {
    return {
      conversationId,
      found: false,
      totalSteps: 0,
      steps: [],
      summary: `Transcript not found or inaccessible: ${err.message}`,
    }
  }
}
