const STORAGE_KEY = 'filtr.autoCovers'

export function readAutoCovers(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function writeAutoCovers(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {
    return
  }
}
