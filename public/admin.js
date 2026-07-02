const generatedKeys = document.querySelector('#generated-keys');
const keysTable = document.querySelector('#keys-table');
const validateOutput = document.querySelector('#validate-output');
const healthOutput = document.querySelector('#health-output');

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }
  return data;
}

function formatValue(value) {
  return value == null || value === '' ? '-' : value;
}

function statusText(status) {
  return {
    unused: '未使用',
    active: '使用中',
    used: '已完成',
    expired: '已过期',
    revoked: '已撤销',
  }[status] || status;
}

async function loadKeys() {
  const data = await requestJson('/admin/api/keys');
  keysTable.innerHTML = '';
  for (const key of data.keys) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${key.id}</td>
      <td>${key.keyPrefix}</td>
      <td><span class="status ${key.status}">${statusText(key.status)}</span></td>
      <td>${formatValue(key.phoneNumber)}</td>
      <td>${formatValue(key.expiresAt)}</td>
      <td>${key.createdAt}</td>
      <td>${['unused', 'active'].includes(key.status) ? `<button data-revoke="${key.id}" type="button">撤销</button>` : '-'}</td>
    `;
    keysTable.appendChild(tr);
  }
}

document.querySelector('#generate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const count = Number(new FormData(event.currentTarget).get('count'));
  const data = await requestJson('/admin/api/keys', {
    method: 'POST',
    body: JSON.stringify({ count }),
  });
  generatedKeys.value = data.keys.map((item) => item.key).join('\n');
  await loadKeys();
});

document.querySelector('#validate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const key = new FormData(event.currentTarget).get('key');
    const data = await requestJson('/admin/api/keys/validate', {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
    validateOutput.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    validateOutput.textContent = error.message;
  }
});

document.querySelector('#health-button').addEventListener('click', async () => {
  try {
    const data = await requestJson('/admin/api/health');
    healthOutput.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    healthOutput.textContent = error.message;
  }
});

document.querySelector('#refresh-keys').addEventListener('click', loadKeys);
keysTable.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-revoke]');
  if (!button) return;
  await requestJson(`/admin/api/keys/${button.dataset.revoke}/revoke`, { method: 'POST' });
  await loadKeys();
});

loadKeys();
