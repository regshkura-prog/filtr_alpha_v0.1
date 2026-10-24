import { useEffect, useState } from 'react'
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

function App(): React.JSX.Element {
  const crate = usePanels()
  const { assignEnergy, selectOffset } = crate
  const [dragSource, setDragSource] = useState<PanelSide | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
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
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return
      const tag = energyTagForHotkey(event.code)
      if (!tag) return
      event.preventDefault()
      void assignEnergy(tag)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [assignEnergy, selectOffset])

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
      onPrepareDrag={(file) => crate.prepareDrag(side, file)}
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
      sortConfig={crate.sortConfig[side]}
      onSort={(key) => crate.setPaneSort(side, key)}
    />
  )

  return (
    <div className="relative flex h-full flex-col bg-[#09090b] text-white">
      <header className="flex shrink-0 items-center gap-2.5 px-4 pt-3">
        <img src={logo} alt="" className="h-8 w-8 object-contain" />
        <p className="text-sm font-medium tracking-[0.22em] text-white">FILTR</p>
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
        <div className="absolute top-3 left-1/2 z-20 flex max-w-[70%] -translate-x-1/2 items-center gap-3 rounded-full bg-red-500/15 px-4 py-2 text-sm text-red-100">
          <AlertCircle size={15} strokeWidth={1.5} className="shrink-0" />
          <span className="min-w-0 truncate">{crate.error}</span>
          <button
            type="button"
            aria-label="Закрыть"
            title="Закрыть"
            onClick={crate.dismissError}
            className="grid size-7 shrink-0 place-items-center rounded-full hover:bg-white/10"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}

      <div className="grid min-h-0 flex-[1_1_85%] grid-cols-2 gap-3 px-3 pt-3 pb-1.5">
        {panel('left')}
        {panel('right')}
      </div>
      <div className="min-h-[112px] flex-[1_1_15%] px-3 pt-1.5 pb-3">
        <Player
          key={playerKey}
          file={crate.selected?.file ?? null}
          hasPrevious={fileIndex > 0}
          hasNext={fileIndex >= 0 && fileIndex < activeFiles.length - 1}
          onPrevious={() => selectOffset(-1)}
          onNext={() => selectOffset(1)}
        />
      </div>

      {crate.pendingDeletes.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex flex-col items-center gap-2">
          {crate.pendingDeletes.map((item) => (
            <div
              key={item.id}
              className="pointer-events-auto flex items-center gap-3 rounded-full bg-white py-1.5 pr-1.5 pl-4 text-sm text-black shadow-lg"
            >
              <span>{item.kind === 'directory' ? 'Папка удалена' : 'Трек удален'}</span>
              <button
                type="button"
                onClick={() => crate.undoDelete(item.id)}
                className="rounded-full bg-black px-3 py-1 text-xs text-white transition hover:bg-black/80"
              >
                Отмена
              </button>
            </div>
          ))}
        </div>
      )}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default App
