import { audioMime } from '../protocol.ts'

export function isAudioFile(file: File): boolean {
  try { audioMime(file.name, file.type); return true } catch { return false }
}

/** Scoped capture avoids Desktop's audio-to-local-path conversion, then uses native drafts. */
export function installAudioIntake(
  composer: () => HTMLElement | null,
  stage: (files: readonly File[]) => void,
  pasteText: (text: string) => void,
  notify: (text: string) => void,
): () => void {
  const owns = (event: Event) => event.target instanceof Node && composer()?.contains(event.target) === true
  const consume = (event: Event, files: readonly File[], directories = false): boolean => {
    if (!files.some(isAudioFile)) return false
    event.preventDefault()
    event.stopImmediatePropagation()
    if (directories) { notify('请将音频文件与文件夹分开添加。'); return true }
    // Mixed image/document/audio batches use the same durable native upload path.
    stage(files)
    return true
  }
  const change = (event: Event) => {
    if (!owns(event) || !(event.target instanceof HTMLInputElement) || event.target.type !== 'file' || event.target.hasAttribute('data-native-audio-picker')) return
    const files = [...event.target.files ?? []]
    if (consume(event, files)) event.target.value = ''
  }
  const transferFiles = (transfer: DataTransfer | null): { files: File[]; directories: boolean } => {
    if (!transfer) return { files: [], directories: false }
    const files = [...transfer.files]
    const directories = [...transfer.items ?? []].some(item => typeof item.webkitGetAsEntry === 'function' && item.webkitGetAsEntry()?.isDirectory)
    return { files, directories }
  }
  const drop = (event: DragEvent) => {
    if (!owns(event)) return
    const batch = transferFiles(event.dataTransfer)
    consume(event, batch.files, batch.directories)
  }
  const paste = (event: ClipboardEvent) => {
    if (!owns(event)) return
    const batch = transferFiles(event.clipboardData)
    if (consume(event, batch.files, batch.directories)) {
      const text = event.clipboardData?.getData('text/plain')
      if (text) pasteText(text)
    }
  }
  const dragover = (event: DragEvent) => {
    if (owns(event) && event.dataTransfer?.types.includes('Files')) event.preventDefault()
  }
  // Window capture precedes the shell's document drop listeners regardless of load order.
  window.addEventListener('change', change, true)
  window.addEventListener('drop', drop, true)
  window.addEventListener('paste', paste, true)
  window.addEventListener('dragover', dragover, true)
  return () => {
    window.removeEventListener('change', change, true)
    window.removeEventListener('drop', drop, true)
    window.removeEventListener('paste', paste, true)
    window.removeEventListener('dragover', dragover, true)
  }
}
