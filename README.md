# CDKey SMSBower App

轻量 CDKey 接码管理应用，面向 SMSBower 的 OpenAI 临时验证码流程。

## 功能

- 管理端单密码登录，写操作需要 CSRF token。
- 批量生成 CDKey，明文只在生成响应中显示一次，数据库只保存 hash。
- 用户无需登录，输入 CDKey 获取手机号、国家、区号、无区号号码并轮询验证码。
- 用户未收到短信时可以更换号码；应用会先确认旧号码仍未收到验证码，再取消旧 activation 并重新购买。
- 管理端可配置 service code、多国家优先级、最低/最高价格、接码等级。
- 管理端 CDKey 列表支持输入完整 CDKey 精确查询，并显示手机号、国家、费用和已收到的验证码。

## 配置

复制 `.env.example` 为 `.env` 后填写：

```ini
ADMIN_PASSWORD=your-long-random-admin-password
SESSION_SECRET=your-32-plus-character-random-session-secret
CDKEY_ENCRYPTION_SECRET=

SMSBOWER_API_KEY=replace-me
SMSBOWER_SERVICE_CODE=replace-me
SMSBOWER_COUNTRIES=39,0,12
SMSBOWER_QUALITY_TIER=any
SMSBOWER_MIN_PRICE=
SMSBOWER_MAX_PRICE=
ACTIVATION_TTL_MINUTES=25
```

`.env` 里的 SMSBower 设置是首次启动默认值。管理员登录后在“接码设置”里保存的新设置会写入 SQLite，后续兑换和更换号码都会优先使用管理端设置。

`CDKEY_ENCRYPTION_SECRET` 可选，用于加密保存完整 CDKey 以便管理端列表展示。留空时会使用 `SESSION_SECRET` 兜底。已经创建过、历史上只保存截断前缀的旧 CDKey 无法恢复完整明文。

国家优先级用一行一个国家代码配置，越靠上优先级越高。例如阿根廷优先、俄罗斯兜底：

```text
39
0
```

价格单位按 SMSBower API 文档是美元；`minPrice` 和 `maxPrice` 都可以留空。

## 接码等级

SMSBower API 文档中的 `getNumber/getNumberV2` 支持 `providerIds`、`exceptProviderIds`、`minPrice`、`maxPrice`，但没有直接的“铜/银/金”请求参数。

本应用的处理方式：

- `不限`：只按国家优先级和价格范围购买号码。
- `金`：先调用 `getTopCountriesByService` 获取 Gold-ranked providers，再把对应国家的 providerIds 传给 `getNumberV2`。
- `银`、`铜`：目前 SMSBower 文档没有公开对应过滤参数，应用会保存该配置用于展示，但实际购买不会额外传等级参数。

## 启动

```bash
npm install
npm test
npm start
```

默认地址：

- 用户页：`http://localhost:3000/`
- 管理端：`http://localhost:3000/admin`

## 安全

- `ADMIN_PASSWORD` 至少 12 个字符，不要使用默认或占位密码。
- `SESSION_SECRET` 至少 32 个随机字符。
- 完整 CDKey 会加密保存用于管理端展示；如果数据库和加密密钥同时泄露，未使用 CDKey 仍可能被盗用。
- `.env`、`*.env`、数据库和日志文件已加入 `.gitignore`，不要提交真实密钥。
- 未知服务器错误不会把 stack trace 或内部错误详情返回给客户端。
