import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { copyFile, mkdir, readdir, realpath, rename, rm, stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import type { AudioFileEntry, DirectoryEntry, DirectoryListing } from '../shared/types'
import { sortByFileName } from '../shared/files'
import { isInsideDirectory } from '../shared/paths'
import { FILE_BUSY_MESSAGE, isFileBusy, toFileAccessError } from './errors'
import { ensureWritable } from './writable'
import { emptyTags, readAudioTags } from './tags'

export const SCAN_CHUNK_SIZE = 50
const ENRICH_BATCH_SIZE = 10
const ENRICH_CONCURRENCY = 2

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.wave',
  '.flac',
  '.aiff',
  '.aif',
  '.aifc',
  '.ogg',
  '.oga',
  '.opus',
  '.m4a',
  '.aac',
  '.wma',
  '.alac',
  '.caf'
])

const MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.flac': 'audio/flac',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.aifc': 'audio/aiff',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.alac': 'audio/mp4',
  '.wma': 'audio/x-ms-wma',
  '.caf': 'audio/x-caf'
}

export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase())
}

export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

export function isPathInsideRoot(root: string, target: string): boolean {
  return isInsideDirectory(root, target)
}

export function assertSafeDirectoryName(name: string): string {
  const trimmed = name.trim()
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0') ||
    /[<>:"|?*]/.test(trimmed) ||
    trimmed.endsWith('.') ||
    trimmed.endsWith(' ')
  ) {
    throw new Error('Некорректное имя папки')
  }
  return trimmed
}

export function assertSafeFileName(name: string): string {
  const trimmed = name.trim()
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0') ||
    /[<>:"|?*]/.test(trimmed)
  ) {
    throw new Error('Некорректное имя файла')
  }
  if (!isAudioFile(trimmed)) throw new Error('Имя должно заканчиваться расширением аудиофайла')
  return trimmed
}

async function resolveInsideRoot(rootPath: string, targetPath: string): Promise<string> {
  try {
    const rootReal = await realpath(rootPath)
    const targetReal = await realpath(targetPath)
    if (!isPathInsideRoot(rootReal, targetReal)) {
      throw new Error('Путь вне выбранной библиотеки')
    }
    return targetReal
  } catch (error) {
    throw toFileAccessError(error, 'Путь недоступен')
  }
}

export async function resolveAudioFile(rootPath: string, filePath: string): Promise<string> {
  const fileReal = await resolveInsideRoot(rootPath, filePath)
  if (!isAudioFile(fileReal)) throw new Error('Формат не поддерживается')
  const fileStat = await stat(fileReal)
  if (!fileStat.isFile()) throw new Error('Это не файл')
  return fileReal
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return name
  return name.slice(0, dot)
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  try {
    for await (const chunk of stream) hash.update(chunk)
    return hash.digest('hex')
  } finally {
    stream.destroy()
  }
}

export async function describeAudioFile(filePath: string): Promise<AudioFileEntry> {
  const fileStat = await stat(filePath)
  const name = basename(filePath)
  const [hash, tags] = await Promise.all([hashFile(filePath), readAudioTags(filePath)])
  return {
    name,
    path: filePath,
    extension: extname(name).slice(1).toLowerCase(),
    size: fileStat.size,
    modifiedAt: fileStat.mtimeMs,
    stem: stemOf(name),
    hash,
    tags,
    isDirectory: false
  }
}

