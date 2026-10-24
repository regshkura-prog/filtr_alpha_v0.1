import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assignEnergyTag,
  coverFileForTag,
  energyTagForHotkey,
  energyTagsInName,
  normalizeEnergyFileName,
  primaryEnergyTag,
  toggleEnergyTag
} from '../shared/energy'

test('toggleEnergyTag keeps tags before the title in priority order', () => {
  const once = toggleEnergyTag('Mumbai Science.mp3', 'AFTERPARTY')
  assert.equal(once, '[AFTERPARTY] Mumbai Science.mp3')

  const twice = toggleEnergyTag(once, 'MID')
  assert.equal(twice, '[MID][AFTERPARTY] Mumbai Science.mp3')

  const withEnd = toggleEnergyTag(twice, 'END')
  assert.equal(withEnd, '[MID][AFTERPARTY][END] Mumbai Science.mp3')

  const removed = toggleEnergyTag(withEnd, 'AFTERPARTY')
  assert.equal(removed, '[MID][END] Mumbai Science.mp3')
  assert.equal(toggleEnergyTag(removed, 'MID'), '[END] Mumbai Science.mp3')
  assert.equal(toggleEnergyTag('[END] Mumbai Science.mp3', 'END'), 'Mumbai Science.mp3')
})

test('normalizeEnergyFileName dedupes tags and sorts them by priority', () => {
  assert.equal(
    normalizeEnergyFileName('Название [END][PREPARTY][END].mp3'),
    '[PREPARTY][END] Название.mp3'
  )
  assert.equal(normalizeEnergyFileName('[END] [PREPARTY] Night.wav'), '[PREPARTY][END] Night.wav')
  assert.equal(
    normalizeEnergyFileName('[END]  [PREPARTY]   Night.wav'),
    '[PREPARTY][END] Night.wav'
  )
  assert.equal(normalizeEnergyFileName('Song [PARTY].mp3'), '[PRIME] Song.mp3')
  assert.equal(normalizeEnergyFileName('Song [party].wav'), '[PRIME] Song.wav')
  assert.equal(normalizeEnergyFileName('Live [END][PaRtY].mp3'), '[PRIME][END] Live.mp3')
  assert.equal(normalizeEnergyFileName('Song [PREPARTY].mp3'), '[PREPARTY] Song.mp3')
  assert.equal(
    normalizeEnergyFileName('Warmup [PREPARTY][party].mp3'),
    '[PREPARTY][PRIME] Warmup.mp3'
  )
  assert.equal(normalizeEnergyFileName('Song [PARTY][PRIME].mp3'), '[PRIME] Song.mp3')
  assert.equal(
    normalizeEnergyFileName('Set [END][AFTERPARTY][PARTY][MID][PREPARTY].wav'),
    '[PREPARTY][MID][PRIME][AFTERPARTY][END] Set.wav'
  )
  assert.equal(toggleEnergyTag('track.name.wav', 'PRIME'), '[PRIME] track.name.wav')
  assert.deepEqual(energyTagsInName('[END][PREPARTY] Название.mp3'), ['PREPARTY', 'END'])
  assert.equal(primaryEnergyTag('[END][PREPARTY] Название.mp3'), 'PREPARTY')
  assert.equal(primaryEnergyTag('[PARTY] Hat.mp3'), 'PRIME')
  assert.equal(primaryEnergyTag('[party][END] Hat.mp3'), 'PRIME')
  assert.equal(coverFileForTag('PRIME'), 'prime.jpg')
  assert.equal(coverFileForTag('PREPARTY'), 'preparty.jpg')
  assert.equal(primaryEnergyTag('Night.wav'), null)
})

test('assignEnergyTag adds a missing tag and leaves an existing one', () => {
  assert.equal(assignEnergyTag('Song.mp3', 'PREPARTY'), '[PREPARTY] Song.mp3')
  assert.equal(assignEnergyTag('[PREPARTY] Song.mp3', 'PREPARTY'), '[PREPARTY] Song.mp3')
  assert.equal(assignEnergyTag('[END] Song.mp3', 'MID'), '[MID][END] Song.mp3')
  assert.equal(assignEnergyTag('Song [party].wav', 'PRIME'), 'Song [party].wav')
})

test('energyTagForHotkey maps 1-5 to the energy order', () => {
  assert.equal(energyTagForHotkey('Digit1'), 'PREPARTY')
  assert.equal(energyTagForHotkey('Digit2'), 'MID')
  assert.equal(energyTagForHotkey('Digit3'), 'PRIME')
  assert.equal(energyTagForHotkey('Digit4'), 'AFTERPARTY')
  assert.equal(energyTagForHotkey('Numpad5'), 'END')
  assert.equal(energyTagForHotkey('Digit6'), null)
  assert.equal(energyTagForHotkey('KeyA'), null)
})
