export const API = '/api/dsh-native-audio'
export const DEFAULT_MAX_BYTES = 12 * 1024 * 1024
export const marker = (id: string): string => `[dsh-audio:${id}]`
export const markerPattern = (): RegExp => /\[dsh-audio:([a-f0-9]{32})\]/g
export interface AudioReceipt {
  id: string
  sessionId: string
  name: string
  mimeType: string
  size: number
}
export function validSession(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value)
}

const types: Record<string, string> = {
  wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg',
  flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', weba: 'audio/webm',
}
export const ACCEPT_AUDIO = 'audio/wav,audio/mpeg,audio/ogg,audio/flac,audio/aac,audio/mp4,audio/webm,.wav,.mp3,.ogg,.flac,.aac,.m4a,.webm'
export function audioMime(name: string, declared: string): string {
  const alias: Record<string, string> = { 'audio/x-wav': 'audio/wav', 'audio/mp3': 'audio/mpeg', 'audio/x-flac': 'audio/flac', 'audio/x-m4a': 'audio/mp4' }
  const base = declared.split(';')[0].trim().toLowerCase()
  const normalized = alias[base] ?? base
  if (Object.values(types).includes(normalized)) return normalized
  if (base === '' || base === 'application/octet-stream') {
    const fromName = types[name.split('.').pop()?.toLowerCase() ?? '']
    if (fromName) return fromName
  }
  throw new Error('不支持的音频格式，请使用 WAV、MP3、OGG、FLAC、AAC、M4A 或 WebM。')
}
