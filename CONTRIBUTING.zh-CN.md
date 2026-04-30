# 为 80m Agent Desktop 做贡献

感谢你愿意为 80m Agent Desktop 做出贡献。无论是修复 bug、添加新功能、完善文档，还是修正一个拼写错误，每一份贡献都很有价值。

## 语言

- 英文：`CONTRIBUTING.md`
- 简体中文：`CONTRIBUTING.zh-CN.md`

## 快速开始

1. **Fork** 本仓库，并将你的 fork 克隆到本地。
2. **安装依赖：**

   ```bash
   npm install
   ```

3. **以开发模式启动应用：**

   ```bash
   npm run dev
   ```

## 提交更改

1. 从 `main` 分支创建一个新分支：

   ```bash
   git checkout -b your-branch-name
   ```

2. 进行更改。每次提交保持专注 — 一个逻辑更改对应一次提交。

3. 提交前运行检查：

   ```bash
   npm run lint
   npm run typecheck
   ```

4. 使用 `npm run dev` 在本地测试，确保一切正常。

## 提交 Pull Request

1. 将分支推送到你的 fork。
2. 在上游仓库向 `main` 分支发起 Pull Request。
3. 清晰描述你更改了什么以及为什么。
4. 如果你的 PR 解决了某个 issue，请引用它（例如 `Fixes #42`）。

维护者会审查你的 PR，可能会要求修改。批准后将会合并。

## 报告 Bug

发现 bug？[提交 issue](https://github.com/guapdad4000/80m-agent-desktop/issues/new)，请包含：

- 清晰的标题和描述。
- 复现步骤。
- 预期行为与实际行为。
- 你的操作系统和应用程序版本（如有）。

## 功能建议

有好点子？[提交 issue](https://github.com/guapdad4000/80m-agent-desktop/issues/new) 并描述：

- 你想解决的问题。
- 你希望它如何工作。
- 你考虑过的替代方案。

## 项目结构

```text
src/main/          Electron 主进程、IPC 处理器、Hermes 集成
src/preload/       安全渲染器桥接
src/renderer/src/  React 应用和 UI 组件
resources/         应用图标和打包资源
build/             打包资源
```

## 代码规范

- 项目使用 TypeScript、React 和 Electron。
- 运行 `npm run lint` 检查代码格式错误。
- 运行 `npm run typecheck` 验证类型安全。
- 请遵循代码库中现有的模式和约定。

## 社区

- 加入 [Nous Research Discord](https://discord.gg/NousResearch) 与其他贡献者交流。
- 查看 [Hermes Agent 文档](https://hermes-agent.nousresearch.com/docs/) 了解更多背景。

## 许可证

提交贡献即表示你同意你的贡献将采用 [MIT 许可证](LICENSE)。
