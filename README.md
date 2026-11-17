# MarkVault 文档站

这个分支只存放 MarkVault 文档站的静态文件，由 GitHub Pages 直接发布到 <https://xinmang.github.io/MarkVault/>，与 `main` 分支没有共同历史。

- `index.html`：产品介绍页
- `api.html`：接口文档（Agent REST API、MCP、应用接口）
- `assets/`：样式、脚本与截图
- `media/markvault-intro.mp4`：介绍视频，与 `main` 分支的 `docs/media/markvault-intro.mp4` 相同

页面是纯静态 HTML/CSS/JS，没有构建步骤，直接修改后提交即可。接口行为变化时请同步更新 `api.html`。
