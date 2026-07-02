function page(title, body, scripts = '', extraHead = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="stylesheet" href="/styles.css">
  ${extraHead}
</head>
<body>
${body}
${scripts}
</body>
</html>`;
}

export function renderRedeemPage() {
  return page(
    'CDKey 验证码领取',
    `<main class="redeem-shell">
  <section class="redeem-panel">
    <div class="brand-row">
      <div class="brand-mark">OK</div>
      <div>
        <p class="eyebrow">OpenAI 临时验证码</p>
        <h1>输入 CDKey 获取手机号</h1>
      </div>
    </div>
    <form id="redeem-form" class="form-grid">
      <label for="key">CDKey</label>
      <div class="inline-control">
        <input id="key" name="key" autocomplete="off" placeholder="OK-XXXX-XXXX-XXXX-XXXX" required>
        <button type="submit">领取</button>
      </div>
    </form>
    <div id="redeem-message" class="message" hidden></div>
    <section id="activation-card" class="activation-card" hidden>
      <div>
        <span class="label">手机号</span>
        <strong id="phone-number">-</strong>
      </div>
      <div>
        <span class="label">国家</span>
        <strong id="country-name">-</strong>
      </div>
      <div>
        <span class="label">区号</span>
        <strong id="dial-code">-</strong>
      </div>
      <div class="local-number-block">
        <span class="label">无区号号码</span>
        <div class="copy-row">
          <strong id="local-number">-</strong>
          <button id="copy-local-number" class="ghost small" type="button" disabled>复制</button>
        </div>
      </div>
      <div>
        <span class="label">剩余时间</span>
        <strong id="expires-in">-</strong>
      </div>
      <div class="code-block">
        <span class="label">验证码</span>
        <strong id="sms-code">等待短信</strong>
      </div>
      <div class="activation-actions">
        <button id="replace-number" class="ghost" type="button">更换号码</button>
      </div>
    </section>
  </section>
</main>`,
    '<script src="/redeem.js" type="module"></script>',
  );
}

export function renderLoginPage(error = '') {
  return page(
    '管理端登录',
    `<main class="admin-login-shell">
  <form class="login-card" method="post" action="/admin/login">
    <div class="brand-mark">OK</div>
    <h1>管理端</h1>
    <label for="password">管理员密码</label>
    <input id="password" name="password" type="password" autofocus required>
    <button type="submit">登录</button>
    ${error ? `<p class="message error">${error}</p>` : ''}
  </form>
</main>`,
  );
}

export function renderAdminPage(csrfToken) {
  return page(
    'CDKey 管理端',
    `<main class="admin-shell">
  <header class="admin-header">
    <div>
      <p class="eyebrow">SMSBower OpenAI 接码</p>
      <h1>CDKey 管理端</h1>
    </div>
    <form method="post" action="/admin/logout">
      <input type="hidden" name="_csrf" value="${csrfToken}">
      <button class="ghost" type="submit">退出</button>
    </form>
  </header>

  <section class="admin-grid">
    <section class="panel">
      <h2>生成 CDKey</h2>
      <form id="generate-form" class="inline-control">
        <input name="count" type="number" min="1" max="500" value="10">
        <button type="submit">生成</button>
      </form>
      <textarea id="generated-keys" readonly placeholder="新生成的 CDKey 只会在这里显示一次"></textarea>
    </section>

    <section class="panel">
      <h2>健康检查</h2>
      <button id="health-button" type="button">检查余额与配置</button>
      <pre id="health-output" class="output">尚未检查</pre>
    </section>

    <section class="panel wide">
      <h2>接码设置</h2>
      <form id="settings-form" class="settings-form">
        <label for="settings-service-code">Service Code</label>
        <input id="settings-service-code" name="serviceCode" autocomplete="off" placeholder="oa">

        <label for="settings-countries">国家优先级，一行一个国家代码</label>
        <textarea id="settings-countries" name="countries" placeholder="39&#10;0&#10;12"></textarea>

        <label for="settings-quality-tier">接码等级</label>
        <select id="settings-quality-tier" name="qualityTier">
          <option value="any">不限</option>
          <option value="bronze">铜</option>
          <option value="silver">银</option>
          <option value="gold">金</option>
        </select>

        <div class="settings-prices">
          <label for="settings-min-price">最低价格 USD</label>
          <input id="settings-min-price" name="minPrice" inputmode="decimal" placeholder="0.10">

          <label for="settings-max-price">最高价格 USD</label>
          <input id="settings-max-price" name="maxPrice" inputmode="decimal" placeholder="0.50">
        </div>

        <button type="submit">保存设置</button>
      </form>
      <pre id="settings-output" class="output">正在读取设置</pre>
    </section>

    <section class="panel">
      <h2>验证 CDKey</h2>
      <form id="validate-form" class="inline-control">
        <input name="key" autocomplete="off" placeholder="OK-XXXX-XXXX-XXXX-XXXX">
        <button type="submit">验证</button>
      </form>
      <pre id="validate-output" class="output">等待输入</pre>
    </section>

    <section class="panel wide">
      <div class="panel-title-row">
        <h2>CDKey 列表</h2>
        <form id="key-search-form" class="inline-control compact">
          <input name="key" autocomplete="off" placeholder="输入完整 CDKey 精确查询">
          <button type="submit">查询</button>
          <button id="refresh-keys" type="button">刷新</button>
        </form>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>前缀</th>
              <th>状态</th>
              <th>手机号</th>
              <th>国家</th>
              <th>验证码</th>
              <th>费用</th>
              <th>过期时间</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="keys-table"></tbody>
        </table>
      </div>
    </section>
  </section>
</main>`,
    '<script src="/admin.js" type="module"></script>',
    `<meta name="csrf-token" content="${csrfToken}">`,
  );
}
