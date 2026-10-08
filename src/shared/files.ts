export function sortByFileName<T extends { name: string }>(files: T[]): T[] {
  return [...files].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
  )
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
