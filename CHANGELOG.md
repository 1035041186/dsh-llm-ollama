# 更新日志

所有项目变更都会记录在此文件中。

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
