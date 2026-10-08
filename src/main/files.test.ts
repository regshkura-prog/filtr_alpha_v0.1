import assert from 'node:assert/strict'
import { test } from 'node:test'
import { duplicatePaths, sortByFileName } from '../shared/files'

test('sortByFileName sorts alphabetically and keeps track numbers in order', () => {
  const sorted = sortByFileName([
    { name: 'b.wav' },
    { name: '10.mp3' },
    { name: '2.mp3' },
    { name: 'a.flac' }
  ])
  assert.deepEqual(
    sorted.map((file) => file.name),
    ['2.mp3', '10.mp3', 'a.flac', 'b.wav']
  )
})

test('duplicatePaths marks same stems and identical hashes', () => {
  const matches = duplicatePaths([
    { path: '/a/Kick.wav', stem: 'Kick', hash: '1' },
    { path: '/a/kick.mp3', stem: 'kick', hash: '2' },
    { path: '/a/Loop.wav', stem: 'Loop', hash: '9' },
    { path: '/a/Loop Copy.wav', stem: 'Loop Copy', hash: '9' },
    { path: '/a/Only.wav', stem: 'Only', hash: '3' }
  ])

  assert.deepEqual([...matches].sort(), [
    '/a/Kick.wav',
    '/a/Loop Copy.wav',
    '/a/Loop.wav',
    '/a/kick.mp3'
  ])
})
