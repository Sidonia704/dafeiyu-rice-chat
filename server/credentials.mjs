const encoder = new TextEncoder(), decoder = new TextDecoder();
const encode = bytes => Buffer.from(bytes).toString('base64url');
const decode = text => new Uint8Array(Buffer.from(text, 'base64url'));
async function cryptoKey(secret) {
  return crypto.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealSettings(settings, sessionId, secret, now = Date.now()) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(JSON.stringify({ settings, sessionId, expiresAt: now + 8 * 3600000 }));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(secret), data);
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}
export async function openSettings(value, sessionId, secret, now = Date.now()) {
  try {
    if (!value || value.length > 4096) return null;
    const [iv, bytes] = value.split('.');
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, await cryptoKey(secret), decode(bytes));
    const result = JSON.parse(decoder.decode(data));
    if (result.sessionId !== sessionId || result.expiresAt <= now || !result.settings?.key) return null;
    return result.settings;
  } catch { return null; }
}
