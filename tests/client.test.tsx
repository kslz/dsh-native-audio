// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AudioDock } from '../src/client/AudioDock.tsx'

vi.mock('../src/client/api.ts', () => ({
  hostFetch: vi.fn(async () => ({ ok: true, json: async () => ({ maxBytes: 12 * 1024 * 1024 }) })),
  readJson: async (response: Response) => response.json(),
}))
let root: Root
let box: HTMLDivElement
const file = () => new File(['audio bytes'], 'voice.wav', { type: 'audio/wav' })
let actions: { captureInsertion: ReturnType<typeof vi.fn>; insertText: ReturnType<typeof vi.fn>; persistDraft: ReturnType<typeof vi.fn>; addAttachments: ReturnType<typeof vi.fn> }
let drafts: { create: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }
function props(sessionId = 'a') { return { sessionId, inputActions: actions, nativeDrafts: drafts } as unknown as Parameters<typeof AudioDock>[0] }
async function render(session = 'a') { await act(async () => root.render(<AudioDock {...props(session)} />)) }
async function select(input?: HTMLInputElement, files = [file()]) {
  if (!input) { input = document.createElement('input'); input.type = 'file'; box.append(input) }
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true })) })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  box = document.createElement('div'); box.dataset.conversationRegion = 'composer'; document.body.append(box); root = createRoot(box)
  actions = { captureInsertion: vi.fn(() => ({ start: 4, end: 4, draftRev: 8 })), insertText: vi.fn(() => true), persistDraft: vi.fn(), addAttachments: vi.fn(() => true) }
  drafts = { create: vi.fn((files: File[]) => files.map((file, index) => ({ kind: 'file', id: `draft-${index}`, file }))), release: vi.fn(), remove: vi.fn() }
})
afterEach(async () => { await act(async () => root.unmount()); box.remove(); vi.clearAllMocks(); vi.unstubAllGlobals() })
it('adds native attachment chips immediately after selecting a file without inserting marker text', async () => {
  await render()
  expect(box.querySelector('button')).toBeNull()
  expect(box.textContent).toBe('')
  await select()
  expect(drafts.create).toHaveBeenCalledWith([expect.objectContaining({ name: 'voice.wav' })])
  expect(actions.addAttachments).toHaveBeenCalledWith(['draft-0'])
  expect(actions.insertText).not.toHaveBeenCalled()
  expect(actions.persistDraft).toHaveBeenCalledTimes(1)
  expect(box.textContent).not.toContain('插入到消息')
  expect(box.textContent).toBe('')
})
it('lets DSH admit a large ordinary audio file without applying native listening limits in the picker', async () => {
  await render()
  const large = file(); Object.defineProperty(large, 'size', { value: 100 * 1024 * 1024 })
  await select(undefined, [large])
  expect(drafts.create).toHaveBeenCalledOnce()
  expect(actions.addAttachments).toHaveBeenCalledWith(['draft-0'])
  expect(box.textContent).toBe('')
})
it('intercepts the normal attachment picker before Desktop turns audio into a path mention', async () => {
  await render()
  const normal = document.createElement('input'); normal.type = 'file'; box.append(normal)
  const original = vi.fn(); normal.addEventListener('change', original)
  await select(normal)
  expect(drafts.create).toHaveBeenCalledTimes(1)
  expect(original).not.toHaveBeenCalled()
  expect(actions.addAttachments).toHaveBeenCalledWith(['draft-0'])
})
it('preserves standard handling for image-only files and file inputs outside the composer', async () => {
  await render()
  const image = document.createElement('input'); image.type = 'file'; box.append(image)
  const nativeImage = vi.fn(); image.addEventListener('change', nativeImage)
  await select(image, [new File(['image'], 'one.png', { type: 'image/png' })])
  const outside = document.createElement('input'); outside.type = 'file'; document.body.append(outside)
  const nativeOutside = vi.fn(); outside.addEventListener('change', nativeOutside)
  try { await select(outside) } finally { outside.remove() }
  expect(nativeImage).toHaveBeenCalledOnce()
  expect(nativeOutside).toHaveBeenCalledOnce()
  expect(drafts.create).not.toHaveBeenCalled()
})
it('handles mixed image/audio drops once through native uploads', async () => {
  const documentCapture = vi.fn()
  document.addEventListener('drop', documentCapture, true)
  await render()
  const files = [file(), new File(['image'], 'one.png', { type: 'image/png' })]
  const drop = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(drop, 'dataTransfer', { value: { files, items: [] } })
  const standardDrop = vi.fn(); box.addEventListener('drop', standardDrop)
  await act(async () => { box.dispatchEvent(drop) })
  expect(drafts.create).toHaveBeenCalledWith(files)
  expect(actions.addAttachments).toHaveBeenCalledWith(['draft-0', 'draft-1'])
  expect(standardDrop).not.toHaveBeenCalled()
  expect(drop.defaultPrevented).toBe(true)
  expect(documentCapture).not.toHaveBeenCalled()
  document.removeEventListener('drop', documentCapture, true)
})
it('pastes audio while retaining accompanying clipboard text', async () => {
  await render()
  const paste = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(paste, 'clipboardData', { value: { files: [file()], items: [], getData: () => 'Please listen to this' } })
  await act(async () => { box.dispatchEvent(paste) })
  expect(actions.addAttachments).toHaveBeenCalledWith(['draft-0'])
  expect(actions.insertText).toHaveBeenCalledWith('Please listen to this', expect.any(Object))
})
it('releases rejected native drafts instead of leaving uploads running', async () => {
  actions.addAttachments.mockReturnValue(false)
  await render(); await select()
  expect(drafts.release).toHaveBeenCalledWith([expect.objectContaining({ id: 'draft-0' })])
  expect(box.textContent).toContain('暂时无法添加附件')
  expect(actions.persistDraft).not.toHaveBeenCalled()
})
it('stages into the newly selected session and detaches capture listeners on unmount', async () => {
  await render(); await render('b'); await select()
  expect(drafts.create).toHaveBeenCalledOnce()
  await act(async () => root.unmount())
  root = createRoot(box)
  const normal = document.createElement('input'); normal.type = 'file'; box.append(normal)
  await select(normal)
  expect(drafts.create).toHaveBeenCalledOnce()
})
