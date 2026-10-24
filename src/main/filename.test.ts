import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyAutoClean,
  escapeRegExp,
  parseFilename,
  withKeptTrash,
  type FilenameToken
} from '../shared/filename'

test('parseFilename turns underscores into spaces and drops links and mentions', () => {
  const parsed = parseFilename('[PREPARTY] Night_Call (www.dj.com) @promo.mp3')
  assert.equal(parsed.isClean, false)
  assert.equal(parsed.cleanName, '[PREPARTY] Night Call.mp3')
  assert.deepEqual(
    parsed.tokens.filter((token) => token.type === 'trash').map((token) => token.value),
    ['_', '(www.dj.com)', '@promo']
  )
})

test('parseFilename removes bracketed and bare links without touching energy tags', () => {
  assert.equal(
    parseFilename('Warmup [http://example.com/a] https://site.test/x.mp3').cleanName,
    'Warmup.mp3'
  )
  assert.equal(parseFilename('Set ( www.radio.fm/live ).wav').cleanName, 'Set.wav')
  assert.equal(parseFilename('[PRIME] Midnight.flac').isClean, true)
  assert.equal(parseFilename('[PRIME] Midnight.flac').cleanName, '[PRIME] Midnight.flac')
})

test('parseFilename keeps an @ that is not the start of a word', () => {
  const parsed = parseFilename('artist@mail.com night.mp3')
  assert.equal(parsed.isClean, true)
  assert.equal(
    parsed.tokens.some((token) => token.type === 'trash'),
    false
  )
})

test('parseFilename collapses spaces left by removed tokens and repeated underscores', () => {
  assert.equal(parseFilename('My__Track.mp3').cleanName, 'My Track.mp3')
  assert.equal(parseFilename('A (www.x.com) B.mp3').cleanName, 'A B.mp3')
  const spaced = parseFilename('My  Track.mp3')
  assert.equal(spaced.isClean, false)
  assert.equal(spaced.cleanName, 'My Track.mp3')
  assert.equal(
    spaced.tokens.some((token) => token.type === 'trash'),
    false
  )
})

test('parseFilename refuses a name that would become empty', () => {
  const parsed = parseFilename('@only.mp3')
  assert.equal(parsed.cleanName, null)
  assert.equal(parsed.isClean, false)
})

test('withKeptTrash preserves the opted-out token and can mark the file clean', () => {
  const tokens: FilenameToken[] = [
    { type: 'text', value: 'Night' },
    { type: 'trash', value: '_' },
    { type: 'text', value: 'Call ' },
    { type: 'trash', value: '@promo' }
  ]
  const kept = withKeptTrash(
    { name: 'Night_Call @promo.mp3', isClean: false, cleanTokens: tokens },
    new Set(['@promo'])
  )
  assert.equal(kept.isClean, false)
  assert.equal(kept.cleanTokens?.find((token) => token.value === '@promo')?.type, 'text')
  assert.equal(kept.cleanTokens?.find((token) => token.value === '_')?.type, 'trash')

  const allKept = withKeptTrash(kept, new Set(['_']))
  assert.equal(allKept.isClean, true)
  assert.equal(allKept.cleanTokens, undefined)
})

test('applyAutoClean skips filename parsing when automatic cleaning is off', () => {
  const dirty = {
    name: 'Night_Call @promo.mp3',
    isClean: false,
    cleanTokens: [
      { type: 'text' as const, value: 'Night' },
      { type: 'trash' as const, value: '_' },
      { type: 'text' as const, value: 'Call ' },
      { type: 'trash' as const, value: '@promo' }
    ]
  }
  const hidden = applyAutoClean(dirty, false)
  assert.equal(hidden.isClean, true)
  assert.equal(hidden.cleanTokens, undefined)

  const kept = applyAutoClean(dirty, true)
  assert.equal(kept.isClean, false)
  assert.equal(kept.cleanTokens?.length, 4)

  const restored = applyAutoClean(
    {
      name: 'Night_Call.mp3',
      isClean: true,
      cleanTokens: undefined as FilenameToken[] | undefined
    },
    true
  )
  assert.equal(restored.isClean, false)
  assert.ok(restored.cleanTokens?.some((token) => token.type === 'trash' && token.value === '_'))
})

test('parseFilename marks dictionary words and escapes regex characters', () => {
  assert.equal(escapeRegExp('a+b.com'), String.raw`a\+b\.com`)
  const parsed = parseFilename('Night FreeMusic @VipPromoMusic.mp3', [
    'freemusic',
    'promodj',
    '@vippromomusic'
  ])
  assert.equal(parsed.cleanName, 'Night.mp3')
  assert.deepEqual(
    parsed.tokens.filter((token) => token.type === 'trash').map((token) => token.value),
    ['FreeMusic', '@VipPromoMusic']
  )
  assert.equal(parseFilename('promodj set.mp3', ['promo']).cleanName, 'promodj set.mp3')
  const literal = parseFilename('File (a+b).mp3', ['(a+b)'])
  assert.equal(literal.cleanName, 'File.mp3')
  assert.deepEqual(
    literal.tokens.filter((token) => token.type === 'trash').map((token) => token.value),
    ['(a+b)']
  )
})
