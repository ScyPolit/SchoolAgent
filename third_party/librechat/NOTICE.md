# LibreChat 源码复用说明

**历史方案归档，已退出运行前端。** 用户随后要求完整使用最新开发版 LibreChat，当前源码和构建入口见 [最新版说明](../../docs/librechat-latest.md)。以下 `v0.8.1` 模块及自制客户端保留在历史归档中，不再被当前 npm build/dev 或 Dockerfile 使用。

上游：[LibreChat-AI/LibreChat](https://github.com/LibreChat-AI/LibreChat)。固定标签 `v0.8.1`，固定提交 [`b288d81f5a4625403bc880e93059d90d9aa51fe3`](https://github.com/LibreChat-AI/LibreChat/tree/b288d81f5a4625403bc880e93059d90d9aa51fe3)。标签到提交通过 GitHub 官方 API 核对。许可为同一提交中的 MIT；完整原文见 [LICENSE](LICENSE)，所有交付副本必须保留该版权和许可。

`upstream/` 保存以下聊天模块，以及主题、字体、组件样式和壳布局参考的上游原文，供比较与升级，项目运行时使用 `client/vendor/librechat/` 的适配版本。来源、Git blob SHA 和本地 SHA-256 逐文件记录在 [manifest.json](manifest.json)；`tests/librechat.test.js` 检查源码、运行字体及许可完整性，并检查运行主题中的调色板规则逐字保留。

| 原始模块 | 实际适配内容 |
| --- | --- |
| `SiblingSwitch.tsx` | 保留上一版/下一版、状态播报、首尾禁用逻辑；移除 LibreChat 类型及 Tailwind/主题依赖，中文无障碍文案，增加请求期间禁用 |
| `MarkdownLite.tsx` | 保留 memo、ReactMarkdown、GFM、渲染错误边界的组合；去除代码执行、Artifacts、数学和语法高亮，不引入一期以外的运行能力；增加 HTML 清理与安全协议控制 |
| `MarkdownErrorBoundary.tsx` | 保留错误状态和内容变化后的重置，回退为 React 转义后的纯文本，避免再次调用失败的 Markdown 渲染器 |
| `useTextarea.ts` | 抽取输入法组合、Safari keyCode 229、Enter/Ctrl+Enter 提交与 Shift+Enter 换行逻辑；去除上传、语音、Recoil 和模型/助手配置 |
| `useAutoScroll.ts` | 保留滚动监听、距底部 50 像素判断、用户向上滚动后暂停自动滚动；移除 TypeScript 类型 |
| `client/src/style.css` | `theme.css` 逐字提取 `:root`、`html`、`.dark`、`.gizmo`、`.gizmo.dark` 的完整调色板；保留九个 `@font-face` 规则，仅把构建别名 `$fonts/` 改为 `./fonts/` |
| `packages/client/src/theme/context/ThemeProvider.tsx`、`atoms/themeAtoms.ts` | `ThemeProvider.jsx` 保留 light/dark/system、系统变化监听、HTML 主题类及 `color-theme` 持久化；以 React 状态替代 Jotai，去除动态配色覆盖以遵守用户完整使用 LibreChat 主题的要求 |
| `client/tailwind.config.cjs`、主题 `default.ts` / `dark.ts` | 归档字体、组件 token 和 RGB 主题对照；运行默认字体使用 Inter / Roboto Mono，与上游一致 |
| `Nav.tsx`、`ChatForm.tsx`、`SendButton.tsx`、`Button.tsx`、`Input.tsx`、`ThemeSelector.tsx`、`mobile.css` | 归档上游导航宽度、聊天输入、发送按钮、表单、明暗切换与手机布局样式作为校园页面和管理员页面的统一样式依据；学校业务组件以相同 token 映射到本地 CSS，不引入整套应用依赖 |

用户最新要求客户端与管理员端统一完整使用 LibreChat 主题。运行主题不重新调色，不使用原有校园青绿色自定义配色；Light/Dark/System 切换作用于全部页面。校园目录、后台管理等新增业务布局按 LibreChat 的圆角、边框、按钮与输入风格构建，不声称这些校园业务页面本身来自原项目。学校名称和配置的 Logo 仍为学校品牌。

九个 WOFF2 字体从同一固定 LibreChat 提交逐字节复制，运行副本与归档副本均有校验；Inter 与 Roboto Mono 保留各自完整 SIL Open Font License，见 [fonts/Inter-OFL.txt](fonts/Inter-OFL.txt)、[fonts/RobotoMono-OFL.txt](fonts/RobotoMono-OFL.txt)。字体文件不改名、不改内容。LibreChat 原 Logo 另作为参考资产归档及提供，使用它不表示 LibreChat 项目对本平台背书。

这些模块用于真实聊天组件中的回答版本导航、Markdown 渲染、输入和流式滚动，主题 token、字体和主题切换机制用于全部客户端和管理员页面。**本项目不是完整 LibreChat 分叉，也未复用其认证、数据库或提供方后端。** 校园首页、受限管理员端、游客迁移、固定分享副本、工作流适配、后台审计及服务端持久化是本项目新增。不能把这些新增功能归因于 LibreChat 开箱即用。

升级流程：先选择并审核新的固定提交；对照 `upstream/` 和适配文件逐项合并；保留新版许可并重新生成清单；执行构建、源码校验、输入法测试、版本切换与 Markdown 安全验证，再更新此说明。
