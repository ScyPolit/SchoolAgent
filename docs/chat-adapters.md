# 聊天适配、上下文与数据生命周期

实现位置：`server/chat.js`、`server/adapters/`。用户已授权继续功能测试；聊天及适配器专项测试已运行 29 项，全部通过，未执行 Docker 部署。Dify 校内应用、Polymas 正式协议和真实 20 路容量仍未验收。公开文档检索及协议修正见 [public-api-research.md](public-api-research.md)。

## 接入边界

服务端 `createAdapter(integration)` 提供 `run({content,history,upstreamUser,signal,onEvent})` 和 `stop({taskId,runId,upstreamUser})`。页面不接触密钥。事件分为内部请求派发 `dispatch`、内部标识 `meta`、可显示答案 `delta` / `replace` 和进度 `progress`。适配器完成配置校验后，在实际发出上游 HTTP 调用前发出 `dispatch`；后台保留接受时间与派发时间，不把本地配置拒绝当作实际调用。`run` 仅在收到语义终态后返回完成；连接结束但没有终态会标为未知，并保留部分正文。`message_replace` 用于输出审核等上游整段替换，服务端和客户端必须同时覆盖当前正文，不能追加旧内容。

`usage_logs` 记录调用标识、智能体、接入实例、平台、应用标识、执行用户、上游用户/会话/消息/任务/运行标识、调用来源、可选父调用及权限范围。普通使用日志不保存问题、回答、原始上游错误或密钥。问题及回答只在正文表保存；反馈、分享另有正文访问控制和关联删除。

调用前重新检查当前组权限及上架状态。首页隐藏仅影响首页入口；下架和撤销授权均阻止新调用，已有本人历史仍保留。测试连接需要 `integrations` 和 `credentials` 两项权限，作为 `connection_test` 独立调用记录，不自动证明多轮、分支或取消能力。

## Dify 配置

平台类型可用 `dify`，并在 `config.mode` 中明确 `workflow` 或 `chatflow`。兼容 `dify-workflow` / `dify-chatflow`，由类型提供默认模式。实例基础地址须包含实际 API 前缀，例如 `https://dify.school.internal/v1`；它不是 Dify 网页聊天地址。应用通常由独立的应用 API Key 识别，后台应用标识用于登记和追溯。凭据由管理员在受控后台录入，加密保存在服务端。

Chatflow 配置示例（不含凭据）：

```json
{
  "mode": "chatflow",
  "responseMode": "streaming",
  "inputs": {},
  "timeoutMs": 120000
}
```

每次 Chatflow 调用都新建上游会话，不发送旧 `conversation_id`。本地所选活动历史按角色组成完整 JSON，作为当前问题前的显式上下文传入；若发布应用有专用历史变量，可设置 `historyField`，改为向 `inputs` 传该 JSON 字符串。这样重生成、版本切换和游客转账号不会继续使用被其他分支污染的远端会话。此策略避免远端隐藏状态混入；应用是否正确理解传入历史仍须用真实业务问答验证，不能因此自行把多轮能力标为通过。长历史不静默截断，超过上游上下文限制会明确失败；必要时由应用维护者调整上游容量或历史协议。

Workflow 配置示例：

```json
{
  "mode": "workflow",
  "queryField": "question",
  "historyField": "history",
  "answerField": "answer",
  "responseMode": "streaming",
  "inputs": {},
  "timeoutMs": 120000
}
```

Workflow 使用 `/workflows/run`；`queryField` 是 Start 节点的问题变量，`historyField` 是由上游维护者定义的历史字符串变量。未配置历史字段时允许单轮，但拒绝后续多轮。`answerField` 相对于工作流 `outputs`，支持点号路径，例如 `result.text`。Workflow SSE 的节点事件和内部 LLM 文本不直接作为答案显示：默认仅展示最终映射输出；确认某节点文本确为用户主答案后，可配置 `streamAnswerSelector: ["answer-node-id", "text"]`，仅接收该来源的 `text_chunk`。选择器须根据校内实际版本的事件验证。Chatflow 接收正式答案增量；按当前官方协议默认同时等待 `message_end` 和成功的 `workflow_finished`，避免漏掉随后出现的工作流失败。实例已验证旧版终态协议时，可显式设置 `chatflowTerminalMode: "message_end"`，不能未经验证自行降级。

Chatflow 可选 `workflowId` 传递已发布版本标识，是否支持受校内实例版本限制。配置 `responseMode: "blocking"` 时，显示处理中，返回后一次显示完整答案。默认超时 120 秒，可配置 1～600 秒；超时保存未知状态和部分正文，并说明上游可能仍在运行。此资源边界不构成每日次数、账号数量或发送频率配额。

