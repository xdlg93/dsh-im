# 插件发现索引站点

`docs/` 目录同时是这个仓库的文档目录和 GitHub Pages 站点根目录，DSH 的「插件 → 发现」从这里读取索引。

发布方式：**Deploy from a branch**，Branch `main`，Folder **`/docs`**（GitHub 的分支发布只允许
`/` 或 `/docs` 两种文件夹）。仓库不使用 `actions/deploy-pages` 工作流——在这个仓库上它一直报
“No artifacts named github-pages were found”，而分支发布不经过 artifact 服务，推送到 `docs/` 即自动重建。
`docs/.nojekyll` 让 Pages 跳过 Jekyll，`.md` 与 `.json` 原样发布，文件名不会被改写。

- `docs/index.json`：format 1 的插件市场索引，由 `npm run publish:index -- --commit <release-sha>` 生成，不要手改。
- `docs/icons/dsh-im.png`：索引条目引用的 256 px 图标。
- `docs/index.html`：给人看的落地页，说明索引地址与安装方式。
- `docs/pkg/dsh-im-<版本>.tgz`：当前版本的安装包，由 `npm run pack:release` 生成；给访问不了 github.com 的用户直链安装用。
- `docs/.nojekyll`：让 Pages 跳过 Jekyll，避免文件名被改写。

索引地址：<https://xdlg93.github.io/dsh-im/index.json>

索引里的版本用 `source.type: git` 固定到 commit，安装时 `pnpm` 会**直接 `git clone` github.com**，不经过 npm 源也不吃 npm 的代理配置。网络受限的用户可以改用同一版本的 tgz 直链：

```bash
dsh plugin --profile web add https://xdlg93.github.io/dsh-im/pkg/dsh-im-<版本>.tgz
```

发版流程：

```bash
# 1. 版本号与 CHANGELOG（package.json 的 version 决定 tgz 文件名）
# 2. 写 Release 正文（可选，但推荐）：docs/releases/<tag>.md
npm run build && npm run check
npm run pack:release              # 3. 生成 docs/pkg/dsh-im-<版本>.tgz
git add -A && git commit -m "feat: ..."   # 4. 提交代码与安装包
git tag -a v1.3.x -F <notes>      # 5. 打 tag
git push origin main v1.3.x       # 6. 推送：Release 工作流自动建 Release，Pages 自动重建
npm run publish:index -- --commit "$(git rev-parse v1.3.x)"   # 7. 写入索引
git add docs/index.json && git commit -m "chore: publish 1.3.x in the plugin market index"
git push origin main              # 8. 推送索引
```

### GitHub Release 由 Actions 发布

本地 DSH 没有 GitHub token，所以 Release 不手工创建，由 `.github/workflows/release.yml` 用 runner 自带的 `GITHUB_TOKEN`（`contents: write`）发布：

- **推送 `v*` tag 即自动建/更新 Release**，不需要任何本地 token；
- 正文取 `docs/releases/<tag>.md`（人工整理稿），文件不存在时用 GitHub 自动生成的变更说明；
- 附件自动上传 `docs/pkg/*.tgz`，并删掉名称不是 `dsh-im-<版本>.tgz` 的其他附件，保证一个 Release 只有一个安装包；
- 忘记先写整理稿、或想重发某次 Release：到 Actions 页面选 **Release → Run workflow**，填已有 tag 重跑即可（`workflow_dispatch`）。

注意 tag 必须在包含 `release.yml` 的提交上，否则 tag 推送不会触发该工作流。

<!-- pages retry 20261125T064505Z -->
