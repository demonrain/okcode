import crypto from 'node:crypto';

const VERSION = 'v1';

function keyFromSecret(secret) {
  const value = String(secret ?? '');
  if (!value) return null;
  return crypto.createHash('sha256').update(value).digest();
}

export function encryptText(plaintext, secret) {
  const key = keyFromSecret(secret);
  if (!key) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptText(payload, secret) {
  const key = keyFromSecret(secret);
  if (!payload || !key) return null;

  const [version, ivText, tagText, encryptedText] = String(payload).split(':');
  if (version !== VERSION || !ivText || !tagText || !encryptedText) return null;

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
