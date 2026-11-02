import { createContext } from 'react'

export const DEFAULT_BLACKLIST_WORDS = ['freemusic', 'promodj']

export type SettingsContextValue = {
  autoAddCovers: boolean
  autoCleanNames: boolean
  isAudioAnalysisEnabled: boolean
  blacklistWords: string[]
  setAutoAddCovers: (enabled: boolean) => void
  setAutoCleanNames: (enabled: boolean) => void
  setIsAudioAnalysisEnabled: (enabled: boolean) => void
  addBlacklistWord: (word: string) => void
  removeBlacklistWord: (word: string) => void
}

export const SettingsContext = createContext<SettingsContextValue>({
  autoAddCovers: true,
  autoCleanNames: true,
  isAudioAnalysisEnabled: false,
  blacklistWords: DEFAULT_BLACKLIST_WORDS,
  setAutoAddCovers: () => undefined,
  setAutoCleanNames: () => undefined,
  setIsAudioAnalysisEnabled: () => undefined,
  addBlacklistWord: () => undefined,
  removeBlacklistWord: () => undefined
})
