/**
 * Google OAuth 2.0 (authorization code flow) for the Business Profile API.
 *
 * The client secret and refresh token never leave the server: the secret lives
 * in env/integrations, and the refresh token is stored AES-GCM encrypted.
 * The `state` parameter is HMAC-signed to prevent CSRF on the callback.
 */
import { config } from '../../config/env.js';
import * as integrationsRepo from '../../repositories/integrations.repo.js';
import { sign, verifySigned, randomToken } from '../../utils/crypto.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/business.manage';

export const redirectUri = () => `${config.publicUrl}/oauth/google/callback`;

async function clientCreds() {
  const stored = await integrationsRepo.getSecrets('google_business');
  const cfg = await integrationsRepo.get('google_business')?.config || {};
  return {
    clientId: stored.client_id || cfg.client_id || config.google.clientId,
    clientSecret: stored.client_secret || config.google.clientSecret,
  };
}

export const isConfigured = async () => {
  const c = clientCreds();
  return Boolean(c.clientId && c.clientSecret);
};

/** Build the consent URL. `state` is signed so the callback can trust it. */
export async function authUrl() {
  const { clientId } = clientCreds();
  if (!clientId) throw new Error('Google OAuth client ID is not configured.');
  const nonce = randomToken(16);
  const state = `${nonce}.${sign(nonce)}`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',       // needed to receive a refresh token
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function verifyState(state) {
  const [nonce, sig] = String(state || '').split('.');
  return Boolean(nonce && sig && verifySigned(nonce, sig));
}

/** Exchange the one-time code for tokens and persist the refresh token. */
export async function exchangeCode(code) {
  const { clientId, clientSecret } = clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri(), grant_type: 'authorization_code',
    }),
  });
  const body = (await res.json()).catch(() => ({}));
  if (!res.ok) throw new Error(body.error_description || body.error || `Token exchange failed (HTTP ${res.status})`);
  if (!body.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove the app from your Google account permissions and connect again.');
  }

  await integrationsRepo.upsert('google_business', {
    secrets: { refresh_token: body.refresh_token },
    config: { connected_at: new Date().toISOString() },
    is_enabled: true,
    status: 'connected',
    last_error: null,
  });
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

/** Exchange the stored refresh token for a short-lived access token. */
export async function accessToken() {
  const { clientId, clientSecret } = clientCreds();
  const { refresh_token: refreshToken } = await integrationsRepo.getSecrets('google_business');
  if (!refreshToken) throw new Error('Google Business Profile is not connected.');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  const body = (await res.json()).catch(() => ({}));
  if (!res.ok) {
    // invalid_grant means the user revoked access or the token expired.
    if (body.error === 'invalid_grant') {
      await integrationsRepo.upsert('google_business', {
        is_enabled: false, status: 'reconnect_required',
        last_error: 'Google access was revoked or expired. Please reconnect.',
      });
      throw new Error('Google access was revoked or has expired. Please reconnect the Business Profile.');
    }
    throw new Error(body.error_description || body.error || `Token refresh failed (HTTP ${res.status})`);
  }
  return body.access_token;
}

export async function disconnect() {
  await integrationsRepo.clearSecrets('google_business');
  return true;
}
