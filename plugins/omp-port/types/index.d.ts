export type RepeatSnapshot = { turn: number; injectedAt: Record<string, number> }
export type AdvisorDecision = 'accept' | 'ignore'
export type PaneTab = 'statusline' | 'ttsr' | 'rules' | 'advisor' | 'context'
export type PaneScope = 'global' | 'project'
export type PaneError = { key: string; text: string }

// What the status line band shows, gathered by register.tsx each refresh.
// Every field is optional: a source that failed or has no reading leaves its
// field out and its segment is not drawn. Times are epoch milliseconds.
export type GitInfo = { branch: string; dirty: boolean; ahead: number; behind: number }
export type Caveman = { mode: string; savings?: string }
export type StatusData = {
  model?: string
  cwd?: string
  home?: string
  git?: GitInfo
  caveman?: Caveman
  tokens?: number
  percent?: number
  window?: number
  usd?: number
  fiveHour?: { percentUsed: number; resetsAt?: number }
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'omp-port': {
      ttsrRepeat: RepeatSnapshot
      astGrepHinted: boolean
      advisorEdits: string[]
      advisorNote: string | null
      advisorDecision: AdvisorDecision
      advisorSessionUsd: number
      advisorLastError: string | null
      advisorEstimatedFor: string | null
      paneTab: PaneTab
      paneScope: PaneScope
      paneError: PaneError | null
      paneThemeGroup: string | null
      statusData: StatusData | null
    }
  }
}
