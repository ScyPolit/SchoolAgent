# 模块协作契约

单个 Node 24 Express 5 服务、完整 LibreChat latest-dev 对应源码前端、node:sqlite WAL 持久化；一套身份与权限。上游基线及构建见 [librechat-latest.md](librechat-latest.md)。旧自制 React 19 前端已归档，不参与构建。API 均 JSON，错误 `{error,code}`，成功通常直接对象或数组。毫秒 UTC 时间。

## LibreChat 原生浏览器协议

`/api/librechat` 由 `server/librechat-startup.js` 和 `server/librechat-compat.js` 适配，原始校园 `/api` 业务协议继续供同一服务使用。浏览器路由根路径仍为 `/`，只给 API 添加命名空间。`auth/refresh` 的 token 是打开原生界面所需的存在标记，**不作为鉴权凭据**；实际身份只取可撤销的 HttpOnly 校园会话 Cookie。游客使用 `provider=school-guest`，不会因为原生界面可打开而获得账号权限。

原生会话/消息树使用校园数据中的实际 ID；生成先 POST admission，返回 streamId/代次时间，再 GET SSE 订阅。累计回答事件来自实际存储的上游增量；重连从同一 SQLite 版本恢复，不另外复制正文。客户端请求 ID 按调用者唯一并验证内容指纹，重试 admission 不产生第二次执行。停止请求校验生成代次，禁止旧页面停止新任务。重新生成仍指向已保存的原始问题，版本切换通过校园 activate 接口保存活动分支。

原生模型选择器和 Marketplace 仅序列化已发布且用户组允许的智能体；不向浏览器发送工作流配置或凭据。校园首页内容和管理功能在原版路由/组件上增补，使用 `@librechat/client` 原生表格、表单、对话框、按钮和主题。上传、语音、MCP、模型/工作流编辑等非一期功能禁用。原生分享使用固定快照和选择消息之前的内容前缀；导出统一由服务端检查本人归属、登录和活动回答版本。

账号邮件链接使用原生 `/verify?email&token` 和 `/reset-password?userId&token` 页面；令牌仍只保存哈希，单次使用并有时限。构建脚本从最终 HTML 计算原版启动脚本 CSP 哈希，服务端只放行这些哈希，不开放任意内联脚本。

## 服务端基础（主开发）

`server/db.js` exports `db` (DatabaseSync), `all(sql,...params)`, `get`, `run`, `id(prefix='')`, `now()`, `parse(value,fallback={})`, `setting(key,fallback)`, `setSetting(key,value)`, `transaction(fn)`。`server/security.js` exports `encrypt`, `decrypt`, `audit(req,action,target,details={})`, `requireUser`, `requirePermission(name)`, `canUseAgent(identity,agent)`, `publicAgent(agent)`。请求 `req.identity={id,type:'user'|'guest',groups:string[],user?:{id,email,name,role,permissions:string[]},guestId?:string}`。`req.user` 同 user，`req.guestId` 当前浏览器原游客ID。`HttpError(status,message,code)` 来自 security.js。

表：users(id,email,name,password_hash,role,permissions JSON,active,email_verified,session_version,created_at)，groups(id,name,agent_ids JSON,content_keys JSON)，user_groups(user_id,group_id)，guests(id,token_hash,created_at,last_seen)，agents(id,name,avatar,description,category,questions JSON,sort_order,recommended,published,homepage_visible,integration_id,created_at)，integrations(id,name,platform,base_url,app_id,secret JSON加密,config JSON,capabilities JSON,created_at)，settings(key,value JSON)，audit_logs(id,actor_id,action,target,details JSON,created_at)，sessions和email_tokens。聊天模块自建其他表。

设置 `homepage` 为包含 schoolName,platformName,logo,themeColor,welcome,subtitle,announcements[],banners[],questions[],faq[],help,contact,footer,modules{} 的对象；每条内容可含 groups[]；空 groups 表示全部。`registration` 为 requireEmailVerification=false（新库及首次升级默认关闭）；开启时未验证账号不可登录，不撤销已有会话。`retention` 为 guestBrowserDays=7,guestServerDays=180,usageDays=180,auditDays=180,shareDays=7；`defaults` 为 guestGroupId='guest',userGroupId='member'。`smtp` 为 host,port,encryption('starttls'|'tls'|'none'),from（完整邮箱或名称加邮箱）,username,password(加密)。

