import { analyzePcm, type TrackAnalysis } from './analyzePcm'

type AnalysisJob = {
  samples: Float32Array
  sampleRate: number
}

type AnalysisScope = {
  onmessage: ((event: MessageEvent<AnalysisJob>) => void) | null
  postMessage: (message: TrackAnalysis | { error: string }) => void
}

const scope = globalThis as unknown as AnalysisScope

scope.onmessage = (event) => {
  const samples = event.data?.samples
  const sampleRate = event.data?.sampleRate
  if (!(samples instanceof Float32Array) || typeof sampleRate !== 'number') {
    scope.postMessage({ error: 'Некорректное аудио' })
    return
  }
  const result = analyzePcm(samples, sampleRate)
  scope.postMessage(result ?? { error: 'Анализ не удался' })
}
