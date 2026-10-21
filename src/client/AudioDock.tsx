import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerAttachment } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { audioMime } from '../protocol.ts'
import { installAudioIntake } from './intake.ts'

export interface AudioDockFace {
  nativeDrafts: {
    create(files: readonly File[]): readonly ComposerAttachment[]
    release(drafts: readonly ComposerAttachment[]): void
  }
}
type Props = PropsRuntime<'conversation.composer.dock'> & InjectFace<AudioDockFace>

/** Native file drafts own progress, removal, send admission, and durable history. */
export function AudioDock(props: Props) {
  const [notice, setNotice] = useState('')
  const dock = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props

  const stage = (files: readonly File[]) => {
    if (!files.length) return
    // DSH controls file upload limits; native-audio limits apply only when actually listening.
    let drafts: readonly ComposerAttachment[] = []
    try {
      const normalized = files.map(file => {
        let mimeType: string
        try { mimeType = audioMime(file.name, file.type) } catch { return file }
        try { audioMime(file.name, ''); return file } catch {}
        // DSH file references retain the name and bytes, so preserve the format in the suffix.
        const suffix: Record<string, string> = { 'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/webm': 'weba' }
        return new File([file], `${file.name || 'audio'}.${suffix[mimeType]}`, { type: file.type, lastModified: file.lastModified })
      })
      drafts = latest.current.nativeDrafts.create(normalized)
      if (!latest.current.inputActions.addAttachments(drafts.map(draft => draft.id))) {
        latest.current.nativeDrafts.release(drafts)
        setNotice('当前暂时无法添加附件，请等待消息提交完成后重试。')
        return
      }
      latest.current.inputActions.persistDraft()
      setNotice('')
    } catch (error) {
      if (drafts.length) latest.current.nativeDrafts.release(drafts)
      setNotice(error instanceof Error ? error.message : '无法添加音频附件。')
    }
  }
  const stageRef = useRef(stage)
  stageRef.current = stage

  useEffect(() => {
    setNotice('')
    const removeIntake = installAudioIntake(
      () => dock.current?.closest<HTMLElement>('[data-conversation-region="composer"]') ?? null,
      files => stageRef.current(files),
      text => {
        const actions = latest.current.inputActions
        if (actions.insertText(text, actions.captureInsertion())) actions.persistDraft()
      },
      setNotice,
    )
    return () => {
      removeIntake()
    }
  }, [props.sessionId])

  return <div ref={dock} role="status" aria-live="polite" style={{ display: notice ? 'block' : 'none', fontSize: 12, color: 'var(--dsw-alias-label-secondary, inherit)' }}>{notice}</div>
}
