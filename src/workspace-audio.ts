import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { audioMime } from './protocol.ts'
import type { AudioData } from './bridge.ts'
import { verifyAudio } from './store.ts'
import { audioInstructionText } from './intent.ts'

export interface AudioMention { token: string; path: string }

/** Only explicit user @file references; email addresses and remote URLs are excluded. */
export function audioMentions(text: string): AudioMention[] {
  return audioMentionMatches(text).map(({ token, path }) => ({ token, path }))
}

export function audioMentionMatches(text: string): (AudioMention & { index: number })[] {
  const result: (AudioMention & { index: number })[] = []
  const expression = /(?<![^\s(（])@(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s<>"'\[\]()，。！？；,!?;@]+))/g
  for (const match of audioInstructionText(text).matchAll(expression)) {
    const path = match[1] ?? match[2] ?? match[3]
    if (!path || /^[a-z][a-z0-9+.-]*:\/\//i.test(path)) continue
    try { audioMime(path, '') } catch { continue }
    result.push({ token: match[0], path, index: match.index! })
  }
  return result
}

/** Resolve and bound binary reads through the session's execution filesystem. */
export async function readWorkspaceAudio(
  fs: Pick<FileSystem, 'resolve' | 'stat' | 'readBytes'>,
  cwd: string | undefined,
  path: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<AudioData> {
  if (!cwd) throw new Error('无法确定当前会话的工作目录，请重新选择工作区或上传音频附件。')
  const mimeType = audioMime(path, '')
  const target = await fs.resolve(path, { cwd, signal })
  const info = await fs.stat(target, signal)
  if (!info || info.type !== 'file') throw new Error('找不到所引用的音频文件，请检查路径或重新上传。')
  if (info.size !== undefined && (info.size <= 0 || info.size > maxBytes)) throw new Error('引用的音频为空或超出音频大小限制。')
  const bytes = Buffer.from(await fs.readBytes(target, signal, maxBytes))
  if (!bytes.length || bytes.length > maxBytes) throw new Error('引用的音频为空或超出音频大小限制。')
  verifyAudio(bytes, mimeType)
  return { mimeType, size: bytes.length, data: bytes.toString('base64') }
}
