import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { audioMime, validSession, type AudioReceipt } from './protocol.ts'

export interface StoredAudio extends AudioReceipt { data: string }
export class AudioError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

/** Lightweight signature check; does not decode or transcribe audio. */
export function verifyAudio(bytes: Buffer, type: string): void {
  const text = (start: number, end: number) => bytes.toString('ascii', start, end)
  const ok = type === 'audio/wav' ? bytes.length >= 44 && text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE'
    : type === 'audio/ogg' ? text(0, 4) === 'OggS'
    : type === 'audio/flac' ? text(0, 4) === 'fLaC'
    : type === 'audio/mp4' ? text(4, 8) === 'ftyp'
    : type === 'audio/webm' ? bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    : type === 'audio/mpeg' ? text(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)
    : type === 'audio/aac' ? bytes[0] === 255 && (bytes[1] & 0xf6) === 0xf0
    : false
  if (!ok) throw new AudioError('文件内容与音频格式不符，无法发送。')
}

export class AudioStore {
  private writes: Promise<unknown> = Promise.resolve()
  constructor(readonly directory: string, readonly maxBytes: number, readonly maxStoredBytes = 512 * 1024 * 1024) {}
  private path(id: string): string {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new AudioError('无效的音频编号。')
    return join(this.directory, `${id}.json`)
  }
  async put(sessionId: string, name: string, declared: string, bytes: Buffer): Promise<AudioReceipt> {
    if (!validSession(sessionId)) throw new AudioError('请选择一个会话后再上传音频。')
    if (!bytes.length || bytes.length > this.maxBytes) throw new AudioError('音频为空或超出大小限制。', 413)
    let mimeType: string
    try { mimeType = audioMime(name, declared) }
    catch { throw new AudioError('不支持的音频格式，请使用 WAV、MP3、OGG、FLAC、AAC、M4A 或 WebM。') }
    verifyAudio(bytes, mimeType)
    const receipt: AudioReceipt = { id: randomBytes(16).toString('hex'), sessionId, name: name.split(/[\\/]/).pop()?.slice(0, 200) || 'audio', mimeType, size: bytes.length }
    const serialized = JSON.stringify({ ...receipt, data: bytes.toString('base64') })
    const write = async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      const files = (await readdir(this.directory)).filter(file => /^[a-f0-9]{32}\.json$/.test(file))
      let used = 0
      for (const file of files) used += (await stat(join(this.directory, file))).size
      if (used + Buffer.byteLength(serialized) > this.maxStoredBytes) throw new AudioError('音频存储空间已满，请清理不再使用的音频。', 507)
      const target = this.path(receipt.id)
      const temporary = `${target}.tmp`
      try {
        await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 })
        await rename(temporary, target)
      } finally { await rm(temporary, { force: true }) }
    }
    const pending = this.writes.then(write)
    this.writes = pending.catch(() => {})
    await pending
    return receipt
  }
  async get(id: string, sessionId: string): Promise<StoredAudio> {
    const file = this.path(id)
    let audio: StoredAudio
    try { audio = JSON.parse(await readFile(file, 'utf8')) as StoredAudio }
    catch { throw new AudioError('音频不存在或已被删除，请重新上传。', 404) }
    if (audio.id !== id || audio.sessionId !== sessionId) throw new AudioError('该音频不属于当前会话。', 403)
    if (typeof audio.data !== 'string' || Buffer.byteLength(audio.data, 'base64') !== audio.size || audio.size > this.maxBytes) throw new AudioError('音频存储损坏，请重新上传。')
    return audio
  }
  async remove(id: string, sessionId: string): Promise<void> {
    await this.get(id, sessionId)
    await rm(this.path(id), { force: true })
  }
}
