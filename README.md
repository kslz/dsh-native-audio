# DSH Native Audio

为 **DeepSeek Harness 0.2.1-rc.2** 增加原生音频附件。**0.2.0 起像添加图片一样使用原附件按钮、拖拽或粘贴音频**，自动显示在附件栏，不需要再点击「插入到消息」。需要原生听音时，原始音频以 Gemini `inlineData` 发送给模型；普通文件任务交给 DSH 的文件/命令工具处理。

**0.2.1 还支持 `@bgm.mp3` 这类工作区音频引用**：读取当前会话工作目录中的原始文件字节，并直接附入模型请求，避免模型只得到路径后转而调用分析工具。带空格的路径可写为 `@"music/my song.mp3"`。

**0.2.2 移除了额外的音频、录音按钮及常驻提示**。音频继续通过 DSH 原附件入口添加，界面仅在添加失败时显示错误。

**0.2.3 修正与原生视频插件的格式冲突**：不再仅凭 `.mp4`、`.webm` 后缀把文件识别成音频。音频专用文件使用 `.m4a`、`.weba`；浏览器明确标记的 audio/mp4 或 audio/webm 文件上传时自动使用音频专用后缀。工作区引用音频专用 WebM 时请使用 `.weba` 后缀，既有旧标记上传仍按保存的 MIME 读取。

**0.2.4 修复普通音频文件操作被直传逻辑拦截的问题**：其他模型默认接收文件引用，不读取音频字节、不应用原生听音大小限制。配置了听音能力的模型，遇到查看文件信息、转码、剪辑、调整采样率等明确文件任务也会放行。只有本条消息明确要求“直接听”“原生听音”或多模态理解时，才检查模型是否配置了听音能力。历史听音指令不会阻止当前文件任务或模型切换。

已通过 OpenCode Go 上 **`gemini-4-argon-contributor`** 的真实测试：发送 WAV 语音，模型准确识别其中的短语；保留音频的第二轮追问也通过，两个请求均返回 HTTP 200。

## 安装

前提：DSH 中已经能够通过 **Gemini Google 协议**调用 `gemini-4-argon-contributor`。本插件复用现有路由及其密钥，不安装或修改提供商桥接；仅有 OpenAI 兼容路由时不能用于原生听音。

