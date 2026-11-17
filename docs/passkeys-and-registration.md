# 注册控制与通行密钥

## 用户注册

新实例首次允许注册。首个成功注册的账号自动成为管理员，并在同一事务内关闭注册；并发请求只有一个能够完成初始化。后续用户需要管理员先在「设置 → 账户与语言 → 用户注册」开启注册，注册后均为普通用户。开关立即保存到服务器，无需重新创建容器。

关闭注册时登录页隐藏注册按钮，直接进入注册页显示关闭提示，服务端也拒绝注册请求。登录页首次加载、重新聚焦和每 15 秒读取一次入口状态。旧实例应用迁移 `0132_registration_passkeys.sql` 后默认关闭注册，已有账号仍可登录。

部署变量 `ALLOW_REGISTRATION=false` 是强制关闭限制，此时界面不能开启；默认的 `true` 允许管理员通过界面控制，不代表注册始终开放。品牌设置的「恢复默认」不会改变注册状态。

## Passkey 插件

内置插件 `markvault.passkey` 默认停用，位于「设置 → 账户与语言」的功能列表。用户主动开启后展开设置，输入密钥名称和当前密码，按系统提示使用指纹、面容、设备 PIN 或安全密钥完成绑定。每个账号在同一站点域名下最多绑定 20 个密钥。

绑定成功后，支持 WebAuthn 的浏览器在登录页显示「使用通行密钥登录」，无需输入用户名或密码。密码登录始终保留。密钥列表显示名称、域名和最近使用时间；删除前输入当前密码并确认，删除后立即拒绝该密钥登录。

停用本人插件或管理员在全实例停用插件都会禁止 Passkey 登录，保留已绑定密钥，恢复启用后可继续使用。通行密钥只能通过专用管理入口验证密码后删除，普通「清除插件数据」接口不可删除认证凭据。

## 站点部署

通行密钥要求 HTTPS；本地测试可用 `http://localhost:8787`。建议固定域名访问，密钥以当前域名作为 RP ID；更换域名后用密码登录并重新绑定。反向代理应保留原始 Host，例如 Nginx 的 `proxy_set_header Host $http_host;`。不从客户端提供的转发域名推导信任来源。

实现采用 `github.com/go-webauthn/webauthn` 验证协议、公钥和签名，强制验证用户与可发现凭据，不保存生物特征或私钥。挑战保存五分钟，绑定来源、浏览器 HttpOnly/SameSite Cookie；绑定密钥还绑定登录令牌与当前密码摘要。挑战原子消费，过期、重放、签名篡改、跨账号和跨来源请求均拒绝；插件状态、凭据状态、认证版本与令牌签发共同校验。

数据库备份包含通行密钥公钥及元数据，不包含设备私钥；业务书签导出不包含认证表。

## 接口与验证

- `GET /api/v1/auth/options`：匿名读取注册和 Passkey 入口状态，不输出账号信息。
- `GET/PUT /api/v1/settings/auth`：管理员读取或修改 `registration_enabled`。
- `GET /api/v1/auth/passkey/credentials`：读取本人密钥元数据。
- `POST /api/v1/auth/passkey/register/begin`、`finish`：绑定密钥，需要 JWT，开始时验证当前密码。
- `POST /api/v1/auth/passkey/login/begin`、`finish`：匿名 Passkey 登录。
- `POST /api/v1/auth/passkey/credentials/:id/delete`：验证当前密码后删除本人密钥。

`scripts/test-auth-browser.mjs` 使用一次性本地数据目录和 Chromium 虚拟验证器，覆盖注册开关、Passkey 绑定、登录、重放与签名拒绝、停用恢复、删除失效、桌面及手机布局。通过环境变量指定 `MARKVAULT_E2E_EXECUTABLE`、`MARKVAULT_PLAYWRIGHT_MODULE`、`MARKVAULT_BROWSER_EXECUTABLE` 后执行；脚本不会修改已有实例。
