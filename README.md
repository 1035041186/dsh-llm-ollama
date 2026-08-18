# dsh-llm-ollama

DeepSeek Harness（dsh）的 Ollama 提供方插件：通过 Ollama 原生 `/api/chat` 协议接入本地或远程部署的 Ollama 服务，提供整页「Ollama」设置界面与一键模型发现。

## 功能特性

- **整页设置界面**：设置 → **Ollama** 管理提供方（通过 `settings.section` 扩展点实现）。
- **原生协议对话**：走 Ollama 原生 `POST /api/chat`（NDJSON 流式），支持工具调用（tool calls）。
- **模型发现**：真实请求 `GET /api/tags` 拉取服务器上的模型，弹窗勾选加入模型目录；也可手动添加。
- **参数直通 Ollama**：
  - 模型级：**上下文窗口** → `options.num_ctx`，**最大输出 token** → `options.num_predict`（填多少传多少；未填上下文窗口时默认发送 32K / 32768）。
  - 提供方级：**保持时间** → `keep_alive`（如 `5m`，`-1` 表示常驻），**温度** → `options.temperature`（范围 0–2），可选 API 密钥。
- **会话级上下文覆盖**：输入 `/ollama-context` 调出当前会话的上下文设置面板（预设 4K/8K/16K/32K/64K/128K、自定义值、跟随系统配置），覆盖值优先于模型配置作为 `num_ctx`；只作用于当前会话，新会话自动回到系统配置。

## 接入 Ollama：本地或远程部署

[Ollama](https://ollama.com) 是本地/自托管的大模型运行平台。本插件通过其**原生协议**（`/api/chat`）接入，无论 Ollama 部署在哪里，配置方式完全一致——只需在设置页把提供方的 API 地址填成对应地址。

**本地部署**

- `ollama pull llama3.2:3b` 拉取模型，`ollama serve` 启动服务，默认监听 `http://localhost:11434`。

**远程部署**

- 把 Ollama 部署到另一台机器或 Docker 容器，确保 `11434` 端口对 dsh 可达；
- API 地址填 `http://<主机IP或域名>:11434` 即可，本地与远程用法相同；
- Ollama 自身不带鉴权，公网暴露时建议在前面加反向代理（nginx / caddy）做 TLS 与访问控制。

**为什么走原生协议（而非 OpenAI 兼容端点）**

- **参数直通**：上下文窗口 / 最大输出 / 保持时间 / 温度以原生 `options` 字段精确生效；OpenAI 兼容端点只暴露 OpenAI 参数子集，`num_ctx`、`keep_alive` 等 Ollama 专有参数无法直接控制。
- **模型发现**：`GET /api/tags` 直接列出服务器上已拉取的模型，设置页一键导入。
- **无中间转换层**：NDJSON 流式与工具调用都走 Ollama 原生实现，不受兼容层参数映射差异的影响。

## 环境要求

- DeepSeek Harness web profile（已测试版本 `0.1.0-rc.6`）
- [Ollama](https://ollama.com) 服务（本地默认 `http://localhost:11434`，远程填对应地址）
- `curl`（Linux/macOS 自带；Windows 10+ 自带）

## 安装

通过 git 仓库安装到 web profile。插件自带的 bundle 补丁（`cordis.patch.yml` + `package.json` 的 `dsh.bundle.patch`）会在安装成功后自动把 `llm-ollama` 插件行挂进组合树，无需手动编辑 `~/.dsh/profiles/web/cordis.patch.yml`：

```bash
dsh plugin --profile web add git+https://github.com/1035041186/dsh-llm-ollama.git
dsh --profile web --dump-config   # 可选：确认 llm-ollama 行已存在
dsh web                           # 重启生效
```

> **从旧版（≤0.1.2）升级**：若此前按旧说明手动在 `cordis.patch.yml` 中添加过 `llm-ollama` 行，请先删除该行再重启，否则会触发 `duplicate loader entry id: llm-ollama` 启动错误。删除后若 `dsh.profile.bundles` 尚未包含本包，重跑一次 `add` 命令即可。

## 使用

1. 刷新页面 → 设置 → **Ollama**。
2. 配置提供方：API 地址填 `http://localhost:11434`（或你的服务器地址），可选保持时间 / 温度 / 密钥。
3. 点击「获取可用模型」从服务器拉取模型，弹窗勾选加入；也可手动添加。
4. 展开某个模型，填**上下文窗口**（如 `32K`）与**最大输出 token**——它们会原样作为 `num_ctx` / `num_predict` 发送。
5. 保存后该提供方即出现在会话的模型选择器中；也可在 `settings.yaml` 的 `agent-default-model` 中设为默认模型。

### 按会话调整上下文

在会话输入框输入 `/ollama-context` 调出上下文设置面板：

- **预设**：4K / 8K / 16K / 32K / 64K / 128K 一键选择；
- **自定义值**：支持 `4096`、`32K`、`1M` 等写法；
- **跟随系统配置**：回到设置页中该模型配置的 Context window（未配置则用默认 32K）。

会话级覆盖的优先级高于设置页中每个模型的 Context window，且只对当前会话生效；覆盖值持久化在 `llm-ollama` 命名空间的 `sessions.<sessionId>.contextWindow` 字段中。

### settings.yaml 等效配置

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

## 架构

- **Bundle 层**（`cordis.patch.yml` + `package.json` 的 `dsh.bundle.patch`）：安装后自动成为 profile 的一个 bundle 层，把 `llm-ollama` 插件行挂进组合树，免去手动补丁。
- **Host**（`lib/index.js`）：注册 `llm-ollama` 设置命名空间（其 schema 即「API 协议」下拉的数据来源）；实现 `LlmAdapter`（`/api/chat` 流式）与 `GET /api/tags` 模型发现；维护可配置提供方目录——其中始终存在一个休眠的 `ollama` 条目，保证命名空间对 Web 客户端保持暴露。
- **Client**（`client.js`）：`settings.section` 整页「Ollama」设置页与 `/ollama-context` 命令，读写 `llm-ollama` 命名空间。

## 开发调试

无真实 Ollama 时可用内置 mock 服务器联调：它实现了 `/api/tags` 与流式 `/api/chat`（含工具调用示例），并把最近一次 `/api/chat` 请求体写入 `/tmp/ollama-mock-last.json`，便于断言 `num_ctx` / `num_predict` / `keep_alive` 的透传是否正确。

```bash
node scripts/mock-ollama.mjs   # 监听 127.0.0.1:11434
```

## 已知限制

- 社区插件（非官方出品）。
- 仅支持文本与工具调用；图片附件暂不支持（会给出明确错误）。
- API 密钥字段当前仅保存凭据引用，尚未随请求发送；远程部署的鉴权请在 Ollama 前的反向代理层处理。
