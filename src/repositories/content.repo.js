/** FAQs and enquiries - the two simple content/lead tables. */
import { one, all, run, buildUpdate } from './base.js';

/* FAQs */
export const listFaqs = ({ publishedOnly = false } = {}) =>
  all(`SELECT * FROM faqs WHERE deleted_at IS NULL ${publishedOnly ? 'AND is_published = 1' : ''}
       ORDER BY display_order, id`);

export const findFaq = (id) => one('SELECT * FROM faqs WHERE id = ? AND deleted_at IS NULL', id);

export function createFaq(f) {
  const order = f.display_order ?? one('SELECT COALESCE(MAX(display_order), 0) + 1 AS n FROM faqs').n;
  const info = run(
    'INSERT INTO faqs (question, answer, display_order, is_published) VALUES (?, ?, ?, ?)',
    f.question, f.answer, order, f.is_published === false ? 0 : 1
  );
  return findFaq(info.lastInsertRowid);
}
export const updateFaq = (id, fields) =>
  buildUpdate('faqs', id, fields, ['question', 'answer', 'display_order', 'is_published']);
export const deleteFaq = (id) =>
  run(`UPDATE faqs SET deleted_at = datetime('now') WHERE id = ?`, id).changes;
export const reorderFaqs = (ids) =>
  ids.forEach((id, i) =>
    run(`UPDATE faqs SET display_order = ?, updated_at = datetime('now') WHERE id = ?`, i, id));

/* Enquiries */
export const listEnquiries = ({ status, limit = 100, offset = 0 } = {}) =>
  all(`SELECT e.*, u.name AS assigned_name, p.code AS patient_code
       FROM enquiries e
       LEFT JOIN users u ON u.id = e.assigned_to
       LEFT JOIN patients p ON p.id = e.converted_patient_id
       WHERE e.deleted_at IS NULL AND (? IS NULL OR e.status = ?)
       ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
    status ?? null, status ?? null, limit, offset);

export const findEnquiry = (id) => one('SELECT * FROM enquiries WHERE id = ? AND deleted_at IS NULL', id);

export function createEnquiry(e) {
  const info = run(
    `INSERT INTO enquiries (name, phone, email, message, preferred_contact, source)
     VALUES (?, ?, ?, ?, ?, ?)`,
    e.name, e.phone, e.email ?? null, e.message ?? null,
    e.preferred_contact || 'phone', e.source || 'website'
  );
  return findEnquiry(info.lastInsertRowid);
}

export const updateEnquiry = (id, fields) =>
  buildUpdate('enquiries', id, fields,
    ['status', 'notes', 'assigned_to', 'contacted_at', 'converted_patient_id']);

export const deleteEnquiry = (id) =>
  run(`UPDATE enquiries SET deleted_at = datetime('now') WHERE id = ?`, id).changes;

export const newEnquiryCount = () =>
  one(`SELECT COUNT(*) AS c FROM enquiries WHERE status = 'new' AND deleted_at IS NULL`).c;
