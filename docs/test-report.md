# 测试与交付报告

最近补充：2026-11-10，注册策略、SMTP 发件人和首页布局；历史部署验收范围仍分别保留。

日期：2026-11-05，Asia/Shanghai。开发轮完成本机非 Docker 验证；用户随后授权更新既有 Docker 服务，该单机增量更新及检查已完成，见 [Docker 更新记录](docker-update.md)。一个 Polymas 高级编排应用已完成真实上架与问答；其他应用、校内 Dify、学校 SMTP、VPN/HTTPS 与微信真机不在已通过范围内。

## 2026-11-10：注册验证、SMTP 发件人和首页布局

本轮在一次性本地 SQLite 库、真实生产前端和仅在回环地址收件的 SMTP 夹具上验证，未部署到线上服务。

- 后端 `npm test`：**97 / 97 通过**；覆盖默认免验证及已有数据库初始化、验证开关与权限、原生注册登录别名、重发、密码找回、一次性令牌、SMTP 鉴权/收件人/内容拒绝、凭据掩码与发件人格式。带名称的发件人已实际送达本地 SMTP 夹具。
- 前端专项：**9 个套件、106 / 106 通过**，包括注册、游客身份恢复、市场筛选/详情和校园组件。修复游客身份恢复将登录页跳回聊天页的问题，并验证不会提前消耗登录目标。
- 浏览器实际操作：后台验证开关保存/回显、SMTP 无效发件人提示、名称加邮箱保存、测试邮件实际收件；免验证注册后停留登录页并成功登录到 `/agents`。QQ 配置按钮填入 `smtp.qq.com / 465 / TLS`，发件人标签改为「发件邮箱地址」。
- 首页检查：0/1/2/6 张卡片、390px 手机和 1600px 桌面、浅色/深色；介绍、卡片及搜索容器对齐，无横向溢出。一张卡片占满内容区，两张等宽排列，FAQ 和页脚位于卡片之后；详情关闭后焦点回到原卡片。截图见本地 `artifacts/email-home-*.png`。
- QQ SMTP：使用与应用相同的 `smtpTransport().transport.verify()` 连接 `smtp.qq.com:465` 成功；另行完成 TLS 1.3、证书验证及 SMTP 欢迎响应检查。此探测没有使用授权码，没有认证或发送邮件。正式服务器网络、真实发信账号、收件箱投递和找回链接仍需真实环境确认。

生产客户端构建、完整客户端 `tsc --noEmit`、修改文件 ESLint 及源码变更清单一致性检查通过。最终三次有效冷启动的中位数：**LCP 1645ms / CLS 0.0136 / TBT 382ms**，低于原版预算 4500ms / 0.1 / 500ms，并核对保存正文为 LCP 及工具元数据接口正常。最终报告位于 `artifacts/performance-campus/attempt-2026-11-09T18-31-36-273Z/summary.json`。其中一次 Chrome 导航缺少 NavStart，由原运行器自动重试后取得三份有效报告；更早一次 TBT 超预算的报告也保留，不作为通过依据。

## 2026-11-05：真实 Polymas 应用上架

已完成一个高级编排应用的发布、网关接入、目录上架和指定默认组授权。发现并更正了应用 appCode 与其他 ID 混用的问题；传统助手路由普通 JSON 请求仍返回 HTTP 500，未将其记为已修复。正式 V2 路由返回 HTTP 200/SSE，其完成事件直接返回正文，补齐显式 `text` 映射兼容和问题内历史传递后通过真实调用。

修复后后端 **89/89**、校园前端 **16/16**、完整客户端类型检查、作用域 ESLint、生产客户端构建通过；功能提交 `681c65a` 的 CI 通过。候选镜像通过独立检查后更新原应用，数据、账号和密钥保持校验通过，应用与代理健康。

实际浏览器验证包括登录用户两轮学籍业务问答、游客宿舍维修问答和刷新恢复。落库回答、上游派发状态、日志终态及数据库完整性已核对。全过程与适用配置见 [上架流程](polymas-listing.md)。真实分支业务恢复、远端停止、全量业务准确性及容量未计入本次已通过范围。

## 2026-11-05：Polymas 与选择式后台

已读取授权登录后的官方文档，实现网关令牌签名/缓存、AES 参数加密、智能助手与工具 V2、历史和答案映射。后台沿用 LibreChat 原有组件，改用平台/模式/响应/变量选择器；首页内容逐项编辑、模块勾选、保留期限预设，并保留自定义值和其他原有高级配置。

