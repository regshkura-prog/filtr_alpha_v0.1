export function sortByFileName<T extends { name: string }>(files: T[]): T[] {
  return [...files].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  )
}

export type SortKey = 'name' | 'type' | 'dateCreated' | 'dateAdded'

export type SortDirection = 'asc' | 'desc'

export type SortConfig = {
  key: SortKey
  direction: SortDirection
}

export const DEFAULT_SORT: SortConfig = { key: 'name', direction: 'asc' }

const SORT_KEYS = new Set<SortKey>(['name', 'type', 'dateCreated', 'dateAdded'])

export function isSortConfig(value: unknown): value is SortConfig {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<SortConfig>
  return (
    typeof record.key === 'string' &&
    SORT_KEYS.has(record.key as SortKey) &&
    (record.direction === 'asc' || record.direction === 'desc')
  )
}

type SortFields = {
  name: string
  type: string
  dateCreated: number
  dateAdded: number
}

const nameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortEntries<T>(
  entries: readonly T[],
  config: SortConfig,
  fields: (entry: T) => SortFields
): T[] {
  const direction = config.direction === 'asc' ? 1 : -1
  return [...entries].sort((left, right) => {
    const a = fields(left)
    const b = fields(right)
    let result = 0
    if (config.key === 'name') result = nameCollator.compare(a.name, b.name)
    else if (config.key === 'type') {
      result = nameCollator.compare(a.type, b.type)
      if (result === 0) result = nameCollator.compare(a.name, b.name)
    } else {
      const leftTime = config.key === 'dateCreated' ? a.dateCreated : a.dateAdded
      const rightTime = config.key === 'dateCreated' ? b.dateCreated : b.dateAdded
      result = leftTime - rightTime
      if (result === 0) result = nameCollator.compare(a.name, b.name)
    }
    return result * direction
  })
}

export function duplicatePaths(
  files: Array<{ path: string; stem: string; hash: string }>
): Set<string> {
  const matches = new Set<string>()
  const byStem = new Map<string, string[]>()
  const byHash = new Map<string, string[]>()

  for (const file of files) {
    const stemKey = file.stem.toLocaleLowerCase()
    const stemGroup = byStem.get(stemKey) ?? []
    stemGroup.push(file.path)
    byStem.set(stemKey, stemGroup)

    if (!file.hash) continue
    const hashGroup = byHash.get(file.hash) ?? []
    hashGroup.push(file.path)
    byHash.set(file.hash, hashGroup)
  }

  for (const group of [...byStem.values(), ...byHash.values()]) {
    if (group.length < 2) continue
    for (const filePath of group) matches.add(filePath)
  }

  return matches
}
