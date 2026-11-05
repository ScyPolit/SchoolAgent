# 部署与运维

本手册涵盖 Docker、学校 HTTPS / VPN 入口、本地开发及备份恢复。2026-11-05 已完成既有单机 Docker 服务的增量更新及检查，见 [更新记录](docker-update.md)；从零构建和学校完整环境仍待验收。项目概览和本地演示见 [README](../README.md)。

## Docker 启动

需要 Docker Engine/Desktop 和 Docker Compose v2+。首次初始化可使用本机 Node.js 24，也可以用临时 Node 容器。

```sh
# 在项目根目录执行。生成唯一密钥，保留已有配置；不产生默认管理员密码。
node scripts/bootstrap.js

# 无本机 Node 的 Linux/macOS 服务器等效命令：
# docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:24-bookworm-slim node scripts/bootstrap.js

docker compose up -d --build
docker compose ps
docker compose exec app node scripts/init-admin.js
```

初始化管理员时交互输入邮箱、显示名称和至少 12 位密码；密码不回显。不能使用 `-T`，也不要把密码写在命令参数、脚本、镜像或仓库中。创建后访问 [本机入口](http://localhost:8080)，登录并打开管理后台配置学校内容和平台接入。初始管理员邮箱由操作者控制，初始化时标记已验证。重复运行初始化不会覆盖现有账号。

`.env` 和 `.secrets/encryption_key` 是本机敏感配置，已加入忽略规则；`bootstrap.js` 不会覆盖它们。数据库和备份分别放在 `school_data`、`school_backups` 命名卷。普通 `docker compose down` 保留数据；不要用 `down -v` 删除生产数据。

Linux 初始化把 `.secrets` 目录设为 `0700`、密钥文件设为 `0444`：父目录阻止其他主机用户遍历，单独挂载进容器的密钥文件允许应用 UID `10001` 读取。Compose 本地文件 secret 保留主机文件权限，不能只依赖 Compose 的 `uid/gid/mode` 字段。重跑初始化会修复这两个权限但不改变密钥；Windows 主机还应使用账户文件权限保护该目录。

## 学校正式部署

1. 把 `.env` 的 `PUBLIC_URL` 改成校内/VPN 下可访问的真实 **HTTPS** 地址，例如 `https://campus-agent.school.internal`，使邮件与分享链接使用同一来源。
2. 保留 `APP_BIND_ADDRESS=127.0.0.1`。在服务器安装学校 HTTPS 入口代理，参考 [nginx HTTPS 模板](../deploy/nginx.https.conf.example)，填写实际证书、域名和学校/VPN 来源网段。此时代理链为“学校主机 nginx → 容器 nginx → 应用”，在 `.env` 设置 `TRUST_PROXY_HOPS=2`，使认证防爆破按真实来源识别；只有容器 nginx 时保留 `1`。不能配置为无条件信任所有代理。默认模板仅允许回环；不能直接把示例网段当学校真实网段。
3. 生产仅执行 `docker compose up -d --build`。应用强制安全 Cookie、禁止模拟适配器、检查唯一加密密钥；普通浏览器通过 HTTPS 使用。默认回环 HTTP 入口只供本机诊断，其他设备不得依赖该地址。
4. 在管理员端配置并测试 SMTP，然后使用真实邮箱验收注册、验证及找回密码。邮件失败会返回失败状态，不能据界面存在判定发送成功。
5. 在平台接入配置中录入正式 Dify/Polymas 参数；多轮、真实输出增量、停止、分支和游客迁移能力分别联调后，再上架并授予用户组权限。Polymas 配置步骤见 [接入指南](polymas-integration.md)；缺少网关凭据或字段映射时会在业务请求派发前拒绝调用。
6. 校内电脑、手机、微信、校外未连 VPN、校外已连 VPN 分别验证；再按 [验收清单](acceptance.md) 进行 20 路真实请求测试。

容器 nginx 禁用了响应/请求缓存、gzip 和 SSE 缓冲。学校入口代理也必须保留这些设置，否则不能保证回答增量及时到达。应用端口没有发布到宿主机；应用容器使用独立出口访问 Dify、Polymas 和 SMTP。

应用镜像把 Chromium 的 `XDG_CONFIG_HOME` 和 `XDG_CACHE_HOME` 指向已有 `/tmp` tmpfs 下的专用目录。只读容器内浏览器需要可写的配置及缓存目录，否则 PDF/PNG 导出可能因 Crashpad 初始化失败而退出。2026-11-05 已在既有运行镜像的非 root、只读根文件系统、禁用网络及移除 capabilities 条件下复现该故障，并验证上述目录设置可以生成有效 PDF；该专项检查不等于从零构建或完整学校环境验收。

代理模板的安全访问日志只记录方法、脱敏路径、状态和流量，不记录查询串、Referer、Cookie、认证头或请求正文；分享路径也脱敏。验证/重置令牌位于链接查询串中，不要改回会记录完整请求的 combined 日志。代理错误日志仅保留 critical 级别，业务错误分类与管理审计由应用提供。

## 本地演示与邮件测试

```sh
docker compose -f compose.yml -f compose.dev.yml --profile mail up -d --build
docker compose exec app node scripts/init-admin.js
```

开发覆盖文件启用醒目标记的模拟器，并允许本机 HTTP Cookie。访问 [平台](http://localhost:8080) 和 [Mailpit 测试邮箱](http://localhost:8025)。首次空库会根据开发环境变量初始化 SMTP；已有数据库请在后台填写主机 `mailpit`、端口 `1025`、加密 `none`、发件人 `campus@example.test`，用户名和密码留空。这不是正式 SMTP 或外部 AI 验收；不要在学校生产部署中带入 `compose.dev.yml`。开发覆盖使用相同数据卷，正式上线应使用干净的数据卷或清理演示会话及测试账号。

## 备份与恢复

使用 SQLite 在线备份 API 获取包含 WAL 中已提交数据的一致快照；不要直接复制运行中的 `.sqlite` 文件。

```sh
docker compose exec app node scripts/backup.js /app/backups/school-agent-backup.sqlite
docker compose cp app:/app/backups/school-agent-backup.sqlite ./school-agent-backup.sqlite
```

将备份文件放入受控存储，同时**单独**备份匹配的 `.secrets/encryption_key`。丢失密钥会导致现有 API/SMTP 密文不可恢复。备份含聊天正文和账号数据，按学校数据权限管理；不要上传公开代码仓库。

恢复前先生成新备份，再停止应用，确保无进程打开数据库。恢复到新的主机时，先放好匹配密钥和 `.env`，把备份复制到 `school_backups` 卷，例如使用临时容器挂载或在服务仍运行时执行 `docker compose cp`。

```sh
docker compose stop proxy app
docker compose run --rm --no-deps app node scripts/restore.js /app/backups/school-agent-backup.sqlite --confirm-offline
docker compose up -d
docker compose ps
```

恢复脚本先执行完整性检查，保留恢复前数据库副本；`--confirm-offline` 表示操作者确认应用已停止。恢复后检查管理员登录、会话、密文解密、邮件和上游连接。应在备用卷/机器定期演练，不把“有备份文件”当作恢复验证。

## 开发与验证

```sh
npm ci
npm run install:client
node scripts/bootstrap.js
# 本地 .env 设置 NODE_ENV=development、COOKIE_SECURE=false、ENABLE_DEMO_ADAPTER=true
npm run dev
npm run build
npm test
```

Node.js 要求 24+（使用 `node:sqlite`）。`install:client` 安装真正 LibreChat 的选定前端工作区；`build` 编译上游共享包和完整客户端，把输出复制到根目录 `dist`；`dev` 运行同一个上游客户端和学校服务端。旧自制客户端已移至 `archive/legacy-client-v0.8.1`，不会被构建或提供给用户。

本机 PDF/PNG 导出若未配置系统 Chromium，可执行 `npx playwright install chromium`；生产镜像自带 Chromium 和中文字体。根目录依赖审计与上游工作区审计分别保存；上游当前没有高危/严重项，仍存在继承的低/中危开发依赖，见 [已知问题](known-issues.md)。测试覆盖范围与外部待办以交付时的 [验收清单](acceptance.md) 为准。

常用运维命令：`docker compose logs --tail=100 app proxy` 查看近期日志；`docker compose restart app` 重启应用；`docker compose build --pull` 更新基础镜像后重新验证。自动保留清理在应用中按配置周期执行，永久清理会删除正文，请先备份。单实例 SQLite 适用于本期规模，不要把同一 SQLite 文件通过网络文件系统挂给多个应用副本。
