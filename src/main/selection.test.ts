import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyFileSelection } from '../shared/selection'

const files = ['a', 'b', 'c', 'd', 'e']

test('toggle adds and removes a path and moves the anchor', () => {
  const added = applyFileSelection(files, ['a'], 0, 2, 'toggle')
  assert.deepEqual(added, { selected: ['a', 'c'], anchor: 2 })
  const removed = applyFileSelection(files, added.selected, added.anchor, 0, 'toggle')
  assert.deepEqual(removed, { selected: ['c'], anchor: 0 })
})

test('range selects every file between the anchor and the click', () => {
  const downward = applyFileSelection(files, ['b'], 1, 4, 'range')
  assert.deepEqual(downward, { selected: ['b', 'c', 'd', 'e'], anchor: 1 })
  const upward = applyFileSelection(files, ['e'], 4, 1, 'range')
  assert.deepEqual(upward, { selected: ['b', 'c', 'd', 'e'], anchor: 4 })
})

test('range without an anchor selects only the clicked file', () => {
  assert.deepEqual(applyFileSelection(files, [], null, 3, 'range'), {
    selected: ['d'],
    anchor: 3
  })
})

test('an index outside the list leaves the selection untouched', () => {
  assert.deepEqual(applyFileSelection(files, ['a'], 0, 9, 'range'), {
    selected: ['a'],
    anchor: 0
  })
})
