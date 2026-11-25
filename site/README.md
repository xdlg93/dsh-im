# 插件发现索引站点

这个目录由 GitHub Pages 原样发布，供 DSH 的「插件 → 发现」读取。

- `index.json`：format 1 的插件市场索引，由 `npm run publish:index -- --commit <release-sha>` 生成，不要手改。
- `icons/dsh-im.png`：索引条目引用的 256 px 图标。
- `.nojekyll`：让 Pages 跳过 Jekyll，避免文件名被改写。

索引地址：<https://xdlg93.github.io/dsh-im/index.json>

发版流程：

```bash
git tag -a v1.0.x -F <notes>      # 1. 打 tag
git push origin main v1.0.x       # 2. 推送
npm run publish:index -- --commit "$(git rev-parse v1.0.x)"   # 3. 写入索引
git add site/index.json && git commit -m "chore: publish 1.0.x in the plugin market index"
git push origin main              # 4. 推送后 Pages 自动部署
```
