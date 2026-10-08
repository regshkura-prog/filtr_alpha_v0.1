import { useEffect, useRef, useState } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import {
  ArrowLeft,
  ArrowRight,
  Folder,
  FolderOpen,
  Gauge,
  KeyRound,
  Image as ImageIcon,
  Loader2,
  Music2,
  Pencil,
  RefreshCw,
  Trash2,
  Tags,
  Type,
  User
} from 'lucide-react'
import type { AudioFileEntry, DirectoryEntry, PanelSide } from '../../../shared/types'
import { ENERGY_TAGS, energyTagsInName, energyTitle, type EnergyTag } from '../../../shared/energy'
import { duplicatePaths } from '../../../shared/files'
import { IconButton } from '@renderer/components/IconButton'
import { baseName } from '@renderer/lib/format'

function TrackCover({ filePath }: { filePath: string }): React.JSX.Element {
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
  }, [filePath])

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
  canMove: boolean
  canGoUp: boolean
  onOpen: () => void
  onRefresh: () => void
  onApplyCovers?: () => void
  applyingCovers?: boolean
  autoCovers?: boolean
  onAutoCoversChange?: (enabled: boolean) => void
  onSyncTitles?: () => void
  syncingTitles?: boolean
  onEnter: (directory: DirectoryEntry) => void
  onUp: () => void
  onPlay: (file: AudioFileEntry) => void
  onEdit: (file: AudioFileEntry) => void
  onMove: (file: AudioFileEntry) => void
  onDelete: (file: AudioFileEntry) => void
  onDeleteDirectory: (directory: DirectoryEntry) => void
  onCreateDirectory: (name: string) => Promise<void>
  onRenameDirectory: (directory: DirectoryEntry, name: string) => Promise<void>
  onRenameFile: (file: AudioFileEntry, name: string) => Promise<void>
  dragSource: PanelSide | null
  onDragSourceChange: (side: PanelSide | null) => void
  onDropFile: (source: PanelSide, path: string, targetDirectory?: string) => void
  onToggleEnergy: (file: AudioFileEntry, tag: EnergyTag) => void
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
      className={`inline-flex max-w-36 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
        selected ? 'bg-black/10 text-black/75' : 'bg-white/8 text-white/70'
      }`}
    >
      {children}
      <span className="truncate">{value}</span>
    </span>
  )
}

