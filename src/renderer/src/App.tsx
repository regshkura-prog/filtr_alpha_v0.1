import { useEffect, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { FilePanel } from '@renderer/components/FilePanel'
import { Player } from '@renderer/components/Player'
import { TagEditor } from '@renderer/components/TagEditor'
import { usePanels } from '@renderer/hooks/usePanels'
import type { PanelSide } from '../../shared/types'
import logo from './assets/filtr.png'

function App(): React.JSX.Element {
  const crate = usePanels()
  const { selectOffset } = crate
  const [dragSource, setDragSource] = useState<PanelSide | null>(null)
  const activeFiles = crate.selected ? crate.panels[crate.selected.side].files : []
  const fileIndex = crate.selected
    ? activeFiles.findIndex((file) => file.path === crate.selected?.file.path)
    : -1
  const playerKey = String(crate.playToken)

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (crate.editing) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      ) {
        return
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault()
        selectOffset(1)
      }
      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        selectOffset(-1)
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [crate.editing, selectOffset])

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
      onApplyCovers={side === 'right' ? () => void crate.applyCovers(side) : undefined}
      applyingCovers={side === 'right' && crate.applyingCovers}
      autoCovers={crate.autoCovers}
      onAutoCoversChange={side === 'right' ? crate.setAutoCovers : undefined}
      onSyncTitles={side === 'right' ? () => void crate.syncTitles(side) : undefined}
      syncingTitles={side === 'right' && crate.syncingTitles}
      onEnter={(directory) => void crate.enterDirectory(side, directory)}
      onUp={() => void crate.goUp(side)}
      onPlay={(file) => crate.selectFile(side, file)}
      onEdit={(file) => crate.beginEdit(side, file)}
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
      onToggleEnergy={(file, tag) => void crate.toggleEnergy(side, file, tag)}
    />
  )

  return (
    <div className="relative flex h-full flex-col bg-[#09090b] text-white">
      <header className="flex shrink-0 items-center gap-2.5 px-4 pt-3">
        <img src={logo} alt="" className="h-8 w-8 object-contain" />
        <p className="text-sm font-medium tracking-[0.22em] text-white">FILTR</p>
      </header>
      {crate.notice && (
        <div className="absolute top-14 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full bg-white px-4 py-2 text-sm text-black shadow-lg">
          <span>{crate.notice}</span>
          <button
            type="button"
            aria-label="Закрыть"
            title="Закрыть"
            onClick={crate.dismissNotice}
            className="grid size-7 shrink-0 place-items-center rounded-full hover:bg-black/10"
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
      )}
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

      {crate.editing && (
        <TagEditor
          file={crate.editing.file}
          onClose={crate.cancelEdit}
          onSave={crate.saveEdit}
          onToggleEnergy={(tag) => {
            if (!crate.editing) return
            void crate.toggleEnergy(crate.editing.side, crate.editing.file, tag)
          }}
        />
      )}
    </div>
  )
}

export default App
