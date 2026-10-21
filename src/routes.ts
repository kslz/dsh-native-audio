import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { API, validSession } from './protocol.ts'
import { AudioError, type AudioStore } from './store.ts'

async function boundedBody(request: Request, limit: number): Promise<Buffer> {
  const declared = Number(request.headers.get('content-length'))
  if (declared > limit) throw new AudioError('音频超出大小限制。', 413)
  const reader = request.body?.getReader()
  if (!reader) throw new AudioError('没有收到音频。')
  let size = 0
  const chunks: Buffer[] = []
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > limit) { await reader.cancel(); throw new AudioError('音频超出大小限制。', 413) }
      chunks.push(Buffer.from(chunk.value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks)
}
export function makeRoutes(store: AudioStore, models: readonly string[]): ConnectionFetchRoute[] {
  const route = (path: string, methods: ('GET' | 'POST')[], handler: (request: Request, url: URL, sessionId: string) => Promise<Response>): ConnectionFetchRoute => ({
    path: `${API}${path}`, methods, requestBody: 'streaming',
    async fetch(request) {
      try {
        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId')
        if (!validSession(sessionId)) throw new AudioError('缺少会话编号。')
        return await handler(request, url, sessionId)
      } catch (error) {
        return Response.json({ error: error instanceof AudioError ? error.message : '音频处理失败，请检查格式或存储权限。' }, { status: error instanceof AudioError ? error.status : 400, headers: { 'cache-control': 'no-store' } })
      }
    },
  })
  return [
    route('/status', ['GET'], async () => Response.json({ maxBytes: store.maxBytes, models })),
    route('/upload', ['POST'], async (request, url, sessionId) => {
      const receipt = await store.put(sessionId, url.searchParams.get('name') ?? 'audio', request.headers.get('content-type') ?? '', await boundedBody(request, store.maxBytes))
      return Response.json(receipt, { headers: { 'cache-control': 'no-store' } })
    }),
    route('/audio', ['GET'], async (_request, url, sessionId) => {
      const audio = await store.get(url.searchParams.get('id') ?? '', sessionId)
      return new Response(new Uint8Array(Buffer.from(audio.data, 'base64')), { headers: { 'content-type': audio.mimeType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
    }),
    route('/delete', ['POST'], async (_request, url, sessionId) => {
      await store.remove(url.searchParams.get('id') ?? '', sessionId)
      return Response.json({ ok: true })
    }),
  ]
}
