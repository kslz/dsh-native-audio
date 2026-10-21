import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply as installConnection, type PeerOptions } from '@deepseek-ai/dsh-client-connection'
import { afterEach, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.ts'
import { wav } from './helpers.ts'
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})
async function setup(maxAudioBytes = 1024 * 1024) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-native-connection-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', directory)
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  ctx.provide('credentials', { modifyRecord: async (_key: unknown, update: (value: undefined) => Promise<unknown>) => update(undefined) })
  ctx.provide('llm', {})
  ctx.provide('attachments', { imageLimits: { maxMessageImageBytes: 1024 * 1024 } })
  await installConnection(ctx)
  const original = globalThis.fetch
  const installed = ctx.plugin(plugin, { maxAudioBytes })
  await installed.await()
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const carrier = (path: string, init: RequestInit = {}) => handler.fetch(new Request(new URL(path, 'http://localhost'), init), ctx.connection.browserPeer)
  return { ctx, installed, original, carrier, handler }
}
it('loads through real Cordis, uploads bytes, enforces session access, persists, deletes, and unloads', async () => {
  const { ctx, installed, original, carrier } = await setup()
  const bytes = wav()
  const response = await carrier('/api/dsh-native-audio/upload?sessionId=a&name=tone.wav', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: new Uint8Array(bytes) })
  expect(response.status).toBe(200)
  const receipt = await response.json()
  const path = `/api/dsh-native-audio/audio?sessionId=a&id=${receipt.id}`
  expect(Buffer.from(await (await carrier(path)).arrayBuffer())).toEqual(bytes)
  expect((await carrier(path.replace('sessionId=a', 'sessionId=b'))).status).toBe(403)
  expect(globalThis.fetch).not.toBe(original)
  await installed.dispose()
  expect(globalThis.fetch).toBe(original)
  expect((await carrier(path)).status).toBe(404)
  await ctx.plugin(plugin).await()
  expect((await carrier(path)).status).toBe(200)
  expect((await carrier(path.replace('/audio?', '/delete?'), { method: 'POST' })).status).toBe(200)
  expect((await carrier(path)).status).toBe(404)
})
it('uses owner authentication, rejects invalid media and oversized bodies, and contains traversal', async () => {
  const { ctx, handler, carrier } = await setup(5000)
  const peer = ctx.connection.createPeer({ principal: { kind: 'fixture' } as unknown as PeerOptions['principal'] })
  expect((await handler.fetch(new Request('http://localhost/api/dsh-native-audio/status?sessionId=a'), peer)).status).toBe(403)
  expect((await carrier('/api/dsh-native-audio/status')).status).toBe(400)
  const upload = '/api/dsh-native-audio/upload?sessionId=a&name=x.wav'
  expect((await carrier(upload, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: new Uint8Array(6000) })).status).toBe(413)
  expect((await carrier(upload, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: 'this is text' })).status).toBe(400)
  expect((await carrier('/api/dsh-native-audio/audio?sessionId=a&id=../../private')).status).toBe(400)
})
