# 安全政策

SchoolAgent 目前为第一期开发版本，尚未完成真实学校环境的生产验收。安全修复优先针对 `main` 分支，不承诺旧快照的独立维护周期。

## 报告漏洞

请通过维护者邮箱 [scypolite@Outlook.com](mailto:scypolite@Outlook.com)私下报告，标题可使用 `SchoolAgent security report`。

请提供受影响的提交、复现步骤、影响范围及脱敏后的最小示例。认证、越权、密钥泄漏或聊天数据暴露请勿直接发布在公开 Issue 中；也不要发送真实用户密码、完整数据库或学校聊天记录。维护者与报告者确认后再协调公开披露。

## 运行边界

- 正式部署使用学校 HTTPS / 校内网 / VPN 入口，正确配置 `PUBLIC_URL` 和代理来源。
- API Key、SMTP 凭据由服务端保存；`.env`、`.secrets/`、数据库和备份不进入代码仓库。
- 开发适配器与 Mailpit 仅用于测试。正式环境不加载 `compose.dev.yml`。
- 实际依赖审计和未验证范围见[测试报告](docs/test-report.md)，不要将本机测试结果当作生产安全保证。
