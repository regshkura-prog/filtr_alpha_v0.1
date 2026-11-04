import { readFileSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { basename, extname } from 'path'
import NodeID3 from 'node-id3'
import { normalizeAnalysisBpm, normalizeCamelot } from '../shared/analyzedName'
import { normalizeEnergyFileName } from '../shared/energy'
import type { AudioTags, TagEdit } from '../shared/types'
import { toFileAccessError } from './errors'
import { writeFlacCover, writeFlacTitle } from './flac'
import { ensureWritable } from './writable'

const WAV_EXTENSIONS = new Set(['.wav', '.wave'])

export function emptyTags(): AudioTags {
  return { artist: null, title: null, genre: null, bpm: null, key: null }
}

export function parseTagEdit(value: unknown): TagEdit {
  if (!value || typeof value !== 'object') throw new Error('Некорректные теги')
  const record = value as Record<string, unknown>
  const bpm = readTagText(record.bpm)
  if (bpm && !/^\d{1,4}(\.\d{1,2})?$/.test(bpm)) throw new Error('BPM должен быть числом')
  return {
    title: readTagText(record.title),
    artist: readTagText(record.artist),
    genre: readTagText(record.genre),
    bpm
  }
}

function readTagText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Некорректные теги')
  const trimmed = value.trim()
  if (trimmed.length > 400) throw new Error('Слишком длинное значение')
  return trimmed
}

function textOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export async function readAudioTags(filePath: string): Promise<AudioTags> {
  try {
    const { parseFile } = await import('music-metadata')
    const metadata = await parseFile(filePath, { duration: false })
    const genre = metadata.common.genre?.map((item) => item.trim()).filter(Boolean) ?? []
    const bpm = metadata.common.bpm
    return {
      artist: textOrNull(metadata.common.artist),
      title: textOrNull(metadata.common.title),
      genre: genre.length > 0 ? genre.join(', ') : null,
      bpm: typeof bpm === 'number' && Number.isFinite(bpm) ? bpm : null,
      key: textOrNull(metadata.common.key)
    }
  } catch {
    return emptyTags()
  }
}

export function titleFromFileName(fileName: string): string {
  const normalized = normalizeEnergyFileName(fileName)
  const dot = normalized.lastIndexOf('.')
  if (dot <= 0) return normalized
  return normalized.slice(0, dot)
}

export async function syncAudioTitle(filePath: string): Promise<void> {
  const title = titleFromFileName(basename(filePath))
  const extension = extname(filePath).toLowerCase()

  if (extension === '.mp3') {
    try {
      const tags = readNodeId3(filePath)
      tags.title = title
      await writeNodeId3(tags, filePath, 'Не удалось записать название')
    } catch (error) {
      throw toFileAccessError(error, 'Не удалось записать название')
    }
    return
  }

  if (WAV_EXTENSIONS.has(extension)) {
    try {
      const source = await readFile(filePath)
      const chunk = readWavId3Chunk(source)
      const tags: NodeID3.Tags = chunk ? readNodeId3(chunk) : {}
      tags.title = title
      await writeWavId3(filePath, tags)
    } catch (error) {
      throw toFileAccessError(error, 'Не удалось записать название')
    }
    return
  }

  if (extension === '.flac') {
    // Rewriting a FLAC copies the whole file, so skip it when the title is already right.
    if ((await readAudioTags(filePath)).title === title) return
    await writeFlacTitle(filePath, title)
    return
  }

  throw new Error('Синхронизация названия поддерживается для FLAC, MP3 и WAV')
}

function coverImage(coverPath: string): NodeID3.Tags['image'] {
  let imageBuffer: Buffer
  try {
    imageBuffer = readFileSync(coverPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error('Cover not found at path:', coverPath)
    }
    throw error
  }
  return {
    mime: 'image/jpeg',
    type: { id: 3, name: 'front cover' },
    description: 'FILTR',
    imageBuffer
  }
}

const COVER_READ_OPTIONS = { include: ['image', 'APIC', 'PIC'] }

