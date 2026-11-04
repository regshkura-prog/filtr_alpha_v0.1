import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-static'
import NodeID3 from 'node-id3'
import { applyTagsAndRename } from './analysis'
import { analyzeIntegratedLoudness } from './loudness'
import { readAudioTags } from './tags'

test('applyTagsAndRename writes TBPM and TKEY, then renames the file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filtr-analysis-'))
  const mp3Path = join(dir, 'Hugel - Movin To The Sun.mp3')
  const wavPath = join(dir, 'Night.wav')
  const nextName = '[PRIME]124 - 3A - - Hugel - Movin To The Sun.mp3'
  try {
    const frame = Buffer.alloc(417, 0)
    frame[0] = 0xff
    frame[1] = 0xfb
    frame[2] = 0x90
    frame[3] = 0x00
    await writeFile(mp3Path, frame)
    await writeFile(wavPath, minimalWav())

    const renamed = await applyTagsAndRename(dir, mp3Path, nextName, 123.6, '3a')
    assert.equal(isAbsolute(renamed), true)
    assert.equal(basename(renamed), nextName)
    await assert.rejects(() => access(mp3Path))

    const tags = await readAudioTags(renamed)
    assert.equal(tags.bpm, 124)
    assert.equal(tags.key, '3A')
    const raw = NodeID3.read(renamed)
    assert.equal(raw.bpm, '124')
    assert.equal(raw.initialKey, '3A')
    assert.equal(
      raw.userDefinedText?.some((item) => item.description === 'KEY' && item.value === '3A'),
      true
    )

    await applyTagsAndRename(dir, wavPath, 'Night.wav', 98, '8B')
    const wavTags = await readAudioTags(wavPath)
    assert.equal(wavTags.bpm, 98)
    assert.equal(wavTags.key, '8B')
    const wavBytes = await readFile(wavPath)
    assert.equal(wavBytes.toString('ascii', 0, 4), 'RIFF')
    assert.equal(wavBytes.toString('ascii', 8, 12), 'WAVE')

    await assert.rejects(
      () => applyTagsAndRename(dir, renamed, '../outside.mp3', 124, '3A'),
      /Некорректное имя/
    )
    await access(renamed)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyTagsAndRename writes to a file with empty UFID and PRIV frames', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filtr-analysis-'))
  const mp3Path = join(dir, 'Empty.mp3')
  try {
    const frame = Buffer.alloc(417, 0)
    frame[0] = 0xff
    frame[1] = 0xfb
    frame[2] = 0x90
    frame[3] = 0x00
    await writeFile(mp3Path, frame)
    NodeID3.write(
      {
        uniqueFileIdentifier: [{ ownerIdentifier: 'owner', identifier: Buffer.alloc(0) }],
        private: [{ ownerIdentifier: 'owner', data: '' }]
      },
      mp3Path
    )

    const renamed = await applyTagsAndRename(dir, mp3Path, '124 - 3A - - Empty.mp3', 124, '3A')
    assert.equal(basename(renamed), '124 - 3A - - Empty.mp3')
    const tags = await readAudioTags(renamed)
    assert.equal(tags.bpm, 124)
    assert.equal(tags.key, '3A')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyTagsAndRename renames formats without ID3 support', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filtr-analysis-'))
  const flacPath = join(dir, 'Night.flac')
  try {
    await writeFile(flacPath, Buffer.from('fLaC'))
    const renamed = await applyTagsAndRename(dir, flacPath, '124 - 3A - - Night.flac', 124, '3A')
    assert.equal(basename(renamed), '124 - 3A - - Night.flac')
    assert.deepEqual(await readFile(renamed), Buffer.from('fLaC'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('applyTagsAndRename waits for a running loudness analysis of the same file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filtr-analysis-'))
  const flacPath = join(dir, 'Long.flac')
  try {
    execFileSync(String(ffmpegStatic), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=duration=300',
      flacPath
    ])
    const loudness = analyzeIntegratedLoudness(flacPath)
    const renamed = await applyTagsAndRename(dir, flacPath, '124 - 3A - - Long.flac', 124, '3A')
    assert.equal(basename(renamed), '124 - 3A - - Long.flac')
    assert.equal(typeof (await loudness), 'number')
  } finally {
    await rm(dir, { recursive: true, force: true })
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
