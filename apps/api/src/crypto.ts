import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function randomId(len = 21): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
export function sha256(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex');
}
export function hmac(secret: string, s: string): string {
  return createHmac('sha256', secret).update(s).digest('hex');
}
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ---- gateway API keys ----
export type GeneratedKey = { secret: string; prefix: string; hash: string; last4: string };
export function generateApiKey(mode: 'live' | 'test' = 'live'): GeneratedKey {
  const prefixPart = randomId(8);
  const secretPart = randomId(32);
  const secret = `tbg_${mode}_${prefixPart}_${secretPart}`;
  return { secret, prefix: `tbg_${mode}_${prefixPart}`, hash: sha256(secret), last4: secretPart.slice(-4) };
}
export function parseKeyPrefix(secret: string): string | null {
  const m = /^(tbg_(?:live|test)_[0-9A-Za-z]{8})_[0-9A-Za-z]{32}$/.exec(secret);
  return m ? m[1] : null;
}

// ---- passwords (scrypt, no native deps) ----
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const hash = scryptSync(password, Buffer.from(saltB64, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashB64, 'base64');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

// ---- symmetric encryption (AES-256-GCM) for upstream keys, TOTP secrets, webhook secrets ----
function deriveKey(master: string): Buffer {
  const raw = Buffer.from(master, 'base64');
  if (raw.length === 32) return raw;
  return createHash('sha256').update(master).digest();
}
export function encrypt(master: string, plaintext: string): string {
  const key = deriveKey(master);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}
export function decrypt(master: string, payload: string): string {
  const [v, ivB64, tagB64, encB64] = payload.split('.');
  if (v !== 'v1') throw new Error('Unsupported ciphertext version');
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(master), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
}

// ---- TOTP (RFC 6238, SHA1, 30s, 6 digits) ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const idx = B32.indexOf(ch); if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function generateTotpSecret(): string { return base32Encode(randomBytes(20)); }
export function totpCode(secretB32: string, time = Date.now(), step = 30): string {
  const counter = Math.floor(time / 1000 / step);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1_000_000).padStart(6, '0');
}
export function verifyTotp(secretB32: string, code: string, window = 1): boolean {
  const c = code.replace(/\s/g, '');
  for (let w = -window; w <= window; w++) if (safeEqual(totpCode(secretB32, Date.now() + w * 30_000), c)) return true;
  return false;
}
export function otpauthUrl(issuer: string, account: string, secret: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

// ---- signed URLs (permalinks / stream entries) ----
export function signParams(secret: string, parts: (string | number)[], exp?: number): string {
  return hmac(secret, [...parts, exp ?? ''].join('|')).slice(0, 40);
}
