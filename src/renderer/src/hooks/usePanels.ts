import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AudioFileEntry,
  DirectoryEntry,
  FolderScanStart,
  PanelSide,
  TagEdit
} from '../../../shared/types'
import type { EnergyTag } from '../../../shared/energy'
import { toggleEnergyTag } from '../../../shared/energy'
import { sortByFileName } from '../../../shared/files'
import { isInsideDirectory, relocatePath } from '../../../shared/paths'
import { baseName, fileStem, humanError } from '@renderer/lib/format'
import { readAutoCovers, writeAutoCovers } from '@renderer/lib/autoCovers'
import { readSession, writeSession, type StoredPanel } from '@renderer/lib/session'

type PanelModel = {
  root: string | null
  current: string | null
  directories: DirectoryEntry[]
  files: AudioFileEntry[]
  loading: boolean
  picking: boolean
  scanning: boolean
  scanId: string | null
  totalFiles: number
}

type Selection = {
  side: PanelSide
  file: AudioFileEntry
}

export type PendingDelete =
  | {
      id: string
      kind: 'file'
      side: PanelSide
      directory: string
      file: AudioFileEntry
      index: number
    }
  | {
      id: string
      kind: 'directory'
      side: PanelSide
      directory: string
      folder: DirectoryEntry
      index: number
    }

const DELETE_UNDO_MS = 5000
const WRITABLE_TITLE = new Set(['mp3', 'wav', 'wave'])

function applyTitleSync(
  file: AudioFileEntry,
  renamed: Map<string, string>,
  writeTitle: boolean
): AudioFileEntry {
  const nextPath = renamed.get(file.path)
  const writable = WRITABLE_TITLE.has(file.extension)
  if (!nextPath && !(writeTitle && writable)) return file
  const name = nextPath ? baseName(nextPath) : file.name
  const stem = fileStem(name)
  return {
    ...file,
    name,
    path: nextPath ?? file.path,
    stem,
    tags: writable ? { ...file.tags, title: stem } : file.tags
  }
}

const emptyPanel: PanelModel = {
  root: null,
  current: null,
  directories: [],
  files: [],
  loading: false,
  picking: false,
  scanning: false,
  scanId: null,
  totalFiles: 0
}

function isListedFile(value: unknown): value is AudioFileEntry {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<AudioFileEntry>
  return (
    typeof record.path === 'string' &&
    typeof record.name === 'string' &&
    typeof record.stem === 'string' &&
    typeof record.tags === 'object' &&
    record.tags !== null
  )
}

function listedFiles(value: unknown): AudioFileEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter(isListedFile)
}

function requireApi(): NonNullable<Window['api']> {
  const api = window.api
  if (!api) throw new Error('Файловая библиотека доступна в окне Electron')
  return api
}

function otherSide(side: PanelSide): PanelSide {
  return side === 'left' ? 'right' : 'left'
}

function batchNotice(updated: number, failed: number): string {
  return `Успешно: ${updated}, Ошибок: ${failed}`
}

function visibleDirectories(
  directories: DirectoryEntry[],
  pending: PendingDelete[]
): DirectoryEntry[] {
  const hidden = pending.flatMap((item) => (item.kind === 'directory' ? [item.folder.path] : []))
  if (hidden.length === 0) return directories
  const hiddenPaths = new Set(hidden)
  return directories.filter((folder) => !hiddenPaths.has(folder.path))
}

function panelFromStored(stored: StoredPanel | undefined): PanelModel {
  if (!stored) return emptyPanel
  return { ...emptyPanel, root: stored.root, current: stored.current, loading: true }
}

