export const LOUDNESS_TARGET_LUFS = -9

export type MeasuredLoudness = 'low_volume' | 'ok'

export function statusForLoudness(lufs: number): MeasuredLoudness {
  return lufs < LOUDNESS_TARGET_LUFS ? 'low_volume' : 'ok'
}
