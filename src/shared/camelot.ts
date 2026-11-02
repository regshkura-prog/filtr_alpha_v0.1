const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

const MAJOR_CAMELOT = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B']
const MINOR_CAMELOT = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A']

const FRAME = 4096
const HOP = 4096
const MAX_FRAMES = 48

const HANN = new Float64Array(FRAME)
for (let i = 0; i < FRAME; i++) {
  HANN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FRAME - 1)))
}

export function roundDetectedBpm(tempo: number): number | null {
  if (!Number.isFinite(tempo) || tempo <= 0) return null
  let normalizedBpm = tempo
  let steps = 0
  while (normalizedBpm > 150 && steps < 16) {
    normalizedBpm /= 2
    steps += 1
  }
  steps = 0
  while (normalizedBpm < 75 && steps < 16) {
    normalizedBpm *= 2
    steps += 1
  }
  normalizedBpm = Math.round(normalizedBpm)
  if (normalizedBpm > 150) normalizedBpm = Math.round(normalizedBpm / 2)
  if (normalizedBpm < 75) normalizedBpm *= 2
  if (normalizedBpm < 75 || normalizedBpm > 150) return null
  return normalizedBpm
}

export function camelotFromChroma(chroma: ArrayLike<number>): string {
  let best = Number.NEGATIVE_INFINITY
  let key = '8B'
  for (let tonic = 0; tonic < 12; tonic++) {
    const major = correlate(chroma, MAJOR_PROFILE, tonic)
    if (major > best) {
      best = major
      key = MAJOR_CAMELOT[tonic] ?? key
    }
    const minor = correlate(chroma, MINOR_PROFILE, tonic)
    if (minor > best) {
      best = minor
      key = MINOR_CAMELOT[tonic] ?? key
    }
  }
  return key
}

export function detectCamelotKey(samples: Float32Array, sampleRate: number): string | null {
  if (samples.length < FRAME || !Number.isFinite(sampleRate) || sampleRate < 8000) return null
  const { data, rate } = downsample(samples, sampleRate, 11025)
  if (data.length < FRAME) return null
  const chroma = new Float64Array(12)
  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  const available = Math.floor((data.length - FRAME) / HOP) + 1
  const frames = Math.min(available, MAX_FRAMES)
  const span = (frames - 1) * HOP + FRAME
  const origin = Math.max(0, Math.floor((data.length - span) / 2))
  for (let frame = 0; frame < frames; frame++) {
    const offset = origin + frame * HOP
    im.fill(0)
    for (let i = 0; i < FRAME; i++) re[i] = (data[offset + i] ?? 0) * (HANN[i] ?? 0)
    fftInPlace(re, im)
    accumulateChroma(re, im, rate, chroma)
  }
  let energy = 0
  for (let i = 0; i < chroma.length; i++) energy += chroma[i] ?? 0
  if (energy < 1e-8) return null
  return camelotFromChroma(chroma)
}

function correlate(chroma: ArrayLike<number>, profile: readonly number[], tonic: number): number {
  let sumChroma = 0
  let sumProfile = 0
  for (let i = 0; i < 12; i++) {
    sumChroma += chroma[i] ?? 0
    sumProfile += profile[i] ?? 0
  }
  const meanChroma = sumChroma / 12
  const meanProfile = sumProfile / 12
  let numerator = 0
  let chromaSquare = 0
  let profileSquare = 0
  for (let i = 0; i < 12; i++) {
    const left = (chroma[i] ?? 0) - meanChroma
    const right = (profile[(i - tonic + 12) % 12] ?? 0) - meanProfile
    numerator += left * right
    chromaSquare += left * left
    profileSquare += right * right
  }
  const denominator = Math.sqrt(chromaSquare * profileSquare)
  if (denominator === 0) return 0
  return numerator / denominator
}

function downsample(
  input: Float32Array,
  fromRate: number,
  toRate: number
): { data: Float32Array; rate: number } {
  const factor = Math.max(1, Math.round(fromRate / toRate))
  if (factor === 1) return { data: input, rate: fromRate }
  const length = Math.floor(input.length / factor)
  const data = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sum = 0
    const base = i * factor
    for (let j = 0; j < factor; j++) sum += input[base + j] ?? 0
    data[i] = sum / factor
  }
  return { data, rate: fromRate / factor }
}

function accumulateChroma(
  re: Float64Array,
  im: Float64Array,
  sampleRate: number,
  chroma: Float64Array
): void {
  const bins = re.length
  const binHz = sampleRate / bins
  const nyquist = bins >> 1
  for (let bin = 1; bin < nyquist; bin++) {
    const hz = bin * binHz
    if (hz < 55 || hz > 5000) continue
    const midi = 69 + 12 * Math.log2(hz / 440)
    const pitchClass = ((Math.round(midi) % 12) + 12) % 12
    const power = (re[bin] ?? 0) * (re[bin] ?? 0) + (im[bin] ?? 0) * (im[bin] ?? 0)
    chroma[pitchClass] = (chroma[pitchClass] ?? 0) + power
  }
}

function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const realSwap = re[i] ?? 0
      re[i] = re[j] ?? 0
      re[j] = realSwap
      const imagSwap = im[i] ?? 0
      im[i] = im[j] ?? 0
      im[j] = imagSwap
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length
    const stepReal = Math.cos(angle)
    const stepImag = Math.sin(angle)
    for (let start = 0; start < n; start += length) {
      let twiddleReal = 1
      let twiddleImag = 0
      const half = length >> 1
      for (let k = 0; k < half; k++) {
        const even = start + k
        const odd = even + half
        const oddReal = re[odd] ?? 0
        const oddImag = im[odd] ?? 0
        const productReal = oddReal * twiddleReal - oddImag * twiddleImag
        const productImag = oddReal * twiddleImag + oddImag * twiddleReal
        const evenReal = re[even] ?? 0
        const evenImag = im[even] ?? 0
        re[even] = evenReal + productReal
        im[even] = evenImag + productImag
        re[odd] = evenReal - productReal
        im[odd] = evenImag - productImag
        const nextReal = twiddleReal * stepReal - twiddleImag * stepImag
        twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal
        twiddleReal = nextReal
      }
    }
  }
}
