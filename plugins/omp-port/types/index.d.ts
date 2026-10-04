export type RepeatSnapshot = { turn: number; injectedAt: Record<string, number> }
export type AdvisorDecision = 'accept' | 'ignore'

declare module 'claude-code' {
  interface PluginState {
    'omp-port': {
      ttsrRepeat: RepeatSnapshot
      astGrepHinted: boolean
      advisorEdits: string[]
      advisorNote: string | null
      advisorDecision: AdvisorDecision
      advisorSessionUsd: number
    }
  }
}