客户端生产构建、客户端 `npx tsc --noEmit` 和改动文件 ESLint 通过。校园前端 4 个套件共 15 项通过；含新增表单凭据保持、跨平台清空、映射与自定义配置保留、显式测试调用、旧内容字段和自定义保留期限回归。浏览器实际新建/重开 Polymas 接入，确认密钥不回显；首页 FAQ 和模块保存后经 API 核对并恢复；390px 宽度无整页横向溢出。全部使用独立无界面浏览器。

最终构建 `2026-11-05T12:52:03.793Z` 的三次冷启动再次通过原版预算，中位数 LCP 1265.274ms、CLS 0.0204202、TBT 244.473ms；三次均以保存的对话正文为 LCP，无运行时错误。它使用本机 SQLite 和开发回答，不代表真实平台容量。构建绑定及安全摘要见 [polymas-test-evidence.json](polymas-test-evidence.json)，接入步骤见 [polymas-integration.md](polymas-integration.md)。

## 自动化结果

最近一次完整执行 `npm test`：87 项通过、0 失败、0 跳过，耗时 24.253 秒（原始 `duration_ms=24252.796`），本机原始日志为 `artifacts/polymas-backend-tests.log`。新增 Polymas 协议和本机 HTTP 网关夹具，不向真实云端应用发送业务请求。下文 11-04 的导出与原版界面实物证据保留其原有范围，不当作本轮重新执行。

覆盖文件与重点：

| 文件 | 已验证行为 |
| --- | --- |
| `tests/auth.test.js` | 未配置邮件时不谎报成功、邮箱验证、单次令牌、重置撤销会话、停用、受限管理员负向接口、跨站请求拒绝 |
| `tests/mail.test.js` | 真实本机 SMTP 收件、注册/重发/找回、令牌到期/重用、拒收/鉴权失败、后台配置加密与测试邮件。SMTP 夹具不转发互联网邮件 |
| `tests/polymas.test.js`、`tests/polymas-chat.test.js` | 网关签名/令牌缓存/并发获取/密钥轮换、AES 封装、两个接口、语义终态、错误脱敏；真实校园 Cookie 与本机 HTTP 网关协作、历史和日志落库，均为本地夹具 |
| `tests/admin.test.js` | 管理功能分权、目录选项脱敏、组成员及默认组保护、逐行导入、首页组范围/显隐、智能体隐藏/下架/撤权、凭据加密、保留预览与确认、审计无敏感正文 |
| `tests/adapters.test.js` | UTF-8 分片、SSE 进度/答案/审核替换、Chatflow 双终态、Workflow 映射、历史传递、取消接口/身份/终态、错误脱敏、生产禁止演示 |
| `tests/chat.test.js` | 对象归属、活动分支的准确上游历史、迁移拒绝/同意/幂等/失败回滚/忙碌重试、快照/过期/撤销、停止/断开/重启未知状态、正文清理、独立保留期限、调用口径及并发隔离 |
| `tests/backup.test.js` | 在线备份包含已提交 WAL；恢复必须声明离线，恢复前回滚快照保留 |
| `tests/export.test.js`、`tests/zip.test.js` | 中文/表格/电话链接、安全 HTML、连续编号分段、不完整 ZIP 失败退出 |
| `tests/librechat.test.js` | 完整最新 LibreChat 源码、构建入口、固定提交与完整 MIT 许可，不再以复制几个模块代表完整前端 |
| `tests/librechat-compat.test.js` | 原生生成请求、SSE/恢复、停止代次、真实重生成参数、分支、分享选定前缀、原生导出/搜索/删除及真实 Cookie 挂载 |
| `tests/librechat-startup.test.js`、`tests/librechat-preferences.test.js` | 游客界面与账号权限隔离、原生登录/失效、目录与模型组权限、邮件原生路径、收藏与置顶顺序按身份持久化 |

根目录校园后端依赖按官方 npm registry 审计为 0 个已知漏洞，旧前端依赖已从根目录移除。完整 LibreChat 的独立工作区审计为 0 高危、0 严重，仍有 10 低危和 42 中危报告，不能把根目录的零漏洞数字用于上游全体依赖。完整锁文件分别保留；原始报告在 `artifacts/npm-audit.json` 和 `artifacts/npm-audit-upstream.json`。高危传递依赖 follow-redirects 已使用兼容的 1.16.2 修复。

原版前端及原生协议专项检查分别记录，不把不同轮次、重叠范围的数量相加为一次全量结果；以下专项包含全量测试的重叠范围及前端独立回归：