export function usePanels(): {
  panels: Record<PanelSide, PanelModel>
  selected: Selection | null
  playToken: number
  error: string | null
  editing: Selection | null
  pendingDeletes: PendingDelete[]
  openPanel: (side: PanelSide) => Promise<void>
  refreshPanel: (side: PanelSide) => Promise<void>
  enterDirectory: (side: PanelSide, directory: DirectoryEntry) => Promise<void>
  goUp: (side: PanelSide) => Promise<void>
  selectFile: (side: PanelSide, file: AudioFileEntry) => void
  selectOffset: (offset: number) => void
  moveFile: (side: PanelSide, file: AudioFileEntry, targetDirectory?: string) => Promise<void>
  toggleEnergy: (side: PanelSide, file: AudioFileEntry, tag: EnergyTag) => Promise<void>
  beginEdit: (side: PanelSide, file: AudioFileEntry) => void
  cancelEdit: () => void
  saveEdit: (nextName: string, tags: TagEdit) => Promise<void>
  requestDelete: (side: PanelSide, file: AudioFileEntry) => void
  requestDeleteDirectory: (side: PanelSide, folder: DirectoryEntry) => void
  createDirectory: (side: PanelSide, name: string) => Promise<void>
  renameDirectory: (side: PanelSide, folder: DirectoryEntry, name: string) => Promise<void>
  renameTrack: (side: PanelSide, file: AudioFileEntry, name: string) => Promise<void>
  undoDelete: (id: string) => void
  dismissError: () => void
  notice: string | null
  dismissNotice: () => void
  applyingCovers: boolean
  applyCovers: (side: PanelSide) => Promise<void>
  syncingTitles: boolean
  syncTitles: (side: PanelSide) => Promise<void>
  autoCovers: boolean
  setAutoCovers: (enabled: boolean) => void
} {
  const [panels, setPanels] = useState<Record<PanelSide, PanelModel>>(() => {
    const saved = readSession()
    return { left: panelFromStored(saved.left), right: panelFromStored(saved.right) }
  })
  const [selected, setSelected] = useState<Selection | null>(null)
  const [playToken, setPlayToken] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [applyingCovers, setApplyingCovers] = useState(false)
  const [syncingTitles, setSyncingTitles] = useState(false)
  const [autoCovers, setAutoCovers] = useState(() => readAutoCovers())
  const [editing, setEditing] = useState<Selection | null>(null)
  const [pendingDeletes, setPendingDeletes] = useState<PendingDelete[]>([])
  const pendingRef = useRef<PendingDelete[]>([])
  const timersRef = useRef(new Map<string, number>())
  const runScanRef = useRef<
    | ((
        side: PanelSide,
        fallback: string,
        request: (scanId: string) => Promise<FolderScanStart | null>
      ) => Promise<void>)
    | null
  >(null)
  const panelsRef = useRef(panels)

  useEffect(() => {
    panelsRef.current = panels
  }, [panels])

  useEffect(() => {
    writeAutoCovers(autoCovers)
  }, [autoCovers])

  useEffect(() => {
    const api = window.api
    if (!api) return

    const onChunk = api.onFolderScanChunk((chunk) => {
      if (chunk.side !== 'left' && chunk.side !== 'right') return
      const incoming = listedFiles(chunk.files)
      if (incoming.length === 0) return
      setPanels((prev) => {
        const panel = prev[chunk.side]
        if (panel.scanId !== chunk.scanId) return prev
        const seen = new Set(panel.files.map((file) => file.path))
        const fresh = incoming.filter((file) => !seen.has(file.path))
        if (fresh.length === 0) return prev
        return {
          ...prev,
          [chunk.side]: { ...panel, files: [...panel.files, ...fresh], loading: false }
        }
      })
    })

    const onComplete = api.onFolderScanComplete((event) => {
      if (event.side !== 'left' && event.side !== 'right') return
      setPanels((prev) => {
        const panel = prev[event.side]
        if (panel.scanId !== event.scanId) return prev
        return { ...prev, [event.side]: { ...panel, scanning: false, loading: false } }
      })
      if (event.error) setError(event.error)
    })

    const onUpdate = api.onFolderScanUpdate((update) => {
      if (update.side !== 'left' && update.side !== 'right') return
      const incoming = listedFiles(update.files)
      if (incoming.length === 0) return
      const byPath = new Map(incoming.map((file) => [file.path, file]))
      setPanels((prev) => {
        const panel = prev[update.side]
        if (panel.scanId !== update.scanId) return prev
        let changed = false
        const files = panel.files.map((file) => {
          const next = byPath.get(file.path)
          if (!next) return file
          changed = true
          return next
        })
        if (!changed) return prev
        return { ...prev, [update.side]: { ...panel, files } }
      })
      setSelected((current) => {
        if (!current || current.side !== update.side) return current
        const next = byPath.get(current.file.path)
        return next ? { ...current, file: next } : current
      })
      setEditing((current) => {
        if (!current || current.side !== update.side) return current
        const next = byPath.get(current.file.path)
        return next ? { ...current, file: next } : current
      })
    })

    return () => {
      onChunk()
      onComplete()
      onUpdate()
    }
  }, [])

  const runScan = useCallback(
    async (
      side: PanelSide,
      fallback: string,
      request: (scanId: string) => Promise<FolderScanStart | null>
    ) => {
      const scanId = crypto.randomUUID()
      setPanels((current) => ({
        ...current,
        [side]: {
          ...current[side],
          scanId,
          scanning: true,
          loading: false,
          files: [],
          directories: [],
          totalFiles: 0
        }
      }))
      try {
        const started = await request(scanId)
        if (!started) {
          let stale = false
          setPanels((current) => {
            if (current[side].scanId !== scanId) {
              stale = true
              return current
            }
            return { ...current, [side]: emptyPanel }
          })
          if (!stale) writeSession(side, null)
          return
        }
        let stale = false
        setPanels((current) => {
          if (current[side].scanId !== scanId) {
            stale = true
            return current
          }
          return {
            ...current,
            [side]: {
              ...current[side],
              root: started.root,
              current: started.path,
              directories: started.directories,
              totalFiles: started.totalFiles,
              loading: false,
              picking: false
            }
          }
        })
        if (stale) return
        writeSession(side, { root: started.root, current: started.path })
        setError(null)
      } catch (caught) {
        let stale = false
        setPanels((current) => {
          if (current[side].scanId !== scanId) {
            stale = true
            return current
          }
          return {
            ...current,
            [side]: { ...current[side], scanning: false, loading: false, picking: false }
          }
        })
        if (!stale) setError(humanError(caught, fallback))
      }
    },
    []
  )

  useEffect(() => {
    runScanRef.current = runScan
  }, [runScan])

  useEffect(() => {
    const saved = readSession()
    let cancelled = false
    const timer = window.setTimeout(() => {
      if (cancelled) return
      if (saved.left) {
        void runScan('left', 'Не удалось открыть прошлую папку', (scanId) =>
          requireApi().restoreDirectory(
            'left',
            saved.left?.root ?? '',
            saved.left?.current ?? '',
            scanId
          )
        )
      }
      if (saved.right) {
        void runScan('right', 'Не удалось открыть прошлую папку', (scanId) =>
          requireApi().restoreDirectory(
            'right',
            saved.right?.root ?? '',
            saved.right?.current ?? '',
            scanId
          )
        )
      }
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [runScan])

  const replaceFile = useCallback(
    (side: PanelSide, previousPath: string, nextFile: AudioFileEntry) => {
      setPanels((current) => ({
        ...current,
        [side]: {
          ...current[side],
          files: current[side].files.map((file) => (file.path === previousPath ? nextFile : file))
        }
      }))
      setSelected((current) =>
        current?.file.path === previousPath ? { side, file: nextFile } : current
      )
      setEditing((current) =>
        current?.file.path === previousPath ? { side, file: nextFile } : current
      )
    },
    []
  )

  const openPanel = useCallback(
    async (side: PanelSide) => {
      setPanels((current) => ({ ...current, [side]: { ...current[side], picking: true } }))
      setError(null)
      try {
        const picked = await requireApi().selectDirectory(side)
        if (!picked) return
        setPanels((current) => ({
          ...current,
          [side]: { ...current[side], root: picked, current: picked }
        }))
        await runScan(side, 'Не удалось открыть папку', (scanId) =>
          requireApi().scanFolder(side, scanId)
        )
      } catch (caught) {
        setError(humanError(caught, 'Не удалось открыть папку'))
      } finally {
        setPanels((current) => ({ ...current, [side]: { ...current[side], picking: false } }))
      }
    },
    [runScan]
  )

  const refreshPanel = useCallback(
    async (side: PanelSide) => {
      let hasRoot = false
      setPanels((current) => {
        hasRoot = Boolean(current[side].root)
        return current
      })
      if (!hasRoot) return
      await runScan(side, 'Не удалось обновить папку', (scanId) =>
        requireApi().scanFolder(side, scanId)
      )
    },
    [runScan]
  )

  const enterDirectory = useCallback(
    async (side: PanelSide, directory: DirectoryEntry) => {
      await runScan(side, 'Не удалось открыть папку', (scanId) =>
        requireApi().enterDirectory(side, directory.path, scanId)
      )
    },
    [runScan]
  )

  const goUp = useCallback(
    async (side: PanelSide) => {
      await runScan(side, 'Не удалось подняться на уровень выше', (scanId) =>
        requireApi().goUp(side, scanId)
      )
    },
    [runScan]
  )

  const selectFile = useCallback((side: PanelSide, file: AudioFileEntry) => {
    setSelected({ side, file })
    setPlayToken((token) => token + 1)
  }, [])

  const visibleFiles = useCallback(
    (files: AudioFileEntry[]): AudioFileEntry[] => {
      if (pendingDeletes.length === 0) return files
      const hidden = new Set(
        pendingDeletes.flatMap((item) => (item.kind === 'file' ? [item.file.path] : []))
      )
      return files.filter((file) => !hidden.has(file.path))
    },
    [pendingDeletes]
  )

  const restoreDeleted = useCallback((entry: PendingDelete) => {
    setPanels((current) => {
      const panel = current[entry.side]
      if (panel.current !== entry.directory) return current
      if (entry.kind === 'directory') {
        if (panel.directories.some((folder) => folder.path === entry.folder.path)) return current
        const directories = [...panel.directories]
        const index = Math.min(Math.max(entry.index, 0), directories.length)
        directories.splice(index, 0, entry.folder)
        return { ...current, [entry.side]: { ...panel, directories } }
      }
      if (panel.files.some((file) => file.path === entry.file.path)) return current
      const files = [...panel.files]
      const index = Math.min(Math.max(entry.index, 0), files.length)
      files.splice(index, 0, entry.file)
      return {
        ...current,
        [entry.side]: {
          ...panel,
          files
        }
      }
    })
  }, [])

  const forgetPending = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
    pendingRef.current = pendingRef.current.filter((item) => item.id !== id)
    setPendingDeletes(pendingRef.current)
  }, [])

  const commitDelete = useCallback(
    async (id: string) => {
      const entry = pendingRef.current.find((item) => item.id === id)
      if (!entry) return
      forgetPending(id)
      try {
        if (entry.kind === 'directory') {
          const removed = entry.folder.path
          await requireApi().trashDirectory(removed)
          for (const panelSide of ['left', 'right'] as const) {
            const open = panelsRef.current[panelSide]
            if (!open.current || !open.root) continue
            const affected =
              isInsideDirectory(removed, open.current) || isInsideDirectory(removed, open.root)
            if (!affected) continue
            await runScanRef.current?.(panelSide, 'Не удалось открыть папку', (scanId) =>
              requireApi().scanFolder(panelSide, scanId)
            )
          }
          return
        }
        await requireApi().trashFile(entry.file.path)
      } catch (caught) {
        restoreDeleted(entry)
        setError(humanError(caught, 'Не удалось переместить в корзину'))
      }
    },
    [forgetPending, restoreDeleted]
  )

  const requestDelete = useCallback(
    (side: PanelSide, file: AudioFileEntry) => {
      const directory = panelsRef.current[side].current
      if (!directory) return
      if (pendingRef.current.some((item) => item.kind === 'file' && item.file.path === file.path)) {
        return
      }
      const index = panelsRef.current[side].files.findIndex((item) => item.path === file.path)
      const entry: PendingDelete = {
        id: crypto.randomUUID(),
        kind: 'file',
        side,
        directory,
        file,
        index: index < 0 ? 0 : index
      }
      pendingRef.current = [...pendingRef.current, entry]
      setPendingDeletes(pendingRef.current)
      setPanels((current) => ({
        ...current,
        [side]: {
          ...current[side],
          files: current[side].files.filter((item) => item.path !== file.path)
        }
      }))
      setEditing((current) => (current?.file.path === file.path ? null : current))
      const timer = window.setTimeout(() => {
        void commitDelete(entry.id)
      }, DELETE_UNDO_MS)
      timersRef.current.set(entry.id, timer)
    },
    [commitDelete]
  )

  const undoDelete = useCallback(
    (id: string) => {
      const entry = pendingRef.current.find((item) => item.id === id)
      if (!entry) return
      forgetPending(id)
      restoreDeleted(entry)
    },
    [forgetPending, restoreDeleted]
  )

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
    }
  }, [])

  const selectOffset = useCallback(
    (offset: number) => {
      if (!selected) return
      const files = visibleFiles(panels[selected.side].files)
      const index = files.findIndex((file) => file.path === selected.file.path)
      const next = files[index + offset]
      if (!next) return
      setSelected({ side: selected.side, file: next })
      setPlayToken((token) => token + 1)
    },
    [panels, selected, visibleFiles]
  )

  const moveFile = useCallback(
    async (side: PanelSide, file: AudioFileEntry, targetDirectory?: string) => {
      const destination = otherSide(side)
      if (!targetDirectory && !panels[destination].root) {
        setError('Сначала выберите папку на другой панели')
        return
      }
      try {
        const moved = await requireApi().moveFile(file.path, destination, targetDirectory)
        const landsIn = (panelSide: PanelSide, directory: string | null): boolean =>
          targetDirectory ? directory === targetDirectory : panelSide === destination
        setPanels((current) => {
          const next = { ...current }
          for (const panelSide of ['left', 'right'] as const) {
            const files = current[panelSide].files.filter((item) => item.path !== file.path)
            next[panelSide] = {
              ...current[panelSide],
              files: landsIn(panelSide, current[panelSide].current) ? [...files, moved] : files
            }
          }
          return next
        })
        setSelected((current) => {
          if (current?.file.path !== file.path) return current
          const landing = (['left', 'right'] as const).find((panelSide) =>
            landsIn(panelSide, panels[panelSide].current)
          )
          return { side: landing ?? current.side, file: moved }
        })
        setError(null)
      } catch (caught) {
        setError(humanError(caught, 'Не удалось переместить файл'))
      }
    },
    [panels]
  )

  const showNotice = useCallback((text: string) => {
    setNotice(text)
    window.setTimeout(() => {
      setNotice((current) => (current === text ? null : current))
    }, 4000)
  }, [])

  const applyCovers = useCallback(
    async (side: PanelSide) => {
      const directory = panels[side].current
      if (!directory || applyingCovers || syncingTitles || !autoCovers) return
      setApplyingCovers(true)
      try {
        const { updated, failed } = await requireApi().applyCovers(directory, autoCovers)
        showNotice(batchNotice(updated, failed))
        setError(null)
      } catch (caught) {
        setError(humanError(caught, 'Не удалось обновить обложки'))
      } finally {
        setApplyingCovers(false)
      }
    },
    [applyingCovers, autoCovers, panels, showNotice, syncingTitles]
  )

  const syncTitles = useCallback(
    async (side: PanelSide) => {
      const directory = panels[side].current
      if (!directory || syncingTitles || applyingCovers) return
      setSyncingTitles(true)
      try {
        const { updated, failed, renamed } = await requireApi().syncTitles(directory)
        const renamedByPath = new Map(renamed.map((item) => [item.from, item.to]))
        const migrate = (file: AudioFileEntry, writeTitle: boolean): AudioFileEntry =>
          applyTitleSync(file, renamedByPath, writeTitle)
        setPanels((current) => ({
          left: {
            ...current.left,
            files: current.left.files.map((file) => migrate(file, side === 'left'))
          },
          right: {
            ...current.right,
            files: current.right.files.map((file) => migrate(file, side === 'right'))
          }
        }))
        setSelected((current) => {
          if (!current) return current
          const next = migrate(current.file, current.side === side)
          return next === current.file ? current : { ...current, file: next }
        })
        setEditing((current) => {
          if (!current) return current
          const next = migrate(current.file, current.side === side)
          return next === current.file ? current : { ...current, file: next }
        })
        const nextPending = pendingRef.current.map((entry) => {
          if (entry.kind !== 'file') return entry
          const next = migrate(entry.file, entry.side === side)
          return next === entry.file ? entry : { ...entry, file: next }
        })
        if (nextPending.some((entry, index) => entry !== pendingRef.current[index])) {
          pendingRef.current = nextPending
          setPendingDeletes(nextPending)
        }
        showNotice(batchNotice(updated, failed))
        setError(null)
      } catch (caught) {
        setError(humanError(caught, 'Не удалось синхронизировать названия'))
      } finally {
        setSyncingTitles(false)
      }
    },
    [applyingCovers, panels, showNotice, syncingTitles]
  )

  const toggleEnergy = useCallback(
    async (side: PanelSide, file: AudioFileEntry, tag: EnergyTag) => {
      const nextName = toggleEnergyTag(file.name, tag)
      if (nextName === file.name) return
      try {
        const renamed = await requireApi().renameFile(file.path, nextName)
        replaceFile(side, file.path, renamed)
        setError(null)
      } catch (caught) {
        setError(humanError(caught, 'Не удалось переименовать файл'))
      }
    },
    [replaceFile]
  )

  const saveEdit = useCallback(
    async (nextName: string, tags: TagEdit) => {
      if (!editing) return
      const { side, file } = editing
      try {
        let current = file
        if (nextName !== file.name) {
          current = await requireApi().renameFile(file.path, nextName)
          replaceFile(side, file.path, current)
        }
        const writable =
          current.extension === 'mp3' || current.extension === 'wav' || current.extension === 'wave'
        const tagsChanged =
          tags.title !== (file.tags.title ?? '') ||
          tags.artist !== (file.tags.artist ?? '') ||
          tags.genre !== (file.tags.genre ?? '') ||
          tags.bpm !== (file.tags.bpm !== null ? String(file.tags.bpm) : '')
        if (writable && tagsChanged) {
          current = await requireApi().writeTags(current.path, tags)
          replaceFile(side, current.path, current)
        } else if (tagsChanged) {
          setError('Запись тегов поддерживается для MP3 и WAV')
          return
        }
        setEditing(null)
        setError(null)
      } catch (caught) {
        setError(humanError(caught, 'Не удалось сохранить изменения'))
      }
    },
    [editing, replaceFile]
  )

  const createDirectory = useCallback(async (side: PanelSide, name: string) => {
    const parent = panelsRef.current[side].current
    if (!parent) return
    try {
      const created = await requireApi().createDirectory(parent, name)
      setPanels((current) => {
        const panel = current[side]
        if (panel.current !== parent) return current
        return {
          ...current,
          [side]: {
            ...panel,
            directories: sortByFileName([...panel.directories, created])
          }
        }
      })
      setError(null)
    } catch (caught) {
      setError(humanError(caught, 'Не удалось создать папку'))
      throw caught
    }
  }, [])

  const renameDirectory = useCallback(
    async (_side: PanelSide, folder: DirectoryEntry, name: string) => {
      try {
        const renamed = await requireApi().renameDirectory(folder.path, name)
        const from = folder.path
        const to = renamed.path
        setPanels((current) => {
          const next = { ...current }
          for (const panelSide of ['left', 'right'] as const) {
            const panel = current[panelSide]
            const directories = sortByFileName(
              panel.directories.map((item) => {
                const path = relocatePath(item.path, from, to)
                if (!path) return item
                if (path === to) return renamed
                return { ...item, path, name: baseName(path) }
              })
            )
            const root = panel.root
              ? (relocatePath(panel.root, from, to) ?? panel.root)
              : panel.root
            const currentPath = panel.current
              ? (relocatePath(panel.current, from, to) ?? panel.current)
              : panel.current
            const files = panel.files.map((file) => {
              const path = relocatePath(file.path, from, to)
              if (!path) return file
              const fileName = baseName(path)
              return { ...file, path, name: fileName, stem: fileStem(fileName) }
            })
            next[panelSide] = { ...panel, directories, root, current: currentPath, files }
            if (root && currentPath && (root !== panel.root || currentPath !== panel.current)) {
              writeSession(panelSide, { root, current: currentPath })
            }
          }
          return next
        })
        setSelected((current) => {
          if (!current) return current
          const path = relocatePath(current.file.path, from, to)
          if (!path) return current
          const fileName = baseName(path)
          return {
            ...current,
            file: { ...current.file, path, name: fileName, stem: fileStem(fileName) }
          }
        })
        setEditing((current) => {
          if (!current) return current
          const path = relocatePath(current.file.path, from, to)
          if (!path) return current
          const fileName = baseName(path)
          return {
            ...current,
            file: { ...current.file, path, name: fileName, stem: fileStem(fileName) }
          }
        })
        setError(null)
      } catch (caught) {
        setError(humanError(caught, 'Не удалось переименовать папку'))
        throw caught
      }
    },
    []
  )

  const renameTrack = useCallback(
    async (side: PanelSide, file: AudioFileEntry, name: string) => {
      try {
        const renamed = await requireApi().renameFile(file.path, name)
        replaceFile(side, file.path, renamed)
        setError(null)
      } catch (caught) {
        setError(humanError(caught, 'Не удалось переименовать файл'))
        throw caught
      }
    },
    [replaceFile]
  )

  const requestDeleteDirectory = useCallback(
    (side: PanelSide, folder: DirectoryEntry) => {
      const directory = panelsRef.current[side].current
      if (!directory) return
      if (
        pendingRef.current.some(
          (item) => item.kind === 'directory' && item.folder.path === folder.path
        )
      ) {
        return
      }
      const index = panelsRef.current[side].directories.findIndex(
        (item) => item.path === folder.path
      )
      const entry: PendingDelete = {
        id: crypto.randomUUID(),
        kind: 'directory',
        side,
        directory,
        folder,
        index: index < 0 ? 0 : index
      }
      pendingRef.current = [...pendingRef.current, entry]
      setPendingDeletes(pendingRef.current)
      setPanels((current) => ({
        ...current,
        [side]: {
          ...current[side],
          directories: current[side].directories.filter((item) => item.path !== folder.path)
        }
      }))
      const timer = window.setTimeout(() => {
        void commitDelete(entry.id)
      }, DELETE_UNDO_MS)
      timersRef.current.set(entry.id, timer)
    },
    [commitDelete]
  )

  return {
    panels: {
      left: {
        ...panels.left,
        files: visibleFiles(panels.left.files),
        directories: visibleDirectories(panels.left.directories, pendingDeletes)
      },
      right: {
        ...panels.right,
        files: visibleFiles(panels.right.files),
        directories: visibleDirectories(panels.right.directories, pendingDeletes)
      }
    },
    selected,
    playToken,
    error,
    editing,
    pendingDeletes,
    openPanel,
    refreshPanel,
    enterDirectory,
    goUp,
    selectFile,
    selectOffset,
    moveFile,
    toggleEnergy,
    beginEdit: (side, file) => setEditing({ side, file }),
    cancelEdit: () => setEditing(null),
    saveEdit,
    requestDelete,
    requestDeleteDirectory,
    createDirectory,
    renameDirectory,
    renameTrack,
    undoDelete,
    dismissError: () => setError(null),
    notice,
    dismissNotice: () => setNotice(null),
    applyingCovers,
    applyCovers,
    syncingTitles,
    syncTitles,
    autoCovers,
    setAutoCovers
  }
}
