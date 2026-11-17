# MarkVault 插件开发与部署

具体插件统一位于仓库根目录 plugins/。后端宿主在 internal/plugin，前端宿主在 src/plugins，清单契约在 shared/plugin-manifest.schema.json。完整实施目标见 plugin-system-plan.md。

## 使用

内置功能（界面主题、页面版式、布局视图、动效、助手、连接、统计等）已整合到设置页，在各自的分区里直接开关和调整，不再出现在插件页面。它们在后端仍登记为内置插件（`markvault.*`），接口与数据不变；旧的内置插件详情链接 `/plugins/markvault.*` 会转到设置页对应的条目。`/plugins` 是自定义插件页，只管理另外安装的第三方插件，入口在「设置 → 自定义插件」，页头和手机底部导航不再有插件按钮。

在「设置 → 自定义插件」或直接打开 /plugins。管理员通过离线市场、固定 GitHub Release 资产或 ZIP 安装；安装本身不启用插件。用户进入详情，勾选权限后启用。新增权限的版本更新进入等待授权状态；更新前检查所有已有用户配置，失败时保留当前版本。详情支持回滚、实例停用、卸载和单独清除本人数据。

/plugins?safe=1 跳过当前页面的可选插件，可用于恢复管理。旧主题、配色、海洋设置保持原语义；插件停用只限制生效，不删除旧偏好，重新启用后恢复。浏览器本地配色及海洋选择不会改为账号同步。匿名分享不加载第三方脚本。

## 目录与包

设置页分为界面外观（界面与配色、布局视图、动画与背景、浏览增强）、助手与连接（助手与模型、API 与外部访问、MCP 与图片存储）、统计与扩展几组。每个分区列出归属它的内置功能：一项一个开关，开关立即生效，带选项的功能开启后可展开设置；开关已表达开与关，只有开着却没在运行或被管理员停用时才另外显示状态。界面主题和页面版式由各自的选择器切换，不单独列出开关。图床要先填写配置并授权才能开启，启停在它自己的设置面板里。开着却不会生效的组合在条目里直接说明，例如光标效果只在 VibeHub 主题下生效。管理员可在「设置 → 自定义插件 → 全实例功能开关」对内置功能做全实例停用。旧 experimental 设置链接转到浏览增强，snapshot 转到数据管理。

海洋背景、动效、标签热度、网址隐私、悬浮卡片和模型供应商的设置直接嵌入对应功能的条目。插件启停立即同步；启用后可展开，停用后收起并卸载配置区。海洋与增强选项沿用页面的保存/放弃流程，模型面板使用自身保存按钮；海洋的浏览器选项仍在本机即时保存。收起或切换展开条目保留未保存草稿。设置链接携带 plugin 参数，直接展开对应条目；实例停用和安全模式禁止快捷启用。

配色方案与主题切换动画也支持条目内展开。配色保存在当前浏览器，与明暗模式独立；配色插件停用或进入安全模式时显示默认色，恢复后使用原选择。根节点与页面共用实际生效的配色，切换明暗不会重新启用被停用的配色。主题切换插件只控制扩散动画，停用后仍可切换明暗。

站内助手 markvault.agent 停用后，桌面顶部和手机底部入口隐藏，直接进入聊天页会提示启用插件。图表统计 markvault.statistics 默认启用，可单独停用；停用后隐藏图表入口并停止访问统计页面及查询接口，保留历史数据和日常访问记录，重新启用即可继续查看。启停按账号隔离，管理员仍可在全实例停用。

- plugins/builtin：内置视觉实现、主题和引擎；src 的旧入口保留兼容导出。
- plugins/examples：aurora 设计变量主题、notes 沙盒页面、echo 服务端工具。
- plugins/packages：上述示例的标准包，作为离线官方目录分发。
- plugins/builtins.go、plugins/catalog.go：宿主可信装配与目录，插件不能自报官方身份。

    go run ./cmd/markvault-plugin validate plugins/examples/notes/manifest.json
    go run ./cmd/markvault-plugin pack plugins/examples/notes notes.zip