| 检查 | 结果 | 实际范围与证据 |
| --- | --- | --- |
| data-provider 请求拦截器三个套件 | 38/38 通过 | `/api/librechat` 认证恢复不再等待自身的 Promise；错误密码不在认证恢复中反复重新提交 |
| 原生聊天 transport | 12/12 通过 | 原版入场/订阅路径命名空间、失败终态与队列生命周期 |
| 原生校园兼容接口 | 14/14 通过 | `tests/librechat-compat.test.js` 专项；可见祖先分支恢复后，导出/分享使用相同后续消息；禁用的原生工具调用历史对本人可见会话返回真实空数组，跨身份/隐藏/过期拒绝访问，不生成工具记录或调用统计；该数量独立于上面的 transport |
| 原生会话菜单 | 46/46 通过 | `client/src/hooks/Sharing/__tests__/useChatOptions.spec.tsx`；校园模式隐藏不支持的项目/复制继续入口，且不请求项目列表 |
| Markdown 电话与危险协议 | 8/8 通过 | `client/src/utils/__tests__/markdownUrl.test.tsx`；实际渲染 Markdown 表格内 `tel:` 链接，同时保留危险 URL 拦截 |
| 原版头像与服务端下载 | 14/14 通过 | `client/src/utils/__tests__/agents.spec.tsx`、`client/src/components/School/__tests__/download.test.ts`；配置表情头像、用户指定文件名、长 PNG 实际 ZIP 扩展名、管理下载文件名和权限拒绝 |
| 可见分支一致性 | 5/5 通过 | `client/src/components/School/__tests__/branch.spec.tsx`；祖先/用户兄弟节点按原生可见后代持久化，失败不提交界面分支，排队切换保持最后成功分支 |
| 历史智能体模型归一化 | 3/3 通过 | `client/src/utils/__tests__/buildDefaultConvo.campus.spec.ts`；已拥有的历史不被另一在架模型替换，新草稿仍限授权目录，其他原版端点不受影响 |
| 原版公开分享页 | 13/13 通过 | `client/src/components/Share/ShareView.spec.tsx` 与 `client/src/components/Share/ShareView.highlight.spec.tsx`；校园快照隐藏继续聊天，保留原生标题/设置；现有高亮配置继续通过；最终生产公开页已复验日期及只读入口 |

以上前端回归文件路径相对于 `upstream/LibreChat/`。可见分支与模型归一化专项的结构化结果为 [`artifacts/native-branch-normalization-tests.json`](../artifacts/native-branch-normalization-tests.json)，其中两个套件共 8 项通过。校园聊天 14 项与原生兼容接口 13 项的独立运行摘要见 [`artifacts/native-chat-test-evidence.json`](../artifacts/native-chat-test-evidence.json)：27/27 通过、10.102 秒；该文件标明它是观察运行后的摘要，不冒充原始测试运行日志。浏览器文字反馈与活动分支的只读数据库核对见 [`artifacts/native-branch-feedback-evidence.json`](../artifacts/native-branch-feedback-evidence.json)，仅记录标识、状态和反馈长度，不包含聊天/反馈正文。

data-provider 类型检查已通过。最新客户端完整类型检查退出码为 0，覆盖历史模型归一化、可见分支和公开分享入口条件；记录为 `artifacts/librechat-client-typecheck.log`（无诊断输出），增量检查状态文件为 `artifacts/librechat-client-verification.tsbuildinfo`。其后的深色标题修正仅调整原版语义颜色类，已通过作用文件 ESLint/格式检查。构建成功没有被用来替代类型检查。`packages/chat` 原版类型检查仍有两处未修改测试导入错误，原因是本次选定前端工作区未安装仅该上游测试依赖的 `@librechat/agents` 及其子路径；没有忽略或改写成“全部类型检查通过”。日志在 `artifacts/librechat-chat-typecheck.log`。

## 导出实物

使用仅监听本机的开发服务、独立 `artifacts/qa.sqlite`、随机生成的测试账号及包含 90 节中文正文的会话，实际通过 HTTP 导出接口生成：

| 格式 | 结果 |
| --- | --- |
| Markdown | 40,661 字节；角色顺序、表格、末尾标记保留，旧回答版本排除 |
| PDF | 25 页；中文可提取、90 个电话链接、最终完整性标记存在；已渲染并目视检查首页和末页的表格/文字 |
| PNG | 返回有效 ZIP，2 张图：1100×16000 与 1100×7777，总高 23777 像素；尾部裁图可见第 90 节和最终标记 |

同时通过游客导出 401、公开分享固定内容读取、撤销后 404 检查。文件及预览位于忽略目录 `artifacts/exports/`，摘要为 [export-test-evidence.json](export-test-evidence.json)。这是 Windows 本机 Chrome 实测；Docker Chromium 和学校服务器导出仍需按部署环境复验。

