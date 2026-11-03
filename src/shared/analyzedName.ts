import {
  ENERGY_TAGS,
  energyTagsInName,
  energyTitle,
  sortEnergyTags,
  type EnergyTag
} from './energy'

// [TAG][TAG]124 - 3A - - Title. BPM and key may be empty: [TAG] - - - Title.
// The key also accepts musical notation (Am, C#m) that older ID3 keys put into the name.
const ANALYSIS_PREFIX =
  /^((?:\s*\[(?:PREPARTY|MID|PRIME|PARTY|AFTERPARTY|END)\])*)\s*(\d{1,3})?\s*-\s*((?:[1-9]|1[0-2])[AB]|[A-G][#B]?M?)?\s*-\s*-\s+(.*)$/i

export interface AnalyzedTrackParts {
  tags: EnergyTag[]
  tag: EnergyTag | null
  bpm: number | null
  key: string | null
  originalStem: string
  hasAnalysisPrefix: boolean
}

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

function splitAnalyzedStem(stem: string): {
  tags: EnergyTag[]
  bpm: number | null
  key: string | null
  rest: string
  matched: boolean
} {
  const tags: EnergyTag[] = []
  let bpm: number | null = null
  let key: string | null = null
  let rest = stem.trim()
  let matched = false
  // A loop, not a single match: names already broken by the old double prefix heal here.
  for (let match = ANALYSIS_PREFIX.exec(rest); match; match = ANALYSIS_PREFIX.exec(rest)) {
    matched = true
    tags.push(...energyTagsInName(match[1] ?? ''))
    bpm ??= match[2] ? normalizeAnalysisBpm(Number(match[2])) : null
    key ??= match[3] ? match[3].toUpperCase() : null
    rest = (match[4] ?? '').trim()
  }
  return { tags, bpm, key, rest, matched }
}

export function analyzedTrackParts(fileName: string): AnalyzedTrackParts {
  const extension = extensionOf(fileName)
  const stem = extension ? fileName.slice(0, -extension.length) : fileName
  const split = splitAnalyzedStem(stem)
  const restName = `${split.rest}${extension}`
  const tags = sortEnergyTags([...split.tags, ...energyTagsInName(restName)])
  return {
    tags,
    tag: tags[0] ?? null,
    bpm: split.bpm,
    key: split.key,
    originalStem: energyTitle(restName),
    hasAnalysisPrefix: split.matched
  }
}

export function knownTrackAnalysis(file: {
  name: string
  tags: { bpm: number | null; key: string | null }
}): { bpm: number; key: string } | null {
  const parts = analyzedTrackParts(file.name)
  const tagBpm = typeof file.tags.bpm === 'number' ? normalizeAnalysisBpm(file.tags.bpm) : null
  const bpm = tagBpm ?? parts.bpm
  const key = normalizeCamelot(file.tags.key ?? '') ?? normalizeCamelot(parts.key ?? '')
  if (bpm === null || key === null) return null
  return { bpm, key }
}

export function buildAnalyzedFileName(
  customTags: string | readonly string[],
  bpm: number | null | undefined,
  key: string | null | undefined,
  originalName: string,
  extension = '.mp3'
): string {
  const requested = typeof customTags === 'string' ? [customTags] : customTags
  const normalized = requested.map(normalizeEnergyTag)
  if (normalized.length === 0 || normalized.some((tag) => tag === null)) {
    throw new Error('Некорректный тег')
  }
  const existing = splitAnalyzedStem(originalName)
  const stem = existing.rest
  if (!stem) throw new Error('Пустое имя')
  const tags = sortEnergyTags([...existing.tags, ...(normalized as EnergyTag[])])
  const resolvedBpm = bpm || existing.bpm
  const resolvedKey = key?.trim() || existing.key
  const formattedBpm = resolvedBpm ? String(Math.round(resolvedBpm)) : ''
  const formattedKey = resolvedKey ? resolvedKey.toUpperCase() : ''
  const trimmed = extension.trim()
  const suffix = trimmed ? (trimmed.startsWith('.') ? trimmed : `.${trimmed}`) : '.mp3'
  const prefix = tags.map((tag) => `[${tag}]`).join('')
  const newFileName = `${prefix}${formattedBpm} - ${formattedKey} - - ${stem}${suffix}`
  return newFileName.replace(/\s+/g, ' ')
}

// Analysis only adds BPM and key, so energy tags already in the current name must survive.
export function mergeAnalyzedFileName(currentName: string, nextName: string): string {
  const next = analyzedTrackParts(nextName)
  const extension = extensionOf(nextName)
  if (!next.hasAnalysisPrefix || !extension || !next.originalStem) return nextName
  const tags = sortEnergyTags([...analyzedTrackParts(currentName).tags, ...next.tags])
  if (tags.length === 0) return nextName
  return buildAnalyzedFileName(tags, next.bpm, next.key, next.originalStem, extension)
}
