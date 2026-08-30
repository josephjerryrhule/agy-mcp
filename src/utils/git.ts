import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export interface GitSummary {
  isGitRepo: boolean
  modifiedFiles: string[]
  untrackedFiles: string[]
  diffStat: string
  hasChanges: boolean
}

export async function getGitSummary(cwd: string): Promise<GitSummary> {
  try {
    const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd, timeout: 5000 })
    const { stdout: diffStatOut } = await execAsync('git diff --stat', { cwd, timeout: 5000 })

    const lines = statusOut.trim().split('\n').filter(Boolean)
    const modifiedFiles: string[] = []
    const untrackedFiles: string[] = []

    for (const line of lines) {
      const code = line.slice(0, 2).trim()
      const file = line.slice(3).trim()
      if (code === '??') {
        untrackedFiles.push(file)
      } else {
        modifiedFiles.push(file)
      }
    }

    const hasChanges = modifiedFiles.length > 0 || untrackedFiles.length > 0

    return {
      isGitRepo: true,
      modifiedFiles,
      untrackedFiles,
      diffStat: diffStatOut.trim(),
      hasChanges,
    }
  } catch {
    return {
      isGitRepo: false,
      modifiedFiles: [],
      untrackedFiles: [],
      diffStat: '',
      hasChanges: false,
    }
  }
}
