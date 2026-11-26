# Changelog

本文件只记录本 fork（[xdlg93/dsh-im](https://github.com/xdlg93/dsh-im)）的变更。上游 [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im) 的历史版本记录不在此维护，需要追溯请查看上游仓库。

版本号遵循语义化版本；`1.0.0` 是本 fork 的起点，与上游 5.10.0 没有版本号对应关系。

## 1.3.3 — 2026-11-26

### 修复

- **手动更新命令改为 tgz 直链优先**：面板原来给的是 `git+https://github.com/...`，可它需要本机有 git，
  并且要能访问 github.com——Desktop/Windows 用户常常根本没装 git，或代理只覆盖浏览器。现在索引里带
  `tgz` 时，手动命令直接给
  `dsh plugin --profile <profile> add -w https://xdlg93.github.io/dsh-im/pkg/dsh-im-<版本>.tgz`，
  并注明「不需要 git，也不需要访问 github.com」；索引没有 tgz 时才回退到 git tag 形式。
- 快照新增 `latestTgz`，面板据此决定手动命令与提示。

### 说明

- 已经停在 1.3.1 的 Desktop 用户，一键更新仍会失败一次（1.3.1 没有 tgz 兜底），用上面的 tgz 命令手动装到
  1.3.2+ 之后，后续更新就会自动走 tgz 兜底。

## 1.3.2 — 2026-11-26

### 新增

- **一键更新支持 tgz 兜底**：索引里每个版本现在除了 git commit 还带一个 `tgz` 直链（`docs/pkg/dsh-im-<版本>.tgz`，
  市场解析器会忽略这个非标准字段，只有本插件的更新器读它）。更新时：
  - 从 git 安装的 profile 先试 git，**失败后自动改用同版本的 tgz 直链**；
  - 从 tgz 安装的 profile 直接用 tgz，不浪费一次 git 尝试；
  - 只有网络类失败（`install-failed` / `install-timeout`）才切换通道，版本或状态问题仍然直接报错。
- 面板新增「安装方式」一行（git / tgz 直链），切换通道时提示「git 不可达，本次已改用 tgz 直链安装」。

### 变更

- `update-runtime` 新增 `installChannelOf()`，把 profile 里的依赖声明归类为 registry / git / tgz / local，
  `sourceInstall` 只对 local 生效（tgz 安装同样可以原地更新）。

## 1.3.1 — 2026-11-25

### 修复

- **网络受限时安装失败**：索引里的版本用 `source.type: git` 固定 commit，安装时 `pnpm` 会直接
  `git clone github.com`——这一步不经过 npm 源，也不吃 npm 的代理配置，国内直连会
  `Recv failure: Connection was reset`。现在提供两条不需要 npm 账号的路径：
  - 文档写清 git 代理的两种设置方式（给 DSH 进程设 `HTTPS_PROXY`，或 `git config --global http.proxy`），
    并说明 git 子进程会继承代理变量；
  - 每个版本都在 `docs/pkg/` 留一份 `dsh-im-<版本>.tgz`，可用
    `dsh plugin --profile web add https://xdlg93.github.io/dsh-im/pkg/dsh-im-<版本>.tgz` 直链安装，
    完全不碰 github.com。
- **面板报错更具体**：安装失败时提示 git 需要访问 github.com，给出 `HTTPS_PROXY` /
  `git config --global http.proxy` 的具体做法与 tgz 兜底命令，不再只说「安装失败」。

## 1.3.0 — 2026-11-25

### 新增

- **一键更新走插件索引，不再依赖 npm**：更新检查改为读取本仓库发布的插件索引
  （`https://xdlg93.github.io/dsh-im/index.json`），挑出**当前 DSH 版本能激活**的最新版本，按索引里固定的
  git commit 安装（`pnpm add -w git+https://github.com/xdlg93/dsh-im.git#<commit>`）。索引不可达时才回退到 npm。
  索引不可达、内容无效、没有兼容版本分别有独立的错误码与提示（`index-unreachable` / `index-invalid` /
  `no-compatible-release`），不再笼统报「无法访问 npm」。
- **git 安装的插件现在可以原地升级**：以前只要是非 registry 安装就判定为「源码安装」并禁止更新；现在指向本仓库的
  git 依赖被视为可升级，只有 `link:` / `file:` / `workspace:` 这类本地来源才拦住自动更新。
- **更新面板显示进度与来源**：安装中显示「正在下载并安装」+「已用时 N 秒」，校验中显示「正在校验安装结果」，
  新增「更新来源」（插件索引 / npm）一行；手工更新命令改成可用的 git 形式
  （`dsh plugin --profile web add -w git+https://github.com/xdlg93/dsh-im.git#v1.3.0`）。

### 修复

- **「目标 profile 无法确认」**：`--profile` 或 `dsh web` 这种启动方式之外（systemd、包装脚本、Desktop），
  原来会直接判定 profile 未知。现在依次回退：启动参数 → `DSH_PROFILE` → 插件自身安装路径
  （`<home>/profiles/<name>/node_modules/@xdlg93/dsh-im`），仍然未知才报 `unknown-profile`，不会猜工作目录。

## 1.2.3 — 2026-11-25

### 修复

- **默认工作区会「漂移」**：1.2.2 之后 `ctx.get('workspaceRegistry')` 能读到列表了，但插件把**第一个**
  已注册工作区当锚点。插件自己创建的目录（`~/.dsh/im`、`~/.dsh/dsh-im`）也会被注册成 DSH 工作区，
  于是下一次启动就锚到它上面，默认值再往上一级挪一层：`/home/xdl/.dsh/im` → `/home/xdl/.dsh/dsh-im`，
  用户真正的 DSH 工作区反而被忽略。现在锚点会跳过**DSH home 下的目录**与**名为 `dsh-im` 的目录**，
  只用读者自己的工作区。
- **已有机器人自动跟上新默认值**：`BotWorkspaceStore.relocateLegacyWorkspaces()` 在启动时把仍指向
  插件曾经自选目录（`$DSH_HOME/im`、`$DSH_HOME/dsh-im`）的机器人改到当前默认值，**保留会话绑定**，
  读者自己选过的目录一律不动。

## 1.2.2 — 2026-11-25

### 修复

- **同级默认工作区没有生效**：1.2.0/1.2.1 用 `ctx.get('workspaceRegistry')` 读 DSH 工作区列表，
  但 Cordis 4.2 的 `ctx.get()` 只回答**本 fiber 声明过**的服务，插件当时只 inject 了
  `connection`/`credentials`/`typertGateway`，于是永远读到空列表，回落到 `$DSH_HOME/im`——机器人
  实际写进了 `~/.dsh/im`，侧边栏出现的也是「im」工作区而不是「dsh-im」。
  现在 `workspaceRegistry` 加进插件的 `inject`，`ctx.get()` 能拿到列表；同时服务读取改成
  `ctx.get()` 与属性访问双路，兼容注入子上下文。
- 顺带修了 1.2.1 的注册顺序：`workspaceController.create()` 只接受已存在的目录，插件现在先
  `mkdir -p` 再注册。

## 1.2.1 — 2026-11-25

### 修复

- **默认工作区现在会注册成 DSH 工作区**：1.2.0 只是把机器人目录建在 DSH 工作区旁边，但没有在
  `workspaceRegistry` 里登记。DSH 只显示已注册的工作区，所以那个目录在侧边栏看不到，里面的会话历史也
  读不出来。现在插件在启动时（每个通道创建生产控制器之前）调用一次
  `workspaceController.create({ path })`，目录不存在就先创建；已注册则跳过，Host 没有工作区服务
  （headless / CLI）时安静跳过。

## 1.2.0 — 2026-11-25

### 变更

- **默认工作区改为「与 DSH 工作区同级」的 `dsh-im` 目录**：机器人会产生文件，之前默认写进 `$DSH_HOME/im`
  （即 `~/.dsh/im`），和用户的 DSH 工作区没有关系，也不方便在同一个父目录里找到。现在从 Host 的
  `workspaceRegistry` 取已注册工作区，取第一个工作区的父目录并创建同名 `dsh-im` 子目录——例如 DSH 工作区是
  `/home/me/DSH/workspace`，默认工作区就是 `/home/me/DSH/dsh-im`。机器人文件因此不会落进用户自己的工作区，
  两者又在同一个父目录下并排可见。
- Host 没有注册任何工作区（headless / CLI）时保持原行为，回落到 `$DSH_HOME/im`；显式配置的
  `workspace`（按通道：`weixin.workspace` / `qq.workspace`）仍然优先于默认值。
- 已绑定机器人的既有工作区不会被自动改写：升级后新机器人使用新默认值，老机器人继续用它已保存的目录，
  需要迁移时用 `/workspace` 命令或在设置页改。

## 1.1.0 — 2026-11-25

### 新增

- **微信主动推送**：iLink 只在会话有效期内接受发送，过期后返回 `errcode -14`（`session timeout`），
  客户端无法自行续期。现在这类消息不再丢失：写入账号状态的持久化队列（`outbox`，保留 7 天、
  每账号最多 50 条），并返回 `{ sent: false, queued: true, reason: "session-timeout", pending }`；
  对方下次给机器人发消息时按顺序自动投递并刷新 `context_token`。多段发送中途被拒时只把剩余段入队，
  已送达的段不重发。其他拒发原因（如 `-2 prepare failed`）仍然直接报错，不被排队掩盖。
- **两个 Agent 工具**：`dsh_im_targets` 列出当前 profile 的投递目标（botId、channel、targetId、
  name、kind、route），`dsh_im_send` 向指定 `botId + targetId` 推送文字，可选 `format`。
  返回值区分 `delivered: true` 与 `queued: true`，并在系统提示里要求助手不要把排队说成已送达。

### 变更

- 投递链路（`target.send`、`target.test`、会话同步镜像）会把 `queued` 原样上报，不再把它压成 `sent: true`；
  微信投递页显示平台限制说明，测试按钮在排队时提示“会话已超时，已排队”。

## 1.0.1 — 2026-11-25

### 修复

- **更新面板不再被上游遗留的更新记录卡住**：更新状态目录按 profile 而不是按包名寻址，所以从上游
  `@xmanrui/dsh-im` 换过来后，目录里还留着一条 `restart-required` 的旧记录（目标 `4.39.0`、
  来源 `4.25.0`）。本包从未发布过这些版本，界面因此显示「插件安装状态已发生变化」与
  「上次安装结果无法确认」，并挡住后续检查。现在每条更新记录都带 `packageName`，读到属于其他包的
  记录（或没有该字段的旧记录）会连同锁文件与回滚快照一起清掉，而不是当作中断的安装上报。
- **兼容性说明改成这个 fork 的版本线**：面板原来列的是上游的 `4.25.0 / 4.39.0 / 5.0.0 / 5.10.0`
  对照表，现在改为 `1.0.0 起支持 DSH 0.2.2-rc.5 及以上（0.2.x 全系列）`、`已在 0.2.3-alpha.2 修复
  Cordis 4.2 根上下文兼容`、`未发布到 npm 时不会自动更新，请用 git 重新安装`，中／英／俄同步。

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
