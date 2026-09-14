/**
 * Local filesystem storage driver. Implements the StorageDriver interface so an
 * S3/R2 driver can replace it without touching MediaService.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config/env.js';

export const name = 'local';

const resolve = (key) => {
  // Defence in depth: keys are generated server-side, but never let one escape.
  const safe = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(config.paths.uploadDir, safe);
  if (!full.startsWith(config.paths.uploadDir)) throw new Error('Invalid storage key');
  return full;
};

export async function put(key, buffer) {
  const full = resolve(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
  return { key, url: url(key), storage: name };
}

export async function get(key) { return fs.readFile(resolve(key)); }

export async function remove(key) {
  try { await fs.unlink(resolve(key)); return true; }
  catch (err) { if (err.code === 'ENOENT') return false; throw err; }
}

export async function url(key) { return `/media/${key}`; }

export async function exists(key) {
  try { await fs.access(resolve(key)); return true; } catch { return false; }
}
