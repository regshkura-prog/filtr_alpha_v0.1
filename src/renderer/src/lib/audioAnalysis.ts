import { analyzePcm, type TrackAnalysis } from './analyzePcm'

export type { TrackAnalysis }

const cache = new Map<string, TrackAnalysis>()
const WINDOW_SECONDS = 30

let jobId = 0
let activeJob: { id: number; worker: Worker; cancel: () => void } | null = null

export function readTrackAnalysis(path: string): TrackAnalysis | null {
  return cache.get(path) ?? null
}

export function rememberTrackAnalysis(path: string, result: TrackAnalysis): void {
  cache.set(path, result)
}

export function cancelTrackAnalysis(): void {
  jobId += 1
  if (!activeJob) return
  activeJob.worker.terminate()
  activeJob.cancel()
  activeJob = null
}

export function analyzeTrackAudio(
  enabled: boolean,
  encoded: ArrayBuffer
): Promise<TrackAnalysis | null> {
  if (!enabled) return Promise.resolve(null)
  const id = ++jobId
  if (activeJob) {
    activeJob.worker.terminate()
    activeJob.cancel()
    activeJob = null
  }
  return decodeAndAnalyze(encoded, id)
}

async function decodeAndAnalyze(encoded: ArrayBuffer, id: number): Promise<TrackAnalysis | null> {
  let audio: AudioBuffer
  try {
    const context = new AudioContext()
    try {
      audio = await context.decodeAudioData(encoded)
    } finally {
      await context.close().catch(() => undefined)
    }
  } catch {
    return null
  }
  if (id !== jobId) return null
  await yieldToUi()
  if (id !== jobId) return null
  const samples = mixWindow(audio)
  if (!samples) return null
  return runInWorker(samples, audio.sampleRate, id)
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function mixWindow(audio: AudioBuffer): Float32Array | null {
  const rate = audio.sampleRate
  if (!Number.isFinite(rate) || rate < 8000) return null
  const total = audio.length
  if (total < rate) return null
  const length = Math.min(total, Math.floor(rate * WINDOW_SECONDS))
  const start = Math.max(0, Math.floor((total - length) / 2))
  const channels = audio.numberOfChannels
  if (channels < 1) return null
  const mixed = new Float32Array(length)
  const scale = 1 / channels
  for (let channel = 0; channel < channels; channel++) {
    const data = audio.getChannelData(channel)
    for (let i = 0; i < length; i++) mixed[i] += (data[start + i] ?? 0) * scale
  }
  return mixed
}

function isTrackAnalysis(value: unknown): value is TrackAnalysis {
  if (!value || typeof value !== 'object') return false
  const record = value as { bpm?: unknown; key?: unknown }
  return typeof record.bpm === 'number' && typeof record.key === 'string'
}

function runInWorker(
  samples: Float32Array,
  sampleRate: number,
  id: number
): Promise<TrackAnalysis | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: TrackAnalysis | null): void => {
      if (settled) return
      settled = true
      if (activeJob?.id === id) activeJob = null
      resolve(result)
    }
    let worker: Worker
    try {
      worker = new Worker(new URL('./audioAnalysis.worker.ts', import.meta.url), {
        type: 'module'
      })
    } catch {
      finish(analyzePcm(samples, sampleRate))
      return
    }
    activeJob = {
      id,
      worker,
      cancel: () => {
        worker.terminate()
        finish(null)
      }
    }
    worker.onmessage = (event: MessageEvent<unknown>) => {
      worker.terminate()
      if (id !== jobId) {
        finish(null)
        return
      }
      finish(isTrackAnalysis(event.data) ? event.data : analyzePcm(samples, sampleRate))
    }
    worker.onerror = () => {
      worker.terminate()
      if (id !== jobId) {
        finish(null)
        return
      }
      finish(analyzePcm(samples, sampleRate))
    }
    try {
      worker.postMessage({ samples, sampleRate })
    } catch {
      worker.terminate()
      finish(id === jobId ? analyzePcm(samples, sampleRate) : null)
    }
  })
}