function CoverSwitch({
  enabled,
  onChange
}: {
  enabled: boolean
  onChange: (enabled: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Включить/отключить вшивание обложек"
      title="Включить/отключить вшивание обложек"
      onClick={() => onChange(!enabled)}
      className={`w-11 h-6 rounded-full relative shrink-0 cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 ${
        enabled ? 'bg-zinc-600' : 'bg-zinc-300'
      }`}
    >
      <span
        aria-hidden="true"
        className={`w-5 h-5 bg-white rounded-full absolute top-0.5 left-0 block shadow-sm transition-transform duration-200 ${
          enabled ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
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
      className={`rounded-full px-2 py-0.5 text-xs leading-none ${tone}`}
    >
      {tag}
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

function ContextMenu({
  x,
  y,
  canMutate,
  onCreate,
  onRename,
  onDelete,
  onClose
}: {
  x: number
  y: number
  canMutate: boolean
  onCreate: () => void
  onRename: () => void
  onDelete: () => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const left = Math.max(8, Math.min(x, window.innerWidth - 188))
  const top = Math.max(8, Math.min(y, window.innerHeight - 132))
  const itemClass =
    'flex w-full rounded-xl px-3 py-2 text-left text-sm text-white/90 hover:bg-white/10 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent'

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
      className="fixed z-40 w-44 rounded-2xl border border-white/10 bg-[#1c1d21] p-1 shadow-xl"
    >
      <button type="button" role="menuitem" className={itemClass} onClick={onCreate}>
        Создать папку
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        disabled={!canMutate}
        onClick={onRename}
      >
        Переименовать
      </button>
      <button
        type="button"
        role="menuitem"
        className={itemClass}
        disabled={!canMutate}
        onClick={onDelete}
      >
        Удалить
      </button>
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
  canMove,
  canGoUp,
  onOpen,
  onRefresh,
  onApplyCovers,
  applyingCovers = false,
  autoCovers = true,
  onAutoCoversChange,
  onSyncTitles,
  syncingTitles = false,
  onEnter,
  onUp,
  onPlay,
  onEdit,
  onMove,
  onDelete,
  onDeleteDirectory,
  onCreateDirectory,
  onRenameDirectory,
  onRenameFile,
  onToggleEnergy,
  dragSource,
  onDragSourceChange,
  onDropFile
}: FilePanelProps): React.JSX.Element {
  const duplicates = duplicatePaths(files)
  const MoveIcon = side === 'left' ? ArrowRight : ArrowLeft
  const busy = loading || scanning
  const listRef = useRef<VirtuosoHandle>(null)
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
        {onApplyCovers && (
          <div className="flex items-center gap-1.5">
            <IconButton
              label="Обновить обложки в папке"
              disabled={!current || applyingCovers || syncingTitles || !autoCovers}
              onClick={onApplyCovers}
              className={!autoCovers ? 'cursor-not-allowed opacity-50' : ''}
            >
              {applyingCovers ? (
                <Loader2 size={15} strokeWidth={1.5} className="animate-spin" />
              ) : (
                <ImageIcon size={15} strokeWidth={1.5} />
              )}
            </IconButton>
            {onAutoCoversChange && (
              <CoverSwitch enabled={autoCovers} onChange={onAutoCoversChange} />
            )}
          </div>
        )}
        {onSyncTitles && (
          <IconButton
            label="Синхронизировать ID3-теги в папке"
            disabled={!current || syncingTitles || applyingCovers}
            onClick={onSyncTitles}
          >
            {syncingTitles ? (
              <Loader2 size={15} strokeWidth={1.5} className="animate-spin" />
            ) : (
              <Tags size={15} strokeWidth={1.5} />
            )}
          </IconButton>
        )}
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
              ...files.map((file) => ({ kind: 'file' as const, file }))
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
              const selected = file.path === selectedPath
              const duplicate = duplicates.has(file.path)
              const activeTags = energyTagsInName(file.name)
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
              const rowTone = selected
                ? duplicate
                  ? 'bg-red-200 text-black'
                  : 'bg-white text-black'
                : duplicate
                  ? 'bg-red-400/20 text-white/90 hover:bg-red-400/30'
                  : 'text-white/85 hover:bg-white/8'
              return (
                <div
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
                  className={`mb-1 flex min-w-0 cursor-grab flex-col rounded-3xl py-1 pr-1 active:cursor-grabbing ${rowTone}`}
                >
                  <div className="flex min-w-0 items-center gap-1">
                    {naming?.kind === 'file' && naming.path === file.path ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1">
                        <TrackCover filePath={file.path} />
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
                        onClick={() => onPlay(file)}
                        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1 text-left"
                      >
                        <TrackCover filePath={file.path} />
                        <span className="flex min-w-0 flex-1 items-center gap-1">
                          {activeTags.length > 0 && (
                            <span className="shrink-0 text-sm">
                              {activeTags.map((tag) => `[${tag}]`).join('')}
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {energyTitle(file.name)}
                          </span>
                        </span>
                      </button>
                    )}
                    {badges.length > 0 && (
                      <div className="ml-auto flex shrink-0 flex-row items-center justify-end gap-1">
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
                      </div>
                    )}
                    <span
                      className={`shrink-0 text-[10px] uppercase tracking-wider ${selected ? 'text-black/45' : 'text-white/35'}`}
                    >
                      {file.extension}
                    </span>
                    <div className="flex shrink-0 items-center">
                      <IconButton
                        label="Изменить"
                        size="xs"
                        variant="plain"
                        onClick={() => onEdit(file)}
                      >
                        <Pencil size={12} strokeWidth={1.5} />
                      </IconButton>
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
                  <div className="mt-1 flex flex-row gap-1 pl-9">
                    {ENERGY_TAGS.map((tag) => (
                      <EnergyButton
                        key={tag}
                        tag={tag}
                        active={activeTags.includes(tag)}
                        selected={selected}
                        onClick={() => onToggleEnergy(file, tag)}
                      />
                    ))}
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
