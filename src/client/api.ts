import { API, type AudioReceipt } from '../protocol.ts'

export function hostFetch(path: string, init?: RequestInit): Promise<Response> {
  const transport = (globalThis as typeof globalThis & { __DSH_TRANSPORT__?: { fetch?: typeof fetch } }).__DSH_TRANSPORT__
  const relative = path.replace(/^\//, '')
  return transport?.fetch ? transport.fetch(relative, init) : fetch(relative, init)
}
export async function readJson<T>(response: Response): Promise<T> {
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : `HTTP ${response.status}`)
  return result as T
}
export async function uploadAudio(file: File, sessionId: string, signal: AbortSignal): Promise<AudioReceipt> {
  const query = new URLSearchParams({ sessionId, name: file.name })
  return readJson(await hostFetch(`${API}/upload?${query}`, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: await file.arrayBuffer(), signal }))
}
