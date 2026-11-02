import { ENERGY_TAGS, energyTitle, primaryEnergyTag, type EnergyTag } from './energy'

const ANALYSIS_PREFIX =
  /^\[(PREPARTY|MID|PRIME|PARTY|AFTERPARTY|END)\]\d{1,3} - \d{1,2}[AB] - - (.*)$/i

export function normalizeEnergyTag(value: string): EnergyTag | null {
  const bare = value.trim().replace(/^\[/, '').replace(/\]$/, '')
  const upper = bare.toUpperCase()
  if (upper === 'PARTY') return 'PRIME'
  if ((ENERGY_TAGS as readonly string[]).includes(upper)) return upper as EnergyTag
  return null
}

export function normalizeCamelot(value: string): string | null {
  const key = value.trim().toUpperCase()
  return /^(?:[1-9]|1[0-2])[AB]$/.test(key) ? key : null
}

export function normalizeAnalysisBpm(value: number): number | null {
  if (!Number.isFinite(value)) return null
  const rounded = Math.round(value)
  if (rounded < 1 || rounded > 999) return null
  return rounded
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return ''
  return fileName.slice(dot)
}

export function analyzedTrackParts(fileName: string): {
  tag: EnergyTag | null
  originalStem: string
} {
  const extension = extensionOf(fileName)
  const stem = extension ? fileName.slice(0, -extension.length) : fileName
  const match = ANALYSIS_PREFIX.exec(stem)
  if (match) {
    return {
      tag: normalizeEnergyTag(match[1] ?? ''),
      originalStem: (match[2] ?? '').trim()
    }
  }
  return { tag: primaryEnergyTag(fileName), originalStem: energyTitle(fileName) }
}

export function buildAnalyzedFileName(
  customTag: string,
  bpm: number | null | undefined,
  key: string | null | undefined,
  originalName: string,
  extension = '.mp3'
): string {
  const normalizedTag = normalizeEnergyTag(customTag)
  if (!normalizedTag) throw new Error('Некорректный тег')
  const stem = originalName.trim()
  if (!stem) throw new Error('Пустое имя')
  const formattedBpm = bpm ? String(Math.round(bpm)) : ''
  const formattedKey = key ? key.trim().toUpperCase() : ''
  const trimmed = extension.trim()
  const suffix = trimmed ? (trimmed.startsWith('.') ? trimmed : `.${trimmed}`) : '.mp3'
  const newFileName = `[${normalizedTag}]${formattedBpm} - ${formattedKey} - - ${stem}${suffix}`
  return newFileName.replace(/\s+/g, ' ')
}
