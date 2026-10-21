import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, fileHandleText } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { expect, it, vi } from 'vitest'
import { AudioStore } from '../src/store.ts'
import { createAudioBridge } from '../src/bridge.ts'
import { readNativeAudio } from '../src/native-attachments.ts'
import { collect, config, model, options, url, wav } from './helpers.ts'

const ref = (bytes: number): FileAttachmentRef => ({ attachmentId: `sha256:${'a'.repeat(64)}`, name: 'voice.wav', bytes } as FileAttachmentRef)

it('expands real DSH file projection into audio without mutating the original attachment message', async () => {
  const bytes = wav()
  const attachment = ref(bytes.length)
  const ctx = new Context()
  const original = globalThis.fetch
  try {
    ctx.provide('attachments', { fileHostPath: () => undefined })
    const llm = new LlmRuntime(ctx)
    const bridge = createAudioBridge(new AudioStore('unused', 1024 * 1024), config, {
      requestText: ref => llm.fileRequestText(ref),
      read: (ref, signal) => readNativeAudio(ref, (async function* () { yield bytes })(), 1024 * 1024, signal),
    })
    const network = vi.fn<typeof fetch>().mockResolvedValue(new Response())
    globalThis.fetch = bridge.wrapFetch(network)
    class Adapter extends LlmAdapter {
      async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
        expect(request.messages[0].content[1].type).toBe('text')
        const parts = request.messages[0].content.map(part => ({ text: part.type === 'text' ? part.text : 'other' }))
        await fetch(url, { method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts }] }) })
        yield { type: 'text-delta', index: 0, text: 'heard' }
      }
    }
    llm.registerAdapter(['opencode-go'], new Adapter())
    ctx.on('llm/stream', bridge.hook, { prepend: true })
    const request = options('Listen', 'a', { messages: [{ role: 'user', content: [{ type: 'text', text: 'Listen' }, { type: 'file', attachment }] }] })
    const chunks = await collect(llm.stream(request))
    expect(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'heard')).toBe(true)
    expect(network).toHaveBeenCalledOnce()
    const sent = JSON.parse(String(network.mock.calls[0][1]?.body))
    expect(sent.contents[0].parts[1].inlineData).toEqual({ mimeType: 'audio/wav', data: bytes.toString('base64') })
    expect(request.messages[0].content[1]).toEqual({ type: 'file', attachment })
  } finally { globalThis.fetch = original; await ctx.fiber.dispose() }
})
it('reads native attachments in bounded chunks and rejects invalid bytes', async () => {
  const bytes = wav()
  const audio = await readNativeAudio(ref(bytes.length), (async function* () { yield bytes.subarray(0, 44); yield bytes.subarray(44) })(), 10000)
  expect(Buffer.from(audio.data, 'base64')).toEqual(bytes)
  await expect(readNativeAudio(ref(1), (async function* () { yield bytes })(), 10000)).rejects.toThrow(/大小/)
  await expect(readNativeAudio(ref(bytes.length), (async function* () { yield bytes.subarray(0, 44) })(), 10000)).rejects.toThrow(/不完整/)
})
it('passes saved-path handles through the same audio expansion without exposing the path upstream', async () => {
  const bytes = wav()
  const attachment = ref(bytes.length)
  const handle = fileHandleText(attachment, '/fixture/stored/voice.wav')
  const bridge = createAudioBridge(new AudioStore('unused', 1024 * 1024), config, {
    requestText: () => handle,
    read: async () => ({ size: bytes.length, mimeType: 'audio/wav', data: bytes.toString('base64') }),
  })
  const original = vi.fn<typeof fetch>().mockResolvedValue(new Response())
  const patched = bridge.wrapFetch(original)
  await collect(bridge.hook(options('', 'a', { messages: [{ role: 'user', content: [{ type: 'file', attachment }] }] }), async function* () {
    await patched(url, { method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: handle }] }] }) })
    yield { type: 'text-delta', index: 0, text: 'done' }
  }))
  const body = String(original.mock.calls[0][1]?.body)
  expect(body).toContain('inlineData')
  expect(body).not.toContain('/fixture/')
})
