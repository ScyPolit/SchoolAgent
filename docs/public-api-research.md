# 公开 API 文档检索与协议核对

检索日期：2026-11-04；登录后协议核对更新：2026-11-05，Asia/Shanghai。此前按用户要求完成公开检索，本轮在用户自行登录后读取正式文档。未调用真实智能体、未发送验证码或聊天消息，未执行 Docker 部署。

## Polymas：2026-11-05 已通过授权登录读取官方协议

此前公开检索未取得完整请求协议。用户随后提供了官方[智能助手文档](https://platform.polymas.com/instructions?docNid=KIGeJe725k&childIndex=1)，并完成智慧树登录，本轮已在独立后台浏览器读取正文；另核对同站[网关接入文档](https://platform.polymas.com/instructions?docNid=UvtFSkcFIR&childIndex=2)。未将网页登录 Cookie 作为业务 API 凭据。

已确认网关生产域名、带毫秒时间戳的 MD5 令牌签名、Authorization 请求头、AES ECB / ZeroPadding 参数封装，以及助手聊天 SSE、工具 V2 的普通/流式请求和最终输出格式。文档未提供远程停止接口、可枚举学校发布应用的正式 API，或能证实 AES 密钥字节编码与 Authorization 前缀的完整 SDK 测试向量。

实现按上述已公布协议工作，差异以明确的高级兼容选项处理，不能把默认解释视为真实互通已经通过。工具中间 ANSWER 不作为正文，OUT_COMPLETE 中的 JSON 再按主答案字段映射；缺少正式终态不能成功。具体配置、加密边界、历史策略及测试范围见 [Polymas 接入指南](polymas-integration.md)。

学校账号身份、实际应用标识、密钥、浏览器会话和原始页面快照不随开源分发。官方网页示例也不作为本项目默认业务应用或可用凭据。

## Dify：已找到的官方公开协议

本轮读取的是 `docs.dify.ai` 官方文档；没有用第三方封装或同名网站替代。下表概述核对结果，学校实际实例版本、地址、应用发布状态和输入输出变量仍需从校内应用取得。

| 核对项 | 官方依据 | 实现处理 |
| --- | --- | --- |
| Chatflow 请求 | [Send Chat Message](https://docs.dify.ai/en/api-reference/chat-messages/send-chat-message)：`POST /chat-messages`，`inputs/query/user/response_mode`；新会话省略 `conversation_id` | 每次从本地活动分支恢复到新上游会话，避免远端旧分支混入 |
| Workflow 请求 | [Run Workflow](https://docs.dify.ai/en/api-reference/workflow-runs/run-workflow)：`POST /workflows/run`，`inputs/user/response_mode` | 问题与历史映射到应用定义的输入，主答案映射自 `outputs`；没有历史输入就拒绝多轮 |
| 应用模式和输入变量 | [Get App Info](https://docs.dify.ai/en/api-reference/applications/get-app-info)、[Get App Parameters](https://docs.dify.ai/en/api-reference/applications/get-app-parameters) | 联调可用 `/info` 查模式（Chatflow 为 `advanced-chat`），`/parameters` 查 `user_input_form`；公开文档无法得知校内自定义字段 |
| 用户身份 | [End User Identity](https://docs.dify.ai/en/api-reference/guides/end-user-identity) | 本平台会话随机稳定身份由服务端生成；发送、取消及迁移后续聊保持一致；不尝试迁移原网页身份 |
| 流事件与双终态 | [Consume Streaming Responses](https://docs.dify.ai/en/api-reference/guides/streaming)，页面标注 2026-10-29 更新 | 跳过没有 `data` 的裸 `event: ping`；只有答案事件更新正文；当前 Chatflow 需要 `message_end` 与 `workflow_finished` 两个终态 |
| 取消聊天 | [Stop Chat Message Generation](https://docs.dify.ai/en/api-reference/chat-messages/stop-chat-message-generation) | `POST /chat-messages/{task_id}/stop`，必须使用原始 `user`；HTTP 成功不保证真的取消 |
| 取消 Workflow | [Stop Workflow Task](https://docs.dify.ai/en/api-reference/workflow-runs/stop-workflow-task) | `POST /workflows/tasks/{task_id}/stop`。当前官方说明此接口不校验 `user` 是否匹配；本平台仍先执行本地回答归属检查并使用原始身份，不能仅凭外部任务标识操作他人任务 |
| 独立终态核验 | [Get Workflow Run Detail](https://docs.dify.ai/en/api-reference/workflow-runs/get-workflow-run-detail) | Chatflow/Workflow 均可按 `/workflows/run/{workflow_run_id}` 读取状态；按官方请求移除无文档依据的 `user` 查询参数 |

公开协议只证明官方能力存在，不能证明学校实例已经发布兼容应用。Chatflow 的“新会话 + 完整活动历史”是本平台为安全分支实现选用的策略；必须用真实部门问答等业务样例验证应用确实理解历史，而非把策略实现等同多轮业务验收通过。

## 本轮已落实的代码修正和验证

核对官方 2026-10-29 流式说明时发现：旧实现收到 Chatflow 的 `message_end` 就提前结束，可能漏掉随后失败的 `workflow_finished`。已修正为默认等待两个语义终态，同时兼容两者先后顺序；`workflow_finished` 失败时保留部分正文并报告失败。仅收到答案结束、随后断线的情况标为未完整结束。只有实例维护者已核实旧版本协议时，才可显式配置 `chatflowTerminalMode: "message_end"`；默认不启用该兼容选项。

新增回归覆盖双终态、答案结束后的工作流失败、双终态反序、显式旧版模式及裸心跳。执行：

```text
node --test --test-concurrency=1 tests/adapters.test.js tests/chat.test.js
29 tests / 29 pass / 0 fail / 0 skipped
```

本地协议夹具已同步为当前 Chatflow 双终态。测试和本地 20 路指标详见 [chat-test-evidence.json](chat-test-evidence.json)，均不能代替真实平台联调。后续校内 Dify 实例可能运行旧版本，应以该实例发布应用的 API 页面及实际 SSE 事件再次核对，不把官方最新版协议当成已检测到的实例版本。
