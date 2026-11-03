import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  analyzedTrackParts,
  buildAnalyzedFileName,
  knownTrackAnalysis,
  mergeAnalyzedFileName
} from '../shared/analyzedName'

test('buildAnalyzedFileName follows the Camelot filename template', () => {
  assert.equal(
    buildAnalyzedFileName('PRIME', 124, '3A', 'Hugel - Movin To The Sun (GALVH & DARYLL Edit)'),
    '[PRIME]124 - 3A - - Hugel - Movin To The Sun (GALVH & DARYLL Edit).mp3'
  )
  assert.equal(
    buildAnalyzedFileName('[party]', 123.6, '3a', 'Night Call', '.wav'),
    '[PRIME]124 - 3A - - Night Call.wav'
  )
  assert.equal(buildAnalyzedFileName('PRIME', null, undefined, 'Song'), '[PRIME] - - - Song.mp3')
})

test('buildAnalyzedFileName does not repeat an existing BPM and key prefix', () => {
  assert.equal(
    buildAnalyzedFileName('PRIME', 124, '3A', '124 - 3A - - Song'),
    '[PRIME]124 - 3A - - Song.mp3'
  )
  assert.equal(
    buildAnalyzedFileName('MID', 124, '3A', '[PRIME]124 - 3A - - 124 - 3A - - Song'),
    '[MID][PRIME]124 - 3A - - Song.mp3'
  )
  assert.equal(
    buildAnalyzedFileName('PRIME', null, null, '128 - 8A - - Song'),
    '[PRIME]128 - 8A - - Song.mp3'
  )
})

test('buildAnalyzedFileName keeps several tags in canonical order', () => {
  assert.equal(
    buildAnalyzedFileName(['PRIME', 'MID', 'prime'], 124, '3A', 'Song'),
    '[MID][PRIME]124 - 3A - - Song.mp3'
  )
  assert.throws(() => buildAnalyzedFileName(['PRIME', 'VOCAL'], 124, '3A', 'Song'))
})

test('analyzedTrackParts keeps the title and every energy tag', () => {
  assert.deepEqual(analyzedTrackParts('[PRIME] Hugel - Movin To The Sun.mp3'), {
    tags: ['PRIME'],
    tag: 'PRIME',
    bpm: null,
    key: null,
    originalStem: 'Hugel - Movin To The Sun',
    hasAnalysisPrefix: false
  })
  assert.deepEqual(
    analyzedTrackParts('[PRIME]124 - 3A - - Hugel - Movin To The Sun (GALVH & DARYLL Edit).mp3'),
    {
      tags: ['PRIME'],
      tag: 'PRIME',
      bpm: 124,
      key: '3A',
      originalStem: 'Hugel - Movin To The Sun (GALVH & DARYLL Edit)',
      hasAnalysisPrefix: true
    }
  )
  assert.deepEqual(analyzedTrackParts('[MID][PRIME]124 - 3A - - Song.mp3').tags, ['MID', 'PRIME'])
  assert.equal(analyzedTrackParts('[PRIME]124 - 3A - - 124 - 3A - - Song.mp3').originalStem, 'Song')
  assert.deepEqual(analyzedTrackParts('Hugel - Song.mp3'), {
    tags: [],
    tag: null,
    bpm: null,
    key: null,
    originalStem: 'Hugel - Song',
    hasAnalysisPrefix: false
  })
})

test('knownTrackAnalysis reads BPM and key from ID3 or the filename', () => {
  assert.deepEqual(knownTrackAnalysis({ name: 'Song.mp3', tags: { bpm: 123.6, key: '3a' } }), {
    bpm: 124,
    key: '3A'
  })
  assert.deepEqual(
    knownTrackAnalysis({ name: '[PRIME]124 - 3A - - Song.mp3', tags: { bpm: null, key: null } }),
    { bpm: 124, key: '3A' }
  )
  assert.equal(knownTrackAnalysis({ name: 'Song.mp3', tags: { bpm: 124, key: null } }), null)
  assert.equal(
    knownTrackAnalysis({ name: '[PRIME] - - - Song.mp3', tags: { bpm: null, key: null } }),
    null
  )
})

test('mergeAnalyzedFileName keeps energy tags of the current name', () => {
  assert.equal(
    mergeAnalyzedFileName('[MID][PRIME] Song.mp3', '[PRIME]124 - 3A - - Song.mp3'),
    '[MID][PRIME]124 - 3A - - Song.mp3'
  )
  assert.equal(mergeAnalyzedFileName('Night.wav', 'Night.wav'), 'Night.wav')
})
