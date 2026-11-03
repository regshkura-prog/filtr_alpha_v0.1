import { execFile } from 'child_process'
import { renameSync, rmSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { toFileAccessError } from './errors'
import { ffmpegBinary, waitForLoudnessAnalysis } from './loudness'
import { ensureWritable } from './writable'

export function temporaryCoverPath(filePath: string): string {
  return join(dirname(filePath), `${basename(filePath, extname(filePath))}.cover.tmp.flac`)
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

// FLAC keeps covers in a PICTURE block, not ID3. ffmpeg copies the audio untouched,
// keeps the Vorbis comments and replaces any previous cover with the given one.
// "Cover (front)" is the comment DJ software reads as the front cover.
export async function writeFlacCover(filePath: string, coverPath: string): Promise<void> {
  const tempPath = temporaryCoverPath(filePath)
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
      '-i',
      coverPath,
      '-map',
      '0:a',
      '-map',
      '1:0',
      '-map_metadata',
      '0',
      '-c',
      'copy',
      '-disposition:v:0',
      'attached_pic',
      '-metadata:s:v',
      'title=Album cover',
      '-metadata:s:v',
      'comment=Cover (front)',
      '-f',
      'flac',
      tempPath
    ])
    await ensureWritable(filePath)
    renameSync(tempPath, filePath)
    replaced = true
  } catch (error) {
    throw toFileAccessError(error, 'Не удалось записать обложку')
  } finally {
    if (!replaced) rmSync(tempPath, { force: true })
  }
}
