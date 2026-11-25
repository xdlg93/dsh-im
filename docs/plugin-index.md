# 插件发现索引站点

`docs/` 目录同时是这个仓库的文档目录和 GitHub Pages 站点根目录，DSH 的「插件 → 发现」从这里读取索引。

发布方式：**Deploy from a branch**，Branch `main`，Folder **`/docs`**（GitHub 的分支发布只允许
`/` 或 `/docs` 两种文件夹）。仓库不使用 `actions/deploy-pages` 工作流——在这个仓库上它一直报
“No artifacts named github-pages were found”，而分支发布不经过 artifact 服务，推送到 `docs/` 即自动重建。
`docs/.nojekyll` 让 Pages 跳过 Jekyll，`.md` 与 `.json` 原样发布，文件名不会被改写。

- `docs/index.json`：format 1 的插件市场索引，由 `npm run publish:index -- --commit <release-sha>` 生成，不要手改。
- `docs/icons/dsh-im.png`：索引条目引用的 256 px 图标。
- `docs/index.html`：给人看的落地页，说明索引地址与安装方式。
- `docs/.nojekyll`：让 Pages 跳过 Jekyll，避免文件名被改写。

索引地址：<https://xdlg93.github.io/dsh-im/index.json>

发版流程：

```bash
git tag -a v1.0.x -F <notes>      # 1. 打 tag
git push origin main v1.0.x       # 2. 推送
npm run publish:index -- --commit "$(git rev-parse v1.0.x)"   # 3. 写入索引
git add docs/index.json && git commit -m "chore: publish 1.0.x in the plugin market index"
git push origin main              # 4. 推送后 Pages 自动重建 docs/
```

<!-- pages retry 20261125T064505Z -->
