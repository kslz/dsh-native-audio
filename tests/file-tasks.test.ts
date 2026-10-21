import { expect, it, vi } from 'vitest'
import { audioIntent } from '../src/intent.ts'
import { createAudioBridge, type NativeAudioSource } from '../src/bridge.ts'
import { audioMentions } from '../src/workspace-audio.ts'
import { AudioStore } from '../src/store.ts'
import { marker } from '../src/protocol.ts'
import { collect, config, options, url, wav } from './helpers.ts'

it.each([
  '@a.mp3 仅作为文件，不做多模态识别。',
  '@a.mp3 不用原生听音，查看采样率。',
  '@a.mp3 帮我转成48kHz的WAV。',
  '@a.mp3 用ffprobe查看信息。',
  '@a.mp3 查看音频信息、时长和码率。',
  '@a.mp3 帮我剪辑一下这个音频。',
  '@a.mp3 降噪并压缩音频。',
  '@a.mp3 绘制波形。',
])('recognizes ordinary audio file task: %s', value => { expect(audioIntent(value)).toBe('file') })
it.each(['@a.mp3 请直接听这段音频。', '@a.mp3 用原生音频理解分析一下。', '不要读文件的附加信息，用你的多模态能力去听这个音乐 @bgm.mp3'])('recognizes explicit native listening: %s', value => { expect(audioIntent(value)).toBe('native') })
it.each(['@a.mp3', '@a.mp3 请转写这段录音。', '@a.mp3 分析降噪后的音质。', '@"直接听原生音频.mp3"', '“直接听”\n> 用多模态识别\n```\nffprobe\n```'])('does not invent a transport command: %s', value => { expect(audioIntent(value)).toBe('auto') })
it('ignores references inside quotations/code while preserving multiple quoted workspace paths', () => {
  expect(audioMentions('`@secret.mp3` “@other.wav”\n> @private.flac')).toEqual([])
  expect(audioMentions('@"a one.mp3" @"b two.wav"').map(m => m.path)).toEqual(['a one.mp3', 'b two.wav'])
})

function setup(maxBytes = 1024 * 1024) {
  const bytes = wav(); const data = { mimeType: 'audio/wav', size: bytes.length, data: bytes.toString('base64') }
  const source: NativeAudioSource = { requestText: ref => `FILE:${ref.name}`, read: vi.fn(async () => data), readMention: vi.fn(async () => data) }
  const store = new AudioStore('unused', maxBytes)
  const get = vi.spyOn(store, 'get')
  const bridge = createAudioBridge(store, config, source)
  const network = vi.fn<typeof fetch>().mockResolvedValue(new Response())
  const patched = bridge.wrapFetch(network)
  const send = (texts: string[]) => async function* () { await patched(url, { body: JSON.stringify({ contents: [{ role: 'user', parts: texts.map(text => ({ text })) }] }) }); yield { type: 'text-delta', index: 0, text: 'ok' } as const }
  return { bridge, source, get, network, send }
}
it.each(['@a.mp3', '@a.mp3 查看文件信息', '@a.mp3 转成WAV', marker('a'.repeat(32))])('passes references to other models without binary reads or native session/size validation: %s', text => {
  const run = async () => {
    const { bridge, source, get, network, send } = setup(1)
    await collect(bridge.hook(options(text, 'a', { model: 'other-model', sessionId: undefined }), send([text])))
    expect(network).toHaveBeenCalledOnce()
    expect(JSON.parse(String(network.mock.calls[0][1]?.body)).contents[0].parts).toEqual([{ text }])
    expect(source.read).not.toHaveBeenCalled(); expect(source.readMention).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled()
  }
  return run()
})
it.each(['@a.mp3 仅作为文件，不做多模态识别', '@a.mp3 转成48kHz的WAV', '@a.mp3 查看文件大小和采样率'])('bypasses native audio for file tasks on Gemini too: %s', async text => {
  const { bridge, source, network, send } = setup(1)
  await collect(bridge.hook(options(text), send([text])))
  expect(source.readMention).not.toHaveBeenCalled()
  expect(JSON.parse(String(network.mock.calls[0][1]?.body)).contents[0].parts).toEqual([{ text }])
})
it('ignores historical explicit listening commands after switching models or starting a file task', async () => {
  const { bridge, source, send } = setup(1)
  const old = options('@a.mp3 请直接听原生音频。').messages[0]
  await collect(bridge.hook(options('', 'a', { model: 'other-model', messages: [old, options('请继续。').messages[0]] }), send(['@a.mp3 请直接听原生音频。'])))
  await collect(bridge.hook(options('', 'a', { messages: [old, options('只查看采样率和码率。').messages[0]] }), send(['@a.mp3 请直接听原生音频。'])))
  expect(source.readMention).not.toHaveBeenCalled()
})
it('preserves historical file occurrences even when a new native request uses the same path', async () => {
  const { bridge, source, network, send } = setup()
  const old = '@a.mp3 查看文件信息'; const current = '@a.mp3 请直接听音频'
  await collect(bridge.hook(options('', 'a', { messages: [options(old).messages[0], options(current).messages[0]] }), send([old, current])))
  const parts = JSON.parse(String(network.mock.calls[0][1]?.body)).contents[0].parts
  expect(parts.filter((p: any) => p.inlineData)).toHaveLength(1)
  expect(parts.filter((p: any) => p.text).map((p: any) => p.text).join('')).toContain(old)
  expect(source.readMention).toHaveBeenCalledTimes(1)
})
it('does not re-read file-task history until a follow-up explicitly asks for native listening', async () => {
  const { bridge, source, send, network } = setup()
  const text = '@a.mp3 查看文件信息'; const old = options(text).messages[0]
  await collect(bridge.hook(options('', 'a', { messages: [old, options('谢谢，继续。').messages[0]] }), send([text])))
  expect(source.readMention).not.toHaveBeenCalled()
  await collect(bridge.hook(options('', 'a', { messages: [old, options('这次请直接听一下。').messages[0]] }), send([text])))
  expect(source.readMention).toHaveBeenCalledOnce()
  expect(JSON.parse(String(network.mock.calls[1][1]?.body)).contents[0].parts[0].inlineData.mimeType).toBe('audio/wav')
})
it('leaves large durable files unchanged and only reads authored references', async () => {
  const { bridge, source, send } = setup(1)
  await collect(bridge.hook(options('', 'a', { model: 'other-model', messages: [{ role: 'user', content: [{ type: 'file', attachment: { attachmentId: `sha256:${'b'.repeat(64)}`, name: 'large.wav', bytes: 100 * 1024 * 1024 } }] }] }), send(['FILE:large.wav'])))
  expect(source.read).not.toHaveBeenCalled()
  const next = vi.fn(() => ({ async *[Symbol.asyncIterator]() {} }))
  bridge.hook(options('', 'a', { messages: [{ role: 'user', source: { kind: 'tool-context' }, content: [{ type: 'text', text: '@private.wav' }] }] }), next)
  expect(next).toHaveBeenCalledOnce()
})
