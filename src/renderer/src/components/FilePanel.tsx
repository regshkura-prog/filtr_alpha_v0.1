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
  Gauge,
  KeyRound,
  Loader2,
  Music2,
  RefreshCw,
  Trash2,
  Tags,
  Type,
  User
} from 'lucide-react'
import type { AudioFileEntry, DirectoryEntry, PanelSide } from '../../../shared/types'
import { ENERGY_TAGS, energyTagsInName, energyTitle, type EnergyTag } from '../../../shared/energy'
import type { FileSelectMode } from '../../../shared/selection'
import { duplicatePaths, type SortConfig, type SortKey } from '../../../shared/files'
import { IconButton } from '@renderer/components/IconButton'
import { SettingsContext } from '@renderer/context/settings-context'
import { baseName } from '@renderer/lib/format'

function TrackCover({
  filePath,
  revision
}: {
  filePath: string
  revision: number
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

  if (!cover) {
    return <Music2 size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" />
  }

  return <img src={cover} alt="" className="mt-0.5 h-8 w-8 shrink-0 rounded-md object-cover" />
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
  canMove: boolean
  canGoUp: boolean
  onOpen: () => void
  onRefresh: () => void
  onEnter: (directory: DirectoryEntry) => void
  onUp: () => void
  onSelect: (file: AudioFileEntry, index: number, mode: FileSelectMode) => void
  onPrepareDrag: (file: AudioFileEntry) => string
  onKeepTrash: (file: AudioFileEntry, tokenIndex: number) => void
  onMove: (file: AudioFileEntry) => void
  onDelete: (file: AudioFileEntry) => void
  onDeleteDirectory: (directory: DirectoryEntry) => void
  onCreateDirectory: (name: string) => Promise<void>
  onRenameDirectory: (directory: DirectoryEntry, name: string) => Promise<void>
  onRenameFile: (file: AudioFileEntry, name: string) => Promise<void>
  dragSource: PanelSide | null
  onDragSourceChange: (side: PanelSide | null) => void
  onDropFile: (source: PanelSide, path: string, targetDirectory?: string) => void
  onToggleEnergy: (file: AudioFileEntry, tag: EnergyTag, embedCover: boolean) => void
  sortConfig: SortConfig
  onSort: (key: SortKey) => void
}

function TagBadge({
  label,
  value,
  selected,
  children
}: {
  label: string
  value: string
  selected: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      title={`${label}: ${value}`}
      className={`inline-flex min-w-0 max-w-36 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
        selected ? 'bg-black/10 text-black/75' : 'bg-white/8 text-white/70'
      }`}
    >
      <span className="shrink-0">{children}</span>
      <span className="min-w-0 truncate text-right">{value}</span>
    </span>
  )
}

function EnergyButton({
  tag,
  active,
  selected,
  onClick
}: {
  tag: EnergyTag
  active: boolean
  selected: boolean
  onClick: () => void
}): React.JSX.Element {
  const tone = active
    ? selected
      ? 'bg-black text-white'
      : 'bg-white text-black'
    : selected
      ? 'bg-black/10 text-black/70 hover:bg-black/15'
      : 'bg-white/8 text-white/60 hover:bg-white/14'
  return (
    <button
      type="button"
      title={tag}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={`inline-flex h-auto min-h-6 items-center rounded-sm px-2 py-1 ${tone}`}
    >
      <span className="text-[10px] leading-none">{tag}</span>
    </button>
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
    'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent'

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
      className="fixed z-40 w-52 rounded-2xl border border-white/10 bg-[#1c1d21] p-1 shadow-xl"
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
            className={`absolute z-50 w-52 rounded-2xl border border-white/10 bg-[#1c1d21] p-1 shadow-xl ${
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
    <div className="flex justify-center py-8 text-white/30">
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
  canMove,
  canGoUp,
  onOpen,
  onRefresh,
  onEnter,
  onUp,
  onSelect,
  onPrepareDrag,
  onKeepTrash,
  onMove,
  onDelete,
  onDeleteDirectory,
  onCreateDirectory,
  onRenameDirectory,
  onRenameFile,
  onToggleEnergy,
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
      className={`flex h-full min-h-0 min-w-0 flex-col rounded-[28px] border p-3 ${
        showDrop ? 'border-white/20 bg-white/5' : 'border-transparent bg-[#101113]'
      }`}
    >
      <div className="flex items-center gap-2 px-1 pb-3">
        {canGoUp && (
          <IconButton label="На уровень выше" onClick={onUp}>
            <ArrowLeft size={16} strokeWidth={1.5} />
          </IconButton>
        )}
        <IconButton label="Выбрать папку" disabled={picking} onClick={onOpen}>
          {picking ? (
            <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
          ) : (
            <FolderOpen size={16} strokeWidth={1.5} />
          )}
        </IconButton>
        <p
          className="min-w-0 flex-1 truncate text-sm text-white/70"
          title={current ?? root ?? undefined}
        >
          {current ? baseName(current) : ''}
        </p>
        <IconButton label="Обновить" disabled={!root || loading || scanning} onClick={onRefresh}>
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
              className="grid size-16 place-items-center rounded-full bg-white text-black transition hover:bg-white/90 disabled:opacity-50"
            >
              <FolderOpen size={22} strokeWidth={1.5} />
            </button>
          </div>
        ) : (
          <Virtuoso
            ref={listRef}
            className="px-1"
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
            defaultItemHeight={78}
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
                  <div className="mb-1 flex min-w-0 items-center gap-2 rounded-full px-3 py-2 text-sm text-white/90">
                    <Folder size={14} strokeWidth={1.5} className="shrink-0" />
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
                    className={`mb-1 flex min-w-0 items-center gap-2 rounded-full px-3 py-2 text-left text-sm text-white/90 ${
                      folderDrop === directory.path ? 'bg-white/10' : 'hover:bg-white/8'
                    }`}
                  >
                    <Folder size={14} strokeWidth={1.5} className="shrink-0" />
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
              const batch = selectedSet.has(file.path)
              const selected = playing && batch
              const duplicate = duplicates.has(file.path)
              const showTrash =
                autoCleanNames &&
                !file.isClean &&
                file.cleanTokens?.some((token) => token.type === 'trash')
              const activeTags = showTrash ? [] : energyTagsInName(file.name)
              const badges = [
                file.tags.artist
                  ? {
                      key: 'artist',
                      label: 'Artist',
                      value: file.tags.artist,
                      icon: <User size={8} />
                    }
                  : null,
                file.tags.title
                  ? {
                      key: 'title',
                      label: 'Title',
                      value: file.tags.title,
                      icon: <Type size={8} />
                    }
                  : null,
                file.tags.genre
                  ? {
                      key: 'genre',
                      label: 'Genre',
                      value: file.tags.genre,
                      icon: <Tags size={8} />
                    }
                  : null,
                file.tags.bpm !== null
                  ? {
                      key: 'bpm',
                      label: 'BPM',
                      value: String(file.tags.bpm),
                      icon: <Gauge size={8} />
                    }
                  : null,
                file.tags.key
                  ? { key: 'key', label: 'Key', value: file.tags.key, icon: <KeyRound size={8} /> }
                  : null
              ].filter((badge) => badge !== null)
              const rowTone =
                playing && batch
                  ? duplicate
                    ? 'bg-red-200 text-black'
                    : 'bg-white text-black'
                  : playing
                    ? duplicate
                      ? 'text-white/90 ring-1 ring-inset ring-red-200/80'
                      : 'text-white/90 ring-1 ring-inset ring-white/35'
                    : batch
                      ? duplicate
                        ? 'bg-red-400/30 text-white/90'
                        : 'bg-zinc-800/80 text-white/90'
                      : duplicate
                        ? 'bg-red-400/20 text-white/90 hover:bg-red-400/30'
                        : 'text-white/85 hover:bg-white/8'
              return (
                <div
                  aria-selected={batch}
                  draggable={!(naming?.kind === 'file' && naming.path === file.path)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setMenu({ x: event.clientX, y: event.clientY, target: { kind: 'file', file } })
                  }}
                  onDragStart={(event) => {
                    const path = onPrepareDrag(file)
                    event.dataTransfer.setData(DRAG_PATH, path)
                    event.dataTransfer.setData(DRAG_SIDE, side)
                    event.dataTransfer.effectAllowed = 'move'
                    onDragSourceChange(side)
                  }}
                  onDragEnd={() => onDragSourceChange(null)}
                  className={`mb-1 flex h-auto min-h-[4rem] min-w-0 cursor-grab flex-col rounded-3xl py-2 pr-1 active:cursor-grabbing ${rowTone}`}
                >
                  <div className="flex min-w-0 items-center">
                    {naming?.kind === 'file' && naming.path === file.path ? (
                      <div className="flex w-full min-w-0 flex-1 items-center gap-2 px-3 py-1">
                        <TrackCover filePath={file.path} revision={coverRevision} />
                        <NameInput
                          initial={file.name}
                          onCommit={(name) => onRenameFile(file, name)}
                          onCancel={() => setNaming(null)}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        title={file.name}
                        onMouseDown={(event) => {
                          if (event.shiftKey) event.preventDefault()
                        }}
                        onClick={(event) => {
                          if (event.shiftKey) {
                            onSelect(file, row.index, 'range')
                            return
                          }
                          if (event.metaKey || event.ctrlKey) {
                            onSelect(file, row.index, 'toggle')
                            return
                          }
                          onSelect(file, row.index, 'single')
                        }}
                        className="flex w-full min-w-0 flex-1 items-center gap-2 px-3 py-1 text-left"
                      >
                        <TrackCover filePath={file.path} revision={coverRevision} />
                        {showTrash ? (
                          <span className="min-w-0 w-full truncate text-sm">
                            {file.cleanTokens?.map((token, index) =>
                              token.type === 'trash' ? (
                                <span
                                  key={`${token.value}-${index}`}
                                  className="bg-red-500/30 text-red-400 line-through cursor-pointer hover:bg-red-500/50 px-1 rounded transition-colors"
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
                          <span className="min-w-0 w-full truncate text-sm">
                            {activeTags.length > 0
                              ? `${activeTags.map((tag) => `[${tag}]`).join('')} `
                              : ''}
                            {energyTitle(file.name)}
                          </span>
                        )}
                      </button>
                    )}
                    <div className="flex shrink-0 items-center">
                      <IconButton
                        label="Удалить"
                        size="xs"
                        variant="plain"
                        onClick={() => onDelete(file)}
                      >
                        <Trash2 size={12} strokeWidth={1.5} />
                      </IconButton>
                      <IconButton
                        label={side === 'left' ? 'Перенести вправо' : 'Перенести влево'}
                        size="xs"
                        variant="plain"
                        disabled={!canMove}
                        onClick={() => onMove(file)}
                      >
                        <MoveIcon size={12} strokeWidth={1.5} />
                      </IconButton>
                    </div>
                  </div>
                  <div className="mt-1 flex w-full items-center justify-between gap-4 px-3">
                    <div className="flex shrink-0 items-center gap-1">
                      {ENERGY_TAGS.map((tag) => (
                        <EnergyButton
                          key={tag}
                          tag={tag}
                          active={activeTags.includes(tag)}
                          selected={selected}
                          onClick={() => onToggleEnergy(file, tag, autoAddCovers)}
                        />
                      ))}
                    </div>
                    <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden">
                      {badges.map((badge) => (
                        <TagBadge
                          key={badge.key}
                          label={badge.label}
                          value={badge.value}
                          selected={selected}
                        >
                          {badge.icon}
                        </TagBadge>
                      ))}
                      <span
                        className={`shrink-0 truncate text-right text-[10px] uppercase tracking-wider ${selected ? 'text-black/45' : 'text-white/35'}`}
                      >
                        {file.extension}
                      </span>
                    </div>
                  </div>
                </div>
              )
            }}
          />
        )}
        {root && busy && progress > 0 && (
          <div className="pointer-events-none absolute inset-x-3 top-0 z-10 h-0.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-white/70 transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        {root && busy && (
          <div className="pointer-events-none absolute right-3 bottom-3 z-10 grid size-8 place-items-center rounded-full bg-black/50 text-white/80">
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