## 20 路本地协议检查

本地 Dify HTTP/SSE 协议夹具下，20 个不同游客同时执行，20/20 完成。断言独立调用 ID、上游用户、浏览器归属、对应回答、首段/完成时间持久化；没有用空闲连接替代请求。一次完整测试运行记录的首段为 58～81ms、完成为 59～82ms、进程 RSS 105,308,160 字节。

夹具没有执行真实模型或学校工作流；上述数字不能作为真实平台容量、业务正确率或学校网络延迟。单独专项记录见 [chat-test-evidence.json](chat-test-evidence.json)；不同次本机执行的时序会不同。真实 20 路验收仍需要实际发布应用及可控上游容量，并与学校确认成功率/响应时间阈值。

## 界面与构建

运行前端已完全替换为官方 `librechat-dev:latest` 对应的完整源码，固定提交 `f4154b649efa37e1345ccc517a4d8d1ed2178c82`（v0.8.9-rc1），修改清单见 `third_party/librechat-latest/changes.json`。`npm run build` 实际编译原版共享工作区和全部客户端，原自制页面已归档并退出入口。保留原版导航、聊天树、输入器、目录、分享/导出对话框和主题；校园管理使用同一原版组件库。

本期为在线校园应用，在原版 `vite.config.ts` 将 `VitePWA.injectRegister` 设为 `false`，不再自动注入 Service Worker 注册脚本；没有替换原版 UI，也没有放宽性能预算。决策及对照观察详见 [在线客户端与 Service Worker](online-client-service-worker.md)。

最终复验对应生产构建时间 `2026-11-04T07:50:19.658Z`，本地变更清单SHA-256为 `bca5ce164b2e8e1422f3bedfb706476b979cebab6e6a21b6f7f6d770d0b0255a`。安全汇总、与构建绑定的截图和排除范围见 [原生界面证据](native-ui-test-evidence.json)。

当前无拦截、无故障注入的生产浏览器会话 `school-finalqa` 在该构建后保持可交互，已通过真实页面操作观察到：

| 当前浏览器操作 | 已见结果与边界 |
| --- | --- |
| 游客原生聊天 | 能提问、接收回答、显示 Markdown/表格；基于本地测试服务/适配器，不是正式校园模型验收 |
| 重新生成与版本切换 | 保留旧版本并能切换，后续问题显示在所选分支；活动分支只读数据库证据另行保存 |
| 文字反馈 | 原生界面提交成功，SQL 已持久化并关联实际回答版本；数据库证据不输出正文 |
| 游客导出 | 点击导出进入原生登录页，未赋予游客账号导出权限 |
| 普通账号登录与游客迁移 | 测试普通账号通过真实登录接口登录；显示迁移选择，明确确认后能看到迁入历史，没有自动合并；退出后账号历史不出现在游客视图 |
| 管理入口与首页保存 | 超管从原版账号菜单进入校园管理，12 个模块入口展示；原版 OGDialog 修改欢迎语后保存、重开正确回显，并已通过界面恢复原值保存。此项不代表全部后台表单操作均已验收 |
| 创建公开分享 | 登录账号在原生分享框选择 1 天并创建成功；公开正文完整显示两轮分支，顺序正确。最终生产构建已复验日期为2026年11月4日、无 Invalid Date，继续聊天入口已消失；截图 `artifacts/native-share-public-final.png` |
| 登录后原生 Markdown 下载 | 原版导出对话框输入自定义名称 `native-download-long` 后，普通界面点击产生 Chrome `completed` 下载，实际文件 40,661 字节；与既有 HTTP 长会话 MD 的 SHA-256 完全相同。PDF/PNG 仍仅有 HTTP 实物证据，未宣称对应 UI 下载已通过 |
| 手机视口与安全链接 | 390×844 视口下，管理页和 90 节长会话的页面宽度均为 390，无整页横向溢出；长会话 DOM 中有 90 个 `tel:` 链接、0 个 `javascript:` 链接。截图为 `artifacts/native-admin-mobile.png`、`artifacts/native-chat-mobile.png`，不代替微信真机拨号验收 |
| 原版主题切换 | 原版 General 设置成功切换 light，截图 `artifacts/native-marketplace-light.png`；原账号菜单的管理链接实际指向 `/school/admin`。深色管理标题已补原版 `text-text-primary` 继承，最终桌面/手机截图目视通过；标题深色为rgb(236,236,236)、浅色为rgb(33,33,33)，截图 `artifacts/native-admin-desktop-final.png`、`artifacts/native-admin-mobile-final.png` |

