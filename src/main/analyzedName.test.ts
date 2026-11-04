import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  analyzedTrackParts,
  buildAnalyzedFileName,
  energyFileName,
  knownTrackAnalysis,
  mergeAnalyzedFileName
} from '../shared/analyzedName'
import type { EnergyTag } from '../shared/energy'

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

test('buildAnalyzedFileName starts with the tempo when the track has no tag', () => {
  assert.equal(buildAnalyzedFileName([], 124, '3A', 'Song'), '124 - 3A - - Song.mp3')
  assert.equal(
    buildAnalyzedFileName([], 128, '8a', '124 - 3A - - Song', '.flac'),
    '128 - 8A - - Song.flac'
  )
})

test('analyzedTrackParts keeps the title and every energy tag', () => {
  assert.deepEqual(analyzedTrackParts('[PRIME] Hugel - Movin To The Sun.mp3'), {
    tags: ['PRIME'],
    tag: 'PRIME',
    bpm: null,
    key: null,
    originalStem: 'Hugel - Movin To The Sun',
    hasAnalysisPrefix: false,
    repeatedPrefix: false
  })
  assert.deepEqual(
    analyzedTrackParts('[PRIME]124 - 3A - - Hugel - Movin To The Sun (GALVH & DARYLL Edit).mp3'),
    {
      tags: ['PRIME'],
      tag: 'PRIME',
      bpm: 124,
      key: '3A',
      originalStem: 'Hugel - Movin To The Sun (GALVH & DARYLL Edit)',
      hasAnalysisPrefix: true,
      repeatedPrefix: false
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
    hasAnalysisPrefix: false,
    repeatedPrefix: false
  })
})

test('analyzedTrackParts recognizes the BPM and key formats found in real libraries', () => {
  const cases: Array<[string, number, string, string]> = [
    ['100 - 11A - Bad Bunny - Mia.mp3', 100, '11A', 'Bad Bunny - Mia'],
    ['[PRIME] 128 - 8A - Pitbull - Satalanaaa.mp3', 128, '8A', 'Pitbull - Satalanaaa'],
    ['10A - 131 - Kid Cudi - Day.mp3', 131, '10A', 'Kid Cudi - Day'],
    ['14 - 12A - 128 - LMFAO - Shots.mp3', 128, '12A', 'LMFAO - Shots'],
    ['136-2A-Babylon.mp3', 136, '2A', 'Babylon'],
    ['113 - 6A or 5A - Ciara - 1, 2 Step.mp3', 113, '6A', 'Ciara - 1, 2 Step'],
    ['128 - 4B - - 01 - Hidden Empire - Hot.flac', 128, '4B', '01 - Hidden Empire - Hot'],
    ['76 - 2B - - 152 - 10A - Smj - My Block.mp3', 152, '10A', 'Smj - My Block'],
    ['[PRIME] 155 8A VILLIAN - Party Up.mp3', 155, '8A', 'VILLIAN - Party Up'],
    ['[AFTERPARTY]80 - 8A - - 80 - 8A - Mike Enemy - Tik Tok.mp3', 80, '8A', 'Mike Enemy - Tik Tok']
  ]
  for (const [name, bpm, key, originalStem] of cases) {
    const parts = analyzedTrackParts(name)
    assert.deepEqual([parts.bpm, parts.key, parts.originalStem], [bpm, key, originalStem], name)
  }
})

test('analyzedTrackParts leaves track numbers and ordinary titles alone', () => {
  for (const name of [
    '09 Fantasy (Feat. Money).flac',
    '06 - 7A - Intro.mp3',
    '100 - Gecs - Money Machine.mp3',
    '50 Cent - 21 Questions.mp3'
  ]) {
    const parts = analyzedTrackParts(name)
    assert.equal(parts.hasAnalysisPrefix, false, name)
    assert.equal(parts.originalStem, name.slice(0, name.lastIndexOf('.')), name)
  }
})

test('energyFileName with analysis off changes only the tag', () => {
  const tagged = { name: 'Song.mp3', stem: 'Song', tags: { bpm: 124, key: '3A' } }
  assert.equal(energyFileName(tagged, 'PRIME', 'toggle', false), '[PRIME] Song.mp3')
  const named = { name: '100 - 11A - Song.mp3', stem: '', tags: { bpm: 124, key: '3A' } }
  assert.equal(energyFileName(named, 'MID', 'toggle', false), '[MID] 100 - 11A - Song.mp3')
  const both = { name: '[MID] Song.mp3', stem: '', tags: { bpm: 124, key: '3A' } }
  assert.equal(energyFileName(both, 'MID', 'toggle', false), 'Song.mp3')
})

test('energyFileName with analysis on never doubles BPM and key', () => {
  const file = (name: string): Parameters<typeof energyFileName>[0] => ({
    name,
    stem: '',
    tags: { bpm: 124, key: '3A' }
  })
  assert.equal(
    energyFileName(file('100 - 11A - Song.mp3'), 'PRIME', 'toggle', true),
    '[PRIME]100 - 11A - - Song.mp3'
  )
  assert.equal(
    energyFileName(file('[AFTERPARTY]80 - 8A - - 80 - 8A - Song.mp3'), 'MID', 'toggle', true),
    '[MID][AFTERPARTY]80 - 8A - - Song.mp3'
  )
  assert.equal(
    energyFileName(file('Song.mp3'), 'END', 'toggle', true),
    '[END]124 - 3A - - Song.mp3'
  )
  const bare = { name: 'Song.mp3', stem: 'Song', tags: { bpm: null, key: null } }
  assert.equal(energyFileName(bare, 'END', 'toggle', true), '[END] Song.mp3')
})

test('energy tags always follow the set order, whatever order they were pressed in', () => {
  const press = (order: EnergyTag[], analysis: boolean): string => {
    let name = 'Song.mp3'
    for (const tag of order) {
      name = energyFileName(
        { name, stem: '', tags: { bpm: 124, key: '3A' } },
        tag,
        'toggle',
        analysis
      )
    }
    return name
  }
  const order: EnergyTag[] = ['END', 'PRIME', 'PREPARTY', 'AFTERPARTY', 'MID']
  assert.equal(press(order, false), '[PREPARTY][MID][PRIME][AFTERPARTY][END] Song.mp3')
  assert.equal(press(order, true), '[PREPARTY][MID][PRIME][AFTERPARTY][END]124 - 3A - - Song.mp3')
})

test('mergeAnalyzedFileName leaves an unchanged name alone', () => {
  assert.equal(
    mergeAnalyzedFileName('[PRIME] 100 - 11A - Song.mp3', '[PRIME] 100 - 11A - Song.mp3'),
    '[PRIME] 100 - 11A - Song.mp3'
  )
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
