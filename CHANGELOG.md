# 更新日志

所有项目变更都会记录在此文件中。

---

## [v0.1.9] - 2026-08-22 21:55:00

**更新作者**: ZhangYi
**更新类型**: Bug 修复

### 更新内容
- 兼容 DeepSeek Harness 更新到 `dsh-llm@0.1.1-rc.2` 后的适配器契约：该版本起每个 `LlmAdapter` 都必须暴露 `prepareCall(provider, model, signal)`，用于把「模型元数据解析」与「实际流式分发」绑定到同一代适配器注册，避免准备与分发之间配置变化把一代能力拼到另一代端点上
  - 此前插件以纯对象字面量注册适配器，未继承抽象基类 `LlmAdapter` 提供的默认 `prepareCall`，任何路由到本插件的请求都会在 harness 内部抛出 `registration.adapter.prepareCall is not a function`，导致整轮对话失败
  - 现在在适配器对象上显式声明 `async prepareCall`：先 `await this.resolveModel(...)` 解析出该模型的完整元数据（provider/id/name/inputModalities/context/defaultMaxTokens），再返回 `{ model, stream }`，其中 `stream` 复用本适配器既有的 `stream`（保留会话级上下文覆盖、图片附件、工具调用、流式错误还原等全部既有行为）
  - 返回的 `model` 与旧代码路径 `resolveModel` 产出的形状一致，经 harness 的 `normalizeModelInfo` 校验无额外校验负担

### 影响文件
- `lib/index.js` — 适配器对象新增 `async prepareCall` 方法（`resolveModel` 之后、`stream` 之前）
- `package.json` — 版本递增至 0.1.9

---

## [v0.1.8] - 2026-08-18 22:30:00

**更新作者**: ZhangYi
**更新类型**: Bug 修复

### 更新内容
- 修复工具调用历史回传导致 Ollama 拒绝请求的问题（`ollama: stream ended without a done frame` / `STREAM_CLOSED`）：
  - 根因：Ollama 原生 `/api/chat` 要求历史消息 `tool_calls[].function.arguments` 必须是 JSON **对象**，而插件把上一次响应解析出的参数字符串原样透传，Ollama 返回 HTTP 400 `Value looks like object, but can't find closing '}' symbol`，流在 `done` 帧前被掐断——每次对话的第二个请求必然失败，与模型大小/显存无关
  - `buildMessages` 发送前将字符串形式的 `arguments` `JSON.parse` 为对象
- 修复错误被吞成泛化提示的问题：Ollama 的错误响应体（如 400）不带结尾换行符，按行解析的流式读取会把它留在缓冲区直到 EOF 才丢弃；现在 EOF 时刷新缓冲区残留行并解析其中的 `error` 字段，让真实错误以 `INVALID_REQUEST` 浮出，而非误导性的 `STREAM_CLOSED`
- `scripts/mock-ollama.mjs` 忠实模拟真实 Ollama 的该行为：请求历史中 `arguments` 为字符串时返回完全一致的 400 错误体（同样无结尾换行），并支持 `PORT` 环境变量覆盖监听端口，便于在真实 Ollama 占用 11434 时离线回归

### 影响文件
- `lib/index.js` — `buildMessages` 的 assistant tool_calls 映射改为解析 `arguments` 为对象；`stream()` 流解析在 EOF 时刷新缓冲区残留行
- `scripts/mock-ollama.mjs` — 新增字符串 `arguments` 的 400 校验与 `PORT` 环境变量
- `package.json` — 版本递增至 0.1.8

---

## [v0.1.7] - 2026-08-18 18:59:09

**更新作者**: ZhangYi
**更新类型**: 需求新增

### 更新内容
- 会话级上下文覆盖与右下角上下文指示同步：通过 `ctx.sessions` 把「实际生效的 contextWindow」（覆盖值 → 模型配置 → 默认 32K）折叠进会话日志的 `request/context` 事件（token-meter 的 `contextPressure` 投影按 last-wins 读取该事件），`/ollama-context` 调整后右下角 meter 立即跟随，发请求时再次校正以覆盖 agent-loop 写入的模型级值
  - 仅处理路由到本插件提供方（`llm-ollama` 命名空间）的会话，其他提供方的会话一律跳过，不会被本插件的默认值/覆盖值改写显示
  - 仅在生效值有变化且会话已有 provider/model 路由时追加，避免日志累积重复

### 影响文件
- `lib/index.js` — 新增 `publishContextWindow`（设置变更 watcher + `stream()` 两处触发，把生效 contextWindow 写入会话 `request/context`）
- `README.md` — 会话级上下文覆盖特性说明补充右下角上下文指示同步
- `package.json` — 版本递增至 0.1.7

---

## [v0.1.6] - 2026-08-18 16:48:42

**更新作者**: ZhangYi
**更新类型**: 需求新增

