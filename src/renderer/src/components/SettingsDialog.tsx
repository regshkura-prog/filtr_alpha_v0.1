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
        enabled ? 'bg-[#34C759]' : 'bg-white/20'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform duration-200 ${
          enabled ? 'translate-x-5' : 'translate-x-0'
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
    blacklistWords,
    setAutoAddCovers,
    setAutoCleanNames,
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
      className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/50 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Настройки"
        className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-[28px] bg-[#16171b] p-6 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-sm font-medium tracking-wide text-white">Настройки</h2>
          <IconButton label="Закрыть" size="sm" onClick={onClose}>
            <X size={14} strokeWidth={1.5} />
          </IconButton>
        </div>
        <section className="flex flex-col gap-4">
          <h3 className="text-xs tracking-wide text-white/45">Основные настройки</h3>
          <ul className="flex flex-col gap-4">
            <li className="flex items-center justify-between gap-4">
              <span className="text-sm text-white/85">Авто-загрузка обложек при тегировании</span>
              <SettingToggle
                enabled={autoAddCovers}
                label="Авто-загрузка обложек при тегировании"
                onChange={setAutoAddCovers}
              />
            </li>
            <li className="flex items-center justify-between gap-4">
              <span className="text-sm text-white/85">Авто-очистка мусора в названиях</span>
              <SettingToggle
                enabled={autoCleanNames}
                label="Авто-очистка мусора в названиях"
                onChange={setAutoCleanNames}
              />
            </li>
          </ul>
        </section>
        <div className="my-5 h-px bg-white/10" />
        <section className="flex flex-col gap-3">
          <h3 className="text-xs tracking-wide text-white/45">Словарь мусорных слов</h3>
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
            className="w-full rounded-full bg-white/8 px-4 py-2 text-sm text-white outline-none select-text placeholder:text-white/35"
          />
          <div className="flex flex-wrap gap-2">
            {blacklistWords.map((word) => (
              <span
                key={word}
                className="inline-flex items-center gap-1 bg-zinc-700/50 hover:bg-zinc-700 text-xs px-2 py-1 rounded transition-colors"
              >
                {word}
                <button
                  type="button"
                  aria-label={`Удалить ${word}`}
                  title="Удалить"
                  onClick={() => removeBlacklistWord(word)}
                  className="text-white/60 hover:text-white"
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
