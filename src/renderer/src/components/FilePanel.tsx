import { useContext, useEffect, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  Music2,
  RefreshCw,
  Trash2,
  Volume2
} from 'lucide-react'
import type { AudioFileEntry, DirectoryEntry, PanelSide } from '../../../shared/types'
import { ENERGY_TAGS, energyTagsInName, energyTitle, type EnergyTag } from '../../../shared/energy'
import { statusForLoudness } from '../../../shared/loudness'
import type { FileSelectMode } from '../../../shared/selection'
import { duplicatePaths, type SortConfig, type SortKey } from '../../../shared/files'
import { IconButton } from '@renderer/components/IconButton'
import { SettingsContext } from '@renderer/context/settings-context'
import { baseName } from '@renderer/lib/format'

function TrackCover({
  filePath,
  revision,
  playing = false
}: {
  filePath: string
  revision: number
  playing?: boolean
}): React.JSX.Element {
  const [cover, setCover] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const api = window.api
    if (!api) return
    void api
      .getAudioCover(filePath)
      .then((value) => {
        if (active) setCover(value)
      })
      .catch(() => {
        if (active) setCover(null)
      })
    return () => {
      active = false
    }
  }, [filePath, revision])

  return (
    <span className="relative grid size-10 shrink-0 place-items-center overflow-visible rounded-md bg-zinc-800/70 text-zinc-500">
      {cover ? (
        <img src={cover} alt="" className="size-10 rounded-md object-cover" />
      ) : (
        <Music2 size={14} strokeWidth={1.5} />
      )}
      {playing && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-white ring-2 ring-surface"
        />
      )}
    </span>
  )
}

const DRAG_PATH = 'application/x-filtr-path'
const DRAG_SIDE = 'application/x-filtr-side'

type FilePanelProps = {
  side: PanelSide
  root: string | null
  current: string | null
  directories: DirectoryEntry[]
  files: AudioFileEntry[]
  loading: boolean
  scanning: boolean
  totalFiles: number
  picking: boolean
  selectedPath: string | null
  selectedPaths: string[]
  coverRevision: number
  pendingTagPaths: string[]
  canMove: boolean
  canGoUp: boolean
  onOpen: () => void
  onRefresh: () => void
  onEnter: (directory: DirectoryEntry) => void
  onUp: () => void
  onSelect: (file: AudioFileEntry, index: number, mode: FileSelectMode) => void
  onKeepTrash: (file: AudioFileEntry, tokenIndex: number) => void
  onMove: (file: AudioFileEntry) => void
  onDelete: (file: AudioFileEntry) => void
  onDeleteDirectory: (directory: DirectoryEntry) => void
  onCreateDirectory: (name: string) => Promise<void>
  onRenameDirectory: (directory: DirectoryEntry, name: string) => Promise<void>
  onRenameFile: (file: AudioFileEntry, name: string) => Promise<void>
  onToggleEnergy: (file: AudioFileEntry, tag: EnergyTag, embedCover: boolean) => void
  onLoudnessNormalized: (filePath: string) => void
  dragSource: PanelSide | null
  onDragSourceChange: (side: PanelSide | null) => void
  onDropFile: (source: PanelSide, path: string, targetDirectory?: string) => void
  sortConfig: SortConfig
  onSort: (key: SortKey) => void
}

function MetaValue({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <span title={`${label}: ${value}`} className="flex shrink-0 items-baseline gap-1">
      <span className="text-[10px] tracking-wider text-zinc-600 uppercase">{label}</span>
      <span className="text-xs text-zinc-300 tabular-nums">{value}</span>
    </span>
  )
}

