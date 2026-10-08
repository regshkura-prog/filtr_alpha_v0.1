const STORAGE_KEY = 'filtr_volume'
const DEFAULT_VOLUME = 0.5

export function readVolume(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null || raw === '') return DEFAULT_VOLUME
    const value = Number(raw)
    if (!Number.isFinite(value)) return DEFAULT_VOLUME
    return Math.min(1, Math.max(0, value))
  } catch {
    return DEFAULT_VOLUME
  }
}

export function writeVolume(volume: number): void {
  const clamped = Math.min(1, Math.max(0, volume))
  localStorage.setItem(STORAGE_KEY, String(clamped))
}
