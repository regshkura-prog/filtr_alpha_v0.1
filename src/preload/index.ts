import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
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

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => {
    callback(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  selectDirectory: (side: PanelSide): Promise<string | null> =>
    ipcRenderer.invoke('library:selectDirectory', side),
  scanFolder: (side: PanelSide, scanId: string): Promise<FolderScanStart> =>
    ipcRenderer.invoke('library:scanFolder', side, scanId),
  enterDirectory: (
    side: PanelSide,
    directoryPath: string,
    scanId: string
  ): Promise<FolderScanStart> =>
    ipcRenderer.invoke('library:enterDirectory', side, directoryPath, scanId),
  goUp: (side: PanelSide, scanId: string): Promise<FolderScanStart> =>
    ipcRenderer.invoke('library:goUp', side, scanId),
  restoreDirectory: (
    side: PanelSide,
    root: string,
    current: string,
    scanId: string
  ): Promise<FolderScanStart | null> =>
    ipcRenderer.invoke('library:restoreDirectory', side, root, current, scanId),
  onFolderScanChunk: (callback: (chunk: FolderScanChunk) => void): (() => void) =>
    subscribe('folder-scan-chunk', callback),
  onFolderScanComplete: (callback: (event: FolderScanComplete) => void): (() => void) =>
    subscribe('folder-scan-complete', callback),
  onFolderScanUpdate: (callback: (update: FolderScanUpdate) => void): (() => void) =>
    subscribe('folder-scan-update', callback),
  moveFile: (
    filePath: string,
    destination: PanelSide,
    directoryPath?: string
  ): Promise<AudioFileEntry> =>
    ipcRenderer.invoke('library:moveFile', filePath, destination, directoryPath),
  renameFile: (filePath: string, nextName: string): Promise<AudioFileEntry> =>
    ipcRenderer.invoke('library:renameFile', filePath, nextName),
  dragFile: (
    filePath: string,
    nextName: string
  ): { path: string; name: string; cleaned: boolean; error?: string } | null =>
    ipcRenderer.sendSync('library:dragFile', filePath, nextName),
  createDirectory: (parentPath: string, name: string): Promise<DirectoryEntry> =>
    ipcRenderer.invoke('library:createDirectory', parentPath, name),
  renameDirectory: (directoryPath: string, nextName: string): Promise<DirectoryEntry> =>
    ipcRenderer.invoke('library:renameDirectory', directoryPath, nextName),
  trashDirectory: (directoryPath: string): Promise<void> =>
    ipcRenderer.invoke('library:trashDirectory', directoryPath),
  writeTags: (filePath: string, tags: TagEdit): Promise<AudioFileEntry> =>
    ipcRenderer.invoke('library:writeTags', filePath, tags),
  writeId3: (
    filePath: string,
    tag: EnergyTag,
    action: 'toggle' | 'assign',
    embedCover = true
  ): Promise<AudioFileEntry> => ipcRenderer.invoke('write-id3', filePath, tag, action, embedCover),
  trashFile: (filePath: string): Promise<void> => ipcRenderer.invoke('library:trashFile', filePath),
  getAudioCover: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('get-audio-cover', filePath),
  readAudioFile: async (filePath: string): Promise<ArrayBuffer> => {
    const payload: unknown = await ipcRenderer.invoke('read-audio-file', filePath)
    return toArrayBuffer(payload)
  },
  applyCovers: (directoryPath: string, embedCovers = true): Promise<BatchResult> =>
    ipcRenderer.invoke('apply-covers-to-folder', directoryPath, embedCovers),
  applyFileCover: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('apply-cover-to-file', filePath),
  syncTitles: (
    directoryPath: string
  ): Promise<BatchResult & { renamed: Array<{ from: string; to: string }> }> =>
    ipcRenderer.invoke('sync-id3-titles-in-folder', directoryPath)
}

function toArrayBuffer(payload: unknown): ArrayBuffer {
  if (payload instanceof ArrayBuffer) return payload
  if (ArrayBuffer.isView(payload)) {
    const copy = new Uint8Array(payload.byteLength)
    copy.set(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength))
    return copy.buffer
  }
  throw new Error('Не удалось прочитать файл')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  console.error('Context isolation is disabled; refusing to expose the library API')
}