原生 MD 下载文件为 [`artifacts/exports/native-download-long.md`](../artifacts/exports/native-download-long.md)，SHA-256 为 `41C41B3F8325B145624426FFAED52B6B7649D2C8FA3ABE96C53314CEED289944`，本次已直接核对它与 `artifacts/exports/long-conversation.md` 的文件长度及哈希。早先 CLI 的 `Download was canceled` 已与 agent-browser 0.39.4 的 Windows 路径规范化问题区分：该工具把 verbatim 路径传给 Chromium 下载设置，上游记录了同类问题（[issue 1659](https://github.com/vercel-labs/agent-browser/issues/1659)）。本次只通过同一浏览器 CDP 将下载目录设为普通反斜杠路径，再普通点击原生按钮完成下载；未修改产品导出代码来绕过工具问题。

首次原版生产冷启动 Lighthouse 的 `PAGE_HUNG` 原始失败继续保留在 `artifacts/performance-campus/`，未覆盖成成功结果。认证刷新自等待、可见分支与旧模型归一化是已发现并分别修复的缺陷；**没有证据证明认证自等待是 renderer 无响应或首次 PAGE_HUNG 的唯一根因**。关闭自动注册后的当前会话持续响应也只是已见事实，不能替代三次全新浏览器的 Lighthouse 冷启动门禁。

最终生产构建的公开分享日期/只读入口、深色标题桌面/手机可读性复验已通过，三次冷启动结果见下一节。其他后台功能的自动化/API证据与本轮具体页面操作分别记录，不将 12 个菜单入口可见或首页保存通过等同于每个管理表单都做过手工验收。原生复制按钮可以点击，但 Chrome 对实际剪贴板读取返回 `NotAllowedError`，一次授权后仍拒绝，因此未宣称剪贴板内容已核验；PDF/PNG 原生浏览器下载尚未单独验收。第二台真实设备、微信内置浏览器与学校网络边界仍未验收。现阶段不据此宣称全部一期功能或生产部署验收完成。

## 最终生产构建冷启动

采用上游原版 Lighthouse runner，在停止构建、类型检查与手工浏览器后，对最终客户端和学校后端执行三次全新浏览器冷启动。三次均无 runtimeError，最终 URL 保持已登录会话，实际保存的消息正文均为 LCP 元素。使用原版中位数预算，未提高阈值。

| 指标 | 三次中位数 | 原版预算 | 结果 |
| --- | --- | --- | --- |
| LCP | 1919.266ms | ≤4500ms | 通过 |
| CLS | 0.013600 | ≤0.1 | 通过 |
| TBT | 480.421ms | ≤500ms | 通过 |

摘要见 [performance-test-evidence.json](performance-test-evidence.json)，逐次数据和接口核验见 [performance-contract-evidence.json](performance-contract-evidence.json)。三次 TBT 分别为 563.597、460.564、480.421ms，第一次数值高于 500ms；通过结论依据原版的三次中位数预算，不能表述为每一次均低于阈值。每次原生工具调用历史只发出一次请求并返回 200，无重试，三次报告内 API 错误均为 0。

原始三个 JSON/HTML 报告位于 `artifacts/performance-campus/attempt-2026-11-04T08-00-05-160Z/.lighthouse/`，认证头已脱敏；此前 `PAGE_HUNG` 失败和修正前已通过的另一次测量均保留在各自独立目录。该场景使用本机 SQLite、测试账号和明确标记的开发回答，不包含上游 Mongo 延迟注入，也不代表真实 Dify/Polymas 延迟、学校服务器容量、微信真机或 Docker 性能。检查后已关闭本轮浏览器和临时 QA 服务。

## 部署与正式接入边界

- Dockerfile、Compose、私有入口、HTTPS/SSE、日志脱敏、管理员初始化、备份恢复及清理策略已提供；既有 Docker 增量镜像更新、健康状态、数据保持及只读容器 PDF/PNG 检查已通过。完整 Dockerfile 从零构建未完成验收，详见 [更新记录](docker-update.md)。
- 已按用户要求检索公开文档，记录见 [public-api-research.md](public-api-research.md)。Dify 官方协议已有契约测试；校内实例地址/版本/变量仍未知。
- Polymas 一个高级工作流的真实学校网关授权、V2 输入输出、登录用户追问和游客问答已验证；AES 密钥编码、其他应用及业务真值仍待各自联调。文档没有远程停止接口，只能本地停止。
- 正式 SMTP、真实微信、学校 VPN/HTTPS 和两个真实发布应用的业务验证仍需实际环境。
