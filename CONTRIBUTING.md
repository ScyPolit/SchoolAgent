# 参与 SchoolAgent

欢迎改进校园智能体入口、工作流适配、权限、测试和文档。当前主分支为 `main`，Pull Request 请提交到本仓库的 `main`。

## 开始之前

先查看 [README](README.md)、[架构](docs/architecture.md)和[已知限制](docs/known-issues.md)。较大改动建议先开 Issue，说明具体场景、预期行为及涉及的平台。

本项目包含完整上游客户端：

- 校园服务端：`server/`、`scripts/`、`tests/`。
- 当前前端：`upstream/LibreChat/client/`。
- 上游共享包：`upstream/LibreChat/packages/`。
- `archive/` 为历史记录，不应作为新功能入口。

修改上游源码时，还需阅读对应的 [AGENTS.md](upstream/LibreChat/AGENTS.md)。向 LibreChat 上游提交贡献时遵循其分支规则；这些规则不改变 SchoolAgent 本仓库的 `main` 目标分支。

## 本地开发

```bash
git clone https://github.com/ScyPolit/SchoolAgent.git
cd SchoolAgent
npm ci
npm run install:client
node scripts/bootstrap.js
```

按 [README](README.md#本地源码开发)设置本地 `.env`，执行 `npm run dev`。运行时配置、数据库、密钥、真实问答和随机测试账号留在本机，不加入提交。`.env.example` 只放不含凭据的模板。

## 验证改动

| 改动 | 检查 |
| --- | --- |
| 校园服务端 | 针对性测试及 `npm test` |
| 前端及共享包 | `npm run build`，并在修改的工作区运行相应类型检查与专项测试 |
| 启动、认证或消息加载 | 按[上游性能说明](docs/librechat-latest.md#原版性能门禁)复测实际正文冷启动 |
| 文档 | 检查命令、链接、截图和状态描述是否与当前实现一致 |

客户端继续使用 LibreChat 原版组件、主题和交互；颜色使用语义主题变量。权限、对象归属与凭据管理由服务端执行，不能依赖隐藏按钮实现授权。

新增工作流适配器需要可核实的正式协议、脱敏请求/响应样例，以及流式终态、历史、停止和错误处理测试。请分别记录“本地夹具通过”和“真实平台通过”。不要把上游接受停止请求等同于已确认远端停止。

## Pull Request

说明解决的具体问题、改动后的行为、验证结果和仍未验证的条件。界面改动附浅色、深色或手机截图；截图使用开发数据，并保留第三方版权。

修改上游依赖或源码基线时，同步维护 `third_party/librechat-latest/` 的基线与修改清单，保持 LF 归一化校验可复现。不要直接追随浮动 `latest` 改写当前基线。

## 问题与安全报告

普通问题请使用 [Issues](https://github.com/ScyPolit/SchoolAgent/issues)。安全漏洞按 [SECURITY.md](SECURITY.md)私下报告，不在公开 Issue 中粘贴凭据、会话 Cookie 或实际聊天正文。

提交贡献即表示你有权提交对应内容，并同意原创贡献按本项目 MIT 许可分发；第三方内容需保留原始许可和来源。
