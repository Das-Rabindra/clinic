/** FAQs and enquiries - the two simple content/lead tables. */
import { one, all, run, buildUpdate } from './base.js';

/* FAQs */
export const listFaqs = async ({ publishedOnly = false } = {}) =>
  await all(`SELECT * FROM faqs WHERE deleted_at IS NULL ${publishedOnly ? 'AND is_published = 1' : ''}
       ORDER BY display_order, id`);

export const findFaq = async (id) => await one('SELECT * FROM faqs WHERE id = ? AND deleted_at IS NULL', id);

export async function createFaq(f) {
  const order = f.display_order ?? (await one('SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM faqs')).n;
  const info = await run(
    'INSERT INTO faqs (question, answer, display_order, is_published) VALUES (?, ?, ?, ?)',
    f.question, f.answer, order, f.is_published === false ? 0 : 1
  );
  return await findFaq(info.lastInsertRowid);
}
export const updateFaq = async (id, fields) =>
  await buildUpdate('faqs', id, fields, ['question', 'answer', 'display_order', 'is_published']);
export const deleteFaq = async (id) =>
  (await run(`UPDATE faqs SET deleted_at = NOW() WHERE id = ?`, id)).changes;
export async function reorderFaqs(ids) {
  for (const [i, id] of ids.entries()) {
    await run(`UPDATE faqs SET display_order = ?, updated_at = NOW() WHERE id = ?`, i, id);
  }
}

/* Enquiries */
export const listEnquiries = async ({ status, limit = 100, offset = 0 } = {}) =>
  await all(`SELECT e.*, u.name AS assigned_name, p.code AS patient_code
       FROM enquiries e
       LEFT JOIN users u ON u.id = e.assigned_to
       LEFT JOIN patients p ON p.id = e.converted_patient_id
       WHERE e.deleted_at IS NULL AND (?::text IS NULL OR e.status = ?)
       ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
    status ?? null, status ?? null, limit, offset);

export const findEnquiry = async (id) => await one('SELECT * FROM enquiries WHERE id = ? AND deleted_at IS NULL', id);

export async function createEnquiry(e) {
  const info = await run(
    `INSERT INTO enquiries (name, phone, email, message, preferred_contact, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
    e.name, e.phone, e.email ?? null, e.message ?? null,
    e.preferred_contact || 'phone', e.source || 'website'
  );
  return await findEnquiry(info.lastInsertRowid);
}

export const updateEnquiry = async (id, fields) =>
  await buildUpdate('enquiries', id, fields,
    ['status', 'notes', 'assigned_to', 'contacted_at', 'converted_patient_id']);

export const deleteEnquiry = async (id) =>
  (await run(`UPDATE enquiries SET deleted_at = NOW() WHERE id = ?`, id)).changes;

export const newEnquiryCount = async () =>
  (await one(`SELECT COUNT(*) AS c FROM enquiries WHERE status = 'new' AND deleted_at IS NULL`)).c;
