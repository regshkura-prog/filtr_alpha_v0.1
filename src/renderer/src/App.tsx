import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Settings, X } from 'lucide-react'
import { FilePanel } from '@renderer/components/FilePanel'
import { Player } from '@renderer/components/Player'
import { SettingsDialog } from '@renderer/components/SettingsDialog'
import { IconButton } from '@renderer/components/IconButton'
import { usePanels } from '@renderer/hooks/usePanels'
import { isTypingTarget } from '@renderer/lib/hotkeys'
import { energyTagForHotkey } from '../../shared/energy'
import type { PanelSide } from '../../shared/types'
import logo from './assets/filtr.png'

const MIN_PANEL_WIDTH = 380
const SPLIT_CHROME = 12

function App(): React.JSX.Element {
  const crate = usePanels()
  const { assignEnergy, deleteSelection, selectAll, selectOffset } = crate
  const [dragSource, setDragSource] = useState<PanelSide | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loudnessRevision, setLoudnessRevision] = useState(0)
  const [leftWidth, setLeftWidth] = useState<number | null>(null)
  const [resizing, setResizing] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)
  const leftPaneRef = useRef<HTMLDivElement>(null)
  const rightPaneRef = useRef<HTMLDivElement>(null)
  const stopResizeRef = useRef<(() => void) | null>(null)
  const activeFiles = crate.selected ? crate.panels[crate.selected.side].files : []
  const fileIndex = crate.selected
    ? activeFiles.findIndex((file) => file.path === crate.selected?.file.path)
    : -1
  const playerKey = String(crate.playToken)

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (isTypingTarget()) return
      if (
        event.code === 'ArrowDown' ||
        event.code === 'ArrowUp' ||
        event.code === 'ArrowRight' ||
        event.code === 'ArrowLeft'
      ) {
        if (event.metaKey || event.ctrlKey || event.altKey) return
        event.preventDefault()
        const forward = event.code === 'ArrowDown' || event.code === 'ArrowRight'
        selectOffset(forward ? 1 : -1)
        return
      }
      if (event.code === 'KeyA' && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault()
        selectAll()
        return
      }
      if (event.code === 'Delete' || (event.code === 'Backspace' && event.metaKey)) {
        if (event.repeat) return
        event.preventDefault()
        deleteSelection()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return
      const tag = energyTagForHotkey(event.code)
      if (!tag) return
      event.preventDefault()
      void assignEnergy(tag)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [assignEnergy, deleteSelection, selectAll, selectOffset])

  useEffect(() => () => stopResizeRef.current?.(), [])

  function onResizeStart(event: React.MouseEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    const split = splitRef.current
    const left = leftPaneRef.current
    const right = rightPaneRef.current
    if (!split || !left || !right) return
    event.preventDefault()
    const splitBox = split.getBoundingClientRect()
    const leftBox = left.getBoundingClientRect()
    const rightBox = right.getBoundingClientRect()
    const chrome = splitBox.width - leftBox.width - rightBox.width
    const startX = event.clientX
    const startWidth = leftBox.width
    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setResizing(true)

    const onMove = (moveEvent: MouseEvent): void => {
      const available = Math.max(0, split.getBoundingClientRect().width - chrome)
      const min = Math.min(MIN_PANEL_WIDTH, available / 2)
      const max = Math.max(min, available - min)
      const next = startWidth + (moveEvent.clientX - startX)
      setLeftWidth(Math.round(Math.min(max, Math.max(min, next))))
    }
    const onUp = (): void => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
      setResizing(false)
      stopResizeRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    stopResizeRef.current = onUp
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const panelFloor = `min(${MIN_PANEL_WIDTH}px, calc((100% - ${SPLIT_CHROME}px) / 2))`

  const panel = (side: PanelSide): React.JSX.Element => (
    <FilePanel
      side={side}
      root={crate.panels[side].root}
      files={crate.panels[side].files}
      loading={crate.panels[side].loading}
      scanning={crate.panels[side].scanning}
      totalFiles={crate.panels[side].totalFiles}
      picking={crate.panels[side].picking}
      selectedPath={crate.selected?.side === side ? crate.selected.file.path : null}
      selectedPaths={crate.selectionSide === side ? crate.selectedFiles : []}
      coverRevision={crate.coverRevision}
      pendingTagPaths={crate.pendingTagPaths}
      current={crate.panels[side].current}
      directories={crate.panels[side].directories}
      canMove={Boolean(crate.panels[side === 'left' ? 'right' : 'left'].root)}
      canGoUp={Boolean(
        crate.panels[side].root &&
        crate.panels[side].current &&
        crate.panels[side].root !== crate.panels[side].current
      )}
      onOpen={() => void crate.openPanel(side)}
      onRefresh={() => void crate.refreshPanel(side)}
      onEnter={(directory) => void crate.enterDirectory(side, directory)}
      onUp={() => void crate.goUp(side)}
      onSelect={(file, index, mode) => crate.selectFiles(side, file, index, mode)}
      onKeepTrash={(file, tokenIndex) => crate.keepTrash(side, file, tokenIndex)}
      onMove={(file) => void crate.moveFile(side, file)}
      onDelete={(file) => crate.requestDelete(side, file)}
      onDeleteDirectory={(directory) => crate.requestDeleteDirectory(side, directory)}
      onCreateDirectory={(name) => crate.createDirectory(side, name)}
      onRenameDirectory={(directory, name) => crate.renameDirectory(side, directory, name)}
      onRenameFile={(file, name) => crate.renameTrack(side, file, name)}
      dragSource={dragSource}
      onDragSourceChange={setDragSource}
      onDropFile={(source, path, targetDirectory) => {
        const file = crate.panels[source].files.find((item) => item.path === path)
        if (!file) return
        void crate.moveFile(source, file, targetDirectory)
      }}
      onToggleEnergy={(file, tag, embedCover) =>
        void crate.toggleEnergy(side, file, tag, 'selection', embedCover)
      }
      onLoudnessNormalized={(path) => {
        if (crate.selected?.file.path === path) setLoudnessRevision((value) => value + 1)
      }}
      sortConfig={crate.sortConfig[side]}
      onSort={(key) => crate.setPaneSort(side, key)}
    />
  )

  return (
    <div className="relative flex h-full flex-col bg-canvas text-zinc-100">
      <header className="flex shrink-0 items-center gap-2 px-4 pt-2">
        <img src={logo} alt="" className="h-5 w-5 object-contain" />
        <p className="text-xs font-medium tracking-[0.3em] text-zinc-500">FILTR</p>
        <IconButton
          label="Настройки"
          size="sm"
          onClick={() => setSettingsOpen(true)}
          className="ml-auto"
        >
          <Settings size={16} strokeWidth={1.5} />
        </IconButton>
      </header>
      {crate.error && (
        <div className="absolute top-3 left-1/2 z-20 flex max-w-[70%] -translate-x-1/2 items-center gap-3 rounded-full border border-line bg-surface py-1.5 pr-1.5 pl-4 text-sm text-zinc-200 shadow-lg shadow-black/30">
          <AlertCircle size={15} strokeWidth={1.5} className="shrink-0 text-red-400" />
          <span className="min-w-0 truncate">{crate.error}</span>
          <button
            type="button"
            aria-label="Закрыть"
            title="Закрыть"
            onClick={crate.dismissError}
            className="grid size-7 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-100"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      <div ref={splitRef} className="flex min-h-0 min-w-0 flex-[1_1_85%] gap-1 px-3 pt-2 pb-1.5">
        <div
          ref={leftPaneRef}
          className="h-full min-h-0"
          style={{
            minWidth: panelFloor,
            maxWidth: `calc(100% - ${panelFloor} - ${SPLIT_CHROME}px)`,
            ...(leftWidth == null
              ? { flex: '1 1 0%' }
              : { flexGrow: 0, flexShrink: 1, flexBasis: leftWidth })
          }}
        >
          {panel('left')}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Изменить ширину панелей"
          onMouseDown={onResizeStart}
          className={`relative z-10 w-1 shrink-0 cursor-col-resize transition-colors before:absolute before:inset-y-0 before:-left-1.5 before:w-4 before:content-[''] ${
            resizing ? 'bg-zinc-500' : 'bg-transparent hover:bg-zinc-700'
          }`}
        />
        <div
          ref={rightPaneRef}
          className="h-full min-h-0"
          style={{ flex: '1 1 0%', minWidth: panelFloor }}
        >
          {panel('right')}
        </div>
      </div>
      <div className="min-h-[124px] flex-[1_1_15%] px-3 pt-1.5 pb-3">
        <Player
          key={`${playerKey}:${loudnessRevision}`}
          file={crate.selected?.file ?? null}
          hasPrevious={fileIndex > 0}
          hasNext={fileIndex >= 0 && fileIndex < activeFiles.length - 1}
          onPrevious={() => selectOffset(-1)}
          onNext={() => selectOffset(1)}
          onAnalyzed={(path, analysis) => {
            void crate.applyTrackAnalysis(path, analysis.bpm, analysis.key)
          }}
        />
      </div>

      {crate.pendingDeletes.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex flex-col items-center gap-2">
          {crate.pendingDeletes.map((item) => (
            <div
              key={item.id}
              className="pointer-events-auto flex items-center gap-3 rounded-full border border-line bg-surface py-1.5 pr-1.5 pl-4 text-sm text-zinc-200 shadow-lg shadow-black/30"
            >
              <span>
                {item.kind === 'directory'
                  ? 'Папка удалена'
                  : item.items.length === 1
                    ? 'Трек удален'
                    : `Удалено треков: ${item.items.length}`}
              </span>
              <button
                type="button"
                onClick={() => crate.undoDelete(item.id)}
                className="rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-950 transition hover:bg-zinc-200"
              >
                Отмена
              </button>
            </div>
          ))}
        </div>
      )}
      {settingsOpen ? (
        <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      ) : null}
    </div>
  )
}

export default App
