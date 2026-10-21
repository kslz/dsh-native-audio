import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioBridge } from '../src/bridge.ts'
import { AudioStore } from '../src/store.ts'
import { marker } from '../src/protocol.ts'
import { collect, config, model, options, url, wav } from './helpers.ts'

let directory: string
let store: AudioStore
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'dsh-audio-test-')); store = new AudioStore(directory, 1024 * 1024) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('Gemini audio request transport', () => {
  it('sends original audio bytes, keeps tool signatures and request metadata, and replays after restart', async () => {
    const bytes = wav()
    const receipt = await store.put('session-a', 'tone.wav', 'audio/wav', bytes)
    const restarted = new AudioStore(directory, store.maxBytes)
    const bridge = createAudioBridge(restarted, config)
    const original = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok'))
    const patched = bridge.wrapFetch(original)
    const text = `Listen ${marker(receipt.id)} then describe.`
    const body = { contents: [
      { role: 'user', parts: [{ text }] },
      { role: 'model', parts: [{ functionCall: { name: 'read', args: {} }, thoughtSignature: 'signed-value' }] },
      { role: 'user', parts: [{ functionResponse: { name: 'read', response: { ok: true } } }] },
    ], tools: [{ functionDeclarations: [{ name: 'read' }] }], systemInstruction: { parts: [{ text: 'system' }] } }
    const signal = new AbortController().signal
    async function* adapter() {
      await patched(url, { method: 'POST', body: JSON.stringify(body), signal, headers: { authorization: 'Bearer fixture', 'x-opencode-session': 'fixture', 'content-length': '123' } })
      yield { type: 'text-delta', index: 0, text: 'audio heard' } as const
    }
    const frozen = Object.freeze(options(text))
    expect(await collect(bridge.hook(frozen, adapter))).toHaveLength(1)
    const init = original.mock.calls[0][1]!
    const sent = JSON.parse(String(init.body))
    expect(Buffer.from(sent.contents[0].parts[1].inlineData.data, 'base64')).toEqual(bytes)
    expect(sent.contents[0].parts[1].inlineData.mimeType).toBe('audio/wav')
    expect(sent.contents[0].parts.map((part: { text?: string }) => part.text).filter(Boolean)).toEqual(['Listen ', ' then describe.'])
    expect(sent.contents.slice(1)).toEqual(body.contents.slice(1))
    expect(sent.tools).toEqual(body.tools)
    expect(sent.systemInstruction).toEqual(body.systemInstruction)
    expect(init.signal).toBe(signal)
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer fixture')
    expect(new Headers(init.headers).get('x-opencode-session')).toBe('fixture')
    expect(new Headers(init.headers).has('content-length')).toBe(false)
    expect(frozen.messages[0].content[0]).toEqual({ type: 'text', text })
    await collect(bridge.hook(options(text), adapter))
    expect(original).toHaveBeenCalledTimes(2)
    // The transport is inert outside the owning stream.
    await patched(url, { body: JSON.stringify(body) })
    expect(original.mock.calls[2][1]?.body).toBe(JSON.stringify(body))
  })
  it('isolates concurrent streams and supports Request inputs', async () => {
    const a = await store.put('session-a', 'a.wav', 'audio/wav', wav(0.1))
    const b = await store.put('session-b', 'b.wav', 'audio/wav', wav(0.2))
    const bridge = createAudioBridge(store, config)
    const bodies: string[] = []
    const patched = bridge.wrapFetch(async (input, init) => { bodies.push(String(init?.body)); return new Response() })
    const run = (id: string, session: string) => collect(bridge.hook(options(marker(id), session), async function* () {
      await Promise.resolve()
      await patched(new Request(url, { method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: marker(id) }] }] }), headers: { 'x-request': session } }))
      yield { type: 'text-delta', index: 0, text: session }
    }))
    await Promise.all([run(a.id, 'session-a'), run(b.id, 'session-b')])
    const sizes = bodies.map(body => Buffer.from(JSON.parse(body).contents[0].parts[0].inlineData.data, 'base64').length).sort((a, b) => a - b)
    expect(sizes).toEqual([a.size, b.size])
  })
  it.each([
    ['wrong model for explicit native listening', { model: 'text-only' }, /当前模型/],
    ['wrong session', { sessionId: 'session-b' }, /不属于/],
    ['missing session', { sessionId: undefined }, /会话编号/],
  ])('refuses %s before invoking the adapter', async (_name, overrides, error) => {
    const receipt = await store.put('session-a', 'tone.wav', 'audio/wav', wav())
    const bridge = createAudioBridge(store, config)
    const next = vi.fn()
    await expect(collect(bridge.hook(options(`原生听音 ${marker(receipt.id)}`, 'session-a', overrides), next))).rejects.toThrow(error)
    expect(next).not.toHaveBeenCalled()
  })
  it.each([
    ['https://other.example/v1beta/models/' + model + ':generateContent', /allowedOrigins/],
    ['https://opencode.ai/v1/chat/completions', /不是 Gemini/],
  ])('blocks unsupported or unauthorized upstream %s', async (endpoint, error) => {
    const receipt = await store.put('session-a', 'tone.wav', 'audio/wav', wav())
    const bridge = createAudioBridge(store, config)
    const original = vi.fn<typeof fetch>()
    const patched = bridge.wrapFetch(original)
    await expect(collect(bridge.hook(options(marker(receipt.id)), async function* () {
      await patched(endpoint, { method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: marker(receipt.id) }] }] }) })
      yield { type: 'text-delta', index: 0, text: 'bad' }
    }))).rejects.toThrow(error)
    expect(original).not.toHaveBeenCalled()
  })
  it('does not intercept text calls, assistant markers, or title/compaction calls', async () => {
    const bridge = createAudioBridge(store, config)
    const next = vi.fn(() => ({ async *[Symbol.asyncIterator]() {} }))
    bridge.hook(options('plain'), next)
    bridge.hook(options('', 'session-a', { messages: [{ role: 'assistant', content: [{ type: 'text', text: marker('a'.repeat(32)) }] }] }), next)
    bridge.hook(options(marker('a'.repeat(32)), 'session-a', { purpose: 'compaction' }), next)
    expect(next).toHaveBeenCalledTimes(3)
  })
  it('refuses dropped markers and oversized serialized requests before network I/O', async () => {
    const receipt = await store.put('session-a', 'tone.wav', 'audio/wav', wav())
    const original = vi.fn<typeof fetch>()
    for (const [maxRequestBytes, text, expected] of [
      [config.maxRequestBytes, 'reference was lost', /没有保留/],
      [1000, marker(receipt.id), /请求大小/],
    ] as const) {
      const bridge = createAudioBridge(store, { ...config, maxRequestBytes })
      const patched = bridge.wrapFetch(original)
      await expect(collect(bridge.hook(options(marker(receipt.id)), async function* () {
        await patched(url, { method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }) })
        yield { type: 'text-delta', index: 0, text: 'bad' }
      }))).rejects.toThrow(expected)
    }
    expect(original).not.toHaveBeenCalled()
  })
  it('forwards early cancellation to the adapter and disables retained wrappers on unload', async () => {
    const receipt = await store.put('session-a', 'tone.wav', 'audio/wav', wav())
    const bridge = createAudioBridge(store, config)
    let finalized = false
    const stream = bridge.hook(options(marker(receipt.id)), async function* () {
      try { yield { type: 'text-delta', index: 0, text: 'one' }; yield { type: 'text-delta', index: 0, text: 'two' } }
      finally { finalized = true }
    })
    for await (const _chunk of stream) break
    expect(finalized).toBe(true)
    bridge.dispose()
    const next = vi.fn(() => ({ async *[Symbol.asyncIterator]() {} }))
    bridge.hook(options(marker(receipt.id)), next)
    expect(next).toHaveBeenCalled()
  })
})
