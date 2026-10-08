import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { AudioFileEntry, TagEdit } from '../../../shared/types'
import { ENERGY_TAGS, energyTagsInName, type EnergyTag } from '../../../shared/energy'
import { IconButton } from '@renderer/components/IconButton'
import { fileStem } from '@renderer/lib/format'

type TagEditorProps = {
  file: AudioFileEntry
  onClose: () => void
  onSave: (nextName: string, tags: TagEdit) => Promise<void>
  onToggleEnergy: (tag: EnergyTag) => void
}

function Field({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-2 text-xs text-white/45">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-full bg-white/8 px-4 py-2.5 text-sm text-white outline-none select-text"
      />
    </label>
  )
}

export function TagEditor({
  file,
  onClose,
  onSave,
  onToggleEnergy
}: TagEditorProps): React.JSX.Element {
  const [stem, setStem] = useState(fileStem(file.name))
  const [title, setTitle] = useState(file.tags.title ?? '')
  const [artist, setArtist] = useState(file.tags.artist ?? '')
  const [genre, setGenre] = useState(file.tags.genre ?? '')
  const [bpm, setBpm] = useState(file.tags.bpm !== null ? String(file.tags.bpm) : '')
  const [saving, setSaving] = useState(false)
  const [stemPath, setStemPath] = useState(file.path)
  const activeTags = energyTagsInName(file.name)
  if (file.path !== stemPath) {
    setStemPath(file.path)
    setStem(fileStem(file.name))
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.code === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 p-6">
      <form
        className="flex w-full max-w-md flex-col gap-4 rounded-[28px] bg-[#16171b] p-6"
        onSubmit={(event) => {
          event.preventDefault()
          if (!stem.trim() || saving) return
          setSaving(true)
          void onSave(`${stem.trim()}.${file.extension}`, { title, artist, genre, bpm }).finally(
            () => setSaving(false)
          )
        }}
      >
        <div className="flex items-center justify-end gap-2">
          <IconButton label="Закрыть" size="sm" type="button" onClick={onClose}>
            <X size={14} strokeWidth={1.5} />
          </IconButton>
          <IconButton
            label="Сохранить"
            size="sm"
            type="submit"
            variant="solid"
            disabled={saving || !stem.trim()}
          >
            <Check size={14} strokeWidth={1.5} />
          </IconButton>
        </div>
        <div className="flex flex-wrap gap-1">
          {ENERGY_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => onToggleEnergy(tag)}
              className={`rounded-full px-3 py-1 text-[10px] tracking-wide ${
                activeTags.includes(tag) ? 'bg-white text-black' : 'bg-white/8 text-white/70'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
        <Field label="Файл" value={stem} onChange={setStem} />
        <Field label="Title" value={title} onChange={setTitle} />
        <Field label="Artist" value={artist} onChange={setArtist} />
        <Field label="Genre" value={genre} onChange={setGenre} />
        <Field label="BPM" value={bpm} onChange={setBpm} />
      </form>
    </div>
  )
}
