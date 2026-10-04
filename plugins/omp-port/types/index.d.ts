export type RepeatSnapshot = { turn: number; injectedAt: Record<string, number> }

declare module 'claude-code' {
  interface PluginState {
    'omp-port': {
      ttsrRepeat: RepeatSnapshot
      astGrepHinted: boolean
    }
  }
}
