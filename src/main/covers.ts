import { app } from 'electron'
import { existsSync } from 'fs'
import { readdir, realpath, stat } from 'fs/promises'
import { basename, join } from 'path'
import { normalizeEnergyFileName, primaryEnergyTag } from '../shared/energy'
import type { BatchResult } from '../shared/types'
import { isAudioFile, isPathInsideRoot, renameAudioFile } from './library'
import { syncAudioTitle, writeCoverImage } from './tags'
import { ensureWritable } from './writable'

export function coversDirectory(): string {
  const directory = app.isPackaged
    ? join(process.resourcesPath, 'covers')
    : join(__dirname, '../../resources/covers')
  const probe = join(directory, 'end.jpg')
  if (existsSync(probe)) return directory
  const unpacked = join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'covers')
  if (app.isPackaged && existsSync(join(unpacked, 'end.jpg'))) return unpacked
  console.error('Cover not found at path:', probe)
  return directory
}

export async function applyCoversInDirectory(
  root: string,
  directory: string,
  coversDir: string,
  embedCovers = true
): Promise<BatchResult> {
  if (!embedCovers) return { updated: 0, failed: 0 }
  return visitAudioFiles(root, directory, async (filePath) => {
    const firstTag = primaryEnergyTag(basename(filePath))
    console.log('Found tag for cover:', firstTag)
    if (!firstTag) return false
    const coverPath = join(coversDir, `${firstTag.toLowerCase()}.jpg`)
    await writeCoverImage(filePath, coverPath)
    return true
  })
}

export async function syncTitlesInDirectory(
  root: string,
  directory: string
): Promise<BatchResult & { renamed: Array<{ from: string; to: string }> }> {
  const renamed: Array<{ from: string; to: string }> = []
  const stats = await visitAudioFiles(root, directory, async (filePath) => {
    await ensureWritable(filePath)
    const name = basename(filePath)
    const nextName = normalizeEnergyFileName(name)
    const changed = nextName !== name
    const target = changed ? await renameAudioFile(root, filePath, nextName) : filePath
    if (changed) renamed.push({ from: filePath, to: target })
    try {
      await syncAudioTitle(target)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (!(changed && message.includes('MP3 и WAV'))) throw error
    }
    return true
  })
  return { ...stats, renamed }
}

async function visitAudioFiles(
  root: string,
  directory: string,
  visit: (filePath: string) => Promise<boolean>
): Promise<BatchResult> {
  const rootReal = await realpath(root)
  const directoryReal = await realpath(directory)
  if (!isPathInsideRoot(rootReal, directoryReal)) {
    throw new Error('Путь вне выбранных папок')
  }
  const directoryStat = await stat(directoryReal)
  if (!directoryStat.isDirectory()) throw new Error('Это не папка')

  let updated = 0
  let failed = 0

  async function walk(current: string): Promise<void> {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      failed += 1
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(current, entry.name)
      try {
        const real = await realpath(full)
        if (!isPathInsideRoot(rootReal, real)) continue
        const info = await stat(real)
        if (info.isDirectory()) {
          await walk(real)
          continue
        }
        if (!info.isFile() || !isAudioFile(real)) continue
        if (await visit(real)) updated += 1
      } catch (error) {
        if (isSkippedWrite(error)) continue
        failed += 1
      }
    }
  }

  await walk(directoryReal)
  return { updated, failed }
}

function isSkippedWrite(error: unknown): boolean {
  return error instanceof Error && error.message.includes('MP3 и WAV')
}
