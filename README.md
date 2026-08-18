# dsh-llm-ollama

Ollama 原生协议（/api/chat）提供方插件 for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）。

Ollama native protocol (/api/chat) provider plugin for DeepSeek Harness (dsh).

## 功能 / Features

- 在 设置 → **Ollama** 页面管理提供方（整页级扩展点 `settings.section`，不改动 dsh 官方文件）。
  A whole-page "Ollama" settings section — no modification of dsh's own packages.
- 通过 Ollama 原生 `POST /api/chat`（NDJSON 流式）对话，支持工具调用（tool calls）。
  Serves chat through Ollama's native streaming `/api/chat`, including tool calls.
- 「获取可用模型」真实请求 `GET /api/tags`，弹窗选择后加入模型目录。
  "Fetch available models" interrogates `/api/tags` and adopts candidates via a modal.
- 每个模型的**上下文窗口**逐字映射为请求参数 `options.num_ctx`；**最大输出 token** 映射为 `options.num_predict`——填多少，API 就传多少。
  Per-model **Context window** maps exactly to `options.num_ctx`; **Max output tokens** maps to `options.num_predict`.
- 未填上下文窗口的模型默认按 **32K（32768）** 发送 `num_ctx`。
  Models without an explicit context window default to 32K (32768) `num_ctx`.
- 提供方级参数：**保持时间**（`keep_alive`）、**温度**（`options.temperature`）、可选 API 密钥。
  Provider-level **keep alive** (`keep_alive`), **temperature** (`options.temperature`), optional API key.

## 要求 / Requirements

- DeepSeek Harness (dsh) web profile（已测试版本 `0.1.0-rc.6`）
- [Ollama](https://ollama.com) 服务（默认 `http://localhost:11434`）
- `curl`（Linux/macOS 自带；Windows 10+ 自带）

## 安装 / Install

**一步完成**——通过 git 仓库安装到 web profile（等价于 `pnpm add git+<url>` + 自动挂载）：

```bash
dsh plugin --profile web add git+https://github.com/<user>/<repo>.git
```

插件自带 `dsh.bundle.patch`（`cordis.patch.yml`）：安装成功后 dsh 会自动把本包追加到 profile 的 `dsh.profile.bundles`，启动时作为 bundle 层把 `llm-ollama` 插件行挂进组合树——**无需再手动编辑 `~/.dsh/profiles/web/cordis.patch.yml`**。可运行 `dsh --profile web --dump-config` 确认 `llm-ollama` 行已存在。

> **从旧版（≤0.1.2）升级**：如果此前按旧 README 手动在 `~/.dsh/profiles/web/cordis.patch.yml` 里加过 `llm-ollama` 行，请**先删除那一行**再重启。现在该行由 bundle 层提供，两层同时存在会触发 `duplicate loader entry id: llm-ollama` 启动错误。删除后如 `dsh.profile.bundles` 尚未包含本包，重跑一次上面的 `add` 命令即可（或 `dsh plugin --profile web install`）。

重启 dsh：

```bash
# 停止当前 dsh web，然后
dsh web
```

## 使用 / Usage

1. 刷新页面 → 设置 → **Ollama**。
2. 配置提供方：API 地址填 `http://localhost:11434`（或你的服务器地址），可填保持时间 / 温度 / 密钥。
3. 点击「获取可用模型」从服务器拉取模型，弹窗勾选加入。
4. 展开某个模型：填**上下文窗口**（如 `32K`）与**最大输出 token**——它们会原样作为 `num_ctx` / `num_predict` 发送。
5. 保存后，该提供方即出现在会话的模型选择器中（也可在 `settings.yaml` 的 `agent-default-model` 里设为默认模型）。

### settings.yaml 等效配置 / Equivalent `settings.yaml`

```yaml
llm-ollama:
  providers:
    ollama:
      displayName: Ollama (local)
      api: ollama-chat
      baseURL: http://localhost:11434
      keepAlive: 5m
      temperature: 0.7
      models:
        - id: llama3.2:3b
          contextWindow: 32768
          maxTokens: 4096
        - id: qwen2.5:7b
```

## 架构 / Architecture

- **Bundle**（`cordis.patch.yml` + `package.json` 的 `dsh.bundle.patch`）：安装后自动成为 profile 的一个 bundle 层，把 `llm-ollama` 插件行挂进组合树，免去手动补丁。
- **Host**（`lib/index.js`）：注册 `llm-ollama` 设置命名空间（其 schema 即「API 协议」下拉的数据来源）、实现 `LlmAdapter`（`/api/chat` 流式）、`/api/tags` 模型发现、`registerConfigurableProviders` 目录（含始终存在的休眠 `ollama` 条目，使命名空间对 Web 客户端保持暴露）。
- **Client**（`client.js`）：`settings.section` 整页「Ollama」设置页（提供方卡片 / 模型目录 / 获取弹窗），写入 `llm-ollama` 命名空间。

## 开发 / Development

无真实 Ollama 时可用 mock 服务器联调：

```bash
node scripts/mock-ollama.mjs   # 127.0.0.1:11434，/api/tags 与 /api/chat（含工具调用示例）
```

## 说明 / Notes

- 这是一个社区插件（非官方出品），包名保留了 `@deepseek-ai/` 前缀仅为与 dsh 内部包一致的命名习惯。
- 仅支持文本与工具调用；图片附件暂不支持（会给出明确错误）。
- 修改客户端 UI 只发生在插件自身；dsh 官方包不被改动，升级 dsh 无影响。
