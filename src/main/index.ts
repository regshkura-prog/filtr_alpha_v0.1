import { createReadStream, existsSync } from 'fs'
import { readFile, realpath, stat } from 'fs/promises'
import { homedir } from 'os'
import { basename, dirname, join } from 'path'
import { Readable } from 'stream'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
  type IpcMainInvokeEvent
} from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ENERGY_TAGS, normalizeEnergyFileName, type EnergyTag } from '../shared/energy'
import { relocatePath } from '../shared/paths'
import { FILE_BUSY_MESSAGE, isFileBusy } from './errors'
import type { FolderScanStart, PanelSide } from '../shared/types'
import {
  createDirectory,
  describeAudioFile,
  enrichDirectoryFiles,
  isPathInsideRoot,
  mimeTypeFor,
  moveAudioFile,
  parentDirectory,
  readDirectoryIndex,
  renameAudioFile,
  renameAudioFileSync,
  renameDirectory,
  resolveAudioFile,
  resolveLibraryDirectory,
  streamDirectoryFiles
} from './library'
import {
  applyCoverToFile,
  applyCoversInDirectory,
  applyEnergyToFile,
  coversDirectory,
  syncTitlesInDirectory
} from './covers'
import { adjustAudioVolume, analyzeIntegratedLoudness, normalizeAudioFile } from './loudness'
import { applyTagsAndRename } from './analysis'
import { parseTagEdit, readAnyAudioCover, syncAudioTitle, writeAudioTags } from './tags'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true
    }
  }
])

let mainWindow: BrowserWindow | null = null
const panelLocations: Record<PanelSide, { root: string; current: string } | null> = {
  left: null,
  right: null
}
const activeScans = new Map<PanelSide, string>()

function asSide(value: unknown): PanelSide {
  if (value === 'left' || value === 'right') return value
  throw new Error('Некорректная панель')
}

function openRoots(): string[] {
  return [panelLocations.left?.root, panelLocations.right?.root].filter((root): root is string =>
    Boolean(root)
  )
}

function requireLocation(side: PanelSide): { root: string; current: string } {
  const location = panelLocations[side]
  if (!location) throw new Error('Сначала выберите папку')
  return location
}

function emitScan(channel: string, payload: unknown): void {
  const contents = mainWindow?.webContents
  if (!contents || contents.isDestroyed()) return
  contents.send(channel, payload)
}

function scanIsCurrent(side: PanelSide, scanId: string): boolean {
  return activeScans.get(side) === scanId
}

async function publishScan(
  side: PanelSide,
  scanId: string,
  rootReal: string,
  filePaths: string[]
): Promise<void> {
  await Promise.resolve()
  if (!scanIsCurrent(side, scanId)) return
  const revealed: string[] = []
  try {
    await streamDirectoryFiles(
      rootReal,
      filePaths,
      () => scanIsCurrent(side, scanId),
      (files) => {
        if (!scanIsCurrent(side, scanId)) return
        for (const file of files) revealed.push(file.path)
        emitScan('folder-scan-chunk', { scanId, side, files })
      }
    )
  } catch (error) {
    if (!scanIsCurrent(side, scanId)) return
    const message = error instanceof Error ? error.message : 'Не удалось прочитать папку'
    emitScan('folder-scan-complete', { scanId, side, error: message })
    console.error(error)
    return
  }
  if (!scanIsCurrent(side, scanId)) return
  emitScan('folder-scan-complete', { scanId, side })
  try {
    await enrichDirectoryFiles(
      revealed,
      () => scanIsCurrent(side, scanId),
      (files) => {
        if (!scanIsCurrent(side, scanId)) return
        emitScan('folder-scan-update', { scanId, side, files })
      }
    )
  } catch (error) {
    console.error(error)
  }
}

async function beginScan(side: PanelSide, scanId: unknown): Promise<FolderScanStart> {
  if (typeof scanId !== 'string' || !scanId || scanId.includes('\0') || scanId.length > 80) {
    throw new Error('Некорректный запрос')
  }
  activeScans.set(side, scanId)
  const location = requireLocation(side)
  const root = location.root
  const current = location.current
  const index = await readDirectoryIndex(root, current)
  if (!scanIsCurrent(side, scanId)) {
    return {
      scanId,
      root,
      path: index.path,
      directories: index.directories,
      totalFiles: index.filePaths.length
    }
  }
  void publishScan(side, scanId, index.root, index.filePaths)
  return {
    scanId,
    root,
    path: index.path,
    directories: index.directories,
    totalFiles: index.filePaths.length
  }
}

