import { DEFAULT_SORT, isSortConfig, type SortConfig } from '../../../shared/files'
import type { PanelSide } from '../../../shared/types'

const STORAGE_KEY: Record<PanelSide, string> = {
  left: 'leftPaneSort',
  right: 'rightPaneSort'
}

export function readPaneSort(side: PanelSide): SortConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY[side])
    if (!raw) return DEFAULT_SORT
    const parsed: unknown = JSON.parse(raw)
    return isSortConfig(parsed) ? parsed : DEFAULT_SORT
  } catch {
    return DEFAULT_SORT
  }
}

export function writePaneSort(side: PanelSide, config: SortConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY[side], JSON.stringify(config))
  } catch {
    return
  }
}
