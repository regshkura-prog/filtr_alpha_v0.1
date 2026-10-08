export function baseName(filePath: string): string {
  const parts = filePath.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? filePath
}

export function fileStem(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return name
  return name.slice(0, dot)
}

export function mediaUrl(filePath: string): string {
  return `media://local/?path=${encodeURIComponent(filePath)}`
}

export function audioMime(extension: string): string {
  switch (extension) {
    case 'wav':
    case 'wave':
      return 'audio/wav'
    case 'flac':
      return 'audio/flac'
    case 'ogg':
    case 'oga':
    case 'opus':
      return 'audio/ogg'
    case 'm4a':
    case 'aac':
    case 'alac':
      return 'audio/mp4'
    case 'aiff':
    case 'aif':
    case 'aifc':
      return 'audio/aiff'
    default:
      return 'audio/mpeg'
  }
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remain = total % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`
  }
  return `${minutes}:${String(remain).padStart(2, '0')}`
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unit]}`
}

export function formatChannels(channels: number): string {
  if (channels === 1) return 'Mono'
  if (channels === 2) return 'Stereo'
  return `${channels} ch`
}

export function formatModified(timestamp: number): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(new Date(timestamp))
}

export function humanError(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || error.message.trim() === '') return fallback
  const marker = 'Error: '
  const index = error.message.lastIndexOf(marker)
  const message = index >= 0 ? error.message.slice(index + marker.length) : error.message
  return message.trim() || fallback
}
