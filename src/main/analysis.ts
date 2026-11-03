import { realpathSync } from 'fs'
import { basename, dirname } from 'path'
import {
  mergeAnalyzedFileName,
  normalizeAnalysisBpm,
  normalizeCamelot
} from '../shared/analyzedName'
import { assertSafeFileName, renameAudioFileSync, resolveAudioFile } from './library'
import { writeAnalysisTags } from './tags'

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
  await writeAnalysisTags(real, rounded, camelot)
  if (basename(real) === finalName) return real
  return renameAudioFileSync(real, finalName, [rootPath, dirname(real)])
}
