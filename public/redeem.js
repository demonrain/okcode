const form = document.querySelector('#redeem-form');
const message = document.querySelector('#redeem-message');
const card = document.querySelector('#activation-card');
const phoneNumber = document.querySelector('#phone-number');
const expiresIn = document.querySelector('#expires-in');
const smsCode = document.querySelector('#sms-code');
const replaceButton = document.querySelector('#replace-number');

let activeKey = '';
let pollTimer = null;

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollStatus, 5000);
  pollStatus();
}

function showMessage(text, type = 'info') {
  message.textContent = text;
  message.className = `message ${type}`;
  message.hidden = false;
}

function formatSeconds(seconds) {
  const value = Math.max(Number(seconds) || 0, 0);
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function renderActivation(data) {
  card.hidden = false;
  phoneNumber.textContent = data.phoneNumber || '-';
  expiresIn.textContent = data.expiresInSeconds == null ? '-' : formatSeconds(data.expiresInSeconds);
  smsCode.textContent = data.code || '等待短信';
  smsCode.classList.toggle('ready', Boolean(data.code));
  replaceButton.disabled = data.status !== 'active' || Boolean(data.code);
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '请求失败');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function pollStatus() {
  if (!activeKey) return;
  try {
    const data = await requestJson(`/api/redeem/${encodeURIComponent(activeKey)}/status`);
    renderActivation(data);
    if (data.code) {
      stopPolling();
      showMessage('验证码已收到', 'success');
    }
  } catch (error) {
    stopPolling();
    showMessage(error.message, error.status === 410 ? 'error' : 'info');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  stopPolling();
  activeKey = new FormData(form).get('key').trim();
  showMessage('正在领取手机号...', 'info');

  try {
    const data = await requestJson('/api/redeem', {
      method: 'POST',
      body: JSON.stringify({ key: activeKey }),
    });
    renderActivation(data);
    showMessage('手机号已分配，请在有效期内完成验证', 'success');
    startPolling();
  } catch (error) {
    card.hidden = true;
    showMessage(error.message, 'error');
  }
});

replaceButton.addEventListener('click', async () => {
  if (!activeKey) return;
  stopPolling();
  replaceButton.disabled = true;
  showMessage('正在更换号码...', 'info');

  try {
    const data = await requestJson(`/api/redeem/${encodeURIComponent(activeKey)}/replace`, {
      method: 'POST',
    });
    renderActivation(data);
    showMessage('号码已更换，请使用新手机号继续验证', 'success');
    startPolling();
  } catch (error) {
    showMessage(error.message, 'error');
    if (!smsCode.classList.contains('ready')) {
      replaceButton.disabled = false;
      startPolling();
    }
  }
});
