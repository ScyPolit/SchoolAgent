# 开源 AI 对话平台初步评估

最新实施结果已按用户要求改为**完整最新版 LibreChat 前端源码**，基线 `v0.8.9-rc1` / `f4154b649efa37e1345ccc517a4d8d1ed2178c82`，见 [最新版说明](librechat-latest.md)。下方初步评估及早期 `v0.8.1` 抽取记录仅保留历史背景，已被此次完整客户端方案取代。

评估日期：2026-11-04。来源为官方文档与仓库；未安装候选项目，未完成微信兼容性、20 路负载或真实工作流接入测试。

实施更新（2026-11-04）：已选择 **LibreChat 前端模块复用 + 学校统一后端**，固定 `v0.8.1` / `b288d81f5a4625403bc880e93059d90d9aa51fe3`，并归档五个源码模块、完整 MIT 许可和 SHA-256 清单。整套二次开发与模块复用的比较、实际范围见 [架构决策](architecture.md) 和 [源码复用说明](../third_party/librechat/NOTICE.md)。本文下方保留初步评估背景；最终选型以实施更新为准。尚未执行构建、自动化测试或 Docker 部署验证，不代表整套 LibreChat 迁移完成或真实接入通过。

业务基线见[需求分析](requirements.md)。以下为工程建议，不是已锁定的开发方案；正式选型前须固定版本并复核对应源码和许可。

## 1. 评估结论

优先验证 LibreChat，Open WebUI 作为备选，LobeHub 作为交互参考及补充候选。此排序主要考虑既有聊天能力、邮箱账号基础、外部接口扩展成本、学校品牌配置和许可条件，尚未计入实际部署性能。

所有候选均是完整应用。选择整套二次开发可以复用部分账号、历史及权限能力；仅取前端组件则仍要自行建立相应后端。当前阶段不承诺现成系统完全满足本项目，也不把“只用界面”误当成不用开发服务端。

## 2. 候选对比

| 项目 | 可用作基础的能力或扩展点 | 本项目主要差异 | 建议 |
| --- | --- | --- | --- |
| LibreChat | 成熟对话应用；邮箱账号；自定义服务端点；已有访问控制与多格式导出基础 | 官方无游客模式；需补游客及迁移、原平台协议适配、学校首页、管理功能授权、正文保留、PDF等差异 | 优先验证 |
| Open WebUI | Pipe Function 可接管请求/响应，适合验证外部非标准工作流 | 超管/普通管理员拆分、普通管理员正文权限、游客、分享期限及首页仍需验证/开发；品牌条款影响学校定制 | 备选 |
| LobeHub | 对话交互及自托管提供方配置可供参考 | 任意外部工作流不等于原生可接；需核对身份、后台、游客和交付方式对应许可 | 补充候选 |

本表没有把中文体验和手机适配写成已经通过；需在目标版本与学校网络中实测。

## 3. LibreChat

### 3.1 已核实事实

- 当前仓库采用 MIT License，要求随相关软件副本保留版权及许可声明。[官方 LICENSE](https://github.com/LibreChat-AI/LibreChat/blob/main/LICENSE)
- 官方账号说明包含邮箱注册、邮件验证与找回密码；同一说明明确聊天前需登录，没有游客模式。因此匿名聊天和登录迁移属于二次开发。[官方账号说明](https://www.librechat.ai/docs/features/authentication)、[邮件配置](https://www.librechat.ai/docs/configuration/authentication/email)
- Custom Endpoints 面向约定的兼容协议；Polymas、Dify 的原生工作流 API 需要额外适配或后端改造，不能仅填写任意地址。[官方端点配置](https://www.librechat.ai/docs/quick_start/custom_endpoints)
- 官方存在用户/组/资源访问控制和对话导出基础；是否覆盖本项目菜单授权、聊天正文单独授权及导出组合仍需核对。[官方访问控制](https://www.librechat.ai/docs/features/access_control)、[官方导出说明](https://www.librechat.ai/docs/features/import_convos)

### 3.2 验证重点

1. 游客会话能否在不削弱原有账号隔离的前提下独立实现。
2. 原生请求/流式/停止管线如何对接平台适配器，并保留本地稳定会话标识。
3. 是否可复用原角色权限并补齐普通管理员功能授权，避免另做一套相互冲突的权限系统。
4. 重新生成版本与原平台会话上下文的一致性。
5. 学校固定首页与管理端的增量开发范围，及 MD/PDF/PNG 导出的完整性。

## 4. Open WebUI

- Pipe Function 是可处理完整请求/响应的扩展点，可用于连接非兼容协议和工作流；这只说明存在扩展路径，不代表已经兼容本项目两个平台。[Functions](https://docs.openwebui.com/features/extensibility/plugin/functions/)、[Pipe](https://docs.openwebui.com/features/extensibility/plugin/functions/pipe/)
- 原生 Admin 拥有广泛管理能力；不能据用户组机制直接认定已满足本项目受限普通管理员，需逐项验证。[官方角色说明](https://docs.openwebui.com/features/authentication-access/rbac/roles/)
- 当前许可对改变品牌存在条件，其中一个例外使用滚动 30 天独立自然人数不超过 50 的口径；其他路径包括书面许可或相应企业许可。本项目的 20 并发不能替代该人数口径。[官方 LICENSE](https://github.com/open-webui/open-webui/blob/main/LICENSE)

学校名称、Logo 和主题配置的可行方式应在选定版本中核对；不能预设可无条件移除原项目全部品牌。

## 5. LobeHub

- 提供方配置说明提供自托管模型接口相关配置，但不能据此认定可直接运行任意第三方工作流。[官方提供方配置](https://github.com/lobehub/lobehub/blob/canary/docs/self-hosting/environment-variables/model-provider.mdx)
- 当前 LobeHub Community License 在 Apache 2.0 基础上增加条件，包含衍生作品开发和分发的许可条款；不能按纯 Apache 2.0 候选处理。具体交付方式需对应条款核对。[官方 LICENSE](https://github.com/lobehub/lobehub/blob/canary/LICENSE)

## 6. 选型验证门槛

| 维度 | 必须取得的证据 |
| --- | --- |
| 校园交互 | 中文、电脑、手机、微信内置浏览器以及固定首页配置可用 |
| 真实接入 | 一个 Polymas 和一个校内 Dify 应用贯通；答案增量或明确降级、多轮与停止正确 |
| 身份与权限 | 游客/账号隔离，登录迁移、普通管理员授权、正文查看限制通过负向检查 |
| 历史与版本 | 跨设备续聊、用户隐藏/后台保留、重生成版本与上游上下文一致 |
| 分享与导出 | 登录限制、快照、过期/撤销，以及 MD/PDF/PNG 输出正确 |
| 容量 | 实际部署环境下 20 路同时执行，不串流；取得延迟与成功率数据 |
| 可维护性 | 固定版本、记录修改点、外部适配不依赖页面事件、升级边界明确 |
| 使用与品牌条件 | 对应版本的许可和学校品牌展示方案核对完成 |

许可段落仅记录官方文本中的现有条件，不替学校对具体交付安排作最终适用性判断。正式开发优先锁定稳定版本，避免只依据持续变化的 main/canary 文档安排工作。
