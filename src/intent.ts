export type AudioIntent = 'auto' | 'file' | 'native'

/** Preserve offsets, including quoted @paths; instructions inside quotes/code are inert. */
export function audioInstructionText(text: string): string {
  const blank = (match: string) => match.replace(/[^\r\n]/g, ' ')
  return text.replace(/```[^]*?(?:```|$)|~~~[^]*?(?:~~~|$)/g, blank)
    .replace(/@"[^"\r\n]+"|@'[^'\r\n]+'|`[^`\n]*`|^[ \t]*>[^\n]*|“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/gm, match => match.startsWith('@') ? match : blank(match))
}

export function audioIntent(text: string): AudioIntent {
  const clean = audioInstructionText(text).replace(/@(?:"[^"\n]+"|'[^'\n]+'|[^\s，。！？；,!?;]+)/g, m => ' '.repeat(m.length))
  if (/(?:仅|只)(?:把[^，。；\n]{0,24})?(?:作为|当作|按)(?:普通)?文件|(?:不要|不用|无需|不需要|不想|不做|不进行|关闭|跳过)(?:让模型)?(?:进行|启用|使用|用|做)?\s*(?:原生)?(?:音频)?(?:多模态(?:识别|理解|分析)?|直传|听音|直接听|原生识别|音频理解)/i.test(clean)) return 'file'
  if (/(?:直接|原生)(?:听|聆听)|(?:用|使用|进行|启用|做)\s*(?:原生(?:音频)?(?:理解|识别|分析)|(?:音频)?多模态(?:理解|识别|分析))|(?:用|使用)(?:你(?:的)?|模型的)?(?:原生|多模态)(?:音频)?能力[^，。；\n]{0,12}(?:听|识别|理解|分析)|(?:原生|多模态)(?:音频)?(?:理解|识别|分析)(?:这个|这段|一下|音频)/i.test(clean)) return 'native'
  if (/\b(?:ffmpeg|ffprobe|sox|mediainfo)\b|(?:转码|转封装|压缩|剪辑|裁剪|合并|拼接|降噪|重采样)(?=\s*(?:一下|这个|这段|这些|一个|音频|录音|文件|它|为|成|到|[，。；,;！!]|$))|剪掉|截取|(?:提取|分离)(?:音轨|音频|人声|伴奏)|(?:调整|修改|改变|设置)(?:音量|采样率|声道|比特率|码率)|(?:转换|转成|转为|改成)[^，。；\n]{0,28}(?:mp3|wav|flac|aac|m4a|ogg|\d+\s*(?:khz|hz|kbps)|格式|采样率|声道)|(?:查看|查询|检查|读取|获取|显示|看一下|看下|看看|看)[^，。；\n]{0,20}(?:文件信息|文件属性|音频信息|元数据|媒体信息|编码|码率|比特率|采样率|声道|时长|大小|格式)|(?:处理|操作)(?:一下)?(?:这个|这段)?(?:音频)?文件|(?:音频|文件)(?:的)?(?:元数据|文件信息|文件属性)|(?:生成|绘制|画出)(?:波形|频谱)/i.test(clean)) return 'file'
  return 'auto'
}