### 更新内容
- 新增图片附件支持：用户消息中的图片块（`ImageBlock`）经 `ctx.attachments.readImage` 解析为字节后，以 base64 编码放入消息的 `images` 数组发送给 Ollama `/api/chat`（JSON 协议下 `images` 字段仅接受 base64 字符串）
  - 工具结果（tool-result）中嵌套的图片同样提取到对应 `tool` 消息的 `images` 字段
  - `listModels` / `resolveModel` 的能力声明由 `['text']` 更新为 `['text', 'image']`，客户端可正常上传图片
  - 附件服务缺失或读取失败时给出明确错误（`UNSUPPORTED_CONTENT` / `ATTACHMENT_READ_FAILED`）
  - 图片需配合支持视觉的多模态模型（如 `llava`、`llama3.2-vision`、`qwen2.5vl` 等）使用，纯文本模型收到图片会由 Ollama 报错
- 移除原先「图片附件不支持」的拦截逻辑

### 影响文件
- `lib/index.js` — `buildMessages` 改为异步并新增 `contentToTextAndImages` 辅助函数；`stream()` 组装请求时 `await` 消息转换；模型能力声明加入 `image`
- `scripts/mock-ollama.mjs` — 流式回复新增 `images=N` 回显，便于断言图片透传
- `README.md` — 功能特性补充图片附件支持，已知限制改为多模态模型说明；开发调试补充 `link:` 软链实时跟随源码的说明
- `package.json` — 版本递增至 0.1.6

---

## [v0.1.5] - 2026-08-18 15:03:36

**更新作者**: ZhangYi
**更新类型**: 需求新增

### 更新内容
- 新增 `/ollama-context` 命令：在输入框输入 `/ollama-context` 即可调出当前会话的上下文窗口（Context window）设置面板
  - 面板提供常用预设（4K / 8K / 16K / 32K / 64K / 128K）、**自定义值**输入（支持 `4096`、`32K`、`1M` 等写法）以及**跟随系统配置**选项
  - 会话级覆盖的优先级高于设置页中每个模型配置的 Context window：设置了覆盖后，当前会话请求 Ollama 时以该值作为 `options.num_ctx`
  - 新会话或选择「跟随系统配置」时恢复为系统配置（模型自身的 Context window 或默认 32K）
  - 覆盖值持久化在 `llm-ollama` 设置命名空间的 `sessions.<sessionId>.contextWindow` 字段中，仅对有覆盖的会话生成记录

### 影响文件
- `lib/index.js` — 设置命名空间 schema/校验新增 `sessions` 字典；适配器 `stream()` 发送 `num_ctx` 时优先取当前会话的覆盖值
- `client.js` — 新增 `/ollama-context` 命令贡献（popupSelect 面板：预设 / 跟随系统配置 / 自定义值）与自定义值输入弹窗（挂载到 `shell.overlay`），写入会话级覆盖
- `README.md` — 功能与使用说明补充 `/ollama-context` 命令；新增「接入 Ollama：本地或远程部署」章节与已知限制更新
- `package.json` — 版本递增至 0.1.5

---

## [v0.1.4] - 2026-08-18 14:44:08

**更新作者**: ZhangYi
**更新类型**: 需求调整

### 更新内容
- 调整模型列表行布局间距：移除 `.dslollama_modelRow` 下边距，改由 `.dslollama_modelAdvanced` 上边距承担，修正高级选项行与上一行的间距

### 影响文件
- `client.js` — 调整 `.dslollama_modelRow` / `.dslollama_modelAdvanced` 样式间距

---

## [v0.1.3] - 2026-08-18 13:58:02

**更新作者**: ZhangYi
**更新类型**: 需求新增

### 更新内容
- 新增 Bundle 层自动挂载机制：`cordis.patch.yml` 补丁文件 + `package.json` 的 `dsh.bundle.patch` 元数据。`dsh plugin --profile web add` 安装成功后，dsh 自动把本包追加到 profile 的 `dsh.profile.bundles`，启动时作为 bundle 层将 `llm-ollama` 插件行挂进组合树，无需再手动编辑 `~/.dsh/profiles/web/cordis.patch.yml`
- 更新 README 安装说明：改为一步安装（`add` + 自动挂载），补充从旧版（≤0.1.2）升级的迁移指南——需先删除手动添加的 `llm-ollama` 行，避免 `duplicate loader entry id: llm-ollama` 启动错误
- 版本号由 0.1.2 递增至 0.1.3，`files` 发布清单加入 `cordis.patch.yml`

### 影响文件
- `cordis.patch.yml` — 新增 bundle 补丁，自动挂载 `llm-ollama` 插件行
- `package.json` — 新增 `dsh.bundle.patch` 元数据，版本递增至 0.1.3，发布清单加入补丁文件
- `README.md` — 更新安装/升级说明，架构章节补充 Bundle 层说明

---
