export type RepeatSnapshot = { turn: number; injectedAt: Record<string, number> }
export type AdvisorDecision = 'accept' | 'ignore'
export type PaneTab = 'statusline' | 'ttsr' | 'rules' | 'advisor' | 'context'
export type PaneScope = 'global' | 'project'
export type PaneError = { key: string; text: string }

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
    }
  }
}
