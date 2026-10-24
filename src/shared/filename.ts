export interface FilenameToken {
  type: 'text' | 'trash'
  value: string
}

export interface ParsedFilename {
  isClean: boolean
  tokens: FilenameToken[]
  cleanName: string | null
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function dictionaryWords(words: readonly string[]): string[] {
  const unique: string[] = []
  for (const word of words) {
    const trimmed = word.trim()
    if (!trimmed) continue
    if (unique.some((item) => item.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) continue
    unique.push(trimmed)
  }
  unique.sort((left, right) => right.length - left.length)
  return unique
}

function trashPattern(blacklistWords: readonly string[] = []): RegExp {
  const words = dictionaryWords(blacklistWords)
  const dictionary =
    words.length > 0
      ? `|(?<![\\p{L}\\p{N}])(?:${words.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`
      : ''
  const builtin = String.raw`\(\s*(?:https?:\/\/|www\.)[^)]*\)|\[\s*(?:https?:\/\/|www\.)[^\]]*\]|(?:https?:\/\/|www\.)\S+|(?<!\S)@\S+|_`
  return new RegExp(`(${builtin}${dictionary})`, 'giu')
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return ''
  return filename.slice(dot)
}

export function cleanStem(tokens: readonly FilenameToken[]): string {
  const raw = tokens
    .map((token) => {
      if (token.type === 'text') return token.value
      return token.value === '_' ? ' ' : ''
    })
    .join('')
  return raw.replace(/[ \t]{2,}/g, ' ').trim()
}

export function fileNameFromTokens(
  filename: string,
  tokens: readonly FilenameToken[]
): string | null {
  const stem = cleanStem(tokens)
  if (!stem) return null
  return `${stem}${extensionOf(filename)}`
}

function tokenizeStem(stem: string, blacklistWords: readonly string[] = []): FilenameToken[] {
  const tokens: FilenameToken[] = []
  let cursor = 0
  for (const match of stem.matchAll(trashPattern(blacklistWords))) {
    const index = match.index ?? 0
    if (index > cursor) tokens.push({ type: 'text', value: stem.slice(cursor, index) })
    tokens.push({ type: 'trash', value: match[0] })
    cursor = index + match[0].length
  }
  if (cursor < stem.length) tokens.push({ type: 'text', value: stem.slice(cursor) })
  return tokens
}

export function parseFilename(
  filename: string,
  blacklistWords: readonly string[] = []
): ParsedFilename {
  const extension = extensionOf(filename)
  const stem = extension ? filename.slice(0, -extension.length) : filename
  const tokens = tokenizeStem(stem, blacklistWords)
  const cleanName = fileNameFromTokens(filename, tokens)
  return {
    isClean: cleanName === filename,
    tokens,
    cleanName
  }
}

export function applyAutoClean<
  T extends { name: string; isClean: boolean; cleanTokens?: FilenameToken[] }
>(file: T, autoCleanNames: boolean, blacklistWords: readonly string[] = []): T {
  if (!autoCleanNames) {
    if (file.isClean && file.cleanTokens === undefined) return file
    return { ...file, isClean: true, cleanTokens: undefined }
  }
  if (blacklistWords.length > 0) {
    const parsed = parseFilename(file.name, blacklistWords)
    if (parsed.isClean) {
      return file.isClean && file.cleanTokens === undefined
        ? file
        : { ...file, isClean: true, cleanTokens: undefined }
    }
    return { ...file, isClean: false, cleanTokens: parsed.tokens }
  }
  if (file.cleanTokens || !file.isClean) return file
  if (!filenameMayContainTrash(file.name)) return file
  const parsed = parseFilename(file.name)
  if (parsed.isClean)
    return file.isClean ? file : { ...file, isClean: true, cleanTokens: undefined }
  return { ...file, isClean: false, cleanTokens: parsed.tokens }
}

function filenameMayContainTrash(name: string): boolean {
  return /_|www\.|https?:\/\/|(^|\s)@/i.test(name)
}

export function cleanedFileName(
  file: {
    name: string
    isClean: boolean
    cleanTokens?: FilenameToken[]
  },
  blacklistWords: readonly string[] = []
): string | null {
  if (file.isClean) return null
  const cleanName = file.cleanTokens
    ? fileNameFromTokens(file.name, file.cleanTokens)
    : parseFilename(file.name, blacklistWords).cleanName
  if (!cleanName || cleanName === file.name) return null
  return cleanName
}

export function withKeptTrash<
  T extends { name: string; isClean: boolean; cleanTokens?: FilenameToken[] }
>(file: T, keptValues: ReadonlySet<string>): T {
  if (keptValues.size === 0 || !file.cleanTokens) return file
  let changed = false
  const cleanTokens = file.cleanTokens.map((token) => {
    if (token.type !== 'trash' || !keptValues.has(token.value)) return token
    changed = true
    return { type: 'text' as const, value: token.value }
  })
  if (!changed) return file
  const cleanName = fileNameFromTokens(file.name, cleanTokens)
  const isClean = cleanName === file.name
  return { ...file, isClean, cleanTokens: isClean ? undefined : cleanTokens }
}
