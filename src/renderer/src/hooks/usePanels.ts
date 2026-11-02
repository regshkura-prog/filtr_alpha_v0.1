import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AudioFileEntry,
  DirectoryEntry,
  FolderScanStart,
  PanelSide
} from '../../../shared/types'
import { energyTagsInName, type EnergyTag } from '../../../shared/energy'
import { applyFileSelection, type FileSelectMode } from '../../../shared/selection'
import { sortByFileName, sortEntries, type SortConfig, type SortKey } from '../../../shared/files'
import { isInsideDirectory, relocatePath } from '../../../shared/paths'
import { baseName, fileStem, humanError } from '@renderer/lib/format'
import {
  analyzedTrackParts,
  buildAnalyzedFileName,
  extensionOf,
  normalizeCamelot
} from '../../../shared/analyzedName'
import { roundDetectedBpm } from '../../../shared/camelot'
import { applyAutoClean, cleanedFileName, withKeptTrash } from '../../../shared/filename'
import {
  analyzeTrackAudio,
  readTrackAnalysis,
  rememberTrackAnalysis
} from '@renderer/lib/audioAnalysis'
import { SettingsContext } from '@renderer/context/settings-context'
import { readPaneSort, writePaneSort } from '@renderer/lib/paneSort'
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

function cloneKept(
  source: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, ReadonlySet<string>> {
  return new Map([...source].map(([key, values]) => [key, new Set(values)]))
}

function rememberedValues(
  file: AudioFileEntry,
  kept: ReadonlyMap<string, ReadonlySet<string>>
): Set<string> {
  const values = new Set<string>()
  for (const key of [file.hash, file.path]) {
    const set = key ? kept.get(key) : undefined
    if (!set) continue
    for (const value of set) values.add(value)
  }
  return values
}

function publishFile(
  file: AudioFileEntry,
  kept: ReadonlyMap<string, ReadonlySet<string>>,
  autoCleanNames: boolean,
  blacklistWords: readonly string[]
): AudioFileEntry {
  const listed = applyAutoClean(file, autoCleanNames, blacklistWords)
  if (!autoCleanNames) return listed
  return withKeptTrash(listed, rememberedValues(file, kept))
}

function annotateClean(
  file: AudioFileEntry,
  kept: ReadonlyMap<string, ReadonlySet<string>>,
  blacklistWords: readonly string[]
): AudioFileEntry {
  return publishFile(file, kept, true, blacklistWords)
}

function fileSortFields(file: AudioFileEntry): {
  name: string
  type: string
  dateCreated: number
  dateAdded: number
} {
  return {
    name: file.name,
    type: file.extension,
    dateCreated: file.birthtimeMs,
    dateAdded: file.mtimeMs
  }
}

function directorySortFields(directory: DirectoryEntry): {
  name: string
  type: string
  dateCreated: number
  dateAdded: number
} {
  return {
    name: directory.name,
    type: '',
    dateCreated: directory.birthtimeMs,
    dateAdded: directory.mtimeMs
  }
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

function trackHasAnalysis(file: AudioFileEntry): boolean {
  return (
    typeof file.tags.bpm === 'number' &&
    Number.isFinite(file.tags.bpm) &&
    file.tags.bpm > 0 &&
    typeof file.tags.key === 'string' &&
    file.tags.key.trim() !== ''
  )
}

function energyRenameName(
  file: AudioFileEntry,
  tag: EnergyTag,
  action: 'toggle' | 'assign'
): string {
  const extension = extensionOf(file.name) || '.mp3'
  const parts = analyzedTrackParts(file.name)
  const originalName = parts.originalStem || file.stem
  const removing =
    action === 'toggle' && (energyTagsInName(file.name).includes(tag) || parts.tag === tag)
  if (removing) return originalName ? `${originalName}${extension}` : file.name
  if (!originalName) return file.name
  try {
    return buildAnalyzedFileName(tag, file.tags.bpm, file.tags.key, originalName, extension)
  } catch {
    return file.name
  }
}

type PendingTagRename = {
  side: PanelSide
  tag: EnergyTag
  action: 'toggle' | 'assign'
  embedCover: boolean
}

export function usePanels(): {
  panels: Record<PanelSide, PanelModel>
  selected: Selection | null
  selectedFiles: string[]
  selectionSide: PanelSide | null
  coverRevision: number
  playToken: number
  error: string | null
  pendingDeletes: PendingDelete[]
  openPanel: (side: PanelSide) => Promise<void>
  refreshPanel: (side: PanelSide) => Promise<void>
  prepareDrag: (side: PanelSide, file: AudioFileEntry) => string
  keepTrash: (side: PanelSide, file: AudioFileEntry, tokenIndex: number) => void
  enterDirectory: (side: PanelSide, directory: DirectoryEntry) => Promise<void>
  goUp: (side: PanelSide) => Promise<void>
  selectFile: (side: PanelSide, file: AudioFileEntry) => void
  selectFiles: (side: PanelSide, file: AudioFileEntry, index: number, mode: FileSelectMode) => void
  selectOffset: (offset: number) => void
  moveFile: (side: PanelSide, file: AudioFileEntry, targetDirectory?: string) => Promise<void>
  toggleEnergy: (
    side: PanelSide,
    file: AudioFileEntry,
    tag: EnergyTag,
    scope?: 'file' | 'selection',
    embedCover?: boolean
  ) => Promise<void>
  assignEnergy: (tag: EnergyTag) => Promise<void>
  requestDelete: (side: PanelSide, file: AudioFileEntry) => void
  requestDeleteDirectory: (side: PanelSide, folder: DirectoryEntry) => void
  createDirectory: (side: PanelSide, name: string) => Promise<void>
  renameDirectory: (side: PanelSide, folder: DirectoryEntry, name: string) => Promise<void>
  renameTrack: (side: PanelSide, file: AudioFileEntry, name: string) => Promise<void>
  applyTrackAnalysis: (path: string, bpm: number, key: string) => Promise<void>
  pendingTagPaths: string[]
  undoDelete: (id: string) => void
  sortConfig: Record<PanelSide, SortConfig>
  setPaneSort: (side: PanelSide, key: SortKey) => void
  dismissError: () => void
} {
  const { autoAddCovers, autoCleanNames, blacklistWords, isAudioAnalysisEnabled } =
    useContext(SettingsContext)
  const [panels, setPanels] = useState<Record<PanelSide, PanelModel>>(() => {
    const saved = readSession()
    return { left: panelFromStored(saved.left), right: panelFromStored(saved.right) }
  })
  const [sortConfig, setSortConfig] = useState<Record<PanelSide, SortConfig>>(() => ({
    left: readPaneSort('left'),
    right: readPaneSort('right')
  }))
  const [selected, setSelected] = useState<Selection | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null)
  const [selectionSide, setSelectionSide] = useState<PanelSide | null>(null)
  const [coverRevision, setCoverRevision] = useState(0)
  const [playToken, setPlayToken] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [pendingDeletes, setPendingDeletes] = useState<PendingDelete[]>([])
  const [pendingTagPaths, setPendingTagPaths] = useState<string[]>([])
  const pendingTagRef = useRef(new Map<string, PendingTagRename>())
  const analysisRequestsRef = useRef(new Set<string>())
  const applyingAnalysisRef = useRef(new Set<string>())
  const applyTrackAnalysisRef = useRef<(path: string, bpm: number, key: string) => Promise<void>>(
    async () => undefined
  )
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
  const selectionSideRef = useRef(selectionSide)
  const keptTrashRef = useRef(new Map<string, Set<string>>())
  const [keptTrash, setKeptTrash] = useState<ReadonlyMap<string, ReadonlySet<string>>>(
    () => new Map()
  )
  const autoCleanRef = useRef(autoCleanNames)
  const autoAddRef = useRef(autoAddCovers)
  const blacklistRef = useRef(blacklistWords)

  useEffect(() => {
    panelsRef.current = panels
    selectionSideRef.current = selectionSide
    autoCleanRef.current = autoCleanNames
    autoAddRef.current = autoAddCovers
    blacklistRef.current = blacklistWords
  }, [panels, selectionSide, autoCleanNames, autoAddCovers, blacklistWords])

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
        const fresh = incoming
          .filter((file) => !seen.has(file.path))
          .map((file) =>
            publishFile(file, keptTrashRef.current, autoCleanRef.current, blacklistRef.current)
          )
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
      let keptChanged = false
      for (const file of incoming) {
        const kept = keptTrashRef.current.get(file.path)
        if (!kept || !file.hash || keptTrashRef.current.has(file.hash)) continue
        keptTrashRef.current.set(file.hash, kept)
        keptChanged = true
      }
      if (keptChanged) setKeptTrash(cloneKept(keptTrashRef.current))
      const byPath = new Map(incoming.map((file) => [file.path, file]))
      setPanels((prev) => {
        const panel = prev[update.side]
        if (panel.scanId !== update.scanId) return prev
        let changed = false
        const files = panel.files.map((file) => {
          const next = byPath.get(file.path)
          if (!next) return file
          changed = true
          return publishFile(next, keptTrashRef.current, autoCleanRef.current, blacklistRef.current)
        })
        if (!changed) return prev
        return { ...prev, [update.side]: { ...panel, files } }
      })
      setSelected((current) => {
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
      const previousCurrent = panelsRef.current[side].current
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
          if (!stale) {
            writeSession(side, null)
            if (selectionSideRef.current === side) {
              setSelectedFiles([])
              setLastSelectedIndex(null)
              setSelectionSide(null)
            }
          }
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
        if (previousCurrent !== started.path && selectionSideRef.current === side) {
          setSelectedFiles([])
          setLastSelectedIndex(null)
        }
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
      const kept = keptTrashRef.current.get(previousPath)
      if (kept && nextFile.path !== previousPath) {
        keptTrashRef.current.set(nextFile.path, kept)
        if (nextFile.hash) keptTrashRef.current.set(nextFile.hash, kept)
        setKeptTrash(cloneKept(keptTrashRef.current))
      }
      setPanels((current) => ({
        ...current,
        [side]: {
          ...current[side],
          files: current[side].files.map((file) => (file.path === previousPath ? nextFile : file))
        }
      }))
      setSelected((current) => {
        if (current?.file.path !== previousPath) return current
        return { side: current.side, file: nextFile }
      })
      setSelectedFiles((current) =>
        current.includes(previousPath)
          ? current.map((path) => (path === previousPath ? nextFile.path : path))
          : current
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

  const cleanDirtyFiles = useCallback(
    async (side: PanelSide) => {
      if (!autoCleanRef.current) return
      const dirty = panelsRef.current[side].files
        .map((file) => publishFile(file, keptTrashRef.current, true, blacklistRef.current))
        .filter((file) => !file.isClean)
      if (dirty.length === 0) return
      const failures: unknown[] = []
      await Promise.all(
        dirty.map(async (file) => {
          const nextName = cleanedFileName(file)
          if (!nextName) {
            const stillDirty = file.cleanTokens?.some((token) => token.type === 'trash')
            if (!stillDirty) {
              replaceFile(side, file.path, { ...file, isClean: true, cleanTokens: undefined })
            }
            return
          }
          try {
            const renamed = await requireApi().renameFile(file.path, nextName)
            const next = annotateClean(renamed, keptTrashRef.current, blacklistRef.current)
            replaceFile(side, file.path, next.isClean ? { ...next, cleanTokens: undefined } : next)
          } catch (error) {
            failures.push(error)
          }
        })
      )
      if (failures.length > 0) setError(humanError(failures[0], 'Не удалось переименовать файл'))
    },
    [replaceFile]
  )

  const refreshPanel = useCallback(
    async (side: PanelSide) => {
      if (!panelsRef.current[side].root) return
      await cleanDirtyFiles(side)
      await runScan(side, 'Не удалось обновить папку', (scanId) =>
        requireApi().scanFolder(side, scanId)
      )
    },
    [cleanDirtyFiles, runScan]
  )

  const prepareDrag = useCallback(
    (side: PanelSide, file: AudioFileEntry): string => {
      const api = window.api
      if (!api) return file.path
      const nextName =
        autoCleanRef.current && !file.isClean ? (cleanedFileName(file) ?? file.name) : file.name
      const result = api.dragFile(file.path, nextName)
      if (!result) return file.path
      if (result.error) setError(result.error)
      if (!result.cleaned || !result.path || result.path === file.path)
        return result.path || file.path
      replaceFile(side, file.path, {
        ...file,
        name: result.name,
        path: result.path,
        stem: fileStem(result.name),
        isClean: true,
        cleanTokens: undefined
      })
      return result.path
    },
    [replaceFile]
  )

  const keepTrash = useCallback((side: PanelSide, file: AudioFileEntry, tokenIndex: number) => {
    const token = file.cleanTokens?.[tokenIndex]
    if (!token || token.type !== 'trash') return
    for (const key of [file.hash, file.path]) {
      if (!key) continue
      const set = keptTrashRef.current.get(key) ?? new Set<string>()
      set.add(token.value)
      keptTrashRef.current.set(key, set)
    }
    setKeptTrash(cloneKept(keptTrashRef.current))
    setPanels((current) => ({
      ...current,
      [side]: {
        ...current[side],
        files: current[side].files.map((item) =>
          item.path === file.path ? withKeptTrash(item, new Set([token.value])) : item
        )
      }
    }))
  }, [])

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

  const playFile = useCallback((side: PanelSide, file: AudioFileEntry, index: number) => {
    setSelected({ side, file })
    setPlayToken((token) => token + 1)
    setSelectionSide(side)
    setSelectedFiles([file.path])
    setLastSelectedIndex(index)
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

  const filesInOrder = useCallback(
    (side: PanelSide) =>
      sortEntries(visibleFiles(panels[side].files), sortConfig[side], fileSortFields),
    [panels, sortConfig, visibleFiles]
  )

  const setPaneSort = useCallback((side: PanelSide, key: SortKey) => {
    setSortConfig((current) => {
      const previous = current[side]
      const next: SortConfig =
        previous.key === key
          ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
          : { key, direction: 'asc' }
      writePaneSort(side, next)
      return { ...current, [side]: next }
    })
  }, [])

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
      setSelectedFiles((current) =>
        current.includes(file.path) ? current.filter((path) => path !== file.path) : current
      )
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

  const selectFile = useCallback(
    (side: PanelSide, file: AudioFileEntry) => {
      const files = filesInOrder(side)
      const index = files.findIndex((item) => item.path === file.path)
      playFile(side, file, index < 0 ? 0 : index)
    },
    [filesInOrder, playFile]
  )

  const selectFiles = useCallback(
    (side: PanelSide, file: AudioFileEntry, index: number, mode: FileSelectMode) => {
      const files = filesInOrder(side)
      const resolved =
        files[index]?.path === file.path
          ? index
          : files.findIndex((item) => item.path === file.path)
      if (resolved < 0) return
      if (mode === 'single') {
        playFile(side, files[resolved], resolved)
        return
      }
      const sameSide = selectionSide === side
      const liveSelected = sameSide
        ? selectedFiles.filter((path) => files.some((item) => item.path === path))
        : []
      const next = applyFileSelection(
        files.map((item) => item.path),
        liveSelected,
        sameSide ? lastSelectedIndex : null,
        resolved,
        mode
      )
      setSelectionSide(side)
      setSelectedFiles(next.selected)
      setLastSelectedIndex(next.anchor)
    },
    [filesInOrder, lastSelectedIndex, playFile, selectedFiles, selectionSide]
  )

  const selectOffset = useCallback(
    (offset: number) => {
      const side = selected?.side ?? selectionSide
      const files = side ? filesInOrder(side) : []
      const currentIndex = selected
        ? files.findIndex((file) => file.path === selected.file.path)
        : lastSelectedIndex
      if (side && files.length > 0) {
        if (currentIndex !== null && currentIndex >= 0 && currentIndex < files.length) {
          const next = files[currentIndex + offset]
          if (!next) return
          playFile(side, next, currentIndex + offset)
          return
        }
        const index = offset > 0 ? 0 : files.length - 1
        playFile(side, files[index], index)
        return
      }
      const fallback = (['left', 'right'] as const).find((item) => filesInOrder(item).length > 0)
      if (!fallback) return
      const fallbackFiles = filesInOrder(fallback)
      const index = offset > 0 ? 0 : fallbackFiles.length - 1
      const file = fallbackFiles[index]
      if (!file) return
      playFile(fallback, file, index)
    },
    [filesInOrder, lastSelectedIndex, playFile, selected, selectionSide]
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
              files: landsIn(panelSide, current[panelSide].current)
                ? [
                    ...files,
                    publishFile(
                      moved,
                      keptTrashRef.current,
                      autoCleanRef.current,
                      blacklistRef.current
                    )
                  ]
                : files
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

  const syncPendingTags = useCallback(() => {
    setPendingTagPaths([...pendingTagRef.current.keys()])
  }, [])

  const commitTaggedFile = useCallback(
    async (
      side: PanelSide,
      file: AudioFileEntry,
      tag: EnergyTag,
      action: 'toggle' | 'assign',
      embedCover: boolean
    ) => {
      const live = panelsRef.current[side].files.find((item) => item.path === file.path) ?? file
      const named = live.tags.bpm === file.tags.bpm && live.tags.key === file.tags.key ? live : file
      const nextName = energyRenameName(named, tag, action)
      const updated = await requireApi().writeId3(named.path, tag, action, embedCover, nextName)
      replaceFile(
        side,
        named.path,
        publishFile(updated, keptTrashRef.current, autoCleanRef.current, blacklistRef.current)
      )
      if (embedCover) setCoverRevision((revision) => revision + 1)
    },
    [replaceFile]
  )

  const requestTrackAnalysis = useCallback(
    (path: string) => {
      if (analysisRequestsRef.current.has(path)) return
      analysisRequestsRef.current.add(path)
      void (async () => {
        try {
          const cached = readTrackAnalysis(path)
          if (cached) {
            await applyTrackAnalysisRef.current(path, cached.bpm, cached.key)
            return
          }
          const buffer = await requireApi().readAudioFile(path)
          const result = await analyzeTrackAudio(true, buffer.slice(0))
          if (!pendingTagRef.current.has(path)) return
          const job = pendingTagRef.current.get(path)
          if (!result) {
            pendingTagRef.current.delete(path)
            syncPendingTags()
            if (!job) return
            const live = panelsRef.current[job.side].files.find((item) => item.path === path)
            if (!live) return
            try {
              await commitTaggedFile(job.side, live, job.tag, job.action, job.embedCover)
              setError('Не удалось определить BPM и тональность')
            } catch (caught) {
              setError(humanError(caught, 'Не удалось записать тег'))
            }
            return
          }
          await applyTrackAnalysisRef.current(path, result.bpm, result.key)
        } catch (caught) {
          pendingTagRef.current.delete(path)
          syncPendingTags()
          setError(humanError(caught, 'Не удалось проанализировать трек'))
        } finally {
          analysisRequestsRef.current.delete(path)
        }
      })()
    },
    [commitTaggedFile, syncPendingTags]
  )

  const commitEnergy = useCallback(
    async (
      side: PanelSide,
      targets: AudioFileEntry[],
      tag: EnergyTag,
      action: 'toggle' | 'assign',
      embedCover: boolean
    ) => {
      if (targets.length === 0) return
      const ready: AudioFileEntry[] = []
      for (const file of targets) {
        const live = panelsRef.current[side].files.find((item) => item.path === file.path) ?? file
        const parts = analyzedTrackParts(live.name)
        const removing =
          action === 'toggle' && (energyTagsInName(live.name).includes(tag) || parts.tag === tag)
        if (!removing && isAudioAnalysisEnabled && !trackHasAnalysis(live)) {
          pendingTagRef.current.set(live.path, { side, tag, action, embedCover })
          continue
        }
        pendingTagRef.current.delete(live.path)
        ready.push(live)
      }
      syncPendingTags()
      for (const path of pendingTagRef.current.keys()) {
        if (targets.some((file) => file.path === path)) requestTrackAnalysis(path)
      }
      const results = await Promise.all(
        ready.map(async (file) => {
          try {
            await commitTaggedFile(side, file, tag, action, embedCover)
            return { ok: true as const }
          } catch (error) {
            return { ok: false as const, error }
          }
        })
      )
      const failure = results.find((result): result is { ok: false; error: unknown } => !result.ok)
      if (failure) setError(humanError(failure.error, 'Не удалось записать тег'))
      else if (ready.length > 0) setError(null)
    },
    [commitTaggedFile, isAudioAnalysisEnabled, requestTrackAnalysis, syncPendingTags]
  )

  const toggleEnergy = useCallback(
    async (
      side: PanelSide,
      file: AudioFileEntry,
      tag: EnergyTag,
      scope: 'file' | 'selection' = 'selection',
      embedCover = autoAddRef.current
    ) => {
      const visible = visibleFiles(panels[side].files)
      const inSelection = selectionSide === side && selectedFiles.includes(file.path)
      const targets =
        scope === 'selection' && inSelection
          ? visible.filter((item) => selectedFiles.includes(item.path))
          : [file]
      await commitEnergy(side, targets.length > 0 ? targets : [file], tag, 'toggle', embedCover)
    },
    [commitEnergy, panels, selectedFiles, selectionSide, visibleFiles]
  )

  const assignEnergy = useCallback(
    async (tag: EnergyTag) => {
      if (!selectionSide) return
      const visible = visibleFiles(panels[selectionSide].files)
      const targets = visible.filter((file) => selectedFiles.includes(file.path))
      await commitEnergy(selectionSide, targets, tag, 'assign', autoAddCovers)
    },
    [autoAddCovers, commitEnergy, panels, selectedFiles, selectionSide, visibleFiles]
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
        setSelectedFiles((current) => {
          let changed = false
          const next = current.map((path) => {
            const relocated = relocatePath(path, from, to)
            if (!relocated || relocated === path) return path
            changed = true
            return relocated
          })
          return changed ? next : current
        })
        setError(null)
      } catch (caught) {
        setError(humanError(caught, 'Не удалось переименовать папку'))
        throw caught
      }
    },
    []
  )

  const applyTrackAnalysis = useCallback(
    async (path: string, bpm: number, key: string) => {
      if (!isAudioAnalysisEnabled) return
      if (applyingAnalysisRef.current.has(path)) return
      const normalizedBpm = roundDetectedBpm(bpm)
      if (normalizedBpm === null) return
      applyingAnalysisRef.current.add(path)
      try {
        const camelot = normalizeCamelot(key)
        if (!camelot) return
        const matches = (['left', 'right'] as const).flatMap((side) => {
          const file = panelsRef.current[side].files.find((item) => item.path === path)
          return file ? [{ side, file }] : []
        })
        const current = matches[0]
        if (!current) return
        const file = current.file
        const named = { ...file, tags: { ...file.tags, bpm: normalizedBpm, key: camelot } }
        const pending = pendingTagRef.current.get(path)
        if (pending) {
          pendingTagRef.current.delete(path)
          syncPendingTags()
          try {
            await commitTaggedFile(
              pending.side,
              named,
              pending.tag,
              pending.action,
              pending.embedCover
            )
            rememberTrackAnalysis(path, { bpm: normalizedBpm, key: camelot })
            setError(null)
          } catch (caught) {
            setError(humanError(caught, 'Не удалось записать тег'))
          }
          return
        }
        const parts = analyzedTrackParts(file.name)
        let nextName = file.name
        if (parts.tag && parts.originalStem) {
          try {
            nextName = buildAnalyzedFileName(
              parts.tag,
              normalizedBpm,
              camelot,
              parts.originalStem,
              extensionOf(file.name) || '.mp3'
            )
          } catch {
            nextName = file.name
          }
        }
        const sameTags =
          file.tags.bpm === normalizedBpm && normalizeCamelot(file.tags.key ?? '') === camelot
        const canWrite =
          file.extension === 'mp3' || file.extension === 'wav' || file.extension === 'wave'
        const publish = (nextPath: string, nextFileName: string): void => {
          rememberTrackAnalysis(path, { bpm: normalizedBpm, key: camelot })
          if (nextPath !== path)
            rememberTrackAnalysis(nextPath, { bpm: normalizedBpm, key: camelot })
          const ordered = [...matches].sort((left, right) => {
            if (left.side === selectionSideRef.current) return 1
            if (right.side === selectionSideRef.current) return -1
            return 0
          })
          for (const match of ordered) {
            replaceFile(match.side, path, {
              ...match.file,
              path: nextPath,
              name: nextFileName,
              stem: fileStem(nextFileName),
              extension:
                extensionOf(nextFileName).replace(/^\./, '').toLowerCase() || match.file.extension,
              isClean: true,
              cleanTokens: undefined,
              tags: { ...match.file.tags, bpm: normalizedBpm, key: camelot }
            })
          }
        }
        let settledPath = path
        if (!canWrite) {
          if (!sameTags) publish(path, file.name)
        } else if (!sameTags || nextName !== file.name) {
          try {
            settledPath = await requireApi().applyTagsAndRename(
              file.path,
              nextName,
              normalizedBpm,
              camelot
            )
            publish(settledPath, baseName(settledPath))
            setError(null)
          } catch (caught) {
            publish(path, file.name)
            setError(humanError(caught, 'Не удалось записать BPM и тональность'))
          }
        }
        const queued = pendingTagRef.current.get(path)
        if (!queued) return
        pendingTagRef.current.delete(path)
        syncPendingTags()
        const queuedFile = {
          ...named,
          path: settledPath,
          name: baseName(settledPath),
          stem: fileStem(baseName(settledPath))
        }
        try {
          await commitTaggedFile(
            queued.side,
            queuedFile,
            queued.tag,
            queued.action,
            queued.embedCover
          )
          setError(null)
        } catch (caught) {
          setError(humanError(caught, 'Не удалось записать тег'))
        }
      } finally {
        applyingAnalysisRef.current.delete(path)
      }
    },
    [commitTaggedFile, isAudioAnalysisEnabled, replaceFile, syncPendingTags]
  )

  useEffect(() => {
    applyTrackAnalysisRef.current = applyTrackAnalysis
  }, [applyTrackAnalysis])

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

  const orderedPanels = useMemo(() => {
    const view = (side: PanelSide): PanelModel => ({
      ...panels[side],
      files: sortEntries(
        visibleFiles(panels[side].files).map((file) => {
          const listed = applyAutoClean(file, autoCleanNames, blacklistWords)
          if (!autoCleanNames) return listed
          return withKeptTrash(listed, rememberedValues(file, keptTrash))
        }),
        sortConfig[side],
        fileSortFields
      ),
      directories: sortEntries(
        visibleDirectories(panels[side].directories, pendingDeletes),
        sortConfig[side],
        directorySortFields
      )
    })
    return { left: view('left'), right: view('right') }
  }, [autoCleanNames, blacklistWords, keptTrash, panels, pendingDeletes, sortConfig, visibleFiles])

  return {
    panels: orderedPanels,
    selected,
    selectedFiles:
      selectionSide === null
        ? []
        : selectedFiles.filter((path) =>
            visibleFiles(panels[selectionSide].files).some((file) => file.path === path)
          ),
    selectionSide,
    coverRevision,
    playToken,
    error,
    pendingDeletes,
    openPanel,
    refreshPanel,
    prepareDrag,
    keepTrash,
    enterDirectory,
    goUp,
    selectFile,
    selectFiles,
    selectOffset,
    moveFile,
    toggleEnergy,
    assignEnergy,
    requestDelete,
    requestDeleteDirectory,
    createDirectory,
    renameDirectory,
    renameTrack,
    applyTrackAnalysis,
    pendingTagPaths,
    undoDelete,
    sortConfig,
    setPaneSort,
    dismissError: () => setError(null)
  }
}
