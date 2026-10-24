import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sortEntries, type SortConfig } from '../shared/files'

type Row = {
  name: string
  type: string
  dateCreated: number
  dateAdded: number
}

const rows: Row[] = [
  { name: 'b.wav', type: 'wav', dateCreated: 30, dateAdded: 10 },
  { name: '10.mp3', type: 'mp3', dateCreated: 10, dateAdded: 40 },
  { name: '2.mp3', type: 'mp3', dateCreated: 20, dateAdded: 30 },
  { name: 'a.flac', type: 'flac', dateCreated: 40, dateAdded: 20 }
]

function names(config: SortConfig): string[] {
  return sortEntries(rows, config, (row) => row).map((row) => row.name)
}

test('sortEntries orders names with numeric segments and reverses them', () => {
  assert.deepEqual(names({ key: 'name', direction: 'asc' }), ['2.mp3', '10.mp3', 'a.flac', 'b.wav'])
  assert.deepEqual(names({ key: 'name', direction: 'desc' }), [
    'b.wav',
    'a.flac',
    '10.mp3',
    '2.mp3'
  ])
})

test('sortEntries groups by type and uses the name as a tie break', () => {
  assert.deepEqual(names({ key: 'type', direction: 'asc' }), ['a.flac', '2.mp3', '10.mp3', 'b.wav'])
  assert.deepEqual(names({ key: 'type', direction: 'desc' }), [
    'b.wav',
    '10.mp3',
    '2.mp3',
    'a.flac'
  ])
})

test('sortEntries uses creation time and added time independently', () => {
  assert.deepEqual(names({ key: 'dateCreated', direction: 'asc' }), [
    '10.mp3',
    '2.mp3',
    'b.wav',
    'a.flac'
  ])
  assert.deepEqual(names({ key: 'dateAdded', direction: 'desc' }), [
    '10.mp3',
    '2.mp3',
    'a.flac',
    'b.wav'
  ])
})
