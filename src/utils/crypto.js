/**
 * Password hashing (scrypt), session token hashing, secret encryption (AES-GCM)
 * and HMAC signing. Deliberately built on node:crypto only — no native deps.
 */
import crypto from 'node:crypto';
import { config } from '../config/env.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password, salt = crypto.randomBytes(32).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024,
  }).toString('hex');
  return { hash, salt };
}

/** Constant-time verification; never leaks timing about the stored hash. */
export function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  try {
    const candidate = crypto.scryptSync(password, salt, SCRYPT.keylen, {
      N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024,
    });
    const stored = Buffer.from(hash, 'hex');
    return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
  } catch { return false; }
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const key = () => crypto.createHash('sha256').update(config.appSecret).digest();

/** AES-256-GCM. Used for integration credentials at rest. */
export function encryptSecret(plain) {
  if (plain == null) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(payload) {
  if (!payload) return null;
  try {
    const [iv, tag, data] = String(payload).split('.');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    // Wrong/rotated APP_SECRET, or tampered ciphertext. Treat as "no secret".
    return null;
  }
}

export function sign(value) {
  return crypto.createHmac('sha256', config.appSecret).update(String(value)).digest('base64url');
}
export function verifySigned(value, signature) {
  const expected = sign(value);
  const a = Buffer.from(expected), b = Buffer.from(String(signature || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
