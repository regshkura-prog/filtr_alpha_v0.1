import { renameSync, rmSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import ffmpeg, { type FfmpegCommand } from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import NodeID3 from 'node-id3'
import { toFileAccessError } from './errors'
import { ensureWritable } from './writable'

export const LOUDNORM_FILTER = 'loudnorm=I=-9:LRA=11:TP=-1.0'

const INTEGRATED_LOUDNESS = /I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/gi

let analysisCommand: FfmpegCommand | null = null

export function parseIntegratedLoudness(output: string): number | null {
  const matches = output.match(INTEGRATED_LOUDNESS)
  if (!matches || matches.length === 0) return null
  const last = matches[matches.length - 1] ?? ''
  const value = Number(last.match(/-?\d+(?:\.\d+)?/)?.[0])
  return Number.isFinite(value) ? value : null
}

export function temporaryLoudnessPath(filePath: string): string {
  return join(dirname(filePath), `${basename(filePath, extname(filePath))}.tmp.mp3`)
}

function ffmpegBinary(): string {
  if (!ffmpegStatic) throw new Error('ffmpeg не найден')
  return ffmpegStatic.includes('app.asar')
    ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
    : ffmpegStatic
}

function configureFfmpeg(): void {
  ffmpeg.setFfmpegPath(ffmpegBinary())
}

function runCommand(command: FfmpegCommand): Promise<string> {
  return new Promise((resolve, reject) => {
    const lines: string[] = []
    let settled = false
    const finish = (error?: Error, output = lines.join('\n')): void => {
      if (settled) return
      settled = true
      if (analysisCommand === command) analysisCommand = null
      if (error) reject(error)
      else resolve(output)
    }
    command
      .on('stderr', (line) => {
        lines.push(line)
      })
      .on('end', () => finish())
      .on('error', (error) => finish(error))
  })
}

export function analyzeIntegratedLoudness(filePath: string): Promise<number> {
  configureFfmpeg()
  const previous = analysisCommand
  const command = ffmpeg(filePath).noVideo().audioFilters('ebur128').format('null')
  analysisCommand = command
  previous?.kill('SIGKILL')
  const output = runCommand(command)
  command.save('-')
  return output.then((text) => {
    const loudness = parseIntegratedLoudness(text)
    if (loudness === null) throw new Error('Не удалось прочитать громкость')
    return loudness
  })
}

function renderFiltered(filePath: string, tempPath: string, filter: string): Promise<void> {
  configureFfmpeg()
  const command = ffmpeg(filePath)
    .noVideo()
    .audioFilters(filter)
    .audioCodec('libmp3lame')
    .audioBitrate('320k')
  const rendered = runCommand(command).then(() => undefined)
  command.save(tempPath)
  return rendered
}

async function rewriteAudioFile(filePath: string, filter: string, fallback: string): Promise<void> {
  if (extname(filePath).toLowerCase() !== '.mp3') {
    throw new Error('Нормализация с сохранением тегов поддерживается для MP3')
  }
  const tempPath = temporaryLoudnessPath(filePath)
  if (tempPath === filePath) throw new Error('Некорректный временный файл')
  const tags = NodeID3.read(filePath)
  let replaced = false
  try {
    await renderFiltered(filePath, tempPath, filter)
    if (tags && typeof tags === 'object') {
      const written = NodeID3.write(tags, tempPath)
      if (written !== true) {
        throw written instanceof Error ? written : new Error('Не удалось записать теги')
      }
    }
    await ensureWritable(filePath)
    renameSync(tempPath, filePath)
    replaced = true
  } catch (error) {
    throw toFileAccessError(error, fallback)
  } finally {
    if (!replaced) rmSync(tempPath, { force: true })
  }
}

export function parseVolumeAdjust(value: unknown): number {
  const source = typeof value === 'number' ? String(value) : value
  if (typeof source !== 'string' || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(source.trim())) {
    throw new Error('Некорректная громкость')
  }
  const numeric = Number(source)
  if (!Number.isFinite(numeric)) throw new Error('Некорректная громкость')
  const rounded = Math.round(numeric * 2) / 2
  if (Math.abs(rounded - numeric) > 1e-6 || rounded < -6 || rounded > 6) {
    throw new Error('Некорректная громкость')
  }
  return rounded
}

export function volumeAdjustFilter(gain: number): string {
  return `volume=${gain.toFixed(1)}dB`
}

export function normalizeAudioFile(filePath: string): Promise<void> {
  return rewriteAudioFile(filePath, LOUDNORM_FILTER, 'Не удалось нормализовать громкость')
}

export function adjustAudioVolume(filePath: string, value: unknown): Promise<void> {
  const gain = parseVolumeAdjust(value)
  if (gain === 0) return Promise.resolve()
  return rewriteAudioFile(filePath, volumeAdjustFilter(gain), 'Не удалось изменить громкость')
}
