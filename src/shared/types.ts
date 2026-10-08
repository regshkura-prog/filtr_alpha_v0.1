export type PanelSide = 'left' | 'right'

export interface AudioTags {
  artist: string | null
  title: string | null
  genre: string | null
  bpm: number | null
  key: string | null
}

export interface BatchResult {
  updated: number
  failed: number
}

export interface TagEdit {
  title: string
  artist: string
  genre: string
  bpm: string
}

export interface DirectoryEntry {
  name: string
  path: string
  isDirectory: true
}

export interface AudioFileEntry {
  name: string
  path: string
  extension: string
  size: number
  modifiedAt: number
  stem: string
  hash: string
  tags: AudioTags
  isDirectory: false
}

export interface PanelView {
  root: string
  listing: DirectoryListing
}

export interface DirectoryListing {
  path: string
  directories: DirectoryEntry[]
  files: AudioFileEntry[]
}

export interface FolderScanStart {
  scanId: string
  root: string
  path: string
  directories: DirectoryEntry[]
  totalFiles: number
}

export interface FolderScanChunk {
  scanId: string
  side: PanelSide
  files: AudioFileEntry[]
}

export interface FolderScanComplete {
  scanId: string
  side: PanelSide
  error?: string
}

export interface FolderScanUpdate {
  scanId: string
  side: PanelSide
  files: AudioFileEntry[]
}
