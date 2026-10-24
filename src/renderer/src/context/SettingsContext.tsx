import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_BLACKLIST_WORDS,
  SettingsContext,
  type SettingsContextValue
} from '@renderer/context/settings-context'

const STORAGE_KEY = 'filtr.settings'

function readBlacklist(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_BLACKLIST_WORDS]
  const words: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    if (words.some((word) => word.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) continue
    words.push(trimmed)
  }
  return words
}

function readSettings(): Pick<
  SettingsContextValue,
  'autoAddCovers' | 'autoCleanNames' | 'blacklistWords'
> {
  const defaults = {
    autoAddCovers: true,
    autoCleanNames: true,
    blacklistWords: [...DEFAULT_BLACKLIST_WORDS]
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaults
    const record = parsed as Partial<SettingsContextValue>
    return {
      autoAddCovers: typeof record.autoAddCovers === 'boolean' ? record.autoAddCovers : true,
      autoCleanNames: typeof record.autoCleanNames === 'boolean' ? record.autoCleanNames : true,
      blacklistWords: readBlacklist(record.blacklistWords)
    }
  } catch {
    return defaults
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const stored = useMemo(() => readSettings(), [])
  const [autoAddCovers, setAutoAddCovers] = useState(stored.autoAddCovers)
  const [autoCleanNames, setAutoCleanNames] = useState(stored.autoCleanNames)
  const [blacklistWords, setBlacklistWords] = useState(stored.blacklistWords)

  const addBlacklistWord = useCallback((word: string) => {
    const trimmed = word.trim()
    if (!trimmed) return
    setBlacklistWords((current) => {
      const exists = current.some(
        (item) => item.toLocaleLowerCase() === trimmed.toLocaleLowerCase()
      )
      if (exists) return current
      return [...current, trimmed]
    })
  }, [])

  const removeBlacklistWord = useCallback((word: string) => {
    setBlacklistWords((current) => current.filter((item) => item !== word))
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ autoAddCovers, autoCleanNames, blacklistWords })
      )
    } catch {
      return
    }
  }, [autoAddCovers, autoCleanNames, blacklistWords])

  const value = useMemo(
    () => ({
      autoAddCovers,
      autoCleanNames,
      blacklistWords,
      setAutoAddCovers,
      setAutoCleanNames,
      addBlacklistWord,
      removeBlacklistWord
    }),
    [addBlacklistWord, autoAddCovers, autoCleanNames, blacklistWords, removeBlacklistWord]
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