export function readAudioCover(filePath: string): string | null {
  try {
    const fromFile = coverDataUrl(NodeID3.read(filePath, COVER_READ_OPTIONS))
    if (fromFile) return fromFile
    if (!WAV_EXTENSIONS.has(extname(filePath).toLowerCase())) return null
    const source = readFileSync(filePath)
    const chunk = readWavId3Chunk(source)
    if (!chunk) return null
    return coverDataUrl(NodeID3.read(chunk, COVER_READ_OPTIONS))
  } catch {
    return null
  }
}

// ID3 first (MP3, WAV), then the format's own picture block (FLAC and others).
export async function readAnyAudioCover(filePath: string): Promise<string | null> {
  const fromId3 = readAudioCover(filePath)
  if (fromId3) return fromId3
  if (extname(filePath).toLowerCase() !== '.flac') return null
  try {
    const { parseFile } = await import('music-metadata')
    const metadata = await parseFile(filePath, { duration: false, skipCovers: false })
    const picture = metadata.common.picture?.[0]
    if (!picture || picture.data.length === 0) return null
    const mime = picture.format.startsWith('image/') ? picture.format : 'image/jpeg'
    return `data:${mime};base64,${Buffer.from(picture.data).toString('base64')}`
  } catch {
    return null
  }
}

function coverDataUrl(tags: NodeID3.Tags | false): string | null {
  if (!tags || typeof tags !== 'object') return null
  const image = tags.image
  if (!image || typeof image === 'string' || !('imageBuffer' in image)) return null
  const buffer = image.imageBuffer
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null
  const mime =
    typeof image.mime === 'string' && image.mime.startsWith('image/') ? image.mime : 'image/jpeg'
  return `data:${mime};base64,${buffer.toString('base64')}`
}

function readNodeId3(source: string | Buffer): NodeID3.Tags {
  const tags = NodeID3.read(source)
  if (!tags || typeof tags !== 'object') return {}
  delete (tags as { raw?: unknown }).raw
  return repairEmptyBinaryFrames(tags)
}

// node-id3 reads an empty UFID or PRIV payload as undefined and then throws when it writes
// the same frame back, which would block every BPM, title and cover write on such a file.
function repairEmptyBinaryFrames(tags: NodeID3.Tags): NodeID3.Tags {
  const record = tags as Record<string, unknown>
  for (const [field, payload] of [
    ['uniqueFileIdentifier', 'identifier'],
    ['private', 'data']
  ] as const) {
    const frames = record[field]
    if (!frames) continue
    for (const frame of (Array.isArray(frames) ? frames : [frames]) as Array<
      Record<string, unknown>
    >) {
      frame[payload] ??= Buffer.alloc(0)
    }
  }
  return tags
}

async function writeNodeId3(tags: NodeID3.Tags, filePath: string, fallback: string): Promise<void> {
  await ensureWritable(filePath)
  const written = NodeID3.write(tags, filePath)
  if (written !== true) throw toFileAccessError(written, fallback)
}

function assignCover(tags: NodeID3.Tags, coverPath: string): NodeID3.Tags {
  delete tags.image
  tags.image = coverImage(coverPath)
  return tags
}

export async function writeCoverImage(filePath: string, coverPath: string): Promise<void> {
  const extension = extname(filePath).toLowerCase()

  if (extension === '.mp3') {
    try {
      const tags = assignCover(readNodeId3(filePath), coverPath)
      await writeNodeId3(tags, filePath, 'Не удалось записать обложку')
    } catch (error) {
      throw toFileAccessError(error, 'Не удалось записать обложку')
    }
    return
  }

  if (WAV_EXTENSIONS.has(extension)) {
    try {
      const source = await readFile(filePath)
      const chunk = readWavId3Chunk(source)
      const tags = assignCover(chunk ? readNodeId3(chunk) : {}, coverPath)
      await writeWavId3(filePath, tags)
    } catch (error) {
      throw toFileAccessError(error, 'Не удалось записать обложку')
    }
    return
  }

  if (extension === '.flac') {
    await writeFlacCover(filePath, coverPath)
    return
  }

  throw new Error('Обложка поддерживается для FLAC, MP3 и WAV')
}

