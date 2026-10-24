import type { EnergyTag } from '../shared/energy'
import type {
  AudioFileEntry,
  BatchResult,
  DirectoryEntry,
  FolderScanChunk,
  FolderScanComplete,
  FolderScanStart,
  FolderScanUpdate,
  PanelSide,
  TagEdit
} from '../shared/types'

export interface LibraryApi {
  selectDirectory: (side: PanelSide) => Promise<string | null>
  scanFolder: (side: PanelSide, scanId: string) => Promise<FolderScanStart>
  enterDirectory: (
    side: PanelSide,
    directoryPath: string,
    scanId: string
  ) => Promise<FolderScanStart>
  goUp: (side: PanelSide, scanId: string) => Promise<FolderScanStart>
  restoreDirectory: (
    side: PanelSide,
    root: string,
    current: string,
    scanId: string
  ) => Promise<FolderScanStart | null>
  onFolderScanChunk: (callback: (chunk: FolderScanChunk) => void) => () => void
  onFolderScanComplete: (callback: (event: FolderScanComplete) => void) => () => void
  onFolderScanUpdate: (callback: (update: FolderScanUpdate) => void) => () => void
  moveFile: (
    filePath: string,
    destination: PanelSide,
    directoryPath?: string
  ) => Promise<AudioFileEntry>
  renameFile: (filePath: string, nextName: string) => Promise<AudioFileEntry>
  dragFile: (
    filePath: string,
    nextName: string
  ) => { path: string; name: string; cleaned: boolean; error?: string } | null
  createDirectory: (parentPath: string, name: string) => Promise<DirectoryEntry>
  renameDirectory: (directoryPath: string, nextName: string) => Promise<DirectoryEntry>
  trashDirectory: (directoryPath: string) => Promise<void>
  writeTags: (filePath: string, tags: TagEdit) => Promise<AudioFileEntry>
  writeId3: (
    filePath: string,
    tag: EnergyTag,
    action: 'toggle' | 'assign',
    embedCover?: boolean
  ) => Promise<AudioFileEntry>
  trashFile: (filePath: string) => Promise<void>
  getAudioCover: (filePath: string) => Promise<string | null>
  readAudioFile: (filePath: string) => Promise<ArrayBuffer>
  applyCovers: (directoryPath: string, embedCovers?: boolean) => Promise<BatchResult>
  applyFileCover: (filePath: string) => Promise<boolean>
  syncTitles: (
    directoryPath: string
  ) => Promise<BatchResult & { renamed: Array<{ from: string; to: string }> }>
}

declare global {
  interface Window {
    api?: LibraryApi
  }
}
