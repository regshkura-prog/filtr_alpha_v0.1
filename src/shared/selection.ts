export type FileSelectMode = 'single' | 'toggle' | 'range'

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
