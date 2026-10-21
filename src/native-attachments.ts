import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { audioMime } from './protocol.ts'
import { verifyAudio } from './store.ts'
import type { AudioData } from './bridge.ts'

/** Reads only the durable attachment reference already admitted in the user's message. */
export async function readNativeAudio(
  ref: FileAttachmentRef,
  source: AsyncIterable<Uint8Array>,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<AudioData> {
  if (!Number.isSafeInteger(ref.bytes) || ref.bytes <= 0 || ref.bytes > maxBytes) throw new Error('音频为空或超出大小限制。')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of source) {
    signal?.throwIfAborted()
    size += chunk.byteLength
    if (size > maxBytes || size > ref.bytes) throw new Error('音频附件超出大小限制。')
    chunks.push(Buffer.from(chunk))
  }
  if (size !== ref.bytes) throw new Error('音频附件不完整，请重新上传。')
  const bytes = Buffer.concat(chunks)
  const mimeType = audioMime(ref.name, '')
  verifyAudio(bytes, mimeType)
  return { mimeType, size, data: bytes.toString('base64') }
}
