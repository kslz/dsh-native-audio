import { expect, it } from 'vitest'
import { audioMime } from '../src/protocol.ts'
import { audioMentions } from '../src/workspace-audio.ts'
it('leaves MP4 and WebM video references for the video plugin but retains audio-only containers', () => {
  expect(audioMentions('@clip.mp4 @clip.webm @music.m4a @recording.weba').map(m => m.path)).toEqual(['music.m4a', 'recording.weba'])
  expect(() => audioMime('clip.mp4', '')).toThrow()
  expect(audioMime('music.mp4', 'audio/mp4')).toBe('audio/mp4')
  expect(audioMime('recording.webm', 'audio/webm')).toBe('audio/webm')
})
