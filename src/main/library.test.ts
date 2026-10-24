import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path, { join } from 'node:path'
import { test } from 'node:test'
import { isInsideDirectory } from '../shared/paths'
import { FILE_BUSY_MESSAGE, toFileAccessError } from './errors'
import {
  assertSafeFileName,
  isPathInsideRoot,
  listAudioDirectory,
  moveAudioFile,
  parentDirectory,
  renameAudioFile
} from './library'
import { applyEnergyToFile } from './covers'
import {
  readAudioCover,
  readAudioTags,
  syncAudioTitle,
  writeAudioTags,
  writeCoverImage
} from './tags'

test('isPathInsideRoot rejects siblings and parents', () => {
  assert.equal(isPathInsideRoot('/music', '/music'), true)
  assert.equal(isPathInsideRoot('/music', '/music/house/track.wav'), true)
  assert.equal(isPathInsideRoot('/music/', '/music/house/track.wav'), true)
  assert.equal(isPathInsideRoot('/music/house/..', '/music/track.wav'), true)
  assert.equal(isPathInsideRoot('/music', '/music-evil'), false)
  assert.equal(isPathInsideRoot('/music', '/etc/passwd'), false)
  assert.equal(isPathInsideRoot('/music/house', '/music'), false)
  assert.equal(isInsideDirectory('C:/Music', 'C:\\Music\\house\\track.wav', path.win32), true)
  assert.equal(isInsideDirectory('C:\\Music\\', 'C:/Music/track.wav', path.win32), true)
  assert.equal(isInsideDirectory('C:/Music', 'c:\\music\\house\\track.wav', path.win32), true)
  assert.equal(isInsideDirectory('\\\\?\\C:\\Music', 'C:/Music/house/track.wav', path.win32), true)
  assert.equal(isInsideDirectory('C:/Music', 'C:\\Music-evil\\track.wav', path.win32), false)
  assert.equal(isInsideDirectory('C:/Music/house', 'C:\\Music\\track.wav', path.win32), false)
  assert.equal(isInsideDirectory('C:/Music', 'D:\\Music\\track.wav', path.win32), false)
})

test('toFileAccessError explains a locked file', () => {
  const locked = Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
  const busy = Object.assign(new Error('resource busy'), { code: 'EBUSY' })
  assert.equal(toFileAccessError(locked, 'fallback').message, FILE_BUSY_MESSAGE)
  assert.equal(toFileAccessError(busy, 'fallback').message, FILE_BUSY_MESSAGE)
  assert.equal(
    toFileAccessError(new Error('Файл с таким именем уже есть'), 'fallback').message,
    'Файл с таким именем уже есть'
  )
})

