/**
 * GoogleReviewsService — official Google Business Profile APIs only.
 *
 * No HTML scraping of search results (spec §12). Reviews are upserted by their
 * Google review id, so re-syncing updates rather than duplicating. A failed
 * sync never clears existing reviews: the public site keeps serving the last
 * good data and the admin sees when the last successful sync happened.
 */
import * as reviewsRepo from '../../repositories/reviews.repo.js';
import * as integrationsRepo from '../../repositories/integrations.repo.js';
import * as oauth from './oauth.js';

const ACCOUNTS_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';
/** Reviews still live on the legacy v4 host; there is no v1 replacement yet. */
const REVIEWS_API = 'https://mybusiness.googleapis.com/v4';

const STAR = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

async function apiGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    const msg = body?.error?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

/** Accounts the connected Google user manages. */
export async function listAccounts() {
  const token = await oauth.accessToken();
  const body = await apiGet(`${ACCOUNTS_API}/accounts`, token);
  return (body.accounts || []).map(a => ({
    name: a.name, accountName: a.accountName, type: a.type,
  }));
}

/** Locations (clinics) under an account. */
export async function listLocations(accountName) {
  const token = await oauth.accessToken();
  const url = `${INFO_API}/${accountName}/locations?readMask=name,title,storefrontAddress&pageSize=100`;
  const body = await apiGet(url, token);
  return (body.locations || []).map(l => ({
    name: l.name,
    title: l.title,
    address: [l.storefrontAddress?.addressLines?.join(', '), l.storefrontAddress?.locality]
      .filter(Boolean).join(', '),
  }));
}

/** Persist which location this clinic is, so syncs know what to fetch. */
export function selectLocation({ accountName, locationName, locationTitle }) {
  reviewsRepo.setSyncState({
    connected: true, account_name: accountName,
    location_name: locationName, location_title: locationTitle,
  });
  integrationsRepo.upsert('google_business', {
    config: { account_name: accountName, location_name: locationName },
    status: 'connected',
  });
  return reviewsRepo.syncState();
}

/**
 * Fetch reviews and upsert them.
 * @returns {Promise<{ok:boolean, synced?:number, average?:number, total?:number, error?:string, lastSyncAt?:string}>}
 */
export async function sync() {
  const state = reviewsRepo.syncState();
  if (!state?.location_name || !state?.account_name) {
    return {
      ok: false,
      error: 'No Google Business location selected. Connect the profile and choose the clinic location.',
      lastSyncAt: state?.last_sync_at ?? null,
    };
  }

  try {
    const token = await oauth.accessToken();
    let pageToken = null, synced = 0, average = null, total = null;

    do {
      const url = new URL(`${REVIEWS_API}/${state.account_name}/${state.location_name}/reviews`);
      url.searchParams.set('pageSize', '50');
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const body = await apiGet(url.toString(), token);
      average = body.averageRating ?? average;
      total = body.totalReviewCount ?? total;

      for (const r of body.reviews || []) {
        const rating = STAR[r.starRating] ?? null;
        if (!rating) continue;                     // UNSPECIFIED rating: skip
        reviewsRepo.upsertByExternalId({
          source: 'google',
          external_id: r.reviewId || r.name,
          author_name: r.reviewer?.displayName || 'Google user',
          author_photo_url: r.reviewer?.profilePhotoUrl || null,
          rating,
          text: r.comment || null,
          review_url: state.location_name
            ? `https://search.google.com/local/reviews?placeid=${encodeURIComponent(state.place_id || '')}`
            : null,
          reviewed_at: r.updateTime || r.createTime || null,
          reply_text: r.reviewReply?.comment || null,
          replied_at: r.reviewReply?.updateTime || null,
          raw_json: JSON.stringify(r),
        });
        synced++;
      }
      pageToken = body.nextPageToken || null;
    } while (pageToken && synced < 500);

    const nowIso = new Date().toISOString();
    reviewsRepo.setSyncState({
      connected: true, rating_avg: average, rating_count: total,
      last_sync_at: nowIso, last_error: null,
    });
    integrationsRepo.upsert('google_business', { status: 'connected', last_error: null });

    return { ok: true, synced, average, total, lastSyncAt: nowIso };
  } catch (err) {
    // Keep whatever was synced before; only record the failure.
    reviewsRepo.setSyncState({ last_error: err.message });
    integrationsRepo.upsert('google_business', {
      status: err.status === 401 ? 'reconnect_required' : 'error',
      last_error: err.message,
    });
    return {
      ok: false,
      error: err.message,
      lastSyncAt: reviewsRepo.syncState()?.last_sync_at ?? null,
    };
  }
}

/** Everything the admin Reviews screen needs, including honest failure state. */
export function connectionStatus() {
  const state = reviewsRepo.syncState();
  const integration = integrationsRepo.get('google_business');
  return {
    oauth_configured: oauth.isConfigured(),
    connected: Boolean(state?.connected),
    status: integration?.status || 'not_configured',
    account_name: state?.account_name || null,
    location_name: state?.location_name || null,
    location_title: state?.location_title || null,
    last_sync_at: state?.last_sync_at || null,
    last_error: state?.last_error || null,
    last_error_at: state?.last_error_at || null,
    review_count: reviewsRepo.count(),
    redirect_uri: oauth.redirectUri(),
  };
}

/** Public payload. Aggregate covers only visible reviews, so it is never faked. */
export function publicReviews(limit = 12) {
  const rows = reviewsRepo.listPublic(limit);
  const agg = reviewsRepo.aggregate();
  const state = reviewsRepo.syncState();
  return {
    reviews: rows,
    average: agg.count ? agg.average : null,
    count: agg.count || 0,
    last_sync_at: state?.last_sync_at || null,
  };
}