export function parentDirectory(root: string, current: string): string | null {
  if (current === root) return null
  const parent = dirname(current)
  if (parent === current) return null
  if (!isPathInsideRoot(root, parent)) return null
  return parent
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function moveByRename(source: string, destination: string): Promise<void> {
  await ensureWritable(source)
  try {
    await rename(source, destination)
  } catch (error) {
    if (isFileBusy(error)) throw new Error(FILE_BUSY_MESSAGE)
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    try {
      await copyFile(source, destination)
      await rm(source)
    } catch (copyError) {
      throw toFileAccessError(copyError, 'Не удалось переместить файл')
    }
  }
}

export async function createDirectory(
  rootPath: string,
  parentPath: string,
  name: string
): Promise<DirectoryEntry> {
  const parent = await resolveInsideRoot(rootPath, parentPath)
  const parentStat = await stat(parent)
  if (!parentStat.isDirectory()) throw new Error('Это не папка')
  const safeName = assertSafeDirectoryName(name)
  const destination = join(parent, safeName)
  if (await pathExists(destination)) throw new Error('Папка с таким именем уже есть')
  await mkdir(destination)
  const real = await realpath(destination)
  const rootReal = await realpath(rootPath)
  if (!isPathInsideRoot(rootReal, real)) throw new Error('Путь вне выбранной библиотеки')
  return { name: safeName, path: real, isDirectory: true }
}

export async function renameDirectory(
  rootPath: string,
  directoryPath: string,
  nextName: string
): Promise<DirectoryEntry> {
  const rootReal = await realpath(rootPath)
  const real = await resolveInsideRoot(rootPath, directoryPath)
  if (real === rootReal) throw new Error('Нельзя переименовать корневую папку')
  const info = await stat(real)
  if (!info.isDirectory()) throw new Error('Это не папка')
  const safeName = assertSafeDirectoryName(nextName)
  const destination = join(dirname(real), safeName)
  if (destination === real) return { name: basename(real), path: real, isDirectory: true }
  if (await pathExists(destination)) throw new Error('Папка с таким именем уже есть')
  try {
    await rename(real, destination)
  } catch (error) {
    throw toFileAccessError(error, 'Не удалось переименовать папку')
  }
  const renamed = await realpath(destination)
  if (!isPathInsideRoot(rootReal, renamed)) throw new Error('Путь вне выбранной библиотеки')
  return { name: basename(renamed), path: renamed, isDirectory: true }
}

export async function resolveLibraryDirectory(
  rootPath: string,
  directoryPath: string
): Promise<string> {
  const rootReal = await realpath(rootPath)
  const real = await resolveInsideRoot(rootPath, directoryPath)
  if (real === rootReal) throw new Error('Нельзя удалить корневую папку')
  const info = await stat(real)
  if (!info.isDirectory()) throw new Error('Это не папка')
  return real
}

export async function renameAudioFile(
  rootPath: string,
  filePath: string,
  nextName: string
): Promise<string> {
  const real = await resolveAudioFile(rootPath, filePath)
  const safeName = assertSafeFileName(nextName)
  const destination = join(dirname(real), safeName)
  if (destination === real) return real
  if (await pathExists(destination)) throw new Error('Файл с таким именем уже есть')
  await moveByRename(real, destination)
  return destination
}

export async function moveAudioFile(
  sourceRoot: string,
  filePath: string,
  destinationRoot: string
): Promise<string> {
  const real = await resolveAudioFile(sourceRoot, filePath)
  const destinationDirectory = await realpath(destinationRoot)
  const destination = join(destinationDirectory, basename(real))
  if (destination === real) throw new Error('Файл уже в этой папке')
  if (!isPathInsideRoot(destinationDirectory, destination)) {
    throw new Error('Путь вне выбранной библиотеки')
  }
  if (await pathExists(destination)) throw new Error('В другой папке уже есть файл с таким именем')
  await moveByRename(real, destination)
  return destination
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const item = items[index]
      if (item === undefined) return
      results[index] = await worker(item)
    }
  }

  const workers = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: workers }, () => run()))
  return results
}

export interface DirectoryIndex {
  path: string
  root: string
  directories: DirectoryEntry[]
  filePaths: string[]
}