官方接口依据（公开文档于 2026-11-04 查阅，不能替代校内实例联调）：[发送聊天消息](https://docs.dify.ai/en/api-reference/chat-messages/send-chat-message)、[Workflow 概览](https://docs.dify.ai/en/api-reference/guides/workflow)、[SSE 事件](https://docs.dify.ai/en/api-reference/guides/streaming)、[停止聊天](https://docs.dify.ai/en/api-reference/chat-messages/stop-chat-message-generation)、[停止 Workflow](https://docs.dify.ai/en/api-reference/workflow-runs/stop-workflow-task)。

## 停止与版本

每次执行生成独立 `answer_versions` 和 `usage_logs` 记录。服务端先设置本地停止屏障，立即拒绝迟到片段，再发送对应模式的取消请求。Chatflow 使用 `/chat-messages/{task_id}/stop`，Workflow 使用 `/workflows/tasks/{task_id}/stop`，均使用原调用的稳定用户标识。HTTP 成功仅说明取消命令被接受。可取得运行标识时读取 `/workflows/run/{workflow_run_id}` 核验；只有独立读到 `stopped` 或本次原始流返回停止终态才标 `confirmed`。否则区分 `unknown`、`failed`、`completed_before_confirmation`，并明确上游可能仍在执行。开发演示使用 `local_only`，无上游可取消。

每条用户消息持有精确的 `parent_version_id`，会话持有活动回答版本。读取、导出、分享和下一问通过这一链条重建同一活动分支。重生成保留旧回答，但从目标问题之前的相同前缀开始；切换版本会把该回答设为活动分支末端，后续新问题从此继续。原分支的下游正文保留，授权管理员可查看全部分支。前端须在切换时明确后续分支将变化。进程重启时，未结束执行标为未知，不能推定远端已停止或成功。

每个本地会话分配随机稳定的 `upstream_user`。它不会接受客户端覆盖，不与其他用户或会话共用。游客转账号只在明确同意、同浏览器身份且记录未过浏览器期限时调整本地归属，保留全部版本链和上游用户标识。事务确保失败回滚；重复同意不会重复迁移；有生成任务时拒绝迁移并允许稍后重试。拒绝迁移不会混入账号历史。

## 保留、分享与清理

采用需求文档中的实施建议：浏览器访问及服务器游客正文期限都从该会话最后一次发送/重生成消息起算，独立使用 7 天和 180 天默认值。单纯查看、搜索、重命名、反馈和迁移不刷新消息活动时间。规则修改作用于仍存在的数据；已清理内容不会随期限延长恢复。游客迁移后按账号长期保留，不继续受游客正文期限影响。使用日志及操作日志按各条事件发生时间起算。

用户删除先隐藏原会话，并即时撤销及清空所有分享副本；授权管理员仍可访问原正文。分享创建时固定活动版本内容，只包含标题及有序角色正文；无用户资料、工作流调试信息或密钥。公开读取即时检查到期、撤销和原会话隐藏状态，不等待清理任务。分享到期后，周期任务清空其正文副本。

永久清理级联移除本平台问题、全部回答版本、反馈和分享副本，并解除无正文使用日志的本地正文引用；管理员审计只保存清理标识和数量。定期保留任务也按同一删除逻辑清除到期游客正文。此操作不会删除 Polymas / Dify 的原始数据，也不能删除离线备份；远端和备份由运维按各自规则管理。任务频率、备份恢复及内网限制参见部署文档。

统计中 `attempts` 是平台接受的请求尝试；`calls` 仅统计已派发的上游 HTTP 调用，成功、失败、停止、未知及平均耗时同样按这些调用计算。HTTP 鉴权拒绝等属于真实发出的失败请求，不代表上游成功执行工作流。`configRejected` 是本地校验/配置失败且未派发的请求，`demoCalls` 独立记录开发演示，不混入真实调用。`byKind` 独立列出新问题、重生成、连接测试，`byUserType` 分开登录账号、匿名游客和管理连接测试。游客人数为匿名标识估算。首段耗时只记录实际答案，不包含进度提示；没有上游 token / 费用信息时不生成估算值。迁移新增 `execution_requested`、`dispatched_at`、`execution_mode` 字段；历史旧日志不推定已派发。

## Polymas 与真实联调待办

Polymas 当前明确返回 `POLYMAS_API_UNCONFIRMED`，不猜测演示网页协议。需要正式 API 基础地址、鉴权、输入输出字段、多轮/停止说明及应用标识准确值，随后按同一适配器契约实现并联调。公开 `appCode` 中的字母 O 与另提供 ID 中的数字 0 不会自行统一。

`demo` 适配器必须同时满足 `ENABLE_DEMO_ADAPTER=true` 和非生产模式；页面及回答明确标注开发演示。生产环境即使数据库留有演示配置也拒绝调用。

已于 2026-11-04 执行 `node --test --test-concurrency=1 tests/adapters.test.js tests/chat.test.js`，29 项全部通过，0 失败。前者涵盖 UTF-8 字节拆分、Chatflow 双终态与终态后失败、裸心跳、答案映射、进度隔离、派发事实和取消核验；后者使用本地 Dify 协议夹具验证归属、分支、迁移同意/拒绝/幂等/事务回滚/忙时拒绝与重试、停止竞态、客户端断开、重启未知状态、分享、保留、权限和 20 路 HTTP 调用。

最新一轮 20 个独立游客身份同时请求本地协议夹具：20/20 完成，无串流和记录缺失；消息阶段总耗时 107.67 毫秒，首段答案 49～65 毫秒，单次结束耗时 49～65 毫秒，进程 RSS 105,254,912 字节。夹具没有执行真实模型、知识库或工作流，不能证明真实平台接入或学校生产容量达标。原始指标与命令见 [聊天专项测试证据](chat-test-evidence.json)。
