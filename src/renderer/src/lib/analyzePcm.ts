import MusicTempo from 'music-tempo'
import { detectCamelotKey, roundDetectedBpm } from '../../../shared/camelot'

export interface TrackAnalysis {
  bpm: number
  key: string
}

export function analyzePcm(samples: Float32Array, sampleRate: number): TrackAnalysis | null {
  try {
    const hopSize = Math.max(1, Math.round(sampleRate * 0.01))
    const tempo = new MusicTempo(samples, { hopSize, timeStep: 0.01 })
    const normalizedBpm = roundDetectedBpm(Number(tempo.tempo))
    const key = detectCamelotKey(samples, sampleRate)
    if (normalizedBpm === null || key === null) return null
    return { bpm: normalizedBpm, key }
  } catch {
    return null
  }
}
