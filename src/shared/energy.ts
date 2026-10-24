export const ENERGY_TAGS = ['PREPARTY', 'MID', 'PRIME', 'AFTERPARTY', 'END'] as const

export type EnergyTag = (typeof ENERGY_TAGS)[number]

const TAG_PATTERN = /\[(PREPARTY|MID|PRIME|PARTY|AFTERPARTY|END)\]/gi

export function coverFileForTag(tag: EnergyTag): string {
  return `${tag.toLowerCase()}.jpg`
}

export function energyTagsInName(fileName: string): EnergyTag[] {
  return splitEnergyName(fileName).tags
}

export function energyTitle(fileName: string): string {
  return splitEnergyName(fileName).rest
}

export function primaryEnergyTag(fileName: string): EnergyTag | null {
  return energyTagsInName(fileName)[0] ?? null
}

export function normalizeEnergyFileName(fileName: string): string {
  const { tags, rest, extension } = splitEnergyName(fileName)
  return joinEnergyName(rest, tags, extension)
}

export function toggleEnergyTag(fileName: string, tag: EnergyTag): string {
  const { tags, rest, extension } = splitEnergyName(fileName)
  const next = tags.includes(tag) ? tags.filter((item) => item !== tag) : [...tags, tag]
  if (next.length === 0 && rest === '') return fileName
  return joinEnergyName(rest, next, extension)
}

export function assignEnergyTag(fileName: string, tag: EnergyTag): string {
  const { tags, rest, extension } = splitEnergyName(fileName)
  if (tags.includes(tag)) return fileName
  return joinEnergyName(rest, [...tags, tag], extension)
}

const ENERGY_HOTKEY_INDEX: Record<string, number> = {
  Digit1: 0,
  Numpad1: 0,
  Digit2: 1,
  Numpad2: 1,
  Digit3: 2,
  Numpad3: 2,
  Digit4: 3,
  Numpad4: 3,
  Digit5: 4,
  Numpad5: 4
}

export function energyTagForHotkey(code: string): EnergyTag | null {
  const index = ENERGY_HOTKEY_INDEX[code]
  if (index === undefined) return null
  return ENERGY_TAGS[index] ?? null
}

function canonicalTag(value: string): EnergyTag | null {
  const upper = value.toUpperCase()
  if (upper === 'PARTY') return 'PRIME'
  if ((ENERGY_TAGS as readonly string[]).includes(upper)) return upper as EnergyTag
  return null
}

function sortTags(tags: EnergyTag[]): EnergyTag[] {
  const unique = [...new Set(tags)]
  unique.sort((left, right) => ENERGY_TAGS.indexOf(left) - ENERGY_TAGS.indexOf(right))
  return unique
}

function splitEnergyName(fileName: string): {
  tags: EnergyTag[]
  rest: string
  extension: string
} {
  const dot = fileName.lastIndexOf('.')
  const extension = dot > 0 ? fileName.slice(dot) : ''
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const tags: EnergyTag[] = []
  const rest = stem
    .replace(TAG_PATTERN, (_match, tag: string) => {
      const canonical = canonicalTag(tag)
      if (canonical) tags.push(canonical)
      return ' '
    })
    .replace(/\s+/g, ' ')
    .trim()
  return { tags: sortTags(tags), rest, extension }
}

function joinEnergyName(rest: string, tags: EnergyTag[], extension: string): string {
  const sorted = sortTags(tags)
  const prefix = sorted.map((tag) => `[${tag}]`).join('')
  const title = rest.replace(/[ \t]+/g, ' ').trim()
  const stem = prefix ? (title ? `${prefix} ${title}` : prefix) : title
  return `${stem}${extension}`
}
