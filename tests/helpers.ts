import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
export const model = 'gemini-4-argon-contributor'
export const url = `https://opencode.ai/inference/go/google/v1beta/models/${model}:streamGenerateContent?alt=sse`
export const config = { models: [model], allowedOrigins: ['https://opencode.ai'], maxRequestBytes: 18 * 1024 * 1024 }
export function wav(seconds = 0.1): Buffer {
  const samples = Math.floor(16000 * seconds)
  const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40)
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 16000) * 5000), 44 + i * 2)
  return bytes
}
export function options(text: string, sessionId = 'session-a', overrides: object = {}): GenerateOptions {
  return { provider: 'opencode-go', model, messages: [{ role: 'user', content: [{ type: 'text', text }] }], sessionId, ...overrides } as unknown as GenerateOptions
}
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const value of iterable) result.push(value)
  return result
}