包根目录必须包含 manifest.json；ZIP 最多 16 MiB、256 个文件，实际解压总量最多 48 MiB。拒绝绝对路径、路径穿越、符号链接、重复及大小写冲突文件和 Windows 保留路径。包存入数据库，不向实例目录解压、不执行安装脚本。版本不可变，同版本不同摘要会被拒绝。

清单 api 接受 1.0.0 或 ^1.0.0；依赖使用精确版本。缺失依赖显示等待状态，不自动授权依赖，依赖环在安装时拒绝。第一版不执行插件 SQL 迁移，设置使用有限 JSON Schema 子集；未知约束直接拒绝，Go 与 TypeScript 共用契约样例。

## 页面与 SDK

第三方页面是自包含 HTML，脚本和样式内联。iframe 仅启用 allow-scripts，没有同源身份、网络、表单、弹窗或父页导航权限。SDK 消息绑定 iframe、随机通道、登录会话及插件代次。不要从插件直接读取父页面或宿主令牌。

    const value = await markvault.call('storage.get', { key: 'notes' });
    await markvault.call('storage.set', { key: 'notes', value: '我的便笺' });

可用宿主方法：config、storage.get、storage.set、business.call、network.fetch、models.call。存储单值上限 64 KiB，总量 1 MiB，按账号和插件隔离。业务方法还检查当前调用方权限；写操作必须通过确认。网络代理默认仅支持公网 HTTPS，禁止重定向和环境代理，并在连接时重新解析和校验 IP。凭据通过引用由宿主注入，不向插件返回明文。

