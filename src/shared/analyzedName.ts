import {
  ENERGY_TAGS,
  assignEnergyTag,
  energyTagsInName,
  energyTitle,
  sortEnergyTags,
  toggleEnergyTag,
  type EnergyTag
} from './energy'

const TAGS = String.raw`(?<tags>(?:\s*\[(?:PREPARTY|MID|PRIME|PARTY|AFTERPARTY|END)\])*)\s*`
const CAMELOT = String.raw`(?:1[0-2]|[1-9])[AB]`
// A plausible tempo: smaller numbers at the start of a name are track numbers.
const BPM = String.raw`[4-9]\d|[1-9]\d\d`

const ANALYSIS_PREFIXES = [
  // [TAG]124 - 3A - - Title, the format FILTR writes. BPM and key may be empty, and the key
  // may be in musical notation (Am, C#m) that older ID3 keys put into the name.
  String.raw`${TAGS}(?<bpm>\d{1,3})?\s*-\s*(?<key>${CAMELOT}|[A-G][#B]?M?)?\s*-\s*-\s+(?<rest>.*)`,
  // 14 - 12A - 128 - Title: a track number first.
  String.raw`${TAGS}[0-3]?\d\s*-\s*(?<key>${CAMELOT})\s*-\s*(?<bpm>${BPM})\s*-\s*(?<rest>.+)`,
  // 124 - 3A - Title, 136-2A-Title, 113 - 6A or 5A - Title: how other DJ tools name tracks.
  String.raw`${TAGS}(?<bpm>${BPM})\s*-\s*(?<key>${CAMELOT})(?:\s+or\s+${CAMELOT})?\s*-\s*(?<rest>.+)`,
  // 10A - 131 - Title
  String.raw`${TAGS}(?<key>${CAMELOT})\s*-\s*(?<bpm>${BPM})\s*-\s*(?<rest>.+)`,
  // 155 8A Title
  String.raw`${TAGS}(?<bpm>${BPM})\s+(?<key>${CAMELOT})\s+(?<rest>.+)`
].map((pattern) => new RegExp(`^${pattern}$`, 'i'))

function matchAnalysisPrefix(stem: string): Record<string, string | undefined> | null {
  for (const pattern of ANALYSIS_PREFIXES) {
    const groups = pattern.exec(stem)?.groups
    if (groups) return groups
  }
  return null
}

export interface AnalyzedTrackParts {
  tags: EnergyTag[]
  tag: EnergyTag | null
  bpm: number | null
  key: string | null
  originalStem: string
  hasAnalysisPrefix: boolean
  repeatedPrefix: boolean
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
  matches: number
} {
  const tags: EnergyTag[] = []
  let bpm: number | null = null
  let key: string | null = null
  let rest = stem.trim()
  let matches = 0
  // A loop, not a single match: names already broken by the old double prefix heal here.
  // The innermost prefix wins: it is the original one, the outer ones were added on top of it.
  for (let match = matchAnalysisPrefix(rest); match; match = matchAnalysisPrefix(rest)) {
    matches += 1
    tags.push(...energyTagsInName(match.tags ?? ''))
    if (match.bpm) bpm = normalizeAnalysisBpm(Number(match.bpm))
    if (match.key) key = match.key.toUpperCase()
    rest = (match.rest ?? '').trim()
  }
  return { tags, bpm, key, rest, matches }
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
    hasAnalysisPrefix: split.matches > 0,
    repeatedPrefix: split.matches > 1
  }
}

export function knownTrackAnalysis(file: {
  name: string
  tags: { bpm: number | null; key: string | null }
}): { bpm: number; key: string } | null {
  const parts = analyzedTrackParts(file.name)
  const tagBpm = typeof file.tags.bpm === 'number' ? normalizeAnalysisBpm(file.tags.bpm) : null
  // The name wins over ID3, as in energyFileName: ID3 may hold an older automatic guess.
  const bpm = parts.bpm ?? tagBpm
  const key = normalizeCamelot(parts.key ?? '') ?? normalizeCamelot(file.tags.key ?? '')
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
  // An empty list is valid: an untagged track still gets `{BPM} - {KEY} - - Title`.
  const requested = typeof customTags === 'string' ? [customTags] : customTags
  const normalized = requested.map(normalizeEnergyTag)
  if (normalized.some((tag) => tag === null)) throw new Error('Некорректный тег')
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

// With analysis off only the tag changes: the rest of the name stays exactly as it was,
// and BPM or key from ID3 are not pulled in. BPM and key already in the name always win
// over ID3, so they are never written twice.
export function energyFileName(
  file: { name: string; stem: string; tags: { bpm: number | null; key: string | null } },
  tag: EnergyTag,
  action: 'toggle' | 'assign',
  analysisEnabled: boolean
): string {
  if (!analysisEnabled) {
    return action === 'toggle' ? toggleEnergyTag(file.name, tag) : assignEnergyTag(file.name, tag)
  }
  const extension = extensionOf(file.name) || '.mp3'
  const parts = analyzedTrackParts(file.name)
  const originalName = parts.originalStem || file.stem
  if (!originalName) return file.name
  const removing = action === 'toggle' && parts.tags.includes(tag)
  const tags = sortEnergyTags(
    removing ? parts.tags.filter((item) => item !== tag) : [...parts.tags, tag]
  )
  const bpm = parts.bpm ?? file.tags.bpm
  const key = parts.key ?? file.tags.key
  // No usable BPM and key: a bare name instead of an empty "- - -" template.
  if (tags.length === 0 ? !(bpm && key) : !bpm && !key) {
    const prefix = tags.map((item) => `[${item}]`).join('')
    return `${prefix ? `${prefix} ` : ''}${originalName}${extension}`
  }
  try {
    return buildAnalyzedFileName(tags, bpm, key, originalName, extension)
  } catch {
    return file.name
  }
}

// Analysis only adds BPM and key, so energy tags already in the current name must survive.
export function mergeAnalyzedFileName(currentName: string, nextName: string): string {
  if (currentName === nextName) return nextName
  const next = analyzedTrackParts(nextName)
  const extension = extensionOf(nextName)
  if (!next.hasAnalysisPrefix || !extension || !next.originalStem) return nextName
  const tags = sortEnergyTags([...analyzedTrackParts(currentName).tags, ...next.tags])
  if (tags.length === 0) return nextName
  return buildAnalyzedFileName(tags, next.bpm, next.key, next.originalStem, extension)
}