async function resolveFromOpenRoots(filePath: string): Promise<string> {
  const roots = openRoots()
  if (roots.length === 0) throw new Error('Сначала выберите папку')
  let lastError: unknown = null
  for (const root of roots) {
    try {
      return await resolveAudioFile(root, filePath)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Файл недоступен')
}

async function rootContaining(filePath: string): Promise<string> {
  const roots = openRoots()
  if (roots.length === 0) throw new Error('Сначала выберите папку')
  let busy: unknown = null
  for (const root of roots) {
    try {
      await resolveAudioFile(root, filePath)
      return root
    } catch (error) {
      if (isFileBusy(error)) busy = error
    }
  }
  if (busy) throw busy instanceof Error ? busy : new Error(FILE_BUSY_MESSAGE)
  throw new Error('Файл вне выбранных папок')
}

function retargetOpenPanels(from: string, to: string | null): void {
  for (const side of ['left', 'right'] as const) {
    const location = panelLocations[side]
    if (!location) continue
    if (to) {
      const root = relocatePath(location.root, from, to)
      const current = relocatePath(location.current, from, to)
      if (root) location.root = root
      if (current) location.current = current
      continue
    }
    if (isPathInsideRoot(from, location.root)) location.root = dirname(from)
    if (
      isPathInsideRoot(from, location.current) ||
      !isPathInsideRoot(location.root, location.current)
    ) {
      const parent = dirname(from)
      location.current = isPathInsideRoot(location.root, parent) ? parent : location.root
    }
  }
}

async function requireOpenDirectory(
  directoryPath: unknown
): Promise<{ root: string; directory: string }> {
  if (typeof directoryPath !== 'string' || !directoryPath || directoryPath.includes('\0')) {
    throw new Error('Некорректный путь')
  }
  const directory = await realpath(directoryPath)
  const info = await stat(directory)
  if (!info.isDirectory()) throw new Error('Это не папка')
  const root = openRoots().find((item) => isPathInsideRoot(item, directory))
  if (!root) throw new Error('Путь вне выбранных папок')
  return { root, directory }
}

function defaultMusicPath(): string {
  const music = join(homedir(), 'Music')
  return existsSync(music) ? music : homedir()
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  if (!mainWindow) return false
  return event.sender.id === mainWindow.webContents.id
}

function corsHeaders(contentType = 'text/plain; charset=utf-8'): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type',
    'Cache-Control': 'no-store',
    'Content-Type': contentType
  })
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, { status, headers: corsHeaders() })
}

function parseRange(header: string, total: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || total <= 0) return null
  const startText = match[1] ?? ''
  const endText = match[2] ?? ''
  if (startText === '' && endText === '') return null

  if (startText === '') {
    const suffix = Number(endText)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    return { start: Math.max(total - suffix, 0), end: total - 1 }
  }

  const start = Number(startText)
  const end = endText === '' ? total - 1 : Number(endText)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || start >= total || end < start) return null
  return { start, end: Math.min(end, total - 1) }
}

function fileStreamResponse(
  filePath: string,
  start: number,
  end: number,
  status: number,
  headers: Headers,
  signal: AbortSignal
): Response {
  const nodeStream = createReadStream(filePath, { start, end })
  const close = (): void => {
    if (!nodeStream.destroyed) nodeStream.destroy()
  }
  nodeStream.on('error', close)
  if (signal.aborted) close()
  else signal.addEventListener('abort', close, { once: true })
  const body = Readable.toWeb(nodeStream) as ReadableStream
  return new Response(body, { status, headers })
}

