const form = document.querySelector('#redeem-form');
const message = document.querySelector('#redeem-message');
const card = document.querySelector('#activation-card');
const phoneNumber = document.querySelector('#phone-number');
const expiresIn = document.querySelector('#expires-in');
const smsCode = document.querySelector('#sms-code');

let activeKey = '';
let pollTimer = null;

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
      clearInterval(pollTimer);
      showMessage('验证码已收到', 'success');
    }
  } catch (error) {
    clearInterval(pollTimer);
    showMessage(error.message, error.status === 410 ? 'error' : 'info');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearInterval(pollTimer);
  activeKey = new FormData(form).get('key').trim();
  showMessage('正在领取手机号...', 'info');

  try {
    const data = await requestJson('/api/redeem', {
      method: 'POST',
      body: JSON.stringify({ key: activeKey }),
    });
    renderActivation(data);
    showMessage('手机号已分配，请在有效期内完成验证', 'success');
    pollTimer = setInterval(pollStatus, 5000);
    pollStatus();
  } catch (error) {
    card.hidden = true;
    showMessage(error.message, 'error');
  }
});