页面路由是 /p/:pluginId/*。panel/action 的 slot 可为 settings、statistics、bookmark-actions、tab-group-actions、background；页面仅在贡献处挂载，停用时卸载并销毁消息桥。theme 使用安全设计变量，不能注入远程 CSS 或任意资源。

## 服务端脚本

固定 Deno 2.9.8，使用 scripts/install-deno.mjs 下载并核验官方 SHA-256：

    node scripts/install-deno.mjs
    # Linux
    export MARKVAULT_DENO_PATH="$PWD/.data/tools/deno/deno"
    # Windows PowerShell
    $env:MARKVAULT_DENO_PATH="$PWD/.data/tools/deno/deno.exe"

主 Dockerfile 内置经摘要校验的 amd64/arm64 运行时。轻量 scratch 预构建镜像不含动态链接运行时，脚本插件会显示不可用；需要脚本时使用主 Dockerfile。缺少运行时不影响核心和原生内置插件。

作者预先把依赖打包为自包含 JavaScript。导出 activate(sdk)，返回 invoke(contributionId,args) 和可选 dispose()。每次调用使用独立进程及无权限 Worker，启动 10 秒、调用 30 秒超时，V8 堆上限 128 MiB，全实例最多 8 个并发、每用户插件最多 2 个；没有常驻空闲进程。插件不能访问文件、环境、子进程、直接网络和包外模块。宿主 broker 在每次调用时重新检查当前状态与代次。

接口类型见 src/plugins/sdk/index.ts。模型供应商贡献 invoke 接收 operation=models 或 chat；chat 返回 {content,calls:[{name,arguments}]}。在 markvault.models 的 JSON 设置中选择 providerId（插件 ID/贡献 ID）。API 密钥通过详情的凭据接口保存，供应商通过 network.fetch 的 credential 引用使用；内置供应商保留已有设置和密钥。

## Agent、确认与 MCP

聊天 POST /api/v1/agent/chat 接受可选 agentId，默认 markvault.agent，第三方格式为 插件 ID/贡献 ID。插件工具以稳定哈希命名空间注册，不能覆盖内置工具；第三方和外部工具始终生成确认，版本、配置、撤权或启停变化使旧凭证失效。

现有 Agent REST、内置工具名和 /api/mcp 保持兼容。第三方工具默认不对外开放。登录用户通过 PUT /api/v1/plugins/:id/exposure 指定 tools 和 keyIds，同时建立用户开放列表与 API Key 精确工具权限。旧 Key 的 bookmarks.* 等权限不会自动获得第三方工具。升级清空插件的开放列表，需要重新选择。

外部 MCP 在 markvault.mcp-client 详情配置，支持 Streamable HTTP 和旧 HTTP/SSE、无认证/Bearer/X-API-Key。发现的工具需逐个选入助手。初始化、分页发现、超时、会话删除均在独立账号连接中完成；每次调用新建会话，失败不会重放可能已经执行的写操作。手动刷新工具后代次变化，旧确认失效。

默认拒绝私网，管理员可通过 MARKVAULT_PLUGIN_PRIVATE_TARGETS 填写逗号分隔的完整 HTTPS 来源逐项放行。SSE 返回的端点必须同来源，凭据不随重定向转发。OAuth、stdio、npm 直接安装不支持。

## 管理接口

全部插件管理接口仅接受登录会话；plugin-admin 额外校验现有管理员身份。

- GET /api/v1/plugins、GET/PUT /api/v1/plugins/:id：目录、配置、权限与启停。
- GET /api/v1/plugins/catalog：离线目录；POST /api/v1/plugin-admin/catalog/refresh：刷新自定义 HTTPS 目录；POST .../catalog/install：安装已登记条目。
- POST /api/v1/plugin-admin/install：application/zip 包或 {url,sha256}。
- POST /api/v1/plugin-admin/:id/disable、allow、rollback、uninstall：实例维护。
- GET/PUT /api/v1/plugins/:id/credentials：列出凭据引用或保存加密凭据；secret 为空删除。
- GET /api/v1/plugins/tools、POST /api/v1/plugins/tools/call：工具清单与两步确认调用。
- GET/POST /api/v1/plugins/mcp/connections、PUT/DELETE .../:connectionId、POST .../:connectionId/refresh：连接管理。

自定义目录是 {manifest,url,sha256} 数组，只接受固定 Release ZIP 和摘要。内置离线目录身份可信；自定义条目始终是社区。操作记录不保存密钥、聊天内容、工具参数；调用统计增加 plugin_id、tool_source、connection_id，原统计口径不变。

## 备份与验收

停止实例或使用 SQLite 在线备份，再备份整个数据目录和实例加密密钥。插件包、版本、配置、权限、凭据及独立存储均在数据库中；业务 JSON 导出不包含这些表。恢复时必须保留实例密钥。

执行类型检查、ESLint、Vitest、前端构建、gofmt、Go 编译/vet/test、govulncheck。运行时测试需要 MARKVAULT_DENO_PATH。共享契约、安装路径、权限增加、回滚、账号隔离、HTTP/SSE 与 Deno 权限边界已有自动化回归。完整五阶段目标的剩余验收以本次交付记录为准，不把单项测试通过等同于全部完成。

## 图床插件

内置图床插件可按截图、快照图片、封面、网站图标和自定义默认图分别选择上传。默认停用，支持 S3 / R2 / MinIO 与通用 HTTP 图床接口，上传失败保留原图。设置与边界见 [图床插件](image-hosting.md)。

## 通行密钥插件

`markvault.passkey` 默认停用，支持 WebAuthn 通行密钥绑定、登录和删除，设置嵌入「账户与语言」的关联插件条目。密码登录保留，添加和删除密钥需要验证当前密码；实例停用和个人停用都会暂停密钥登录。部署要求、注册开关及验证见 [注册控制与通行密钥](passkeys-and-registration.md)。

## 布局视图插件

「设置 → 布局视图」提供八个内置布局，均默认关闭、无需配置：

- 书签视图：画廊（`markvault.view-gallery`）、时间线（`markvault.view-timeline`）、站点分组（`markvault.view-domains`）、专注（`markvault.view-focus`）。
- 标签布局：标签云（`markvault.tag-cloud`）、标签排行（`markvault.tag-bars`）。
- 标签页组布局：看板（`markvault.tab-board`，可在列之间拖动标签页，包括拖到空分组）、折叠列表（`markvault.tab-compact`）。

启用后，对应页面的布局切换按钮会多出这一项。停用后显示默认布局，但不改写已保存的选择，重新启用即恢复。书签视图与标签布局随账号偏好同步，标签页组布局只保存在当前浏览器。安全模式和公开分享页不使用插件布局。

实现位于 `plugins/builtin/` 下的同名目录，公共部分在 `plugins/builtin/layouts/`；新增布局时在 `layouts/registry.ts` 登记，并同步 `internal/server/settings.go` 的偏好枚举与 `internal/plugin/store.go` 的默认停用列表。

## 页面版式插件

页面版式在「设置 → 界面与配色 → 页面版式」里选择。与只替换页面中某一块的布局视图插件不同，版式接管整页的排布，可以不保留“左侧标签栏、右侧书签”的结构；它与界面主题、配色互不排斥，可任意搭配。九个内置版式均默认停用、无需配置：

- 首页：顶栏版式（`markvault.home-topbar`，标签收成横向标签带）、起始页版式（`markvault.home-launchpad`，居中搜索、常用标签和快捷访问）、三栏版式（`markvault.home-reader`，标签、列表、详情并排，窗口较窄时退回默认版式）、标签看板（`markvault.home-tagboard`，每个标签一列）、无限画布（`markvault.home-canvas`）。
- 标签页组：顶部分组栏（`markvault.tabs-tabbed`）、卡片墙（`markvault.tabs-wall`，标签页可在卡片之间拖动）、收纳时间线（`markvault.tabs-timeline`）、无限画布（`markvault.tabs-canvas`）。

在「设置 → 界面与配色 → 页面版式」直接选择，选中时自动开启对应版式。启用任一版式后，对应页面的工具栏出现版式切换按钮，可随时换回默认版式。多个版式可以同时启用，当前使用哪一个保存在当前浏览器；从未选择过的浏览器使用账号里第一个已启用的版式。停用后回到默认版式但保留选择。三栏版式需要桌面宽度（1024px 及以上），窗口较窄时页面暂时显示默认版式，设置页的对应卡片会注明原因，选择不变。安全模式和公开分享页不使用页面版式。

版式内的书签列表仍使用当前的书签视图（含布局视图插件），批量操作、搜索、排序和标签页拖动等功能与默认版式一致。

实现位于 `plugins/builtin/` 下的同名目录，公共部分在 `plugins/builtin/shells/`，宿主逻辑在 `src/plugins/shells.ts`。新增版式时在 `src/plugins/shells.ts` 的名称列表和 `shells/registry.ts` 登记，并同步 `plugins/builtins.go`、`internal/plugin/store.go` 的默认停用列表、`src/plugins/navigation.ts` 以及两种语言的 `plugins.json` 文案。

### 无限画布模式

无限画布是页面版式的一种：内容铺在一块可以平移和缩放的平面上，标签、书签和标签页组再多也不受屏幕大小限制。首页是一张「全部标签」卡片加每个标签一张书签卡片（多标签的书签出现在多张卡片里，未加标签的单独一张）；标签页组是每个分组一张卡片，标签页仍可在卡片之间拖动。

- 开关：「设置 → 界面与配色 → 无限画布模式」里首页和标签页组各有一个开关。打开即启用对应插件并切换到画布，关闭则回到默认版式并停用插件；它与下方页面版式选择器里的「无限画布」卡片、页面工具栏的版式切换按钮是同一个状态。被全实例停用或处于安全模式时开关不可操作。
- 操作：拖动空白处平移（鼠标中键也可以），滚轮上下滚动、按住 Shift 横向滚动，按住 Ctrl / ⌘ 滚动或双指捏合缩放（10%–250%）。左下角的控件依次是缩小、当前倍率（点击回到 100%）、放大、适应全部内容、重新整理和小地图开关；右下角的小地图显示全部卡片和当前视口，点击或拖动直接跳过去。焦点在画布上时，方向键平移，`+` / `-` 缩放，`0` 适应全部内容，`1` 回到 100%。
- 排布：卡片默认按瀑布流自动排布，列数随内容多少增加而不是随窗口宽度变化，整幅画布保持接近屏幕的横向比例。拖动卡片上边缘的手柄（或聚焦手柄后按方向键）可以把卡片放到任意位置，其余卡片自动避开；「重新整理」清除全部手动位置。
- 保存：视口和手动摆放的位置按页面分别保存在当前浏览器（`markvault:canvas:home`、`markvault:canvas:tabs`），不随账号同步。
- 手机宽度下隐藏小地图和操作说明，缩放控件让出底部导航栏。

实现位于 `plugins/builtin/canvas/`：`viewport.ts` 是不依赖 DOM 的视口换算、卡片排布和状态存取，`InfiniteCanvas.tsx` 是画布组件（手势、测量、缩放控件和小地图），`CanvasModeSettings.tsx` 是设置页的开关；两个版式在 `plugins/builtin/home-canvas/` 与 `plugins/builtin/tabs-canvas/`。

已知限制：画布倍率不是 100% 时，在卡片之间拖动标签页的落点判断正常，但被拖动项周围让位的位移会按倍率再缩放一次，观感与 100% 时略有出入。

## 分类、图标与设置表单

清单可选声明 `category` 与 `icon`，只影响插件在设置页和自定义插件页的归类与展示，不授予任何能力。`category` 取 appearance、effects、intelligence、connections、insights、layouts、other 之一；未声明时内置插件按宿主登记归类，其余按贡献类型推断。`icon` 是小写连字符的图标名（`^[a-z][a-z0-9-]{0,39}$`），可用名称见 `src/plugins/icons.tsx`；未声明或名称未登记时显示所属分类的默认图标。

带设置 Schema 的插件不必手写 JSON：第三方插件在详情页、内置功能在设置页的条目里，按 Schema 的顶层属性生成表单。布尔值是开关；字符串枚举不超过四项是分段单选，更多则是下拉框；同时声明 `minimum` 和 `maximum` 的数值是滑块，其余数值是数字输入框；字符串是文本框；元素为字符串枚举的数组是多选；其他结构退回该字段的 JSON 文本框。`title`、`description` 作为标签和说明，写成「中文 / English」时按界面语言显示其中一段；`default` 是初始值，也是「恢复默认值」的目标。表单只提交 Schema 声明的属性，`additionalProperties` 不为 false 时保留已有的其他键。详情页仍可切换到 JSON 编辑整份配置；有专用设置页的插件（如图床）不生成表单。

内置插件枚举值的显示名称登记在两种语言 `plugins.json` 的 `settingsOptions.<插件短 id>.<属性名>.<值>`，未登记时显示原值。

## ASCII 终端主题

`markvault.ascii` 归在「主题外观」，默认停用，与 VibeHub、UI/UX Pro 同属界面主题互斥组，同一时间只启用一个。在「设置 → 界面与配色」的界面主题里选择「ASCII 终端」；对应账号偏好 `experimental_ascii_theme_enabled`（迁移 `0133_ascii_theme.sql`）。

启用后整个界面使用等宽字体和直角：卡片、输入框和弹出菜单的边框是 `+--+` 与 `|` 拼成的字符边框，按钮写成 `[ 文字 ]`，开关写成 `[o--]` / `[--#]`，当前导航项前面是 `>` 提示符。明亮模式是纸面终端，暗色模式是黑底终端，配色方案只替换强调色。

主题生效后，选项出现在界面主题选择器的下方：

- 启动序列（`boot`）：每个浏览器会话进入页面时播放一次，约 4 秒，依次是逐字打出启动信息、字符从定位点向外扩散、斜向扫描带揭开界面；点击或按任意键跳过。
- 字符背景（`background`）：字符场、字符雨或关闭。海洋背景开启时不显示字符背景。
- 扫描线（`scanlines`）与故障闪烁（`glitch`，切换页面和悬停标题时的横向错位）。
- 字符密度（`density`）：40–160 的百分比。

关闭交互动效或系统要求减少动态效果时，不播放启动序列和故障闪烁，字符背景保持静止。公开分享页沿用分享者的界面主题，但访客读不到分享者的插件配置：分享页不播放启动序列，其余选项按默认值显示。

实现位于 `plugins/builtin/ascii/`：`style.css` 是配色与组件样式，`frame.ts` 按当前主题色生成字符边框图，`scene.ts` 与 `renderer.ts` 是字符背景和启动序列，`AsciiTheme.tsx` 负责挂载。选项结构登记在 `plugins/builtins.go` 的 `asciiSettings`，前端默认值在 `settings.ts`，两处需保持一致。

## 液态玻璃主题

`markvault.liquid-glass` 归在「主题外观」，默认停用，与 VibeHub、UI/UX Pro、ASCII 终端同属界面主题互斥组，同一时间只启用一个。在「设置 → 界面与配色」的界面主题里选择「液态玻璃」；对应账号偏好 `experimental_liquid_glass_theme_enabled`（迁移 `0134_liquid_glass_theme.sql`）。

主题参考 Apple 的 Liquid Glass：页头、面板、弹出层和对话框是磨砂玻璃，模糊并提亮背后的内容，边缘有一圈高光；按钮、标签和导航项是圆润的胶囊。玻璃后面是一层柔和的彩色底，明亮和暗色模式各有一套色调，配色方案只替换强调色。列表里成片出现的书签卡片只做半透明、不逐个模糊背景，书签再多也不拖慢滚动。

形状融合（融球效果，Metaball）：指针带着一颗玻璃水滴，靠近按钮时被吸过去；水滴、按钮以及相邻的按钮之间先拉出一段细颈，越近越粗，最后合成一个形状，拉开时细颈被拉长再断开。做法与 Liquid Glass 的形状融合一致：每个按钮或水滴是一个圆角矩形的有向距离场，用平滑最小值并在一起，再用 marching squares 取出零等值线作为轮廓，每帧重新计算。被融合的控件把自己的描边让给融合图层，连成一体后只有一圈高光。融合图层不接收指针事件，按钮照常响应点击；指针停下、弹簧静止后暂停计算。

主题生效后，选项和一块可以拖动两颗水滴的融合演示出现在界面主题选择器的下方：

- 指针水滴（`droplet`）：关闭后不显示水滴，也不做融合。
- 流动高光（`highlight`）：控件上的高光跟随指针位置移动。
- 磨砂强度（`frost`）：玻璃背后内容的模糊半径，4–40 像素。
- 融合范围（`fusion`）：水滴与按钮开始吸附、拉丝的距离，40–160 的百分比。

关闭交互动效、系统要求减少动态效果或设备没有精确指针（触摸屏）时，只保留静态的玻璃界面，不挂载融合图层；设置页的演示仍可拖动，但水滴直接跟随、不做回弹。系统要求减少透明度或浏览器不支持 `backdrop-filter` 时，玻璃换成更实的底色。公开分享页沿用分享者的界面主题，但访客读不到分享者的插件配置：分享页不显示指针水滴，只保留流动高光，其余选项按默认值显示。

实现位于 `plugins/builtin/liquid-glass/`：`style.css` 是玻璃材质、配色与控件样式，`metaball.ts` 是不依赖 DOM 的距离场、轮廓提取、吸附与弹簧计算，`fusion.ts` 是页面上的融合图层，`LiquidGlass.tsx` 负责挂载并把磨砂强度写成样式变量，`LiquidGlassPlayground.tsx` 是设置页的演示。选项结构登记在 `plugins/builtins.go` 的 `liquidGlassSettings`，前端默认值在 `settings.ts`，两处需保持一致；参与融合的控件名单是 `settings.ts` 的 `GLASS_TARGETS`，新增控件时与 `style.css` 的玻璃控件规则一起补充，或给元素加上 `data-liquid-glass` 属性。

## 页面加载速度插件

`markvault.page-speed` 默认停用，启用后在页头显示页面加载与站内切换耗时，数据只在当前页面内存中使用。口径与边界见 [页面加载速度插件](page-speed-plugin.md)。
