import { one, all, run } from './base.js';

export const findById = async (id) => await one('SELECT * FROM reviews WHERE id = ?', id);

/** Upsert by the provider's stable review id - re-syncs update, never duplicate. */
export async function upsertByExternalId(r) {
  await run(
    `INSERT INTO reviews (source, external_id, author_name, author_photo_url, rating, text,
       review_url, reviewed_at, reply_text, replied_at, raw_json, synced_at)
     VALUES (@source, @external_id, @author_name, @author_photo_url, @rating, @text,
       @review_url, @reviewed_at, @reply_text, @replied_at, @raw_json, NOW())
     ON CONFLICT(external_id) DO UPDATE SET
       author_name = excluded.author_name, author_photo_url = excluded.author_photo_url,
       rating = excluded.rating, text = excluded.text, reviewed_at = excluded.reviewed_at,
       reply_text = excluded.reply_text, replied_at = excluded.replied_at,
       raw_json = excluded.raw_json, synced_at = NOW(), updated_at = NOW()`,
    {
      source: r.source || 'google', external_id: r.external_id,
      author_name: r.author_name, author_photo_url: r.author_photo_url ?? null,
      rating: r.rating, text: r.text ?? null, review_url: r.review_url ?? null,
      reviewed_at: r.reviewed_at ?? null, reply_text: r.reply_text ?? null,
      replied_at: r.replied_at ?? null, raw_json: r.raw_json ?? null,
    }
  );
}

/** Public: only reviews the admin has left visible, with text. */
export const listPublic = async (limit = 12) =>
  await all(`SELECT id, author_name, author_photo_url, rating, text, review_url, reviewed_at, is_featured
       FROM reviews WHERE is_visible = 1
       ORDER BY is_featured DESC, reviewed_at DESC, id DESC LIMIT ?`, limit);

export const listAdmin = async () =>
  await all('SELECT * FROM reviews ORDER BY reviewed_at DESC, id DESC');

/**
 * Aggregate over *visible* reviews only. Used for the on-page rating and for
 * AggregateRating structured data, so it must never include hidden or invented
 * reviews.
 */
export const aggregate = async () =>
  await one(`SELECT COUNT(*) AS count, ROUND(AVG(rating), 1) AS average
       FROM reviews WHERE is_visible = 1`);

export const setVisible = async (id, visible) =>
  (await run(`UPDATE reviews SET is_visible = ?, updated_at = NOW() WHERE id = ?`,
    visible ? 1 : 0, id)).changes;

export const setFeatured = async (id, featured) =>
  (await run(`UPDATE reviews SET is_featured = ?, updated_at = NOW() WHERE id = ?`,
    featured ? 1 : 0, id)).changes;

export const recent = async (limit = 5) =>
  await all('SELECT * FROM reviews ORDER BY synced_at DESC, id DESC LIMIT ?', limit);

export const count = async () => (await one('SELECT COUNT(*) AS c FROM reviews')).c;

/* Sync state (singleton row) */
export const syncState = async () => await one('SELECT * FROM review_sync_state WHERE id = 1');

export async function setSyncState(s) {
  await run(
    `INSERT INTO review_sync_state (id, connected, account_name, location_name, location_title,
       rating_avg, rating_count, last_sync_at, last_error, last_error_at, updated_at)
     VALUES (1, @connected, @account_name, @location_name, @location_title,
       @rating_avg, @rating_count, @last_sync_at, @last_error, @last_error_at, NOW())
     ON CONFLICT(id) DO UPDATE SET
       connected = COALESCE(excluded.connected, review_sync_state.connected),
       account_name = COALESCE(excluded.account_name, review_sync_state.account_name),
       location_name = COALESCE(excluded.location_name, review_sync_state.location_name),
       location_title = COALESCE(excluded.location_title, review_sync_state.location_title),
       rating_avg = COALESCE(excluded.rating_avg, review_sync_state.rating_avg),
       rating_count = COALESCE(excluded.rating_count, review_sync_state.rating_count),
       last_sync_at = COALESCE(excluded.last_sync_at, review_sync_state.last_sync_at),
       last_error = excluded.last_error,
       last_error_at = excluded.last_error_at,
       updated_at = NOW()`,
    {
      connected: s.connected === undefined ? null : (s.connected ? 1 : 0),
      account_name: s.account_name ?? null, location_name: s.location_name ?? null,
      location_title: s.location_title ?? null,
      rating_avg: s.rating_avg ?? null, rating_count: s.rating_count ?? null,
      last_sync_at: s.last_sync_at ?? null,
      last_error: s.last_error ?? null, last_error_at: s.last_error ? new Date().toISOString() : null,
    }
  );
}
