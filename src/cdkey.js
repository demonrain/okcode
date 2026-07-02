import crypto from 'node:crypto';

const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeKey(key) {
  return String(key ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

export function hashKey(key) {
  return crypto.createHash('sha256').update(normalizeKey(key)).digest('hex');
}

export function generateCdKey(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(16);
  let body = '';

  for (let index = 0; index < 16; index += 1) {
    body += KEY_ALPHABET[bytes[index] % KEY_ALPHABET.length];
  }

  return `OK-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
}

export function keyPrefix(key) {
  const normalized = normalizeKey(key);
  return normalized.length <= 10 ? normalized : `${normalized.slice(0, 10)}...`;
}
