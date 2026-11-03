import { useContext, useEffect, useRef, useState } from 'react'
import { Disc3, Loader2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import WaveSurfer from 'wavesurfer.js'
import type { AudioFileEntry } from '../../../shared/types'
import { knownTrackAnalysis } from '../../../shared/analyzedName'
import { IconButton } from '@renderer/components/IconButton'
import { SettingsContext } from '@renderer/context/settings-context'
import {
  analyzeTrackAudio,
  cancelTrackAnalysis,
  readTrackAnalysis,
  rememberTrackAnalysis,
  type TrackAnalysis
} from '@renderer/lib/audioAnalysis'
import { audioMime, fileStem, formatDuration } from '@renderer/lib/format'
import { isTypingTarget } from '@renderer/lib/hotkeys'
import { readVolume, writeVolume } from '@renderer/lib/volume'

type PlayerProps = {
  file: AudioFileEntry | null
  hasPrevious: boolean
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
  onAnalyzed: (path: string, analysis: TrackAnalysis) => void
}

export function Player({
  file,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onAnalyzed
}: PlayerProps): React.JSX.Element {
  const { isAudioAnalysisEnabled } = useContext(SettingsContext)
  const containerRef = useRef<HTMLDivElement>(null)
  const waveRef = useRef<WaveSurfer | null>(null)
  const onNextRef = useRef(onNext)
  const previousPathRef = useRef<string | null>(null)
  const [sourcePath, setSourcePath] = useState<string | null>(file?.path ?? null)
  const [ready, setReady] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [volume, setVolume] = useState(readVolume)
  const [muted, setMuted] = useState(false)
  const analysisEnabledRef = useRef(isAudioAnalysisEnabled)
  const onAnalyzedRef = useRef(onAnalyzed)

  useEffect(() => {
    onNextRef.current = onNext
  }, [onNext])

  useEffect(() => {
    analysisEnabledRef.current = isAudioAnalysisEnabled
    onAnalyzedRef.current = onAnalyzed
  }, [isAudioAnalysisEnabled, onAnalyzed])

  const fileRef = useRef(file)
  useEffect(() => {
    fileRef.current = file
  }, [file])

  const wasEnabledRef = useRef(isAudioAnalysisEnabled)
  useEffect(() => {
    const turnedOn = isAudioAnalysisEnabled && !wasEnabledRef.current
    wasEnabledRef.current = isAudioAnalysisEnabled
    if (!isAudioAnalysisEnabled) {
      cancelTrackAnalysis()
      return
    }
    const path = file?.path
    if (!turnedOn || !path) return
    const cached = readTrackAnalysis(path)
    if (cached) {
      onAnalyzedRef.current(path, cached)
      return
    }
    const known = fileRef.current ? knownTrackAnalysis(fileRef.current) : null
    if (known) {
      onAnalyzedRef.current(path, known)
      return
    }
    const api = window.api
    if (!api) return
    let cancelled = false
    void api
      .readAudioFile(path)
      .then((buffer) => {
        if (cancelled || !analysisEnabledRef.current) return null
        return analyzeTrackAudio(true, buffer.slice(0))
      })
      .then((result) => {
        if (!result || cancelled || !analysisEnabledRef.current) return
        rememberTrackAnalysis(path, result)
        onAnalyzedRef.current(path, result)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [file?.path, isAudioAnalysisEnabled])

  useEffect(() => {
    const nextPath = file?.path ?? null
    const previousPath = previousPathRef.current
    if (nextPath === previousPath) return
    previousPathRef.current = nextPath
    if (previousPath && nextPath && waveRef.current) {
      setSourcePath(nextPath)
      return
    }
    setSourcePath(nextPath)
  }, [file?.path])

  useEffect(() => {
    const container = containerRef.current
    const initialFile = file
    if (!initialFile || !container) return

    let active = true
    previousPathRef.current = initialFile.path
    const ws = WaveSurfer.create({
      container,
      height: 48,
      normalize: false,
      dragToSeek: true,
      hideScrollbar: true,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      cursorWidth: 1,
      cursorColor: '#ffffff',
      waveColor: 'rgba(255,255,255,0.32)',
      progressColor: '#ffffff',
      interact: true,
      sampleRate: 44100
    })
    waveRef.current = ws
    const savedVolume = readVolume()
    ws.setVolume(savedVolume)

    ws.on('ready', () => {
      if (!active) return
      ws.setVolume(readVolume())
      setDuration(ws.getDuration())
      setReady(true)
      void ws.play().catch(() => undefined)
    })
    ws.on('play', () => active && setIsPlaying(true))
    ws.on('pause', () => active && setIsPlaying(false))
    ws.on('timeupdate', (time) => active && setCurrentTime(time))
    ws.on('finish', () => {
      if (!active) return
      setIsPlaying(false)
      onNextRef.current()
    })
    ws.on('error', () => {
      if (!active) return
      setLoadError('Не удалось открыть трек')
    })

    let objectUrl: string | null = null
    const api = window.api
    const read = api
      ? api.readAudioFile(initialFile.path)
      : Promise.reject(new Error('Файловая библиотека доступна в окне Electron'))
    void read
      .then((buffer) => {
        if (!active) return
        if (analysisEnabledRef.current) {
          const cached = readTrackAnalysis(initialFile.path)
          // BPM and key already in the name or ID3: skip the decode and the worker entirely.
          const known = cached ?? knownTrackAnalysis(initialFile)
          if (known) {
            onAnalyzedRef.current(initialFile.path, known)
          } else {
            const encoded = buffer.slice(0)
            void analyzeTrackAudio(true, encoded).then((result) => {
              if (!result || !analysisEnabledRef.current) return
              rememberTrackAnalysis(initialFile.path, result)
              onAnalyzedRef.current(initialFile.path, result)
            })
          }
        }
        const blob = new Blob([buffer], { type: audioMime(initialFile.extension) })
        const nextUrl = URL.createObjectURL(blob)
        if (!active) {
          URL.revokeObjectURL(nextUrl)
          return
        }
        objectUrl = nextUrl
        return ws.load(objectUrl)
      })
      .then(() => {
        if (!active) return
        ws.setVolume(readVolume())
      })
      .catch(() => {
        if (!active) return
        setLoadError('Не удалось открыть трек')
      })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      waveRef.current = null
      ws.destroy()
    }
    // This session loads once. A rename updates sourcePath above and must not call load().
    // The parent remounts the player only when playToken changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    waveRef.current?.setVolume(muted ? 0 : volume)
  }, [muted, volume])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.code !== 'Space' || event.repeat || isTypingTarget()) return
      event.preventDefault()
      if (!ready) return
      void waveRef.current?.playPause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready])

  const title = file ? (file.tags.title ?? fileStem(file.name)) : ''

  return (
    <section className="flex h-full items-center gap-3 rounded-[28px] bg-[#101113] px-3">
      <IconButton label="Предыдущий" size="sm" disabled={!hasPrevious} onClick={onPrevious}>
        <SkipBack size={14} strokeWidth={1.5} />
      </IconButton>
      <IconButton
        label={isPlaying ? 'Пауза' : 'Играть'}
        variant="solid"
        disabled={!file || (!ready && !loadError)}
        onClick={() => void waveRef.current?.playPause()}
      >
        {!file ? (
          <Disc3 size={16} strokeWidth={1.5} />
        ) : !ready && !loadError ? (
          <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
        ) : isPlaying ? (
          <Pause size={16} strokeWidth={1.5} />
        ) : (
          <Play size={16} strokeWidth={1.5} className="translate-x-0.5" />
        )}
      </IconButton>
      <IconButton label="Следующий" size="sm" disabled={!hasNext} onClick={onNext}>
        <SkipForward size={14} strokeWidth={1.5} />
      </IconButton>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-sm text-white/90">{title}</p>
          <span className="shrink-0 text-[11px] tabular-nums text-white/40">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
        </div>
        <div ref={containerRef} data-path={sourcePath ?? ''} className="w-full" />
      </div>
      <div className="flex shrink-0 items-center gap-2 rounded-full bg-white/6 py-1 pr-3 pl-1">
        <IconButton
          label={muted || volume === 0 ? 'Включить звук' : 'Без звука'}
          size="sm"
          onClick={() => setMuted((current) => !current)}
        >
          {muted || volume === 0 ? (
            <VolumeX size={14} strokeWidth={1.5} />
          ) : (
            <Volume2 size={14} strokeWidth={1.5} />
          )}
        </IconButton>
        <input
          aria-label="Громкость"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(event) => {
            const next = Math.min(1, Math.max(0, Number(event.target.value)))
            setMuted(false)
            setVolume(next)
            writeVolume(next)
            waveRef.current?.setVolume(next)
          }}
        />
      </div>
    </section>
  )
}
