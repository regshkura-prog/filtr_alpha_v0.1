declare module 'fluent-ffmpeg' {
  export interface FfmpegCommand {
    input(source: string): this
    inputFormat(format: string): this
    audioFilters(filter: string): this
    audioCodec(codec: string): this
    audioBitrate(bitrate: string | number): this
    noVideo(): this
    format(format: string): this
    on(event: 'end', listener: () => void): this
    on(event: 'error', listener: (error: Error) => void): this
    on(event: 'stderr', listener: (line: string) => void): this
    save(output: string): this
    kill(signal?: string): this
  }

  interface Ffmpeg {
    (input?: string): FfmpegCommand
    setFfmpegPath(path: string): void
  }

  const ffmpeg: Ffmpeg
  export default ffmpeg
}
