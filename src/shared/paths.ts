import path from 'path'

type PathApi = Pick<typeof path, 'normalize' | 'resolve' | 'sep'>

export function relocatePath(
  filePath: string,
  from: string,
  to: string,
  pathApi: PathApi = path
): string | null {
  const current = foldCase(canonicalPath(filePath, pathApi), pathApi)
  const source = foldCase(canonicalPath(from, pathApi), pathApi)
  const target = canonicalPath(to, pathApi)
  if (current === source) return target
  const prefix = source.endsWith(pathApi.sep) ? source : `${source}${pathApi.sep}`
  if (!current.startsWith(prefix)) return null
  return `${target}${pathApi.sep}${current.slice(prefix.length)}`
}

export function isInsideDirectory(root: string, target: string, pathApi: PathApi = path): boolean {
  const rootPath = foldCase(canonicalPath(root, pathApi), pathApi)
  const targetPath = foldCase(canonicalPath(target, pathApi), pathApi)
  if (rootPath === targetPath) return true
  const prefix = rootPath.endsWith(pathApi.sep) ? rootPath : `${rootPath}${pathApi.sep}`
  return targetPath.startsWith(prefix)
}

function canonicalPath(filePath: string, pathApi: PathApi): string {
  return pathApi.normalize(pathApi.resolve(stripExtendedPath(filePath)))
}

function stripExtendedPath(filePath: string): string {
  if (filePath.startsWith('\\\\?\\UNC\\')) return `\\\\${filePath.slice(8)}`
  if (filePath.startsWith('\\\\?\\')) return filePath.slice(4)
  return filePath
}

function foldCase(filePath: string, pathApi: PathApi): string {
  return pathApi.sep === '\\' ? filePath.toLowerCase() : filePath
}
