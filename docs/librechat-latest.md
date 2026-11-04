# 最新开发镜像源码基线与构建

用户要求“整个前端使用真实 LibreChat，只在上游基础上增删修改，并使用最新 dev”。当前运行前端改为完整上游 React 应用，源码位于 `upstream/LibreChat/client`；包含原版路由、聊天壳、导航、输入框、消息列表、设置与主题。校园差异在这一源码树中修改，不通过旧自制页面套壳。

## 固定基线

- 上游：[LibreChat-AI/LibreChat](https://github.com/LibreChat-AI/LibreChat)。本次检出的提交为 [`f4154b649efa37e1345ccc517a4d8d1ed2178c82`](https://github.com/LibreChat-AI/LibreChat/tree/f4154b649efa37e1345ccc517a4d8d1ed2178c82)，`package.json` 版本 `v0.8.9-rc1`，选择日期 2026-11-04。
- 官方默认 Compose 镜像为 `registry.librechat.ai/librechat-ai/librechat-dev:latest`。该镜像的 [dev-images.yml](https://github.com/LibreChat-AI/LibreChat/blob/f4154b649efa37e1345ccc517a4d8d1ed2178c82/.github/workflows/dev-images.yml) 在 **main** 推送时构建并标记 `latest`；不能把镜像名中的 dev 当成 Git dev 分支。Git dev 分支另由 `dev-branch-images.yml` 构建 `lc-dev` 镜像。
- 不在构建时重新拉取浮动 `latest` 或 `main`。完整源码固定在本次检出提交，记录见 [baseline.json](../third_party/librechat-latest/baseline.json)。后续升级需要重新比较差异并验证。
- 以该提交的实际 [LICENSE](../third_party/librechat-latest/LICENSE) 为准：MIT，Copyright (c) 2026 LibreChat。上游部分 package.json 中的历史 license 字段不替代实际许可文件。原始字体及其他资产的许可随完整上游保留，生产前端构建同时复制字体许可。
- 在完整上游基础上的本地修改文件及 SHA-256 记录于 [changes.json](../third_party/librechat-latest/changes.json)。构建器核对 Git HEAD（检出目录保留 Git 时）和有效锁文件校验值；变更源码基线或依赖必须先更新经过审核的基线记录，不能仍把新输出标成旧提交。

此前 `v0.8.1` 模块抽取方案已经退出运行前端。它的归档及校验仅保留历史可追溯性，不代表本次最新版前端验收。

## 工具链与边界

开源仓库将完整上游源码作为普通目录分发，不携带嵌套 `.git` 或子模块指针。原始基线与校园修改分别保留在 `third_party/librechat-latest/`；克隆本仓库后即可安装和构建，分发检查见 [开源说明](open-source.md)。

上游当前使用 React 18、Vite 8、TypeScript 5.9 和 tsdown 0.22；根目录校园服务端继续使用 Node.js 24 / Express / SQLite。两者分别安装依赖，不能把旧根目录 React 19 依赖当作上游应用的依赖。

```sh
npm ci
npm run install:client
npm run build
```

`install:client` 使用原锁文件安装 `client`、`packages/data-provider`、`packages/client`、`packages/chat` 与上游根开发工具。`build` 依次编译数据提供包、共享组件、聊天包、完整客户端，最后将 `upstream/LibreChat/client/dist` 复制到根目录 `dist`，供校园服务端同源提供。

仅修改客户端源码、且共享包已经按当前源码编译时，可执行 `npm run build:client`；它仍调用原版 Vite 并同步根目录产物和CSP哈希，但不会清理共享包声明。修改 `packages/` 后应执行完整 `npm run build`。

不安装或运行原版 Mongo/Express 后端作为第二套账号系统。校园服务端对原版客户端 API 提供兼容层，继续统一账号、权限、游客、会话、工作流和持久化。原版端点通过 `/api/librechat` 命名空间适配，避免与校园管理 API 混淆。

```sh
# 同时运行校园服务端与真正的 LibreChat Vite 客户端
npm run dev
# 仅运行上游 Vite 开发端，默认 127.0.0.1:5173，代理服务端端口 3000
npm run dev:client
```

原版 HTML 包含首屏主题和恢复脚本。构建器按最终 HTML 生成 `dist/csp-hashes.json`，其中是完整带引号的 SHA-256 CSP 允许值；服务端使用这些值，不能为了兼容原版而普遍开放任意内联脚本。

`dist/librechat-build.json` 记录上游提交、版本、构建时间和本地变更清单的SHA-256；提交号表示原始基线，本地学校修改另由清单标识，不把二次开发产物当作未经修改的官方发行版。

一期是在线校园应用，原版PWA插件关闭自动Service Worker注册；完整原版UI保持运行。受控观察、决策及未证明的因果边界见 [在线客户端决策](online-client-service-worker.md)。

Dockerfile 现在从这一完整上游源码构建前端，单独安装校园后端生产依赖，再装入同一个非 root 应用镜像。未运行原版官方完整应用镜像，不引入第二个身份或数据库。**尚未执行 Docker 构建、启动或部署验证。**

## 依赖审计

根目录后端审计与上游工作区审计分别记录，不能用根目录的零漏洞结果代替新前端依赖审计。上游锁定依赖中的高危 `follow-redirects 1.16.1` 已采用兼容的 `1.16.2` override；其余上游开发工具的低/中危结果按实际报告保留，不通过降级成不兼容旧工具来制造零报告。报告位于 `artifacts/npm-audit-upstream.json`。

## 原版性能门禁

`npm run test:performance` 复用固定上游 `e2e/lighthouse/audit.ts`，针对同一校园后端的本地一次性测试库执行三次全新 Chrome 导航。测试从被忽略的 `artifacts/qa-credentials.json` 读取随机测试账号，通过真实登录接口取得会话，并保存一段真实可读的校园测试会话。只接受回环 HTTP 地址，不能指向学校正式服务；需要先运行专用测试夹具和生产前端构建。

沿用原版中位数上限：LCP 4500ms、CLS 0.1、TBT 500ms，并核对最终地址和正文 LCP，登录页或空壳不能通过。这里使用学校 SQLite，没有注入原版 MongoDB 的 250ms 查询延迟，因而不能声称等价于上游数据库延迟实验，也不代表真实 AI 容量测试。每次报告存入独立 `artifacts/performance-campus/attempt-*` 目录；会话 Cookie 在报告中脱敏。失败报告保留，最近结果见该目录的 `summary.json`。
