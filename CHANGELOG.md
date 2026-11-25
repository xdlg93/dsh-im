# Changelog

本文件只记录本 fork（[xdlg93/dsh-im](https://github.com/xdlg93/dsh-im)）的变更。上游 [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) 的历史版本记录不在此维护，需要追溯请查看上游仓库。

版本号遵循语义化版本；`1.0.0` 是本 fork 的起点，与上游 5.10.0 没有版本号对应关系。

## 1.0.0 — 2026-11-25

首个独立版本：基于上游 `@xmanrui/dsh-im` 5.10.0（MIT）裁剪，**只保留微信与 QQ 两个扫码通道**。

### 定位

- 通道收敛为两个：微信（腾讯 iLink 扫码登录）与 QQ（`@tencent-connect/qqbot-connector` 扫码授权 + `@tencent-connect/qqbot-nodejs` WebSocket）。
- 两个通道都以扫码为主路径接入，不再维护其他平台的手工凭据表单、App Manifest、权限补全与平台专属卡片。
- 包名改为 `@xdlg93/dsh-im`，插件 id 改为 `xdlg93-dsh-im`，仓库迁移到 [xdlg93/dsh-im](https://github.com/xdlg93/dsh-im)。
- 保留上游署名与 MIT 许可：`LICENSE` 原样保留上游版权声明，`THIRD_PARTY_NOTICES.md` 继续列出仍在使用的第三方组件。

### 移除

- 删除飞书／Lark、企业微信、企业微信自建应用、钉钉、Telegram、WhatsApp、Slack、Discord、Matrix、iMessage、邮箱（Agent Mail）、AI Office Connector 的 Host 通道、客户端设置页、测试与构建入口。
- 删除仅服务于上述通道的依赖与代码路径：Lark Node SDK、WeCom aibot SDK、`dingtalk-stream`、`@matrix-org/olm`、Baileys、`imapflow`、`mailparser`、`nodemailer`、`https-proxy-agent`、`@tencent-qqmail/agently-cli`。
- 删除仅属于上述通道的设计文档（`docs/` 与 `docs/方案/` 下的飞书、Telegram、WhatsApp、Slack、Discord、Matrix、钉钉、企业微信、邮箱、AI Office、Webhook 方案与实测记录）。

### 保留并继续维护

- 微信：扫码登录（含手机端数字配对码）、iLink 长轮询、正在输入提示、1,800 字符分段、图片与文件收发、主动投递所需的 `context_token` 缓存。
- QQ：扫码授权创建／绑定机器人、WebSocket 长连接、群聊 @ 触发、Markdown 回复、按钮与数字菜单、文件上传配额错误提示。
- 两个通道共享的能力：多机器人独立管理、账号别名、工作区绑定与目录选择器、模型与思考强度、Agent Preset、上下文增强、私聊／群聊访问策略与命令权限、会话绑定与 `/session` 系列命令、会话标题渠道前缀、群聊记录（QQ）、排队与插话、交互式提问与远程审批、延迟交付（超时补结果）、图片输入与结果文件回传、主动投递（HTTP / `ctx.dshIm` / Connection RPC）、侧边栏面板与 `dshImClient` 客户端服务、检查更新。
- 多语言：机器人消息、命令帮助与设置页支持简体中文、English、Русский，跟随 DSH 界面语言并即时切换。

### 文档

- `README.md` / `README.en.md` 按「微信 + QQ」重写，结构对齐、内容一致，覆盖支持矩阵、安装、两个通道的扫码步骤、共享能力、数据路径、常见问题与许可致谢。
- `PROACTIVE_DELIVERY.md` / `PROACTIVE_DELIVERY.en.md` 保留主动投递的结构与语义，删除其他通道的字段表、卡片与话题示例，示例改为微信／QQ。
- `CONTEXT.md` 改写为「仅微信 + QQ」的架构简述与领域词汇表。
- `THIRD_PARTY_NOTICES.md` 只保留仍在使用的第三方组件声明。

### 修复

- **兼容 DSH 0.2.3-alpha.2（Cordis 4.2）**：Cordis 4.2 起，运行时上下文对未声明的属性访问会抛
  `cannot get property "root" without inject`，而根上下文改为通过 `Symbol(cordis.root)` 发布。
  上游代码里的 `ctx.root ?? ctx` 因此在 0.2.3-alpha.2 上直接让两个通道在「加载渠道配置」阶段失败
  （界面上表现为 `weixin-startup-failed` / `qq-startup-failed`，参考号 `WX-CONN-…`）。新增
  `plugin-src/host/host-root.mjs` 的 `hostRoot()`：优先读 `ctx.root`，否则按 symbol 解析根上下文，
  再退回当前上下文，五个调用点全部改为使用它。旧版本 Cordis 行为不变。

### 兼容性

- DeepSeek Harness `0.2.2-rc.5` 及以上（`package.json` 的 `engines.dsh`；已在 `0.2.3-alpha.2` 实测）。
- Node.js 22.19 及以上。
- 支持 `web` 与 `desktop` 两种运行 profile；从上游版本升级时，已有的微信／QQ 机器人、凭据、工作区与会话绑定不需要迁移，其他通道的配置目录不再被读取，可以手动删除。
