import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationController } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AudioDock, type AudioDockFace } from './AudioDock.tsx'

export const inject = ['slots', 'conversation']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock', id: 'native-audio', order: 95,
    inject: (sessionId): AudioDockFace => ({
      nativeDrafts: {
        create: files => (ctx.conversation as ConversationController).createDrafts(sessionId, files),
        release: drafts => (ctx.conversation as ConversationController).releaseDraftAttachments(drafts),
      },
    }),
  }, AudioDock)), 'native-audio: composer')
}
