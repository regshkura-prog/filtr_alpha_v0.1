import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import ffmpegStatic from 'ffmpeg-static'
import { temporaryCoverPath } from './flacCover'
import { readAnyAudioCover, readAudioTags, writeCoverImage } from './tags'

test('writeCoverImage embeds a cover into FLAC and keeps its tags', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filtr-flac-cover-'))
  const flacPath = join(dir, 'Night.flac')
  const prime = join(process.cwd(), 'resources/covers/prime.jpg')
  const end = join(process.cwd(), 'resources/covers/end.jpg')
  try {
    execFileSync(String(ffmpegStatic), [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.3',
      '-metadata',
      'artist=Timbaland',
      flacPath
    ])
    assert.equal(await readAnyAudioCover(flacPath), null)

    await writeCoverImage(flacPath, prime)
    const dataUrl = await readAnyAudioCover(flacPath)
    assert.ok(dataUrl?.startsWith('data:image/jpeg;base64,'))
    const encoded = dataUrl?.slice('data:image/jpeg;base64,'.length) ?? ''
    assert.ok(Buffer.from(encoded, 'base64').equals(await readFile(prime)))
    assert.equal((await readAudioTags(flacPath)).artist, 'Timbaland')
    await assert.rejects(() => access(temporaryCoverPath(flacPath)))

    // A second cover replaces the first one instead of stacking up.
    await writeCoverImage(flacPath, end)
    const replaced = (await readAnyAudioCover(flacPath)) ?? ''
    const bytes = Buffer.from(replaced.slice('data:image/jpeg;base64,'.length), 'base64')
    assert.ok(bytes.equals(await readFile(end)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
