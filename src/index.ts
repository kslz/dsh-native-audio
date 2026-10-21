import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-fs'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { createAudioBridge } from './bridge.ts'
import { DEFAULT_MAX_BYTES } from './protocol.ts'
import { makeRoutes } from './routes.ts'
import { AudioStore } from './store.ts'
import { readNativeAudio } from './native-attachments.ts'
import { readWorkspaceAudio } from './workspace-audio.ts'
import type { NativeAudioSource } from './bridge.ts'

export const name = 'native-audio'
export const inject = ['connection', 'llm', 'attachments']
export interface Config {
  models: string[]
  allowedOrigins: string[]
  maxAudioBytes: number
  maxRequestBytes: number
  maxStoredBytes: number
}
export const Config = z.object({
  models: z.array(z.string()).default(['gemini-4-argon-contributor']),
  allowedOrigins: z.array(z.string()).default(['https://opencode.ai', 'https://generativelanguage.googleapis.com']),
  maxAudioBytes: z.number().default(DEFAULT_MAX_BYTES),
  maxRequestBytes: z.number().default(18 * 1024 * 1024),
  maxStoredBytes: z.number().default(512 * 1024 * 1024),
})

/** Reuses the existing DSH adapter, credentials, tools, and streaming text response. */
export function apply(ctx: Context, config: Config = Config({})): void {
  for (const value of [config.maxAudioBytes, config.maxRequestBytes, config.maxStoredBytes]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('音频大小配置必须是正整数。')
  }
  for (const origin of config.allowedOrigins) {
    if (new URL(origin).origin !== origin) throw new Error('allowedOrigins 必须是完整 origin，例如 https://opencode.ai。')
  }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const store = new AudioStore(join(home, 'storages', 'dsh-native-audio'), config.maxAudioBytes, config.maxStoredBytes)
  let readMention: NativeAudioSource['readMention']
  ctx.inject(['fs', 'sessions'], scope => {
    const sessions = scope.get('sessions') as SessionStore
    const reader: NonNullable<NativeAudioSource['readMention']> = (path, sessionId, signal) =>
      readWorkspaceAudio(scope.fs, sessions.get(sessionId as SessionId)?.header.cwd, path, config.maxAudioBytes, signal)
    readMention = reader
    scope.effect(() => () => { if (readMention === reader) readMention = undefined }, 'native-audio: workspace reader')
  })
  const bridge = createAudioBridge(store, config, {
    requestText: ref => ctx.llm.fileRequestText(ref),
    read: (ref, signal) => readNativeAudio(ref, ctx.attachments.readFileStream(ref, signal), config.maxAudioBytes, signal),
    readMention: (path, sessionId, signal) => {
      if (!readMention) throw new Error('工作区音频服务尚未就绪，请稍后重试或上传音频附件。')
      return readMention(path, sessionId, signal)
    },
  })
  ctx.effect(() => {
    const original = globalThis.fetch
    const patched = bridge.wrapFetch(original)
    globalThis.fetch = patched
    return () => {
      bridge.dispose()
      if (globalThis.fetch === patched) globalThis.fetch = original
    }
  }, 'native-audio: model transport')
  ctx.on('llm/stream', bridge.hook, { prepend: true })
  for (const route of makeRoutes(store, config.models)) {
    ctx.effect(() => ctx.connection.fetch.register(route), 'native-audio: attachment route')
  }
}
