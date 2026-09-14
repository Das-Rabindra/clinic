/**
 * Vercel Blob storage driver.
 *
 * Implements the same five-method interface as the local filesystem driver, so
 * MediaService is unchanged. Used on Vercel, where the filesystem is ephemeral
 * and anything written to disk disappears between invocations.
 */
import { put as blobPut, del as blobDel, head as blobHead } from '@vercel/blob';
import { config } from '../../config/env.js';

export const name = 'blob';

const token = () => config.storage.blobToken || undefined;

export async function put(key, buffer, contentType = 'image/webp') {
  const res = await blobPut(key, buffer, {
    access: 'public',
    contentType,
    token: token(),
    // Keys are already content-hashed, so the random suffix would only get in
    // the way of deterministic URLs.
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000,
  });
  return { key, url: res.url, storage: name };
}

export async function get(key) {
  const meta = await blobHead(urlFor(key), { token: token() }).catch(() => null);
  if (!meta) throw new Error(`Blob not found: ${key}`);
  const res = await fetch(meta.url);
  if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function remove(key) {
  try { await blobDel(urlFor(key), { token: token() }); return true; }
  catch { return false; }
}

/**
 * Blob returns absolute URLs at upload time and the media row stores them, so
 * this is only a fallback for keys whose URL was not recorded.
 */
function urlFor(key) {
  const base = config.storage.blobBaseUrl;
  return base ? `${base.replace(/\/+$/, '')}/${key}` : key;
}
export const url = (key) => urlFor(key);

export async function exists(key) {
  try { await blobHead(urlFor(key), { token: token() }); return true; }
  catch { return false; }
}
