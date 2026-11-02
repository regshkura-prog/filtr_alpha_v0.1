import assert from 'node:assert/strict'
import { test } from 'node:test'
import { camelotFromChroma, detectCamelotKey, roundDetectedBpm } from '../shared/camelot'

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

test('roundDetectedBpm folds tempo into the 75-150 DJ range', () => {
  assert.equal(roundDetectedBpm(123.6), 124)
  assert.equal(roundDetectedBpm(75), 75)
  assert.equal(roundDetectedBpm(150), 150)
  assert.equal(roundDetectedBpm(60), 120)
  assert.equal(roundDetectedBpm(70), 140)
  assert.equal(roundDetectedBpm(174), 87)
  assert.equal(roundDetectedBpm(200.4), 100)
  assert.equal(roundDetectedBpm(151), 76)
  assert.equal(roundDetectedBpm(37.2), 149)
  assert.equal(roundDetectedBpm(59.4), 119)
  assert.equal(roundDetectedBpm(0), null)
  assert.equal(roundDetectedBpm(Number.NaN), null)
  assert.equal(roundDetectedBpm(Number.POSITIVE_INFINITY), null)
})

test('camelotFromChroma maps C major to 8B and Bb minor to 3A', () => {
  assert.equal(camelotFromChroma(MAJOR), '8B')
  const bbMinor = Array.from({ length: 12 }, (_, index) => MINOR[(index - 10 + 12) % 12] ?? 0)
  assert.equal(camelotFromChroma(bbMinor), '3A')
})

test('detectCamelotKey hears a C major triad as 8B', () => {
  const rate = 22050
  const seconds = 2
  const length = rate * seconds
  const samples = new Float32Array(length)
  for (const frequency of [261.6256, 329.6276, 391.9954]) {
    for (let i = 0; i < length; i++) {
      samples[i] += 0.3 * Math.sin((2 * Math.PI * frequency * i) / rate)
    }
  }
  assert.equal(detectCamelotKey(samples, rate), '8B')
})