export async function readDirectoryIndex(
  rootPath: string,
  directoryPath: string
): Promise<DirectoryIndex> {
  const directoryReal = await resolveInsideRoot(rootPath, directoryPath)
  const rootReal = await realpath(rootPath)
  const directoryStat = await stat(directoryReal)
  if (!directoryStat.isDirectory()) throw new Error('Это не папка')

  const entries = await readdir(directoryReal, { withFileTypes: true })
  const directoryCandidates: Array<{ name: string; fullPath: string }> = []
  const fileCandidates: Array<{ name: string; fullPath: string }> = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = join(directoryReal, entry.name)
    let kind: 'directory' | 'file' | null = null
    if (entry.isDirectory()) kind = 'directory'
    else if (entry.isFile()) kind = 'file'
    else if (entry.isSymbolicLink()) {
      try {
        const linked = await stat(fullPath)
        if (linked.isDirectory()) kind = 'directory'
        else if (linked.isFile()) kind = 'file'
      } catch {
        continue
      }
    }
    if (!kind) continue
    if (kind === 'file' && !isAudioFile(entry.name)) continue
    if (kind === 'directory') directoryCandidates.push({ name: entry.name, fullPath })
    else fileCandidates.push({ name: entry.name, fullPath })
  }

  const resolvedDirectories = await Promise.all(
    directoryCandidates.map(async (candidate) => {
      try {
        const realEntryPath = await realpath(candidate.fullPath)
        if (!isPathInsideRoot(rootReal, realEntryPath)) return null
        const directory: DirectoryEntry = {
          name: candidate.name,
          path: realEntryPath,
          isDirectory: true
        }
        return directory
      } catch {
        return null
      }
    })
  )

  return {
    path: directoryReal,
    root: rootReal,
    directories: sortByFileName(
      resolvedDirectories.filter((directory): directory is DirectoryEntry => directory !== null)
    ),
    filePaths: sortByFileName(fileCandidates).map((candidate) => candidate.fullPath)
  }
}

async function resolveListedAudio(
  rootReal: string,
  filePath: string
): Promise<AudioFileEntry | null> {
  try {
    const real = await realpath(filePath)
    if (!isPathInsideRoot(rootReal, real) || !isAudioFile(real)) return null
    const info = await stat(real)
    if (!info.isFile()) return null
    const name = basename(real)
    return {
      name,
      path: real,
      extension: extname(name).slice(1).toLowerCase(),
      size: info.size,
      modifiedAt: info.mtimeMs,
      stem: stemOf(name),
      hash: '',
      tags: emptyTags(),
      isDirectory: false
    }
  } catch {
    return null
  }
}

export async function streamDirectoryFiles(
  rootReal: string,
  filePaths: string[],
  shouldContinue: () => boolean,
  onChunk: (files: AudioFileEntry[]) => void
): Promise<void> {
  for (let offset = 0; offset < filePaths.length; offset += SCAN_CHUNK_SIZE) {
    if (!shouldContinue()) return
    const slice = filePaths.slice(offset, offset + SCAN_CHUNK_SIZE)
    const resolved = await Promise.all(
      slice.map((filePath) => resolveListedAudio(rootReal, filePath))
    )
    if (!shouldContinue()) return
    const files = resolved.filter((file): file is AudioFileEntry => file !== null)
    if (files.length > 0) onChunk(files)
  }
}

export async function enrichDirectoryFiles(
  filePaths: string[],
  shouldContinue: () => boolean,
  onUpdate: (files: AudioFileEntry[]) => void
): Promise<void> {
  let batch: AudioFileEntry[] = []
  const flush = (): void => {
    if (batch.length === 0) return
    const ready = batch
    batch = []
    onUpdate(ready)
  }

  await mapLimited(filePaths, ENRICH_CONCURRENCY, async (filePath) => {
    if (!shouldContinue()) return
    try {
      const file = await describeAudioFile(filePath)
      if (!shouldContinue()) return
      batch.push(file)
      if (batch.length >= ENRICH_BATCH_SIZE) flush()
    } catch {
      return
    }
  })
  flush()
}

export async function listAudioDirectory(
  rootPath: string,
  directoryPath: string
): Promise<DirectoryListing> {
  const index = await readDirectoryIndex(rootPath, directoryPath)
  const files = await mapLimited(index.filePaths, 4, async (filePath) => {
    const listed = await resolveListedAudio(index.root, filePath)
    if (!listed) return null
    return describeAudioFile(listed.path)
  })
  return {
    path: index.path,
    directories: index.directories,
    files: sortByFileName(files.filter((file): file is AudioFileEntry => file != null))
  }
}
