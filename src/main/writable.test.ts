import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ensureWritable } from './writable'

test('ensureWritable clears the read-only bit and ignores a missing path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'filtr-writable-'))
  const filePath = join(dir, 'track.mp3')
  try {
    await writeFile(filePath, 'audio')
    await chmod(filePath, 0o444)
    await ensureWritable(filePath)
    const info = await stat(filePath)
    assert.ok((info.mode & 0o200) !== 0)
    await ensureWritable(join(dir, 'missing.mp3'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