function EnergyButton({
  tag,
  active,
  onClick
}: {
  tag: EnergyTag
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const tone = active
    ? 'bg-white text-zinc-950'
    : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
  return (
    <button
      type="button"
      title={tag}
      aria-pressed={active}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={`inline-flex h-7 items-center rounded-md px-2.5 text-[11px] font-medium tracking-wide transition-colors ${tone}`}
    >
      {tag}
    </button>
  )
}

type AnalysisStatus = 'idle' | 'analyzing' | 'low_volume' | 'ok'

function formatGain(value: number): string {
  const text = value.toFixed(1)
  return `${value > 0 ? '+' : ''}${text} dB`
}

function LoudnessControl({
  status,
  normalizing,
  note,
  onNormalize,
  onManualVolume
}: {
  status: AnalysisStatus
  normalizing: boolean
  note: string | null
  onNormalize: () => void
  onManualVolume: (gain: number) => Promise<void>
}): React.JSX.Element {
  const anchorRef = useRef<HTMLDivElement>(null)
  const [isVolumeSliderOpen, setIsVolumeSliderOpen] = useState(false)
  const [gain, setGain] = useState(0)
  const [applying, setApplying] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const busy = normalizing || applying || status === 'analyzing'
  const quiet = status === 'low_volume'
  const isOpen = isVolumeSliderOpen && !busy && !quiet

  useEffect(() => {
    if (!isOpen) return
    const item = anchorRef.current?.closest('[data-index]')
    if (!(item instanceof HTMLElement)) return
    const previous = item.style.zIndex
    item.style.zIndex = '40'
    return () => {
      item.style.zIndex = previous
    }
  }, [isOpen])

  async function applyGain(): Promise<void> {
    const next = gain
    setIsVolumeSliderOpen(false)
    setApplying(true)
    setManualError(null)
    try {
      await onManualVolume(next)
    } catch (error) {
      setManualError(error instanceof Error ? error.message : 'Не удалось изменить громкость')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div ref={anchorRef} className="relative">
      {busy ? (
        <IconButton label="Анализ громкости" size="sm" variant="plain">
          <Loader2 size={14} strokeWidth={1.5} className="animate-spin text-zinc-500" />
        </IconButton>
      ) : (
        <IconButton
          label={quiet ? 'Нормализовать громкость' : 'Ручная громкость'}
          size="sm"
          variant="plain"
          className="group"
          title={
            manualError ??
            note ??
            (quiet ? 'Тихий трек. Нормализовать до -9 LUFS' : 'Ручная громкость')
          }
          onClick={() => {
            if (quiet) {
              setIsVolumeSliderOpen(false)
              onNormalize()
              return
            }
            setGain(0)
            setIsVolumeSliderOpen((open) => !open)
          }}
        >
          <Volume2
            size={14}
            strokeWidth={1.5}
            className={quiet ? 'text-red-400' : 'text-zinc-500 group-hover:text-zinc-200'}
          />
        </IconButton>
      )}
      {isOpen ? (
        <div
          className="pointer-events-auto absolute right-0 bottom-full z-50 mb-1 rounded-xl border border-line bg-surface p-3"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <p className="mb-2 text-center text-[11px] text-zinc-300 tabular-nums">
            {formatGain(gain)}
          </p>
          <input
            aria-label="Сдвиг громкости"
            type="range"
            min="-6"
            max="6"
            step="0.5"
            defaultValue="0"
            onChange={(event) => setGain(Number(event.currentTarget.value))}
          />
          <button
            type="button"
            className="mt-3 w-full rounded-md bg-white px-2 py-1.5 text-[11px] font-medium text-zinc-950 hover:bg-zinc-200"
            onClick={() => void applyGain()}
          >
            Применить
          </button>
        </div>
      ) : null}
    </div>
  )
}

function NameInput({
  initial,
  submitUnchanged = false,
  onCommit,
  onCancel
}: {
  initial: string
  submitUnchanged?: boolean
  onCommit: (value: string) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  async function finish(nextValue: string): Promise<void> {
    if (done.current) return
    const next = nextValue.trim()
    if (!next || (!submitUnchanged && next === initial.trim())) {
      done.current = true
      onCancel()
      return
    }
    done.current = true
    try {
      await onCommit(next)
      onCancel()
    } catch {
      done.current = false
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      autoFocus
      value={value}
      aria-label="Название"
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          void finish(value)
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          done.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        void finish(value)
      }}
      className="min-w-0 flex-1 border-b border-current bg-transparent text-sm text-current outline-none"
    />
  )
}

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'name', label: 'Имя' },
  { key: 'type', label: 'Тип' },
  { key: 'dateAdded', label: 'Дата добавления' },
  { key: 'dateCreated', label: 'Дата создания' }
]