前端 API：GET /api/bootstrap => {user:null|{id,email,name,role,permissions},guestMigrationCount,homepage,agents:[],retention:{guestBrowserDays},development:boolean}; GET /api/agents/:id；POST /api/auth/register {email,name,password}；POST login {email,password}；POST logout；POST forgot-password {email}；POST resend-verification {email}；POST verify {token}；POST reset-password {token,password}。注册返回 message、mailSent、verificationRequired；免验证时 mailSent=false、verificationRequired=false，前端提示可直接登录。密码找回始终走 SMTP。登录返回 user,migrationCount。原生 /api/librechat 别名遵循相同策略，启动配置 emailEnabled 表示是否要求注册验证。

管理 API GET /api/admin/overview；GET/POST /api/admin/users；POST /api/admin/users/import {rows:[{email,name,password,groupIds?}]}；PATCH /api/admin/users/:id {name,active,role,permissions,groupIds}；POST /api/admin/users/:id/reset-password；GET/POST /api/admin/groups；PATCH/DELETE /api/admin/groups/:id；GET/POST /api/admin/agents；PATCH/DELETE /api/admin/agents/:id；GET/POST /api/admin/integrations；PATCH /api/admin/integrations/:id；POST /api/admin/integrations/:id/test（聊天模块）；GET /api/admin/settings => {homepage,registration,retention,defaults,smtp}；PUT /api/admin/settings/:key；POST /api/admin/smtp/test {to}；GET /api/admin/audit；GET /api/admin/permissions。权限名称 users,groups,agents,integrations,credentials,homepage,settings,statistics,logs,conversations,content_view,content_export,cleanup,feedback,audit。只有超管可修改 role/permissions 和管理员组；普通管理员不能修改自己及其他管理员、授权组或默认组。

## 聊天模块（独立开发）

`server/chat.js` exports `chatRouter` mounted /api；`initChatSchema()`；`runRetention()`。`server/adapters/*` 独立纯调用层。先依基础契约实现；测试放 tests/chat*.test.js / adapters*.test.js。

GET /api/conversations?q=&agentId= => array；POST /api/conversations {agentId,title?}；GET /api/conversations/:id => conversation含 messages，每条用户消息含 versions:[{id,content,status,...}],activeVersionId；PATCH /api/conversations/:id {title}；DELETE 隐藏并撤销分享。
POST /api/conversations/:id/messages {content} => SSE；POST /api/conversations/:id/messages/:messageId/regenerate {} => SSE；POST /api/conversations/:id/messages/:messageId/activate {versionId}；POST /api/answers/:versionId/stop；POST /api/answers/:versionId/feedback {rating:1|-1|0,text}。SSE data JSON事件 {type:'start',messageId,versionId,invocationId} / {type:'delta',text} / {type:'progress',message} / {type:'done',status,versionId,message?} / {type:'error',error,code}。

POST /api/guest/migrate {consent:boolean}，身份取 req.guestId；GET /api/conversations/:id/export?format=md|pdf|png；POST /api/conversations/:id/shares {days?}=>{id,url,expiresAt}；GET /api/conversations/:id/shares；DELETE /api/shares/:id；GET /api/shares/:id（公开快照）。导出模块可委托主开发实现，需要 chat module 导出 `snapshotConversation(conversationId)` => {title,messages:[{role,content}]}；保留活动版本。

管理：GET /api/admin/usage?from=&to=&agentId=&userType=；GET /api/admin/statistics 同筛选；GET /api/admin/conversations?userType=&agentId=&q=&from=&to=（不含正文，按 conversations 权限）；GET /api/admin/conversations/:id（content_view）；GET /api/admin/conversations/:id/export?format=（content_view+content_export）；POST /api/admin/conversations/purge {ids,confirm:true}（cleanup）；GET /api/admin/feedback?status=；PATCH /api/admin/feedback/:id {status,notes}；正文权限不足时反馈不返回正文。

开发适配器仅 ENABLE_DEMO_ADAPTER=true 且 NODE_ENV!=production；醒目标记。Dify Chatflow 使用 fresh会话+完整活动历史重放策略防止分支污染，Workflow必须有history字段才能多轮，Polymas按官方文档实现助手/工具V2与网关凭据，实际应用待联调，远程停止降级local_only。测试连接独立计次且能力分项未知/实测。
