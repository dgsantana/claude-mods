export type RepeatSnapshot = { turn: number; injectedAt: Record<string, number> }
export type AdvisorDecision = 'accept' | 'ignore'
export type PaneTab = 'statusline' | 'ttsr' | 'rules' | 'advisor' | 'context'
export type PaneScope = 'global' | 'project'
export type PaneError = { key: string; text: string }

// What the status line band shows, gathered by register.tsx each refresh.
// Every field is optional: a source that failed or has no reading leaves its
// field out and its segment is not drawn. Times are epoch milliseconds.
export type GitInfo = {
  branch: string
  dirty: boolean
  ahead: number
  behind: number
  sha: string
  staged: number
  unstaged: number
  untracked: number
}
export type RateWindow = { percentUsed: number; resetsAt?: number }
// Cost and context change over the last main-thread turn.
export type TurnDelta = { usd: number; tokens: number }
// What agent-cockpit itself did this session: TTSR rules fired, advisor spend.
export type Activity = { ttsrHits: number; advisor?: { usd: number; note: boolean } }
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
  fiveHour?: RateWindow
  sevenDay?: RateWindow
  startedAt?: number
  lastTurn?: TurnDelta
  activity?: Activity
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-cockpit': {
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
      paneFocus: string | null
      statusData: StatusData | null
      ttsrHits: number
      turnBase: TurnDelta | null
      lastTurn: TurnDelta | null
    }
  }
}