export async function writeAnalysisTags(filePath: string, bpm: number, key: string): Promise<void> {
  const rounded = normalizeAnalysisBpm(bpm)
  if (rounded === null) throw new Error('Некорректный BPM')
  const camelot = normalizeCamelot(key)
  if (!camelot) throw new Error('Некорректная тональность')
  const extension = extname(filePath).toLowerCase()
  const assign = (tags: NodeID3.Tags): void => {
    tags.bpm = String(rounded)
    tags.initialKey = camelot
    const notes = Array.isArray(tags.userDefinedText)
      ? tags.userDefinedText.filter(
          (item) => item.description !== 'KEY' && item.description !== 'TKEY'
        )
      : []
    notes.push({ description: 'KEY', value: camelot })
    tags.userDefinedText = notes
  }

  if (extension === '.mp3') {
    try {
      const tags = readNodeId3(filePath)
      assign(tags)
      await writeNodeId3(tags, filePath, 'Не удалось записать BPM и тональность')
    } catch (error) {
      throw toFileAccessError(error, 'Не удалось записать BPM и тональность')
    }
    return
  }

  if (WAV_EXTENSIONS.has(extension)) {
    try {
      const source = await readFile(filePath)
      const chunk = readWavId3Chunk(source)
      const tags = chunk ? readNodeId3(chunk) : {}
      assign(tags)
      await writeWavId3(filePath, tags)
    } catch (error) {
      throw toFileAccessError(error, 'Не удалось записать BPM и тональность')
    }
    return
  }

  throw new Error('Запись BPM и тональности поддерживается для MP3 и WAV')
}

export async function writeAudioTags(filePath: string, edit: TagEdit): Promise<void> {
  const extension = extname(filePath).toLowerCase()
  const existing = await readAudioTags(filePath)
  const tags: NodeID3.Tags = {
    title: edit.title,
    artist: edit.artist,
    genre: edit.genre,
    bpm: edit.bpm,
    initialKey: existing.key ?? undefined
  }

  if (extension === '.mp3') {
    try {
      await writeNodeId3(tags, filePath, 'Не удалось записать теги')
    } catch (error) {
      throw toFileAccessError(error, 'Не удалось записать теги')
    }
    return
  }

  if (WAV_EXTENSIONS.has(extension)) {
    try {
      await writeWavId3(filePath, tags)
    } catch (error) {
      throw toFileAccessError(error, 'Не удалось записать теги')
    }
    return
  }

  throw new Error('Запись тегов поддерживается для MP3 и WAV')
}

function readWavId3Chunk(source: Buffer): Buffer | null {
  if (
    source.length < 12 ||
    source.toString('ascii', 0, 4) !== 'RIFF' ||
    source.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return null
  }
  let offset = 12
  while (offset + 8 <= source.length) {
    const id = source.toString('ascii', offset, offset + 4)
    const size = source.readUInt32LE(offset + 4)
    const dataEnd = offset + 8 + size
    if (dataEnd > source.length) break
    if (id === 'id3 ') return source.subarray(offset + 8, dataEnd)
    offset = dataEnd + (size % 2)
  }
  return null
}

async function writeWavId3(filePath: string, tags: NodeID3.Tags): Promise<void> {
  await ensureWritable(filePath)
  const source = await readFile(filePath)
  if (
    source.length < 12 ||
    source.toString('ascii', 0, 4) !== 'RIFF' ||
    source.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('Это не WAV')
  }

  const kept: Buffer[] = []
  let offset = 12
  while (offset + 8 <= source.length) {
    const id = source.toString('ascii', offset, offset + 4)
    const size = source.readUInt32LE(offset + 4)
    const dataEnd = offset + 8 + size
    if (dataEnd > source.length) break
    const paddedEnd = dataEnd + (size % 2)
    if (id !== 'id3 ') kept.push(source.subarray(offset, Math.min(paddedEnd, source.length)))
    offset = paddedEnd
  }

  const id3 = NodeID3.create(tags)
  const header = Buffer.alloc(8)
  header.write('id3 ', 0, 'ascii')
  header.writeUInt32LE(id3.length, 4)
  const padding = id3.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0)
  const body = Buffer.concat([...kept, header, id3, padding])
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(4 + body.length, 4)
  riff.write('WAVE', 8, 'ascii')
  try {
    await writeFile(filePath, Buffer.concat([riff, body]))
  } catch (error) {
    throw toFileAccessError(error, 'Не удалось записать теги')
  }
}
