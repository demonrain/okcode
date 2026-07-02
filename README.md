# CDKey SMSBower App

轻量 CDKey 接码管理应用，面向 SMSBower 的 OpenAI 临时验证码流程。

## 功能

- 管理端单密码登录。
- 批量生成 CDKey，明文只在生成响应中显示一次，数据库只保存 hash。
- 管理端验证、查询、撤销 CDKey。
- 用户无需登录，输入 CDKey 获取手机号并轮询验证码。
- CDKey 首次兑换后绑定一个 SMSBower activation，有效期默认 25 分钟。

## 配置

复制 `.env.example` 为 `.env` 后填写：

```ini
ADMIN_PASSWORD=change-me
SESSION_SECRET=replace-with-at-least-32-random-bytes

SMSBOWER_API_KEY=replace-me
SMSBOWER_SERVICE_CODE=replace-me
SMSBOWER_COUNTRY=0
SMSBOWER_MAX_PRICE=
ACTIVATION_TTL_MINUTES=25
```

`SMSBOWER_SERVICE_CODE` 需要在 SMSBower 后台或 `getServicesList` 中确认 OpenAI 对应编码。

## 启动

```bash
npm install
npm test
npm start
```

默认地址：

- 用户页：`http://localhost:3000/`
- 管理端：`http://localhost:3000/admin`

开发环境如果没有设置 `.env`，管理端密码默认是 `admin`。生产环境必须设置 `ADMIN_PASSWORD` 和不少于 32 字节的 `SESSION_SECRET`。

## SMSBower 行为

- 购买号码：`getNumberV2`
- 查询验证码：`getStatus`
- 验证码成功后完成激活：`setStatus status=6`
- 过期或撤销时尝试取消激活：`setStatus status=8`

如果平台返回 `EARLY_CANCEL_DENIED`，应用会保留本地过期/撤销状态并忽略该取消失败。
