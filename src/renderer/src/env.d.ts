/// <reference types="vite/client" />

declare module 'music-tempo' {
  export default class MusicTempo {
    constructor(
      audioData: ArrayLike<number>,
      params?: {
        bufferSize?: number
        hopSize?: number
        timeStep?: number
      }
    )
    tempo: string | number
    beats: number[]
  }
}
