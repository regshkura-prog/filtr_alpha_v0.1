import { realpathSync } from 'fs'
import { basename, dirname, extname } from 'path'
import {
  mergeAnalyzedFileName,
  normalizeAnalysisBpm,
  normalizeCamelot
} from '../shared/analyzedName'
import { assertSafeFileName, renameAudioFileSync, resolveAudioFile } from './library'
import { waitForLoudnessAnalysis } from './loudness'
import { writeAnalysisTags } from './tags'

const ID3_EXTENSIONS = new Set(['.mp3', '.wav', '.wave'])

export async function applyTagsAndRename(
  rootPath: string,
  oldPath: string,
  newFileName: string,
  bpm: number,
  key: string
): Promise<string> {
  const rounded = normalizeAnalysisBpm(bpm)
  if (rounded === null) throw new Error('Некорректный BPM')
  const camelot = normalizeCamelot(key)
  if (!camelot) throw new Error('Некорректная тональность')
  const safeName = assertSafeFileName(newFileName)
  const resolved = await resolveAudioFile(rootPath, oldPath)
  // realpath and realpathSync can disagree on Windows 8.3 short names.
  const real = realpathSync(resolved)
  const finalName = assertSafeFileName(mergeAnalyzedFileName(basename(real), safeName))
  await waitForLoudnessAnalysis(real)
  // FLAC, AIFF and the rest have no ID3 here, but still get BPM and key in the name.
  if (ID3_EXTENSIONS.has(extname(real).toLowerCase())) {
    await writeAnalysisTags(real, rounded, camelot)
  }
  if (basename(real) === finalName) return real
  return renameAudioFileSync(real, finalName, [rootPath, dirname(real)])
}
