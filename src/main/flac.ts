import { execFile } from 'child_process'
import { renameSync, rmSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { toFileAccessError } from './errors'
import { ffmpegBinary, waitForLoudnessAnalysis } from './loudness'
import { ensureWritable } from './writable'

export function temporaryFlacPath(filePath: string): string {
  return join(dirname(filePath), `${basename(filePath, extname(filePath))}.filtr.tmp.flac`)
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegBinary(), args, { windowsHide: true }, (error, _stdout, stderr) => {
      if (!error) {
        resolve()
        return
      }
      const detail = String(stderr).trim().split('\n').pop()
      reject(new Error(detail || error.message))
    })
  })
}

// FLAC has no ID3: tags are Vorbis comments and the cover is a PICTURE block. ffmpeg
// rewrites the container with the audio copied untouched, then the copy replaces the file.
async function rewriteFlac(filePath: string, args: string[], fallback: string): Promise<void> {
  const tempPath = temporaryFlacPath(filePath)
  let replaced = false
  await waitForLoudnessAnalysis(filePath)
  try {
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      filePath,
      ...args,
      '-map_metadata',
      '0',
      '-c',
      'copy',
      '-f',
      'flac',
      tempPath
    ])
    await ensureWritable(filePath)
    renameSync(tempPath, filePath)
    replaced = true
  } catch (error) {
    throw toFileAccessError(error, fallback)
  } finally {
    if (!replaced) rmSync(tempPath, { force: true })
  }
}

// Replaces any previous cover. "Cover (front)" is the comment DJ software reads as the front cover.
export function writeFlacCover(filePath: string, coverPath: string): Promise<void> {
  return rewriteFlac(
    filePath,
    [
      '-i',
      coverPath,
      '-map',
      '0:a',
      '-map',
      '1:0',
      '-disposition:v:0',
      'attached_pic',
      '-metadata:s:v',
      'title=Album cover',
      '-metadata:s:v',
      'comment=Cover (front)'
    ],
    'Не удалось записать обложку'
  )
}

// The TITLE comment is what Rekordbox and Serato show in the library, so it carries the tags.
// The cover stream, if any, is kept as it is.
export function writeFlacTitle(filePath: string, title: string): Promise<void> {
  return rewriteFlac(
    filePath,
    ['-map', '0', '-metadata', `title=${title}`],
    'Не удалось записать название'
  )
}
