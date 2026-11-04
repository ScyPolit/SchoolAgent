# 公开 API 文档检索与协议核对

检索日期：2026-11-04，Asia/Shanghai。依据用户“文档你上网搜”的要求，实际执行互联网搜索、官方文档读取和官方网页公开界面查看；未调用用户的真实智能体、未填写账号、未发送验证码或聊天消息、未提取网页内部接口，未执行 Docker 部署。

## Polymas：已确认的站点与未找到的协议

目标平台严格限定为用户提供的 `polymas.com`。官方[AI 能力中心首页](https://polymas.com/)介绍智能体、知识库及高校应用，并提供开放云平台、OPS 开发平台等产品入口；页脚链接智慧树的营业执照及备案页面。这些页面说明目标产品身份，不能用作聊天 API 协议。

通过 `agent-browser` 读取实际公开页面后，观察到：

| 页面 | 实际观察 | 可得出的结论 |
| --- | --- | --- |
| `https://polymas.com/` | AI 能力中心产品介绍；公开界面没有看到正式 API 请求、鉴权、SSE、取消或历史参数说明 | 已确认目标官网，尚无可实现的公开协议 |
| 官网右上角登录入口 | 跳转 `login.zhihuishu.com`；登录目标回跳至 `cloudapi.polymas.com` 的 OAuth 入口，再回到官网。页面提供手机号/验证码、账号、学号、工号等登录方式 | 官方系统入口有登录门槛；没有登录，也未确认“通过 API 使用”文档在登录后哪一页 |
| 学校提供的演示页（应用标识不随开源分发） | 当前能加载“AI助手”，显示初始问候、历史记录及提问框；未看到 API 文档入口 | 演示 UI 可达，不等于正式服务端 API 可用或已验证 |

浏览工具最初遇到 `net::ERR_NO_SUPPORTED_PROXIES`；显式采用当前机器已配置的 HTTP 代理后成功读取上述页面。此前需求文档记录的演示页访问失败属于先前状态，本轮已经补充公开 UI 可达证据。只读取 UI，没有提交业务问题，因此不标记真实回答、多轮或取消验证通过。

实际执行过的查询包括：

- `site:polymas.com API 接口 文档 智能体`
- `site:polymas.com 开放 API 工作流 调用`
- `"polymas.com" "通过API"`
- `"polymas.com" "智能体" "API调用"`
- `"polymas.com" "API使用"`
- `"polymas.com" "接口文档"`
- `"polymas.com" "API Key"`
- `"polymas.com" "API" "鉴权"`
- `"polymas.com" "curl"`
- `"polymas.com" "openapi"`
- `site:polymas.com/docs API`、`site:polymas.com/help API`
- `"chat.polymas.com" 文档`、`"chat.polymas.com" "appCode" API`
- `"Polymas" "API" site:zhihuishu.com`
- `"大明白" "Polymas" "API"`

搜索中出现同名预测市场、学术出版及课程辅助脚本，均未作为目标平台协议依据。没有找到可核实为该官方智能体平台发布的完整 API 文档。此结论仅表示本次公开检索结果，不代表平台不存在 API，也不能据此断言所有文档均只能登录查看。索引中出现的非公开凭据式 URL 参数未打开、未保存、未复用。

因此继续保持明确的 `POLYMAS_API_UNCONFIRMED` 阻塞状态。不能把演示页 URL、网页内部请求或其他平台的 OpenAI/Dify 接口套用为 Polymas 正式协议。还需由持有授权的应用维护者从“通过 API 使用”入口取得以下非敏感资料：正式文档链接或导出的请求/响应说明、基础地址、鉴权字段、准确应用标识、问题与历史字段、答案输出、流终态、取消接口及终态核验。密钥仅通过服务端后台配置，不进入文档。应用标识曾存在字母 O / 数字 0 的歧义，需要从正式资料核对；学校实际标识不随开源分发。

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
