import { AsyncLocalStorage } from 'node:async_hooks'
import type { GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { audioMime, markerPattern, validSession } from './protocol.ts'
import type { AudioStore } from './store.ts'
import { audioMentionMatches } from './workspace-audio.ts'
import { audioInstructionText, audioIntent } from './intent.ts'

type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null
export interface AudioData { mimeType: string; data: string; size: number }
interface AudioEntry { token: string; kind: 'file' | 'mention' | 'legacy'; data?: AudioData }
export interface AudioTurn { sessionId: string; model: string; entries: AudioEntry[] }
export interface NativeAudioSource {
  requestText(ref: FileAttachmentRef): string
  read(ref: FileAttachmentRef, signal?: AbortSignal): Promise<AudioData>
  readMention?(path: string, sessionId: string, signal?: AbortSignal): Promise<AudioData>
}
export interface BridgeConfig { models: readonly string[]; allowedOrigins: readonly string[]; maxRequestBytes: number }
type AudioRef = { kind: 'file'; ref: FileAttachmentRef } | { kind: 'mention'; token: string; path: string } | { kind: 'legacy'; token: string; id: string }
function authored(message: RequestMessage): boolean { return message.role === 'user' && (!message.source || message.source.kind === 'user') }
function text(message: RequestMessage): string { return message.content.filter(p => p.type === 'text').map(p => p.text).join('\n') }
function references(message: RequestMessage): AudioRef[] {
  return message.content.flatMap((part): AudioRef[] => {
    if (part.type === 'file') { try { audioMime(part.attachment.name, ''); return [{ kind: 'file', ref: part.attachment }] } catch { return [] } }
    if (part.type !== 'text') return []
    const matches: (AudioRef & { index: number })[] = audioMentionMatches(part.text).map(m => ({ kind: 'mention', ...m }))
    for (const match of audioInstructionText(part.text).matchAll(markerPattern())) matches.push({ kind: 'legacy', token: match[0], id: match[1], index: match.index! })
    return matches.sort((a, b) => a.index - b.index)
  })
}

/** Match occurrences, so the same path can remain a file in one message and be heard in another. */
export function injectGoogleAudio(body: RecordValue, turn: AudioTurn): RecordValue {
  if (!Array.isArray(body.contents)) throw new Error('音频直传需要 Gemini Google generateContent 协议。')
  const queues = new Map<string, AudioEntry[]>()
  for (const entry of turn.entries) { const queue = queues.get(entry.token) ?? []; queue.push(entry); queues.set(entry.token, queue) }
  let injected = 0
  const contents = body.contents.map(content => {
    if (!record(content) || content.role !== 'user' || !Array.isArray(content.parts)) return content
    const parts = content.parts.flatMap(part => {
      if (!record(part) || typeof part.text !== 'string') return [part]
      const value = part.text
      const matches: { index: number; length: number; token: string }[] = []
      for (const match of audioInstructionText(value).matchAll(markerPattern())) {
        if (!queues.has(match[0])) throw new Error('音频引用未获当前会话授权，请重新上传。')
        matches.push({ index: match.index!, length: match[0].length, token: match[0] })
      }
      for (const mention of audioMentionMatches(value)) if (queues.has(mention.token)) matches.push({ index: mention.index, length: mention.token.length, token: mention.token })
      for (const [handle, queue] of queues) if (queue[0]?.kind === 'file') {
        let index = value.indexOf(handle)
        while (index >= 0) { matches.push({ index, length: handle.length, token: handle }); index = value.indexOf(handle, index + handle.length) }
      }
      matches.sort((a, b) => a.index - b.index || b.length - a.length)
      if (!matches.length) return [part]
      const result: RecordValue[] = []; let offset = 0
      for (const match of matches) {
        if (match.index < offset) continue
        const entry = queues.get(match.token)?.shift()
        if (!entry) throw new Error('模型请求中的音频引用数量与用户消息不匹配。')
        if (match.index > offset) result.push({ ...part, text: value.slice(offset, match.index) })
        if (entry.data) { result.push({ inlineData: { mimeType: entry.data.mimeType, data: entry.data.data } }); injected++ }
        else result.push({ ...part, text: value.slice(match.index, match.index + match.length) })
        offset = match.index + match.length
      }
      if (offset < value.length) result.push({ ...part, text: value.slice(offset) })
      return result
    })
    return { ...content, parts }
  })
  if (injected !== turn.entries.filter(e => e.data).length) throw new Error('模型适配器没有保留全部音频引用，已停止本次请求。')
  return { ...body, contents }
}

export function createAudioBridge(store: AudioStore, config: BridgeConfig, native?: NativeAudioSource) {
  const als = new AsyncLocalStorage<AudioTurn>(); let active = true
  const hook = (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> => {
    if (!active || als.getStore() || options.purpose) return next()
    const users = options.messages.filter(authored)
    const messages = users.map(message => ({ message, refs: references(message) })).filter(m => m.refs.length)
    if (!messages.length) return next()
    return { async *[Symbol.asyncIterator]() {
      const latest = users.at(-1)!; const intent = audioIntent(text(latest)); const configured = config.models.includes(options.model)
      if (intent === 'file' || (!configured && intent !== 'native')) { yield* next(); return }
      if (!configured) throw new Error(`本条消息明确要求原生听音，但当前模型未配置此能力。请选择 ${config.models.join('、')}；如需文件处理，可写“仅作为文件，不做多模态识别”。`)
      const followUpNative = !messages.some(m => m.message === latest) && intent === 'native'
      const nativeMessages = new Set(messages.filter(m => followUpNative || audioIntent(text(m.message)) !== 'file').map(m => m.message))
      if (!nativeMessages.size) { yield* next(); return }
      if (!validSession(options.sessionId)) throw new Error('音频直传缺少当前会话编号。')
      const sessionId = options.sessionId
      const cache = new Map<string, AudioData>(); const entries: AudioEntry[] = []; let bytes = 0
      for (const { message, refs } of messages) for (const ref of refs) {
        options.signal?.throwIfAborted()
        if (ref.kind === 'file' && !native) throw new Error('当前 DSH 未提供原生附件读取服务。')
        const token = ref.kind === 'file' ? native!.requestText(ref.ref) : ref.token
        if (!nativeMessages.has(message)) { entries.push({ token, kind: ref.kind }); continue }
        const identity = ref.kind === 'file' ? `file:${ref.ref.attachmentId}:${ref.ref.name}` : ref.kind === 'legacy' ? `legacy:${ref.id}` : `path:${ref.path}`
        let data = cache.get(identity)
        if (!data) {
          if (ref.kind === 'legacy') data = await store.get(ref.id, sessionId)
          else if (ref.kind === 'file') {
            if (!Number.isSafeInteger(ref.ref.bytes) || ref.ref.bytes <= 0 || bytes + ref.ref.bytes > store.maxBytes) throw new Error('当前上下文中的音频总量超出限制，请新建会话或使用更短的音频。')
            data = await native!.read(ref.ref, options.signal)
          } else {
            if (!native?.readMention) throw new Error('当前 DSH 未提供工作区音频读取服务，请上传音频附件。')
            data = await native.readMention(ref.path, sessionId, options.signal)
          }
          if (!Number.isSafeInteger(data.size) || data.size <= 0) throw new Error('音频为空或大小无效。')
          bytes += data.size
          if (bytes > store.maxBytes) throw new Error('当前上下文中的音频总量超出限制，请新建会话或使用更短的音频。')
          cache.set(identity, data)
        }
        entries.push({ token, kind: ref.kind, data })
      }
      const turn: AudioTurn = { entries, model: options.model, sessionId }
      const iterator = als.run(turn, () => next()[Symbol.asyncIterator]()); let done = false
      try { while (true) { const result = await als.run(turn, () => iterator.next()); if (result.done) { done = true; return }; yield result.value } }
      finally { if (!done && iterator.return) await als.run(turn, () => iterator.return!()) }
    } }
  }
  const wrapFetch = (original: typeof fetch): typeof fetch => async (input, init) => {
    const turn = active ? als.getStore() : undefined
    if (!turn) return original(input, init)
    const url = new URL(input instanceof Request ? input.url : String(input))
    const googlePath = /\/models\/([^/]+):(?:streamGenerateContent|generateContent)$/.exec(url.pathname)
    const raw = typeof init?.body === 'string' ? init.body : input instanceof Request && init?.body === undefined ? await input.clone().text() : undefined
    const hasMarker = typeof raw === 'string' && turn.entries.some(e => raw.includes(JSON.stringify(e.token).slice(1, -1)))
    if (!googlePath) { if (hasMarker) throw new Error('此提供商使用的接口不是 Gemini Google 协议，无法原生发送音频。'); return original(input, init) }
    if (!config.allowedOrigins.includes(url.origin)) throw new Error('音频请求地址不在 allowedOrigins 配置中。')
    if (decodeURIComponent(googlePath[1]) !== turn.model) throw new Error('音频请求的模型与当前会话不匹配。')
    if (typeof raw !== 'string') throw new Error('音频直传无法读取模型请求体。')
    let body: unknown
    try { body = JSON.parse(raw) } catch { throw new Error('音频直传需要 JSON 格式的 Gemini 请求。') }
    if (!record(body)) throw new Error('无效的 Gemini 请求。')
    const serialized = JSON.stringify(injectGoogleAudio(body, turn))
    if (Buffer.byteLength(serialized) > config.maxRequestBytes) throw new Error('编码后的音频与上下文超出请求大小限制。')
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.delete('content-length'); headers.set('content-type', 'application/json')
    return original(input, { ...init, headers, body: serialized })
  }
  return { hook, wrapFetch, dispose: () => { active = false } }
}