1. 从 [GitHub Release](https://github.com/kslz/dsh-native-audio/releases/tag/v0.2.4) 下载 **`dsh-native-audio-0.2.4.tgz`**，在 DSH 的「插件」页面添加该本地 bundle。
2. 确认插件列表中出现 **native-audio / dsh-native-audio**。
3. 完全退出并重新打开 DSH，使宿主和聊天界面同时加载插件。
4. 在一个会话中选择 `gemini-4-argon-contributor`，通过原附件入口直接添加音频。

Windows 用户也可以从同一 Release 下载 `install-native-audio.ps1`，与 `.tgz` 放在同一目录，在该目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-native-audio.ps1 -Profile desktop
```

脚本使用 DSH 内置 Node/pnpm，先备份 profile 配置，再安装包并注册 bundle。支持 `DSH_HOME` 和 `-Profile`。请保留下载的包，以便后续依赖重装。

如果通过命令行安装，`dsh plugin --profile desktop add "file:包文件的完整路径"` 只负责安装依赖；还需要在该 profile 的 `package.json` → `dsh.profile.bundles` 中加入 `dsh-native-audio` 才会加载 bundle。推荐使用插件页面，避免遗漏这一步。

此插件包名为 **dsh-native-audio**，宿主 id 为 **native-audio**。它与已有的 **dsh-audio-native / audio-native** 是不同插件；已有插件无需卸载。不要把它们的配置混用。

从 0.1.0 升级时，安装新版包并完全退出、重启 DSH 即可；已注册的 bundle 无需重复添加，旧消息里的音频引用继续兼容。

若出现 `pi-ai image input requires the durable attachment service`，请检查现有 Gemini 提供商桥接是否正确注入 DSH 附件服务；该桥接需要单独修复并重启宿主。

## 使用

- **上传文件**：使用原来的附件按钮选取音频，或将音频拖到输入区域，或从剪贴板粘贴音频文件。音频自动加入原生附件栏；填写问题后使用原发送按钮即可。
- **工作区文件**：直接引用 `@bgm.mp3`，或通过文件引用选择器选中音频。插件按该会话的工作目录解析，通过 DSH 的文件系统服务进行有大小限制的二进制读取。只处理用户消息中的音频引用，不自动读取模型回复或工具输出中的路径。
- **上传状态**：由 DSH 原生附件流程显示上传进度、失败重试，并在上传完成前阻止发送。
- **追问**：同一会话中直接追问即可。音频保存在本地，原消息引用仍在上下文中时，插件会再次发送原音频；重启 DSH 后也可恢复。
- **移除附件**：与图片一样，点击附件卡片的移除按钮。

例如：“请听这段录音，区分说话人，描述背景声音，并总结对话内容。”

普通文件任务示例（无需关闭插件，也无需选择 Gemini）：

```text
@bgm.mp3 查看采样率、码率和时长。
@bgm.mp3 帮我转成48kHz的WAV。
@bgm.mp3 仅作为文件，不做多模态识别。
```

文件任务识别使用有限的明确表达，不调用模型猜测意图。表达有歧义时，可以使用“仅作为文件，不做多模态识别”明确跳过本次直传。文件任务的历史引用保持为文件，普通追问不会自动读取它；要直接听取历史文件，可以追问“这次请直接听一下”。引号、代码块、Markdown 引用中的路径和指令不会自动触发读文件或更改处理方式。

原生听音默认单个音频及一个上下文中不同音频的总大小上限均为 **12 MiB**；编码后的完整模型请求上限为 **18 MiB**。普通文件任务不应用这些限制，附件上传仍遵守 DSH 自身的文件限制。支持 WAV、MP3、OGG、FLAC、AAC、M4A 和音频专用 WebM（.weba）；最终是否接受某个编码由上游模型决定。录音可先通过系统工具保存成音频文件再添加。

## 配置

默认即支持当前目标模型，不需要填写新的 API key。以下是可选的 profile 配置覆盖：

```yaml
- id: native-audio
  config:
    models:
      - gemini-4-argon-contributor
    allowedOrigins:
      - https://opencode.ai
      - https://generativelanguage.googleapis.com
    maxAudioBytes: 12582912
    maxRequestBytes: 18874368
    maxStoredBytes: 536870912
```

接入其他支持音频的 Gemini 模型时，将模型 id 加入 `models`。自建 Google 协议网关的 origin 必须加入 `allowedOrigins`，例如 `https://gateway.example.com`；不包含 API 路径、查询参数或密钥。更改宿主配置后重启。

## 实现与边界

DSH 的原生内容块尚未支持 audio，普通文件附件会被转换成路径文字。插件复用 Conversation 的文件草稿、上传、发送和附件卡片流程，将音频存成 DSH 原生文件附件；在 Gemini 请求发送前，通过宿主附件服务读取已授权引用并展开为真实音频片段。界面和新消息中不再插入音频标记文字。它不修改 DSH 核心，也不改写会话日志；原有模型流式文字输出、工具参数与 Gemini thought signature 保持原样。

为避免桌面端把音频转换成单纯的本地路径，插件在当前输入区域接管包含音频的选择、拖拽、粘贴批次，并交给同一原生附件上传流程。只包含图片或普通文件的批次仍由 DSH 原有入口处理；图片和音频混合添加时只上传一次。文件夹与音频请分开添加。

- 这是**上传文件 / 录音结束后的原生音频理解**；不提供麦克风边说边传或实时双向语音，也不生成语音回复。
- 当前接入 **Google `generateContent` / `streamGenerateContent` 协议**。使用 OpenAI 兼容 `chat/completions` 的同名模型时会提示不支持，需使用已有的 Gemini Google 路由。
- 新音频的持久化、派生会话和附件访问由 DSH 的原生引用管理；只复制消息文字或缺少附件文件的导出不能带走声音。0.1.0 的旧标记引用仍只允许在原会话使用。
- 同一会话每次携带音频都会产生相应模型输入费用。上下文压缩可能删去旧引用；需要再次听原音频时可重新上传。
- 切换到未列入 `models` 的模型后，默认保留普通文件引用供工具使用；仅本条消息明确要求原生听音时提示模型能力未配置。
- 0.1.0 的旧标记没有普通工具可用的文件路径；原生听音仍兼容。若要对这种旧音频做文件操作，请重新作为原生文件附件上传，或引用实际工作区文件。
- 界面与错误提示目前为中文。

0.2.0 新附件直接存放在 DSH 自身的附件库中。旧版音频仍存放于 `$DSH_HOME/storages/dsh-native-audio/`，未设置 `DSH_HOME` 时为 `~/.dsh/storages/dsh-native-audio/`；`maxStoredBytes` 仅限制这个旧库，不限制 DSH 原生附件库。卸载插件不会删除声音文件。

原生上传和附件访问沿用 DSH 的授权流程；兼容旧版的上传、预览与删除接口仍通过 DSH Connection 的 owner 认证。模型发送前再次限制音频大小并校验常见音频文件签名。模型请求仅发送到 `allowedOrigins` 中的 Gemini 接口。

## 开发验证

需要 Node.js 24（最低 22.22.1）及 pnpm 11.25.0。

```powershell
git clone https://github.com/kslz/dsh-native-audio.git
cd dsh-native-audio
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run test
pnpm run build
npm pack --ignore-scripts
```

测试覆盖真实 Cordis / Connection 加载与卸载、真实 LlmRuntime 文件投影与音频展开、owner 权限、旧音频跨重启恢复、会话隔离、存储配额、原始字节直传、并发请求、工具签名保留、请求取消、原附件选择、混合拖拽、粘贴，以及事件监听清理。

测试使用合成媒体和模拟网络，不需要模型密钥，也不会调用付费模型。与[原生视频插件](https://github.com/kslz/dsh-native-video)的联合测试在视频仓库运行。

## 许可证

[MIT](LICENSE)。这是社区插件，与 DeepSeek、Google、OpenCode 无官方隶属关系。
