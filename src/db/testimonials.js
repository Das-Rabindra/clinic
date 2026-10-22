/**
 * Patient testimonials collected by the clinic on paper feedback cards.
 *
 * Applied on boot (like content.js): each entry becomes a "Shared with the
 * clinic" testimonial, with the consent record the reviews table requires.
 * Idempotent — an entry already present (same name and words) is skipped,
 * and one the clinic has since edited or hidden in the admin is left alone.
 *
 * `text` must be the patient's OWN words, copied from their card. An entry
 * with no text is not published — the site never shows words a patient did
 * not write. `consent` must be true only when the patient has agreed to
 * their name and comment appearing on the website.
 */
import { one } from './index.js';
import * as reviewsRepo from '../repositories/reviews.repo.js';

export const TESTIMONIALS = [
  // { name, rating (1-5), text: "exact words from the card", date: 'YYYY-MM-DD', consent: true }
  { name: 'Biswa P Tripathy', rating: 5, text: '', date: null, consent: false },
  { name: 'Subrat Das', rating: 5, text: '', date: null, consent: false },
  { name: 'Bunny', rating: 5, text: '', date: null, consent: false },
  { name: 'Sushil K', rating: 5, text: '', date: null, consent: false },
  { name: 'Mamuni Pradhan', rating: 5, text: '', date: null, consent: false },
  { name: 'Baibhav Kumar Samal', rating: 5, text: '', date: null, consent: false },
  { name: 'Sradha Suman Samal', rating: 5, text: '', date: null, consent: false },
  { name: 'Nihal Garanayak', rating: 5, text: '', date: null, consent: false },
];

export async function applyTestimonials({ log = console.log, list = TESTIMONIALS } = {}) {
  let added = 0;
  const waiting = [];
  for (const t of list) {
    const text = String(t.text || '').trim();
    if (!text || !t.consent) { waiting.push(t.name); continue; }
    const exists = await one(
      `SELECT id FROM reviews WHERE source = 'manual' AND author_name = ? AND text = ?`, t.name, text);
    if (exists) continue;
    await reviewsRepo.createManual({
      author_name: t.name,
      rating: Math.min(5, Math.max(1, Number(t.rating) || 5)),
      text,
      reviewed_at: t.date ? new Date(`${t.date}T12:00:00+05:30`).toISOString() : new Date().toISOString(),
      is_visible: true,
      consent_confirmed: true,
      consent_note: 'Patient agreed to publication of name and comment (paper feedback card); confirmed by the clinic owner.',
      collected_via: 'Paper feedback card',
    });
    added++;
  }
  if (added) log(`[testimonials] ${added} patient testimonial(s) published`);
  if (waiting.length) log(`[testimonials] waiting for card text and consent: ${waiting.join(', ')}`);
  return { added, waiting };
}
