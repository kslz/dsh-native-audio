import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AudioStore } from '../src/store.ts'
import { wav } from './helpers.ts'
let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'native-audio-storage-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
it('enforces the storage quota across concurrent uploads', async () => {
  const store = new AudioStore(directory, 5000, 6000)
  const uploads = await Promise.allSettled([
    store.put('a', 'one.wav', 'audio/wav', wav()),
    store.put('a', 'two.wav', 'audio/wav', wav()),
  ])
  expect(uploads.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  const failed = uploads.find(result => result.status === 'rejected') as PromiseRejectedResult
  expect(failed.reason.status).toBe(507)
})
it('normalizes recorder MIME parameters and stores only a basename', async () => {
  const store = new AudioStore(directory, 5000)
  const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 1, 2, 3])
  const receipt = await store.put('a', 'folder\\recording.webm', 'audio/webm;codecs=opus', bytes)
  expect(receipt.name).toBe('recording.webm')
  expect(receipt.mimeType).toBe('audio/webm')
  expect(Buffer.from((await store.get(receipt.id, 'a')).data, 'base64')).toEqual(bytes)
})
it('rejects empty data, unsupported files, and oversized audio', async () => {
  const store = new AudioStore(directory, 4000)
  await expect(store.put('a', 'a.wav', 'audio/wav', Buffer.alloc(0))).rejects.toMatchObject({ status: 413 })
  await expect(store.put('a', 'a.exe', 'application/octet-stream', wav())).rejects.toThrow(/不支持/)
  await expect(store.put('a', 'a.wav', 'audio/wav', wav(0.2))).rejects.toMatchObject({ status: 413 })
})
