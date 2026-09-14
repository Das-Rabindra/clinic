/**
 * Integration credentials. `secret_json` is AES-256-GCM ciphertext and is never
 * included in anything returned to a client - getPublic() is the only shape
 * that leaves the server.
 */
import { one, all, run } from './base.js';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';

export async function get(provider) {
  const row = await one('SELECT * FROM integrations WHERE provider = ?', provider);
  if (!row) return null;
  return {
    ...row,
    config: JSON.parse(row.config_json || '{}'),
    is_enabled: row.is_enabled === 1,
  };
}

/** Decrypted secrets. Server-side callers only - never serialise this. */
export async function getSecrets(provider) {
  const row = await one('SELECT secret_json FROM integrations WHERE provider = ?', provider);
  if (!row?.secret_json) return {};
  const plain = decryptSecret(row.secret_json);
  if (!plain) return {};
  try { return JSON.parse(plain); } catch { return {}; }
}

export async function upsert(provider, { config, secrets, is_enabled, status, last_error } = {}) {
  const existing = await get(provider);
  const mergedConfig = { ...(existing?.config || {}), ...(config || {}) };
  const mergedSecrets = secrets === undefined
    ? null
    : { ...getSecrets(provider), ...secrets };

  await run(
    `INSERT INTO integrations (provider, config_json, secret_json, is_enabled, status, last_error, last_checked_at)
     VALUES (@provider, @config_json, @secret_json, @is_enabled, @status, @last_error, NOW())
     ON CONFLICT(provider) DO UPDATE SET
       config_json = excluded.config_json,
       secret_json = COALESCE(excluded.secret_json, integrations.secret_json),
       is_enabled = COALESCE(excluded.is_enabled, integrations.is_enabled),
       status = COALESCE(excluded.status, integrations.status),
       last_error = excluded.last_error,
       last_checked_at = NOW(),
       updated_at = NOW()`,
    {
      provider,
      config_json: JSON.stringify(mergedConfig),
      secret_json: mergedSecrets ? encryptSecret(JSON.stringify(mergedSecrets)) : null,
      is_enabled: is_enabled === undefined ? null : (is_enabled ? 1 : 0),
      status: status ?? null,
      last_error: last_error ?? null,
    }
  );
  return await get(provider);
}

export const clearSecrets = async (provider) =>
  (await run(`UPDATE integrations SET secret_json = NULL, is_enabled = 0, status = 'not_configured',
       updated_at = NOW() WHERE provider = ?`, provider)).changes;

/** Safe shape for the admin UI: shows whether a secret exists, never its value. */
export async function listPublic() {
  return (await all('SELECT provider, is_enabled, config_json, status, last_checked_at, last_error, secret_json FROM integrations'))
    .map(r => ({
      provider: r.provider,
      is_enabled: r.is_enabled === 1,
      status: r.status,
      config: JSON.parse(r.config_json || '{}'),
      has_secrets: Boolean(r.secret_json),
      last_checked_at: r.last_checked_at,
      last_error: r.last_error,
    }));
}