function ContextMenu({
  x,
  y,
  canMutate,
  sortConfig,
  onSort,
  onCreate,
  onRename,
  onDelete,
  onClose
}: {
  x: number
  y: number
  canMutate: boolean
  sortConfig: SortConfig
  onSort: (key: SortKey) => void
  onCreate: () => void
  onRename: () => void
  onDelete: () => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [sortOpen, setSortOpen] = useState(false)
  const left = Math.max(8, Math.min(x, window.innerWidth - 216))
  const top = Math.max(8, Math.min(y, window.innerHeight - 188))
  const openLeft = left + 416 > window.innerWidth
  const openUp = top + 320 > window.innerHeight
  const itemClass =
    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/5 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent'

  useEffect(() => {
    function onPointer(event: MouseEvent): void {
      if (ref.current?.contains(event.target as Node)) return
      onClose()
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left, top }}
      className="fixed z-40 w-52 rounded-xl border border-line bg-surface p-1 shadow-lg shadow-black/30"
    >
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onMouseEnter={() => setSortOpen(false)}
        onClick={onCreate}
      >
        Создать папку
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        disabled={!canMutate}
        onMouseEnter={() => setSortOpen(false)}
        onClick={onRename}
      >
        Переименовать
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        disabled={!canMutate}
        onMouseEnter={() => setSortOpen(false)}
        onClick={onDelete}
      >
        Удалить
      </button>
      <div
        className="relative"
        onMouseEnter={() => setSortOpen(true)}
        onMouseLeave={() => setSortOpen(false)}
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={sortOpen}
          className={itemClass}
          onClick={() => setSortOpen((open) => !open)}
        >
          <span className="flex-1">Сортировать по...</span>
          <ChevronRight size={14} className={openLeft ? 'rotate-180' : undefined} />
        </button>
        {sortOpen && (
          <div
            role="menu"
            className={`absolute z-50 w-52 rounded-xl border border-line bg-surface p-1 shadow-lg shadow-black/30 ${
              openLeft ? 'right-full -mr-1' : 'left-full -ml-1'
            } ${openUp ? 'bottom-0' : 'top-0'}`}
          >
            {SORT_OPTIONS.map((option) => {
              const active = sortConfig.key === option.key
              return (
                <button
                  key={option.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={itemClass}
                  onClick={() => {
                    onSort(option.key)
                    onClose()
                  }}
                >
                  <span className="grid w-4 place-items-center">
                    {active && <Check size={14} />}
                  </span>
                  <span className="flex-1">{option.label}</span>
                  {active &&
                    (sortConfig.direction === 'asc' ? (
                      <ArrowUp size={14} />
                    ) : (
                      <ArrowDown size={14} />
                    ))}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyFolder(): React.JSX.Element {
  return (
    <div className="flex justify-center py-8 text-zinc-700">
      <Music2 size={18} strokeWidth={1.5} />
    </div>
  )
}

export function FilePanel({
  side,
  root,
  current,
  directories,
  files,
  loading,
  scanning,
  totalFiles,
  picking,
  selectedPath,
  selectedPaths,
  coverRevision,
  pendingTagPaths,
  canMove,
  canGoUp,
  onOpen,
  onRefresh,
  onEnter,
  onUp,
  onSelect,
  onKeepTrash,
  onMove,
  onDelete,
  onDeleteDirectory,
  onCreateDirectory,
  onRenameDirectory,
  onRenameFile,
  onToggleEnergy,
  onLoudnessNormalized,
  dragSource,
  onDragSourceChange,
  onDropFile,
  sortConfig,
  onSort
}: FilePanelProps): React.JSX.Element {
  const { autoAddCovers, autoCleanNames } = useContext(SettingsContext)
  const duplicates = duplicatePaths(files)
  const MoveIcon = side === 'left' ? ArrowRight : ArrowLeft
  const busy = loading || scanning
  const listRef = useRef<VirtuosoHandle>(null)
  const followedPath = useRef<string | null>(null)
  const selectedSet = new Set(selectedPaths)
  const [hover, setHover] = useState(false)
  const [folderDrop, setFolderDrop] = useState<string | null>(null)
  const [menu, setMenu] = useState<{
    x: number
    y: number
    target:
      | { kind: 'file'; file: AudioFileEntry }
      | { kind: 'directory'; directory: DirectoryEntry }
      | null
  } | null>(null)
  const [naming, setNaming] = useState<
    { kind: 'create' } | { kind: 'file'; path: string } | { kind: 'directory'; path: string } | null
  >(null)
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle')
  const [isNormalizing, setIsNormalizing] = useState(false)
  const [analysisPath, setAnalysisPath] = useState<string | null>(null)
  const [normalizeError, setNormalizeError] = useState<string | null>(null)
  const analysisTicket = useRef(0)

  useEffect(() => {
    if (!selectedPath) return
    const path = selectedPath
    const api = window.api
    if (!api) return
    const ticket = ++analysisTicket.current
    let active = true
    void api.analyzeAudio(path).then(
      (lufs) => {
        if (!active || ticket !== analysisTicket.current) return
        setAnalysisPath(path)
        setAnalysisStatus(statusForLoudness(lufs))
        setNormalizeError(null)
      },
      () => {
        if (!active || ticket !== analysisTicket.current) return
        setAnalysisPath(path)
        setAnalysisStatus('idle')
      }
    )
    return () => {
      active = false
    }
  }, [selectedPath])

  async function normalizeLoudness(path: string): Promise<void> {
    if (isNormalizing || analysisPath !== path || analysisStatus !== 'low_volume') return
    const api = window.api
    if (!api) return
    const ticket = analysisTicket.current
    setIsNormalizing(true)
    setNormalizeError(null)
    try {
      await api.normalizeAudio(path)
      if (ticket === analysisTicket.current) {
        setAnalysisPath(path)
        setAnalysisStatus('ok')
      }
      onLoudnessNormalized(path)
    } catch (error) {
      if (ticket === analysisTicket.current) {
        setAnalysisPath(path)
        setAnalysisStatus('low_volume')
        setNormalizeError(
          error instanceof Error ? error.message : 'Не удалось нормализовать громкость'
        )
      }
    } finally {
      setIsNormalizing(false)
    }
  }

  async function adjustLoudness(path: string, gain: number): Promise<void> {
    const api = window.api
    if (!api) throw new Error('Файловая библиотека доступна в окне Electron')
    await api.manualVolume(path, gain)
    if (gain !== 0) onLoudnessNormalized(path)
  }

  useEffect(() => {
    if (naming?.kind !== 'create') return
    listRef.current?.scrollToIndex({ index: 0, align: 'start' })
  }, [naming])
  const showEmpty =
    !busy && files.length === 0 && directories.length === 0 && naming?.kind !== 'create'
  useEffect(() => {
    if (!selectedPath) return
    const fileIndex = files.findIndex((file) => file.path === selectedPath)
    if (fileIndex < 0) return
    if (followedPath.current === selectedPath) return
    followedPath.current = selectedPath
    const offset = (naming?.kind === 'create' ? 1 : 0) + directories.length + (showEmpty ? 1 : 0)
    listRef.current?.scrollIntoView({ index: offset + fileIndex })
  }, [directories.length, files, naming, selectedPath, showEmpty])
  const progress =
    scanning && totalFiles > 0 ? Math.min(100, Math.round((files.length / totalFiles) * 100)) : 0
  const [seenDragSource, setSeenDragSource] = useState(dragSource)
  if (dragSource !== seenDragSource) {
    setSeenDragSource(dragSource)
    if (!dragSource) {
      setHover(false)
      setFolderDrop(null)
    }
  }
  const showDrop = hover && dragSource !== null && dragSource !== side && Boolean(root)

  function onDragEnter(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setHover(true)
  }

  function onDragOver(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    const accepts = dragSource !== null && dragSource !== side && Boolean(root)
    event.dataTransfer.dropEffect = accepts ? 'move' : 'none'
  }

  function onDragLeave(event: React.DragEvent<HTMLDivElement>): void {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    setHover(false)
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setHover(false)
    const source = event.dataTransfer.getData(DRAG_SIDE)
    const path = event.dataTransfer.getData(DRAG_PATH)
    onDragSourceChange(null)
    if ((source !== 'left' && source !== 'right') || source === side || !path || !root) return
    onDropFile(source, path)
  }

  return (
    <section
      className={`flex h-full min-h-0 min-w-0 flex-col rounded-2xl p-2 transition-colors ${
        showDrop ? 'bg-zinc-800/70' : 'bg-surface'
      }`}
    >
      <div className="flex items-center gap-1 px-1 pt-0.5 pb-2">
        {canGoUp && (
          <IconButton label="На уровень выше" size="sm" onClick={onUp}>
            <ArrowLeft size={16} strokeWidth={1.5} />
          </IconButton>
        )}
        <IconButton label="Выбрать папку" size="sm" disabled={picking} onClick={onOpen}>
          {picking ? (
            <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
          ) : (
            <FolderOpen size={16} strokeWidth={1.5} />
          )}
        </IconButton>
        <p
          className="ml-1 min-w-0 flex-1 truncate text-sm font-medium text-zinc-200"
          title={current ?? root ?? undefined}
        >
          {current ? baseName(current) : ''}
        </p>
        <IconButton
          label="Обновить"
          size="sm"
          disabled={!root || loading || scanning}
          onClick={onRefresh}
        >
          <RefreshCw
            size={15}
            strokeWidth={1.5}
            className={loading || scanning ? 'animate-spin' : ''}
          />
        </IconButton>
      </div>

      <div
        className="relative min-h-0 flex-1"
        onContextMenu={(event) => {
          if (!root) return
          event.preventDefault()
          setMenu({ x: event.clientX, y: event.clientY, target: null })
        }}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {!root ? (
          <div className="flex h-full items-center justify-center">
            <button
              type="button"
              aria-label="Выбрать папку"
              title="Выбрать папку"
              disabled={picking}
              onClick={onOpen}
              className="grid size-16 place-items-center rounded-full bg-white text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-50"
            >
              <FolderOpen size={22} strokeWidth={1.5} />
            </button>
          </div>
        ) : (
          <Virtuoso
            ref={listRef}
            style={{ position: 'absolute', inset: 0 }}
            data={[
              ...(naming?.kind === 'create' ? [{ kind: 'create' as const }] : []),
              ...directories.map((directory) => ({ kind: 'directory' as const, directory })),
              ...(showEmpty ? [{ kind: 'empty' as const }] : []),
              ...files.map((file, index) => ({ kind: 'file' as const, file, index }))
            ]}
            isScrolling={(scrolling) => {
              if (scrolling) setMenu(null)
            }}
            defaultItemHeight={72}
            increaseViewportBy={{ top: 240, bottom: 480 }}
            computeItemKey={(_index, row) => {
              if (row.kind === 'create') return 'create'
              if (row.kind === 'empty') return 'empty'
              if (row.kind === 'directory') return row.directory.path
              return row.file.path
            }}
            itemContent={(_index, row) => {
              if (row.kind === 'create') {
                return (
                  <div className="mb-0.5 flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-zinc-200">
                    <Folder size={16} strokeWidth={1.5} className="shrink-0 text-zinc-500" />
                    <NameInput
                      initial="Новая папка"
                      submitUnchanged
                      onCommit={onCreateDirectory}
                      onCancel={() => setNaming(null)}
                    />
                  </div>
                )
              }
              if (row.kind === 'empty') return <EmptyFolder />
              if (row.kind === 'directory') {
                const directory = row.directory
                const renaming = naming?.kind === 'directory' && naming.path === directory.path
                return (
                  <div
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setMenu({
                        x: event.clientX,
                        y: event.clientY,
                        target: { kind: 'directory', directory }
                      })
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      if (!dragSource) return
                      setFolderDrop(directory.path)
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      event.dataTransfer.dropEffect = dragSource ? 'move' : 'none'
                    }}
                    onDragLeave={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      const next = event.relatedTarget
                      if (next instanceof Node && event.currentTarget.contains(next)) return
                      setFolderDrop((currentPath) =>
                        currentPath === directory.path ? null : currentPath
                      )
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setFolderDrop(null)
                      const source = event.dataTransfer.getData(DRAG_SIDE)
                      const path = event.dataTransfer.getData(DRAG_PATH)
                      onDragSourceChange(null)
                      if ((source !== 'left' && source !== 'right') || !path) return
                      onDropFile(source, path, directory.path)
                    }}
                    className={`mb-0.5 flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-zinc-300 transition-colors ${
                      folderDrop === directory.path ? 'bg-raised text-zinc-100' : 'hover:bg-white/5'
                    }`}
                  >
                    <Folder size={16} strokeWidth={1.5} className="shrink-0 text-zinc-500" />
                    {renaming ? (
                      <NameInput
                        initial={directory.name}
                        onCommit={(name) => onRenameDirectory(directory, name)}
                        onCancel={() => setNaming(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        title={directory.name}
                        onClick={() => onEnter(directory)}
                        className="min-w-0 flex-1 truncate text-left"
                      >
                        {directory.name}
                      </button>
                    )}
                  </div>
                )
              }
              const file = row.file
              const playing = file.path === selectedPath
              const tagPending = pendingTagPaths.includes(file.path)
              const batch = selectedSet.has(file.path)
              const duplicate = duplicates.has(file.path)
              const showTrash =
                autoCleanNames &&
                !file.isClean &&
                file.cleanTokens?.some((token) => token.type === 'trash')
              const activeTags = showTrash ? [] : energyTagsInName(file.name)
              // Artist, title and genre repeat the filename, so they live in the tooltip.
              const tooltip = [
                file.name,
                file.tags.artist ? `Artist: ${file.tags.artist}` : null,
                file.tags.title ? `Title: ${file.tags.title}` : null,
                file.tags.genre ? `Genre: ${file.tags.genre}` : null
              ]
                .filter((line) => line !== null)
                .join('\n')
              const rowTone = batch
                ? duplicate
                  ? 'bg-red-500/15 text-zinc-100 before:bg-red-400'
                  : 'bg-raised text-zinc-100 before:bg-white'
                : duplicate
                  ? 'bg-red-500/10 text-zinc-200 hover:bg-red-500/15 before:bg-transparent'
                  : 'text-zinc-200 hover:bg-white/5 before:bg-transparent'
              const actionsTone =
                batch || playing
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
              const select = (event: React.MouseEvent): void => {
                if (event.shiftKey) {
                  onSelect(file, row.index, 'range')
                  return
                }
                if (event.metaKey || event.ctrlKey) {
                  onSelect(file, row.index, 'toggle')
                  return
                }
                onSelect(file, row.index, 'single')
              }
              const preventShiftSelection = (event: React.MouseEvent): void => {
                if (event.shiftKey) event.preventDefault()
              }
              return (
                <div
                  aria-selected={batch}
                  aria-busy={tagPending}
                  draggable={!(naming?.kind === 'file' && naming.path === file.path)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setMenu({ x: event.clientX, y: event.clientY, target: { kind: 'file', file } })
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_PATH, file.path)
                    event.dataTransfer.setData(DRAG_SIDE, side)
                    event.dataTransfer.effectAllowed = 'move'
                    onDragSourceChange(side)
                  }}
                  onDragEnd={() => onDragSourceChange(null)}
                  className={`group relative mb-0.5 flex min-w-0 cursor-grab items-center gap-3 rounded-xl py-2 pr-1.5 pl-3 transition-colors before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:content-[''] active:cursor-grabbing ${rowTone}`}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    onMouseDown={preventShiftSelection}
                    onClick={select}
                    className="shrink-0"
                  >
                    <TrackCover filePath={file.path} revision={coverRevision} playing={playing} />
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 items-center gap-1">
                      {naming?.kind === 'file' && naming.path === file.path ? (
                        <div className="flex w-full min-w-0 flex-1 items-center py-1">
                          <NameInput
                            initial={file.name}
                            onCommit={(name) => onRenameFile(file, name)}
                            onCancel={() => setNaming(null)}
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          title={tooltip}
                          onMouseDown={preventShiftSelection}
                          onClick={select}
                          className={`flex w-full min-w-0 flex-1 items-center py-1 text-left text-sm ${
                            playing ? 'font-medium text-white' : ''
                          }`}
                        >
                          {tagPending ? (
                            <span className="flex min-w-0 w-full items-center gap-2">
                              <Loader2
                                size={14}
                                strokeWidth={1.5}
                                className="shrink-0 animate-spin text-zinc-500"
                              />
                              <span className="min-w-0 truncate">{file.stem}</span>
                            </span>
                          ) : showTrash ? (
                            <span className="min-w-0 w-full truncate">
                              {file.cleanTokens?.map((token, index) =>
                                token.type === 'trash' ? (
                                  <span
                                    key={`${token.value}-${index}`}
                                    className="cursor-pointer rounded bg-red-500/15 px-1 text-red-300 line-through decoration-red-400/70 transition-colors hover:bg-red-500/25"
                                    onMouseDown={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                    }}
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      onKeepTrash(file, index)
                                    }}
                                  >
                                    {token.value}
                                  </span>
                                ) : (
                                  <span key={`${token.value}-${index}`}>{token.value}</span>
                                )
                              )}
                            </span>
                          ) : (
                            <span className="min-w-0 w-full truncate">
                              {/^\[[^\]]+\]\d/.test(file.stem)
                                ? file.stem
                                : `${
                                    activeTags.length > 0
                                      ? `${activeTags.map((tag) => `[${tag}]`).join('')} `
                                      : ''
                                  }${energyTitle(file.name)}`}
                            </span>
                          )}
                        </button>
                      )}
                      <div
                        className={`flex shrink-0 items-center text-zinc-500 transition-opacity ${actionsTone}`}
                      >
                        <LoudnessControl
                          key={file.path}
                          status={
                            file.path !== selectedPath
                              ? 'idle'
                              : analysisPath === file.path
                                ? analysisStatus
                                : 'analyzing'
                          }
                          normalizing={isNormalizing && analysisPath === file.path}
                          note={analysisPath === file.path ? normalizeError : null}
                          onNormalize={() => void normalizeLoudness(file.path)}
                          onManualVolume={(gain) => adjustLoudness(file.path, gain)}
                        />
                        <IconButton
                          label="Удалить"
                          size="sm"
                          variant="plain"
                          className="hover:text-zinc-100"
                          onClick={() => onDelete(file)}
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                        </IconButton>
                        <IconButton
                          label={side === 'left' ? 'Перенести вправо' : 'Перенести влево'}
                          size="sm"
                          variant="plain"
                          className="hover:text-zinc-100"
                          disabled={!canMove}
                          onClick={() => onMove(file)}
                        >
                          <MoveIcon size={14} strokeWidth={1.5} />
                        </IconButton>
                      </div>
                    </div>
                    <div className="flex w-full items-center justify-between gap-4 pr-1.5">
                      <div className="-ml-2.5 flex shrink-0 items-center gap-0.5">
                        {ENERGY_TAGS.map((tag) => (
                          <EnergyButton
                            key={tag}
                            tag={tag}
                            active={activeTags.includes(tag)}
                            onClick={() => onToggleEnergy(file, tag, autoAddCovers)}
                          />
                        ))}
                      </div>
                      <div className="flex min-w-0 flex-1 items-center justify-end gap-3 overflow-hidden">
                        {file.tags.bpm !== null && (
                          <MetaValue label="BPM" value={String(Math.round(file.tags.bpm))} />
                        )}
                        {file.tags.key && <MetaValue label="Key" value={file.tags.key} />}
                        {file.extension !== 'mp3' && (
                          <span className="shrink-0 text-[10px] tracking-wider text-zinc-600 uppercase">
                            {file.extension}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            }}
          />
        )}
        {root && busy && progress > 0 && (
          <div className="pointer-events-none absolute inset-x-3 top-0 z-10 h-0.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full bg-white/70 transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        {root && busy && (
          <div className="pointer-events-none absolute right-3 bottom-3 z-10 grid size-8 place-items-center rounded-full bg-zinc-800/90 text-zinc-300">
            <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
            <span className="sr-only">Загрузка папки</span>
          </div>
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          canMutate={menu.target !== null}
          sortConfig={sortConfig}
          onSort={onSort}
          onClose={() => setMenu(null)}
          onCreate={() => {
            setMenu(null)
            setNaming({ kind: 'create' })
          }}
          onRename={() => {
            const target = menu.target
            setMenu(null)
            if (!target) return
            setNaming(
              target.kind === 'file'
                ? { kind: 'file', path: target.file.path }
                : { kind: 'directory', path: target.directory.path }
            )
          }}
          onDelete={() => {
            const target = menu.target
            setMenu(null)
            if (!target) return
            if (target.kind === 'file') onDelete(target.file)
            else onDeleteDirectory(target.directory)
          }}
        />
      )}
    </section>
  )
}
