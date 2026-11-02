import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzedTrackParts, buildAnalyzedFileName } from '../shared/analyzedName'

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

test('analyzedTrackParts keeps the title and the selected energy tag', () => {
  assert.deepEqual(analyzedTrackParts('[PRIME] Hugel - Movin To The Sun.mp3'), {
    tag: 'PRIME',
    originalStem: 'Hugel - Movin To The Sun'
  })
  assert.deepEqual(
    analyzedTrackParts('[PRIME]124 - 3A - - Hugel - Movin To The Sun (GALVH & DARYLL Edit).mp3'),
    {
      tag: 'PRIME',
      originalStem: 'Hugel - Movin To The Sun (GALVH & DARYLL Edit)'
    }
  )
  assert.deepEqual(analyzedTrackParts('Hugel - Song.mp3'), {
    tag: null,
    originalStem: 'Hugel - Song'
  })
})
