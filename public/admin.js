const generatedKeys = document.querySelector('#generated-keys');
const keysTable = document.querySelector('#keys-table');
const validateOutput = document.querySelector('#validate-output');
const healthOutput = document.querySelector('#health-output');
const settingsOutput = document.querySelector('#settings-output');
const settingsForm = document.querySelector('#settings-form');
const keySearchForm = document.querySelector('#key-search-form');
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

async function requestJson(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const response = await fetch(url, {
    headers,
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatValue(value) {
  return value == null || value === '' ? '-' : escapeHtml(value);
}

function statusText(status) {
  return (
    {
      unused: '未使用',
      active: '使用中',
      used: '已完成',
      expired: '已过期',
      revoked: '已撤销',
    }[status] || status
  );
}

function settingsFromForm() {
  const formData = new FormData(settingsForm);
  const countries = String(formData.get('countries') || '')
    .split(/\r?\n|,/)
    .map((countryCode, index) => ({ countryCode: countryCode.trim(), priority: index + 1 }))
    .filter((item) => item.countryCode);

  return {
    serviceCode: String(formData.get('serviceCode') || '').trim(),
    countries,
    qualityTier: String(formData.get('qualityTier') || 'any').trim(),
    minPrice: String(formData.get('minPrice') || '').trim(),
    maxPrice: String(formData.get('maxPrice') || '').trim(),
  };
}

function fillSettingsForm(settings) {
  settingsForm.elements.serviceCode.value = settings.serviceCode || '';
  settingsForm.elements.countries.value = (settings.countries || []).map((item) => item.countryCode).join('\n');
  settingsForm.elements.qualityTier.value = settings.qualityTier || 'any';
  settingsForm.elements.minPrice.value = settings.minPrice || '';
  settingsForm.elements.maxPrice.value = settings.maxPrice || '';
  settingsOutput.textContent = JSON.stringify(settings, null, 2);
}

async function loadSettings() {
  try {
    const settings = await requestJson('/admin/api/settings');
    fillSettingsForm(settings);
  } catch (error) {
    settingsOutput.textContent = error.message;
  }
}

async function loadKeys(searchKey = '') {
  const query = searchKey ? `?key=${encodeURIComponent(searchKey)}` : '';
  const data = await requestJson(`/admin/api/keys${query}`);
  keysTable.innerHTML = '';

  for (const key of data.keys) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${key.id}</td>
      <td>${formatValue(key.keyPrefix)}</td>
      <td><span class="status ${escapeHtml(key.status)}">${escapeHtml(statusText(key.status))}</span></td>
      <td>${formatValue(key.phoneNumber)}</td>
      <td>${formatValue(key.countryName || key.countryCode)}</td>
      <td>${formatValue(key.code)}</td>
      <td>${formatValue(key.activationCost)}</td>
      <td>${formatValue(key.expiresAt)}</td>
      <td>${formatValue(key.createdAt)}</td>
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

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const settings = await requestJson('/admin/api/settings', {
      method: 'POST',
      body: JSON.stringify(settingsFromForm()),
    });
    fillSettingsForm(settings);
  } catch (error) {
    settingsOutput.textContent = error.message;
  }
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

keySearchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const key = String(new FormData(keySearchForm).get('key') || '').trim();
  await loadKeys(key);
});

document.querySelector('#refresh-keys').addEventListener('click', async () => {
  keySearchForm.reset();
  await loadKeys();
});

keysTable.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-revoke]');
  if (!button) return;
  await requestJson(`/admin/api/keys/${button.dataset.revoke}/revoke`, { method: 'POST' });
  await loadKeys(String(new FormData(keySearchForm).get('key') || '').trim());
});

await loadSettings();
await loadKeys();
