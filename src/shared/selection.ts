export type FileSelectMode = 'single' | 'toggle' | 'range'

// An action on a selected row applies to the whole selection, in list order. An action on a
// row outside the selection applies to that row only.
export function actionTargets<T extends { path: string }>(
  files: readonly T[],
  selected: readonly string[],
  file: T
): T[] {
  const paths = new Set(selected)
  if (!paths.has(file.path)) return [file]
  const targets = files.filter((item) => paths.has(item.path))
  return targets.length > 0 ? targets : [file]
}

export function applyFileSelection(
  filePaths: readonly string[],
  selected: readonly string[],
  anchor: number | null,
  index: number,
  mode: 'toggle' | 'range'
): { selected: string[]; anchor: number | null } {
  if (index < 0 || index >= filePaths.length) {
    return { selected: [...selected], anchor }
  }
  const path = filePaths[index]
  if (mode === 'toggle') {
    const next = selected.includes(path)
      ? selected.filter((item) => item !== path)
      : [...selected, path]
    return { selected: next, anchor: index }
  }
  const startAnchor = anchor === null ? index : Math.min(Math.max(anchor, 0), filePaths.length - 1)
  const from = Math.min(startAnchor, index)
  const to = Math.max(startAnchor, index)
  return { selected: filePaths.slice(from, to + 1), anchor: startAnchor }
}
