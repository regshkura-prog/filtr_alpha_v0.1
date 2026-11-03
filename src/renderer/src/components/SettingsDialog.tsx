import { useContext, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { SettingsContext } from '@renderer/context/settings-context'
import { IconButton } from '@renderer/components/IconButton'

function SettingToggle({
  enabled,
  label,
  onChange
}: {
  enabled: boolean
  label: string
  onChange: (enabled: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={() => onChange(!enabled)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${
        enabled ? 'bg-white' : 'bg-zinc-700'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 left-0.5 size-6 rounded-full transition duration-200 ${
          enabled ? 'translate-x-5 bg-zinc-950' : 'translate-x-0 bg-zinc-300'
        }`}
      />
    </button>
  )
}

export function SettingsDialog({
  isOpen,
  onClose
}: {
  isOpen: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const {
    autoAddCovers,
    autoCleanNames,
    isAudioAnalysisEnabled,
    blacklistWords,
    setAutoAddCovers,
    setAutoCleanNames,
    setIsAudioAnalysisEnabled,
    addBlacklistWord,
    removeBlacklistWord
  } = useContext(SettingsContext)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!isOpen) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  function addDraft(): void {
    const trimmed = draft.trim()
    if (!trimmed) return
    addBlacklistWord(trimmed)
    setDraft('')
  }

  if (!isOpen) return null

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Настройки"
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-wide text-zinc-100">Настройки</h2>
          <IconButton label="Закрыть" size="sm" onClick={onClose}>
            <X size={14} strokeWidth={1.5} />
          </IconButton>
        </div>
        <section className="flex flex-col gap-4">
          <h3 className="text-xs tracking-wide text-zinc-500">Основные настройки</h3>
          <ul className="flex flex-col gap-4">
            <li className="flex items-center justify-between gap-4">
              <span className="text-sm text-zinc-200">Авто-загрузка обложек при тегировании</span>
              <SettingToggle
                enabled={autoAddCovers}
                label="Авто-загрузка обложек при тегировании"
                onChange={setAutoAddCovers}
              />
            </li>
            <li className="flex items-center justify-between gap-4">
              <span className="text-sm text-zinc-200">Анализ ключа и BPM</span>
              <SettingToggle
                enabled={isAudioAnalysisEnabled}
                label="Анализ ключа и BPM"
                onChange={setIsAudioAnalysisEnabled}
              />
            </li>
            <li className="flex items-center justify-between gap-4">
              <span className="text-sm text-zinc-200">Авто-очистка мусора в названиях</span>
              <SettingToggle
                enabled={autoCleanNames}
                label="Авто-очистка мусора в названиях"
                onChange={setAutoCleanNames}
              />
            </li>
          </ul>
        </section>
        <div className="my-5 h-px bg-zinc-800" />
        <section className="flex flex-col gap-3">
          <h3 className="text-xs tracking-wide text-zinc-500">Словарь мусорных слов</h3>
          <input
            value={draft}
            placeholder="Введите слово или тег (например: @vippromomusic)"
            aria-label="Слово для словаря очистки"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              addDraft()
            }}
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-zinc-100 outline-none select-text placeholder:text-zinc-600 focus:border-zinc-600"
          />
          <div className="flex flex-wrap gap-2">
            {blacklistWords.map((word) => (
              <span
                key={word}
                className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
              >
                {word}
                <button
                  type="button"
                  aria-label={`Удалить ${word}`}
                  title="Удалить"
                  onClick={() => removeBlacklistWord(word)}
                  className="text-zinc-500 hover:text-zinc-100"
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