async function serveFile(request: Request, filePath: string): Promise<Response> {
  const fileStat = await stat(filePath)
  const total = fileStat.size
  const headers = corsHeaders(mimeTypeFor(filePath))
  headers.set('Accept-Ranges', 'bytes')

  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(total))
    return new Response(null, { status: 200, headers })
  }

  if (total === 0) {
    headers.set('Content-Length', '0')
    return new Response(new Uint8Array(), { status: 200, headers })
  }

  const rangeHeader = request.headers.get('range')
  if (!rangeHeader) {
    headers.set('Content-Length', String(total))
    return fileStreamResponse(filePath, 0, total - 1, 200, headers, request.signal)
  }

  const range = parseRange(rangeHeader, total)
  if (!range) {
    headers.set('Content-Range', `bytes */${total}`)
    return new Response(null, { status: 416, headers })
  }

  const length = range.end - range.start + 1
  headers.set('Content-Length', String(length))
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${total}`)
  return fileStreamResponse(filePath, range.start, range.end, 206, headers, request.signal)
}

function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() })
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return errorResponse(405, 'Метод не поддерживается')
      }
      if (openRoots().length === 0) return errorResponse(403, 'Библиотека не выбрана')

      const filePath = new URL(request.url).searchParams.get('path')
      if (!filePath || filePath.includes('\0')) return errorResponse(400, 'Не указан путь')

      const real = await resolveFromOpenRoots(filePath)
      return await serveFile(request, real)
    } catch (error) {
      console.error('media:', error instanceof Error ? error.message : error)
      return errorResponse(403, 'Файл недоступен')
    }
  })
}

function registerLibraryIpc(): void {
  ipcMain.handle('library:selectDirectory', async (event, side: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    const panel = asSide(side)
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent) throw new Error('Нет окна')
    const result = await dialog.showOpenDialog(parent, {
      title: 'Открыть папку с музыкой',
      properties: ['openDirectory'],
      defaultPath: panelLocations[panel]?.current ?? defaultMusicPath()
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const picked = result.filePaths[0]
    if (!picked) return null
    const root = await realpath(picked)
    panelLocations[panel] = { root, current: root }
    return root
  })

  ipcMain.handle('library:scanFolder', async (event, side: unknown, scanId: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    return beginScan(asSide(side), scanId)
  })

  ipcMain.handle(
    'library:enterDirectory',
    async (event, side: unknown, directoryPath: unknown, scanId: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
      if (typeof directoryPath !== 'string' || !directoryPath || directoryPath.includes('\0')) {
        throw new Error('Некорректный путь')
      }
      const panel = asSide(side)
      const location = requireLocation(panel)
      const next = await realpath(directoryPath)
      const nextStat = await stat(next)
      if (!nextStat.isDirectory()) throw new Error('Это не папка')
      if (!isPathInsideRoot(location.root, next)) throw new Error('Путь вне выбранной библиотеки')
      location.current = next
      return beginScan(panel, scanId)
    }
  )

  ipcMain.handle('library:goUp', async (event, side: unknown, scanId: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    const panel = asSide(side)
    const location = requireLocation(panel)
    const parent = parentDirectory(location.root, location.current)
    if (parent) location.current = parent
    return beginScan(panel, scanId)
  })

  ipcMain.handle(
    'library:restoreDirectory',
    async (event, side: unknown, root: unknown, current: unknown, scanId: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
      const panel = asSide(side)
      if (typeof root !== 'string' || !root || root.includes('\0')) return null
      let rootReal: string
      try {
        rootReal = await realpath(root)
        const rootStat = await stat(rootReal)
        if (!rootStat.isDirectory()) return null
      } catch {
        return null
      }
      let currentReal = rootReal
      if (typeof current === 'string' && current && !current.includes('\0')) {
        try {
          const resolved = await realpath(current)
          const currentStat = await stat(resolved)
          if (currentStat.isDirectory() && isPathInsideRoot(rootReal, resolved)) {
            currentReal = resolved
          }
        } catch {
          currentReal = rootReal
        }
      }
      panelLocations[panel] = { root: rootReal, current: currentReal }
      return beginScan(panel, scanId)
    }
  )

  ipcMain.handle(
    'library:moveFile',
    async (event, filePath: unknown, side: unknown, directoryPath: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
      if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
        throw new Error('Некорректный путь')
      }
      const destinationSide = asSide(side)
      let destination = panelLocations[destinationSide]?.current
      if (typeof directoryPath === 'string') {
        if (!directoryPath || directoryPath.includes('\0')) throw new Error('Некорректный путь')
        const resolved = await realpath(directoryPath)
        const info = await stat(resolved)
        if (!info.isDirectory()) throw new Error('Цель должна быть папкой')
        if (!openRoots().some((root) => isPathInsideRoot(root, resolved))) {
          throw new Error('Путь вне выбранных папок')
        }
        destination = resolved
      } else if (directoryPath != null) {
        throw new Error('Некорректный путь')
      }
      if (!destination) throw new Error('Сначала выберите папку на другой панели')
      const sourceRoot = await rootContaining(filePath)
      const movedPath = await moveAudioFile(sourceRoot, filePath, destination)
      return describeAudioFile(movedPath)
    }
  )

  ipcMain.handle('get-audio-cover', async (event, filePath: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) return null
    try {
      const root = await rootContaining(filePath)
      const real = await resolveAudioFile(root, filePath)
      return await readAnyAudioCover(real)
    } catch {
      return null
    }
  })

  ipcMain.handle('read-audio-file', async (event, filePath: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
      throw new Error('Некорректный путь')
    }
    const root = await rootContaining(filePath)
    const real = await resolveAudioFile(root, filePath)
    const data = await readFile(real)
    const copy = new Uint8Array(data.byteLength)
    copy.set(data)
    return copy.buffer
  })

  ipcMain.on('library:dragFile', (event, filePath: unknown, nextName: unknown) => {
    if (!isTrustedSender(event)) {
      event.returnValue = {
        path: '',
        name: '',
        cleaned: false,
        error: 'Недоверенный отправитель'
      }
      return
    }
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
      event.returnValue = { path: '', name: '', cleaned: false, error: 'Некорректный путь' }
      return
    }
    let path = filePath
    let name = basename(filePath)
    let cleaned = false
    if (typeof nextName === 'string' && nextName && nextName !== name) {
      try {
        path = renameAudioFileSync(filePath, nextName, openRoots())
        name = basename(path)
        cleaned = true
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Не удалось переименовать файл'
        try {
          event.sender.startDrag({ file: filePath, icon })
        } catch {
          // Внутренний перенос остаётся на исходном пути.
        }
        event.returnValue = { path: filePath, name, cleaned: false, error: message }
        return
      }
    }
    try {
      event.sender.startDrag({ file: path, icon })
    } catch {
      // Внутренний перенос использует путь из dataTransfer.
    }
    event.returnValue = { path, name, cleaned }
  })

  ipcMain.handle('library:renameFile', async (event, filePath: unknown, nextName: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
      throw new Error('Некорректный путь')
    }
    if (typeof nextName !== 'string') throw new Error('Некорректное имя файла')
    const root = await rootContaining(filePath)
    const renamedPath = await renameAudioFile(root, filePath, normalizeEnergyFileName(nextName))
    try {
      await syncAudioTitle(renamedPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (!message.includes('MP3 и WAV')) throw error
    }
    return describeAudioFile(renamedPath)
  })

  ipcMain.handle('sync-id3-titles-in-folder', async (event, directoryPath: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    const { root, directory } = await requireOpenDirectory(directoryPath)
    return syncTitlesInDirectory(root, directory)
  })

  ipcMain.handle(
    'apply-covers-to-folder',
    async (event, directoryPath: unknown, embedCovers: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
      const { root, directory } = await requireOpenDirectory(directoryPath)
      return applyCoversInDirectory(root, directory, coversDirectory(), embedCovers !== false)
    }
  )

  ipcMain.handle(
    'write-id3',
    async (
      event,
      filePath: unknown,
      tag: unknown,
      action: unknown,
      embedCover: unknown,
      nextName: unknown
    ) => {
      if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
      if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
        throw new Error('Некорректный путь')
      }
      if (typeof tag !== 'string' || !(ENERGY_TAGS as readonly string[]).includes(tag)) {
        throw new Error('Некорректный тег')
      }
      if (action !== 'toggle' && action !== 'assign') throw new Error('Некорректное действие')
      if (nextName != null && typeof nextName !== 'string')
        throw new Error('Некорректное имя файла')
      const root = await rootContaining(filePath)
      return applyEnergyToFile(
        root,
        filePath,
        tag as EnergyTag,
        action,
        coversDirectory(),
        embedCover !== false,
        typeof nextName === 'string' && nextName.trim() ? nextName.trim() : undefined
      )
    }
  )

  ipcMain.handle('apply-cover-to-file', async (event, filePath: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
      throw new Error('Некорректный путь')
    }
    const root = await rootContaining(filePath)
    return applyCoverToFile(root, filePath, coversDirectory())
  })

  ipcMain.handle('library:createDirectory', async (event, parentPath: unknown, name: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    if (typeof name !== 'string') throw new Error('Некорректное имя папки')
    const { root, directory } = await requireOpenDirectory(parentPath)
    return createDirectory(root, directory, name)
  })

  ipcMain.handle(
    'library:renameDirectory',
    async (event, directoryPath: unknown, nextName: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
      if (typeof nextName !== 'string') throw new Error('Некорректное имя папки')
      const { root, directory } = await requireOpenDirectory(directoryPath)
      const renamed = await renameDirectory(root, directory, nextName)
      retargetOpenPanels(directory, renamed.path)
      return renamed
    }
  )

  ipcMain.handle('library:trashDirectory', async (event, directoryPath: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    const { root, directory } = await requireOpenDirectory(directoryPath)
    const real = await resolveLibraryDirectory(root, directory)
    await shell.trashItem(real)
    retargetOpenPanels(real, null)
  })

  ipcMain.handle('library:trashFile', async (event, filePath: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
      throw new Error('Некорректный путь')
    }
    const root = await rootContaining(filePath)
    const real = await resolveAudioFile(root, filePath)
    await shell.trashItem(real)
  })

  ipcMain.handle('analyze-audio', async (event, filePath: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
      throw new Error('Некорректный путь')
    }
    const root = await rootContaining(filePath)
    const real = await resolveAudioFile(root, filePath)
    return analyzeIntegratedLoudness(real)
  })

  ipcMain.handle('normalize-audio', async (event, filePath: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
      throw new Error('Некорректный путь')
    }
    const root = await rootContaining(filePath)
    const real = await resolveAudioFile(root, filePath)
    await normalizeAudioFile(real)
  })

  ipcMain.handle('manual-volume', async (event, filePath: unknown, gain: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
      throw new Error('Некорректный путь')
    }
    const root = await rootContaining(filePath)
    const real = await resolveAudioFile(root, filePath)
    await adjustAudioVolume(real, gain)
  })

  ipcMain.handle('library:writeTags', async (event, filePath: unknown, tags: unknown) => {
    if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
      throw new Error('Некорректный путь')
    }
    const root = await rootContaining(filePath)
    const real = await resolveAudioFile(root, filePath)
    await writeAudioTags(real, parseTagEdit(tags))
    return describeAudioFile(real)
  })

  ipcMain.handle(
    'apply-tags-and-rename',
    async (event, oldPath: unknown, newFileName: unknown, bpm: unknown, key: unknown) => {
      if (!isTrustedSender(event)) throw new Error('Недоверенный отправитель')
      if (typeof oldPath !== 'string' || !oldPath || oldPath.includes('\0')) {
        throw new Error('Некорректный путь')
      }
      if (typeof newFileName !== 'string') throw new Error('Некорректное имя файла')
      if (typeof bpm !== 'number' || !Number.isFinite(bpm)) throw new Error('Некорректный BPM')
      if (typeof key !== 'string') throw new Error('Некорректная тональность')
      const root = await rootContaining(oldPath)
      return applyTagsAndRename(root, oldPath, newFileName, bpm, key)
    }
  )
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    center: true,
    title: 'FILTR',
    icon,
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Файл не открывается вкладкой. Приём drop остаётся у страницы.
      navigateOnDragDrop: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })

  // preventDefault на file: отменяет drop на Windows и оставляет курсор «запрещено»:
  // Chromium считает перетаскивание файла попыткой открыть его страницей.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file:')) return
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl && url.startsWith(rendererUrl)) return
    event.preventDefault()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.raredead.filtr')
    if (!app.userAgentFallback.includes('Electron')) {
      app.userAgentFallback = `${app.userAgentFallback} Electron/${process.versions.electron}`
    }
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerMediaProtocol()
    registerLibraryIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
