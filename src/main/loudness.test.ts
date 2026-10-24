import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import NodeID3 from 'node-id3'
import { statusForLoudness } from '../shared/loudness'
import {
  LOUDNORM_FILTER,
  analyzeIntegratedLoudness,
  normalizeAudioFile,
  parseIntegratedLoudness,
  parseVolumeAdjust,
  temporaryLoudnessPath,
  volumeAdjustFilter
} from './loudness'

const SAMPLE = `[Parsed_ebur128_0 @ 0x1] t: 0.1 M: -18.1 S: -18.1 I: -18.1 LUFS LRA: 0.0 LU
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:         -11.4 LUFS
    Threshold: -21.5 LUFS
`

test('parseIntegratedLoudness keeps the summary value', () => {
  assert.equal(parseIntegratedLoudness(SAMPLE), -11.4)
  assert.equal(parseIntegratedLoudness('I: -9.0 LUFS'), -9)
  assert.equal(parseIntegratedLoudness('no loudness here'), null)
  assert.equal(LOUDNORM_FILTER, 'loudnorm=I=-9:LRA=11:TP=-1.0')
  assert.equal(temporaryLoudnessPath('/music/Night.mp3'), '/music/Night.tmp.mp3')
})

test('parseVolumeAdjust accepts half-decibel steps from -6 to 6', () => {
  assert.equal(parseVolumeAdjust('+2.5'), 2.5)
  assert.equal(parseVolumeAdjust(-1), -1)
  assert.equal(parseVolumeAdjust(0), 0)
  assert.equal(volumeAdjustFilter(2.5), 'volume=2.5dB')
  assert.equal(volumeAdjustFilter(-1), 'volume=-1.0dB')
  assert.throws(() => parseVolumeAdjust('2.5dB'), /Некорректная громкость/)
  assert.throws(() => parseVolumeAdjust(7), /Некорректная громкость/)
})

test('statusForLoudness uses -9 LUFS as the quiet threshold', () => {
  assert.equal(statusForLoudness(-9.1), 'low_volume')
  assert.equal(statusForLoudness(-9), 'ok')
  assert.equal(statusForLoudness(-8.9), 'ok')
})

const directory = mkdtempSync(join(tmpdir(), 'filtr-loudness-'))
const source = join(directory, 'tone.mp3')

after(() => {
  rmSync(directory, { recursive: true, force: true })
})

test('analyze-audio and normalize-audio keep ID3 objects', async (t) => {
  if (!ffmpegStatic) {
    t.skip('ffmpeg-static binary is unavailable')
    return
  }
  ffmpeg.setFfmpegPath(ffmpegStatic)
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input('sine=frequency=440:duration=1:sample_rate=44100')
      .inputFormat('lavfi')
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .on('end', () => resolve())
      .on('error', reject)
      .save(source)
  })
  const cues = Buffer.from('serato-cues')
  const written = NodeID3.write(
    {
      title: 'Keep me',
      generalObject: [
        {
          mimeType: 'application/octet-stream',
          filename: '',
          contentDescription: 'Serato Markers2',
          encapsulatedObject: cues
        }
      ]
    },
    source
  )
  assert.equal(written, true)

  const loudness = await analyzeIntegratedLoudness(source)
  assert.equal(typeof loudness, 'number')
  assert.ok(loudness < 0)

  await normalizeAudioFile(source)
  const tags = NodeID3.read(source)
  assert.equal(tags.title, 'Keep me')
  assert.equal(tags.generalObject?.[0]?.contentDescription, 'Serato Markers2')
  assert.ok(tags.generalObject?.[0]?.encapsulatedObject.equals(cues))
  const normalized = await analyzeIntegratedLoudness(source)
  assert.ok(normalized > -15 && normalized < -4)
})
