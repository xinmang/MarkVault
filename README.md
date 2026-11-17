# MarkVault 文档站

这个分支只存放 MarkVault 文档站的静态文件，由 GitHub Pages 直接发布到 <https://xinmang.github.io/MarkVault/>，与 `main` 分支没有共同历史。

站点默认是英文，中文版在 `zh/` 目录下，页头右侧的链接在两种语言的同一页之间切换。

- `index.html`、`api.html`：英文的产品介绍页和接口文档（Agent REST API、MCP、应用接口）
- `zh/index.html`、`zh/api.html`：对应的中文页
- `assets/`：两种语言共用的样式、脚本与截图
- `media/markvault-intro.mp4`：介绍视频，与 `main` 分支的 `docs/media/markvault-intro.mp4` 相同

页面是纯静态 HTML/CSS/JS，没有构建步骤，直接修改后提交即可。

- 两种语言的页面结构和锚点 `id` 保持一致，改内容时两边一起改；接口行为变化时同步更新两份 `api.html`。
- 中文页引用资源要多一层 `../`。
- 访客在页头选过语言后，选择保存在浏览器的 `localStorage`（`markvault-docs-lang`）：选过中文的访客打开英文地址时会被带到中文页的同一位置，中文地址不做反向跳转。浏览器语言不参与判断。
- 截图是中文界面，两种语言共用。
