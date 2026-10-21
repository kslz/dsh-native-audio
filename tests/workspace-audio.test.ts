import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as installConnection } from '@deepseek-ai/dsh-client-connection'
import { LlmRuntime, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { audioMentions, readWorkspaceAudio } from '../src/workspace-audio.ts'
import { createAudioBridge } from '../src/bridge.ts'
import { AudioStore } from '../src/store.ts'
import { collect, config, options, url, wav } from './helpers.ts'
import * as plugin from '../src/index.ts'

it('recognizes explicit audio references, including quoted Unicode and Windows paths', () => {
  expect(audioMentions('请听 @bgm.mp3，再比较 @"音乐/片段 2.wav" 和 @\'D:\\Music\\one.flac\''))
    .toEqual([
      { token: '@bgm.mp3', path: 'bgm.mp3' },
      { token: '@"音乐/片段 2.wav"', path: '音乐/片段 2.wav' },
      { token: "@'D:\\Music\\one.flac'", path: 'D:\\Music\\one.flac' },
    ])
  expect(audioMentions('mail@example.mp3 @readme.md @https://example.com/audio.mp3')).toEqual([])
})

it('reads exact bytes using the session cwd and the bounded filesystem API', async () => {
  const bytes = wav()
  const target = { targetKey: 'opaque' } as FsTarget
  const fs = {
    resolve: vi.fn(async () => target),
    stat: vi.fn(async () => ({ type: 'file' as const, size: bytes.length, version: 'one' as never })),
    readBytes: vi.fn(async () => new Uint8Array(bytes)),
  }
  const signal = new AbortController().signal
  const audio = await readWorkspaceAudio(fs, '/fixture/workspace', 'bgm.wav', 10000, signal)
  expect(fs.resolve).toHaveBeenCalledWith('bgm.wav', { cwd: '/fixture/workspace', signal })
  expect(fs.readBytes).toHaveBeenCalledWith(target, signal, 10000)
  expect(Buffer.from(audio.data, 'base64')).toEqual(bytes)
  await expect(readWorkspaceAudio(fs, undefined, 'bgm.wav', 10000)).rejects.toThrow(/工作目录/)
  fs.stat.mockResolvedValueOnce({ type: 'file', size: 20000, version: 'one' as never })
  await expect(readWorkspaceAudio(fs, '/fixture/workspace', 'bgm.wav', 10000)).rejects.toThrow(/大小限制/)
  expect(fs.readBytes).toHaveBeenCalledTimes(1)
})

it('reproduces the user @bgm.mp3 case and sends inline audio instead of the filename', async () => {
  const bytes = wav()
  const readMention = vi.fn(async () => ({ size: bytes.length, mimeType: 'audio/wav', data: bytes.toString('base64') }))
  const bridge = createAudioBridge(new AudioStore('unused', 1024 * 1024), config, {
    requestText: () => '', read: vi.fn(), readMention,
  })
  const original = vi.fn<typeof fetch>().mockResolvedValue(new Response())
  const patched = bridge.wrapFetch(original)
  const text = '不要读文件的附加信息，用你的多模态能力去听这个音乐 @bgm.mp3'
  await collect(bridge.hook(options(text, 'music-session'), async function* () {
    await patched(url, { method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }) })
    yield { type: 'text-delta', index: 0, text: 'heard' }
  }))
  expect(readMention).toHaveBeenCalledWith('bgm.mp3', 'music-session', undefined)
  const body = JSON.parse(String(original.mock.calls[0][1]?.body))
  expect(body.contents[0].parts[1].inlineData.data).toBe(bytes.toString('base64'))
  expect(JSON.stringify(body)).not.toContain('@bgm.mp3')
})

it('never expands audio paths supplied by assistant or tool output', () => {
  const bridge = createAudioBridge(new AudioStore('unused', 10000), config)
  const next = vi.fn(() => ({ async *[Symbol.asyncIterator]() {} }))
  bridge.hook(options('', 'a', { messages: [
    { role: 'assistant', content: [{ type: 'text', text: '@private.mp3' }] },
    { role: 'tool', toolCallId: 'call-a', content: [{ type: 'text', text: '@private.mp3' }] },
  ] }), next)
  expect(next).toHaveBeenCalledOnce()
})

it('wires workspace audio through real Cordis injection, session metadata, and LlmRuntime', async () => {
  const ctx = new Context()
  const original = globalThis.fetch
  const bytes = wav()
  const network = vi.fn<typeof fetch>().mockResolvedValue(new Response())
  globalThis.fetch = network
  try {
    ctx.provide('credentials', { modifyRecord: async (_key: unknown, update: (value: undefined) => Promise<unknown>) => update(undefined) })
    ctx.provide('attachments', { imageLimits: { maxMessageImageBytes: 1024 * 1024 } })
    ctx.provide('sessions', { get: () => ({ header: { cwd: '/fixture/workspace' } }) })
    const resolve = vi.fn(async () => ({ targetKey: 'opaque' }))
    ctx.provide('fs', { resolve, stat: async () => ({ type: 'file', size: bytes.length }), readBytes: async () => bytes })
    const llm = new LlmRuntime(ctx)
    await installConnection(ctx)
    await ctx.plugin(plugin).await()
    for (const runtime of ctx.registry.values()) for (const fiber of runtime.fibers) await fiber.await()
    class Adapter extends LlmAdapter {
      async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
        const text = request.messages[0].content.map(part => part.type === 'text' ? part.text : '').join('')
        await fetch(url, { method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }) })
        yield { type: 'text-delta', index: 0, text: 'heard' }
      }
    }
    llm.registerAdapter(['opencode-go'], new Adapter())
    await collect(llm.stream(options('请听 @bgm.wav')))
    expect(resolve).toHaveBeenCalledWith('bgm.wav', { cwd: '/fixture/workspace', signal: undefined })
    const body = JSON.parse(String(network.mock.calls[0][1]?.body))
    expect(body.contents[0].parts[1].inlineData.data).toBe(bytes.toString('base64'))
  } finally { await ctx.fiber.dispose(); globalThis.fetch = original }
})
