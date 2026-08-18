# 更新日志

所有项目变更都会记录在此文件中。

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
