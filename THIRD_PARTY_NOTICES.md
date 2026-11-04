# 第三方源码与资产

SchoolAgent 的原创代码采用根目录 [MIT License](LICENSE)。第三方源码和资产继续适用其原有许可；根目录许可不替代这些文件的版权声明。

## LibreChat

- 项目：[LibreChat-AI/LibreChat](https://github.com/LibreChat-AI/LibreChat)
- 基线：`v0.8.9-rc1` / `f4154b649efa37e1345ccc517a4d8d1ed2178c82`
- 原始版权：Copyright (c) 2026 LibreChat
- 许可：[完整上游 MIT License](upstream/LibreChat/LICENSE)，另存于 [third_party/librechat-latest/LICENSE](third_party/librechat-latest/LICENSE)
- 分发方式：`upstream/LibreChat/` 随 SchoolAgent 一并提交完整源码，不使用外部子模块。保留原始声明、字体许可和其他随附通知。
- 校园修改：[变更清单](third_party/librechat-latest/changes.json)，其中哈希按 UTF-8 / LF 归一化。

校园差异包括客户端 API 命名空间、统一身份与权限、工作流聊天传输、目录及校园管理、分享导出、邮件流程和本期能力开关。原始基线与二次开发产物分别记录，详见[构建说明](docs/librechat-latest.md)。

## 历史归档

`archive/` 与 `third_party/librechat/` 保留早期模块复用实现及其原始许可，不参与当前运行或构建。其第三方声明仍需随对应源码保留。

## 依赖与字体

Node.js、React、Express、SQLite、Playwright、nginx 及其他依赖适用各自项目许可。依赖的准确版本见两套 `package-lock.json`；字体及其他资产的许可保留在对应上游目录中。容器安装的 Chromium、Noto CJK 字体等系统软件适用各自分发许可。

## 独立项目说明

SchoolAgent 由 ScyPolit 维护。LibreChat、Dify、Polymas 等名称用于指明兼容、依赖或拟接入的产品；本项目不代表这些上游项目或服务提供方。