test('listAudioDirectory returns folders and audio files only', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'crate-parent-'))
  const root = join(parent, 'music')
  const evil = join(parent, 'music-evil')
  try {
    await mkdir(join(root, 'House'), { recursive: true })
    await mkdir(evil, { recursive: true })
    await writeFile(join(root, '02 kick.wav'), 'wav')
    await writeFile(join(root, '01 hat.mp3'), 'mp3')
    await writeFile(join(root, 'notes.txt'), 'ignore')
    await writeFile(join(root, '.secret.flac'), 'ignore')
    await writeFile(join(root, 'House', 'pad.flac'), 'flac')
    await writeFile(join(evil, 'secret.mp3'), 'nope')
    await symlink(evil, join(root, 'escape'))

    const listing = await listAudioDirectory(root, root)
    assert.deepEqual(
      listing.files.map((file) => file.name),
      ['01 hat.mp3', '02 kick.wav']
    )
    assert.equal(listing.files[0]?.extension, 'mp3')
    assert.deepEqual(
      listing.directories.map((directory) => directory.name),
      ['House']
    )

    const nested = await listAudioDirectory(root, join(root, 'House'))
    assert.equal(nested.files[0]?.name, 'pad.flac')
    await assert.rejects(() => listAudioDirectory(root, evil), /библиотеки/)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('parentDirectory stays inside the chosen library', () => {
  assert.equal(parentDirectory('/music', '/music/house'), '/music')
  assert.equal(parentDirectory('/music', '/music/house/deep'), '/music/house')
  assert.equal(parentDirectory('/music', '/music'), null)
  assert.equal(parentDirectory('/music', '/etc'), null)
})

test('listAudioDirectory marks folders and keeps them separate from audio', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'crate-dirs-'))
  const root = join(parent, 'music')
  try {
    await mkdir(join(root, 'House'), { recursive: true })
    await writeFile(join(root, 'root.wav'), 'wav')
    await writeFile(join(root, 'House', 'pad.flac'), 'flac')
    const listing = await listAudioDirectory(root, root)
    assert.equal(listing.directories[0]?.isDirectory, true)
    assert.equal(listing.directories[0]?.name, 'House')
    assert.equal(typeof listing.directories[0]?.birthtimeMs, 'number')
    assert.equal(typeof listing.directories[0]?.mtimeMs, 'number')
    assert.equal(listing.files[0]?.isDirectory, false)
    assert.equal(listing.files[0]?.extension, 'wav')
    assert.equal(typeof listing.files[0]?.birthtimeMs, 'number')
    assert.equal(listing.files[0]?.mtimeMs, listing.files[0]?.modifiedAt)
    const nested = await listAudioDirectory(root, join(root, 'House'))
    assert.equal(nested.files[0]?.name, 'pad.flac')
    assert.equal(parentDirectory(listing.path, nested.path), listing.path)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('assertSafeFileName keeps an audio name inside one path segment', () => {
  assert.equal(assertSafeFileName('  01 Night.wav  '), '01 Night.wav')
  assert.throws(() => assertSafeFileName('../secret.mp3'), /Некорректное имя/)
  assert.throws(() => assertSafeFileName('a/b.mp3'), /Некорректное имя/)
  assert.throws(() => assertSafeFileName('bad:name.mp3'), /Некорректное имя/)
  assert.throws(() => assertSafeFileName('notes.txt'), /расширением/)
})

test('renameAudioFile and moveAudioFile stay inside the chosen folders', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'crate-move-'))
  const left = join(parent, 'left')
  const right = join(parent, 'right')
  try {
    await mkdir(left)
    await mkdir(right)
    const source = join(left, 'Kick.wav')
    await writeFile(source, minimalWav())

    const renamed = await renameAudioFile(left, source, 'Kick Loop.wav')
    assert.equal(renamed, join(left, 'Kick Loop.wav'))
    await assert.rejects(() => access(source))
    await assert.rejects(() => renameAudioFile(left, renamed, '../outside.wav'), /Некорректное имя/)

    await writeFile(join(right, 'Kick Loop.wav'), minimalWav())
    await assert.rejects(() => moveAudioFile(left, renamed, right), /уже есть/)
    await rm(join(right, 'Kick Loop.wav'))

    const moved = await moveAudioFile(left, renamed, right)
    assert.equal(moved, join(right, 'Kick Loop.wav'))
    await assert.rejects(() => access(renamed))

    const nested = join(right, 'House')
    await mkdir(nested)
    const nestedMove = await moveAudioFile(right, moved, nested)
    assert.equal(nestedMove, join(nested, 'Kick Loop.wav'))
    await assert.rejects(() => access(moved))
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('writeAudioTags stores ID3 in WAV and MP3 without breaking the RIFF header', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crate-tags-'))
  const wavPath = join(dir, 'Night.wav')
  const mp3Path = join(dir, 'Hat.mp3')
  try {
    await writeFile(wavPath, minimalWav())
    await writeAudioTags(wavPath, {
      title: 'Night Drive',
      artist: 'Crate',
      genre: 'House',
      bpm: '128'
    })
    const wavTags = await readAudioTags(wavPath)
    assert.equal(wavTags.title, 'Night Drive')
    assert.equal(wavTags.artist, 'Crate')
    assert.equal(wavTags.genre, 'House')
    assert.equal(wavTags.bpm, 128)
    const wavBytes = await readFile(wavPath)
    assert.equal(wavBytes.toString('ascii', 0, 4), 'RIFF')
    assert.equal(wavBytes.includes(Buffer.from('ID3')), true)

    await writeAudioTags(wavPath, { title: 'Glass', artist: 'Crate', genre: '', bpm: '' })
    const rewritten = await readAudioTags(wavPath)
    assert.equal(rewritten.title, 'Glass')
    assert.equal(rewritten.artist, 'Crate')
    assert.equal(rewritten.bpm, null)

    const frame = Buffer.alloc(417, 0)
    frame[0] = 0xff
    frame[1] = 0xfb
    frame[2] = 0x90
    frame[3] = 0x00
    await writeFile(mp3Path, frame)
    await writeAudioTags(mp3Path, { title: 'Hat', artist: 'Crate', genre: 'Techno', bpm: '140' })
    const mp3Tags = await readAudioTags(mp3Path)
    assert.equal(mp3Tags.title, 'Hat')
    assert.equal(mp3Tags.artist, 'Crate')
    assert.equal(mp3Tags.genre, 'Techno')
    assert.equal(mp3Tags.bpm, 140)

    await assert.rejects(
      () => writeAudioTags(join(dir, 'nope.flac'), { title: 'X', artist: '', genre: '', bpm: '' }),
      /MP3 и WAV/
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('writeCoverImage embeds the jpeg in WAV and MP3', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crate-cover-'))
  const wavPath = join(dir, 'Night [END].wav')
  const mp3Path = join(dir, 'Hat [PREPARTY].mp3')
  try {
    const image = join(process.cwd(), 'resources/covers/end.jpg')
    await writeFile(wavPath, minimalWav())
    await writeCoverImage(wavPath, image)
    const { parseFile } = await import('music-metadata')
    const wav = await parseFile(wavPath)
    assert.ok((wav.common.picture?.length ?? 0) > 0)

    const frame = Buffer.alloc(417, 0)
    frame[0] = 0xff
    frame[1] = 0xfb
    frame[2] = 0x90
    frame[3] = 0x00
    await writeFile(mp3Path, frame)
    await writeCoverImage(mp3Path, image)
    const mp3 = await parseFile(mp3Path)
    assert.ok((mp3.common.picture?.length ?? 0) > 0)
    const wavBytes = await readFile(wavPath)
    assert.equal(wavBytes.toString('ascii', 0, 4), 'RIFF')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readAudioCover returns a data url for an embedded jpeg and null without one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crate-cover-read-'))
  const mp3Path = join(dir, 'Hat.mp3')
  const wavPath = join(dir, 'Night.wav')
  const image = join(process.cwd(), 'resources/covers/prime.jpg')
  try {
    const frame = Buffer.alloc(417, 0)
    frame[0] = 0xff
    frame[1] = 0xfb
    frame[2] = 0x90
    frame[3] = 0x00
    await writeFile(mp3Path, frame)
    await writeFile(wavPath, minimalWav())
    assert.equal(readAudioCover(mp3Path), null)
    assert.equal(readAudioCover(join(dir, 'broken.mp3')), null)
    await writeCoverImage(mp3Path, image)
    await writeCoverImage(wavPath, image)
    const prime = await readFile(image)
    for (const filePath of [mp3Path, wavPath]) {
      const dataUrl = readAudioCover(filePath)
      assert.ok(dataUrl?.startsWith('data:image/jpeg;base64,'))
      const encoded = dataUrl?.slice('data:image/jpeg;base64,'.length) ?? ''
      assert.ok(Buffer.from(encoded, 'base64').equals(prime))
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('writeCoverImage replaces an existing front cover', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crate-cover-replace-'))
  const mp3Path = join(dir, 'Hat [PRIME].mp3')
  const wavPath = join(dir, 'Night [END].wav')
  const prime = join(process.cwd(), 'resources/covers/prime.jpg')
  const end = join(process.cwd(), 'resources/covers/end.jpg')
  try {
    const frame = Buffer.alloc(417, 0)
    frame[0] = 0xff
    frame[1] = 0xfb
    frame[2] = 0x90
    frame[3] = 0x00
    await writeFile(mp3Path, frame)
    await writeFile(wavPath, minimalWav())
    await writeCoverImage(mp3Path, end)
    await writeCoverImage(wavPath, end)
    await writeCoverImage(mp3Path, prime)
    await writeCoverImage(wavPath, prime)
    const { parseFile } = await import('music-metadata')
    const primeBytes = await readFile(prime)
    const endBytes = await readFile(end)
    const mp3 = await parseFile(mp3Path)
    const wav = await parseFile(wavPath)
    const mp3Picture = Buffer.from(mp3.common.picture?.[0]?.data ?? [])
    const wavPicture = Buffer.from(wav.common.picture?.[0]?.data ?? [])
    assert.ok(mp3Picture.equals(primeBytes))
    assert.ok(wavPicture.equals(primeBytes))
    assert.equal(mp3Picture.equals(endBytes), false)
    assert.equal(wav.common.picture?.length, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('syncAudioTitle stores the filename without extension and keeps other tags', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'crate-title-'))
  const wavPath = join(dir, 'Night [END].wav')
  const mp3Path = join(dir, 'Hat [PREPARTY].mp3')
  try {
    await writeFile(wavPath, minimalWav())
    await writeAudioTags(wavPath, { title: 'Old', artist: 'Crate', genre: 'House', bpm: '120' })
    const image = join(process.cwd(), 'resources/covers/end.jpg')
    await writeCoverImage(wavPath, image)
    await syncAudioTitle(wavPath)
    const wavTags = await readAudioTags(wavPath)
    assert.equal(wavTags.title, '[END] Night')
    assert.equal(wavTags.artist, 'Crate')
    const { parseFile } = await import('music-metadata')
    const wav = await parseFile(wavPath)
    assert.ok((wav.common.picture?.length ?? 0) > 0)

    const frame = Buffer.alloc(417, 0)
    frame[0] = 0xff
    frame[1] = 0xfb
    frame[2] = 0x90
    frame[3] = 0x00
    await writeFile(mp3Path, frame)
    await writeAudioTags(mp3Path, { title: 'Old', artist: 'Crate', genre: 'Techno', bpm: '140' })
    await syncAudioTitle(mp3Path)
    const mp3Tags = await readAudioTags(mp3Path)
    assert.equal(mp3Tags.title, '[PREPARTY] Hat')
    assert.equal(mp3Tags.artist, 'Crate')
    assert.equal(mp3Tags.genre, 'Techno')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyEnergyToFile writes the tag, title, and matching cover', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'crate-energy-'))
  const root = join(parent, 'music')
  const covers = join(process.cwd(), 'resources/covers')
  try {
    await mkdir(root)
    const mp3Path = join(root, 'Hat.mp3')
    const frame = Buffer.alloc(417, 0)
    frame[0] = 0xff
    frame[1] = 0xfb
    frame[2] = 0x90
    frame[3] = 0x00
    await writeFile(mp3Path, frame)
    await writeAudioTags(mp3Path, { title: 'Old', artist: 'Crate', genre: 'Techno', bpm: '140' })
    const updated = await applyEnergyToFile(root, mp3Path, 'PRIME', 'toggle', covers)
    assert.equal(updated.name, '[PRIME] Hat.mp3')
    assert.equal(updated.tags.title, '[PRIME] Hat')
    assert.equal(updated.tags.artist, 'Crate')
    const dataUrl = readAudioCover(updated.path)
    assert.ok(dataUrl?.startsWith('data:image/jpeg;base64,'))
    const encoded = dataUrl?.slice('data:image/jpeg;base64,'.length) ?? ''
    const prime = await readFile(join(covers, 'prime.jpg'))
    assert.ok(Buffer.from(encoded, 'base64').equals(prime))
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('applyEnergyToFile leaves the cover untouched when embedding is off', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'crate-energy-off-'))
  const root = join(parent, 'music')
  const covers = join(process.cwd(), 'resources/covers')
  try {
    await mkdir(root)
    const mp3Path = join(root, 'Hat.mp3')
    const frame = Buffer.alloc(417, 0)
    frame[0] = 0xff
    frame[1] = 0xfb
    frame[2] = 0x90
    frame[3] = 0x00
    await writeFile(mp3Path, frame)
    await writeAudioTags(mp3Path, { title: 'Old', artist: 'Crate', genre: '', bpm: '' })
    const updated = await applyEnergyToFile(root, mp3Path, 'MID', 'toggle', covers, false)
    assert.equal(updated.name, '[MID] Hat.mp3')
    assert.equal(updated.tags.title, '[MID] Hat')
    assert.equal(readAudioCover(updated.path), null)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

function riffChunk(id: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.write(id, 0, 'ascii')
  header.writeUInt32LE(body.length, 4)
  const pad = body.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0)
  return Buffer.concat([header, body, pad])
}

function minimalWav(): Buffer {
  const data = Buffer.alloc(8)
  const fmt = Buffer.alloc(16)
  fmt.writeUInt16LE(1, 0)
  fmt.writeUInt16LE(1, 2)
  fmt.writeUInt32LE(44100, 4)
  fmt.writeUInt32LE(88200, 8)
  fmt.writeUInt16LE(2, 12)
  fmt.writeUInt16LE(16, 14)
  const chunks = Buffer.concat([riffChunk('fmt ', fmt), riffChunk('data', data)])
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(4 + chunks.length, 4)
  header.write('WAVE', 8, 'ascii')
  return Buffer.concat([header, chunks])
}
