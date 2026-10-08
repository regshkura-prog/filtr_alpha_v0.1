import type { PanelSide } from '../../../shared/types'

const STORAGE_KEY = 'crate.session.v1'

export type StoredPanel = {
  root: string
  current: string
}

function isStoredPanel(value: unknown): value is StoredPanel {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.root === 'string' &&
    record.root.length > 0 &&
    !record.root.includes('\0') &&
    typeof record.current === 'string' &&
    record.current.length > 0 &&
    !record.current.includes('\0')
  )
}

export function readSession(): Partial<Record<PanelSide, StoredPanel>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const record = parsed as Record<string, unknown>
    const session: Partial<Record<PanelSide, StoredPanel>> = {}
    if (isStoredPanel(record.left)) session.left = record.left
    if (isStoredPanel(record.right)) session.right = record.right
    return session
  } catch {
    return {}
  }
}

export function writeSession(side: PanelSide, panel: StoredPanel | null): void {
  const session = readSession()
  if (panel) session[side] = panel
  else delete session[side]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}
