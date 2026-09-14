import { api, $, $$, esc, emptyState, toastOk, toastErr, openModal, closeModal, confirmAction } from '../core.js';

/* ══════════ FAQs ══════════ */
export async function renderFaqs(view) {
  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>Frequently asked questions</h2>
          <p class="card-sub">Use {{phone}}, {{address}} or {{clinic}} to insert live clinic details</p></div>
        <button class="btn btn-primary btn-sm" id="newFaq">Add FAQ</button>
      </div>
      <div id="faqList"><div class="spin"></div></div>
    </div>`;

  async function load() {
    const box = $('#faqList');
    const faqs = await api('/api/admin/faqs');
    box.innerHTML = faqs.length ? faqs.map((f, i) => `
      <div style="padding:14px 0; border-bottom:1px solid var(--line);">
        <div style="display:flex; gap:12px; justify-content:space-between; align-items:flex-start;">
          <div style="flex:1;">
            <div class="t-strong">${esc(f.question)}</div>
            <div class="t-muted" style="margin-top:4px; line-height:1.6;">${esc(f.answer)}</div>
          </div>
          <div class="t-actions">
            ${f.is_published ? '<span class="pill pill-confirmed">live</span>' : '<span class="pill pill-disabled">draft</span>'}
            <button class="btn btn-ghost btn-xs" data-up="${i}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
            <button class="btn btn-ghost btn-xs" data-down="${i}" ${i === faqs.length - 1 ? 'disabled' : ''}>&darr;</button>
            <button class="btn btn-ghost btn-xs" data-edit="${f.id}">Edit</button>
            <button class="btn btn-danger btn-xs" data-del="${f.id}">Delete</button>
          </div>
        </div>
      </div>`).join('') : emptyState('No FAQs yet.', 'inbox');

    $$('[data-edit]', box).forEach((b) => { b.onclick = () => faqForm(faqs.find((f) => f.id === Number(b.dataset.edit)), load); });
    $$('[data-del]', box).forEach((b) => {
      b.onclick = async () => {
        if (!await confirmAction('Delete FAQ', 'Remove this question from the website?', { confirmLabel: 'Delete' })) return;
        await api(`/api/admin/faqs/${b.dataset.del}`, { method: 'DELETE' });
        toastOk('FAQ deleted'); load();
      };
    });
    const move = async (from, to) => {
      const ids = faqs.map((f) => f.id);
      const [x] = ids.splice(from, 1);
      ids.splice(to, 0, x);
      await api('/api/admin/faqs/reorder', { method: 'POST', body: { ids } });
      load();
    };
    $$('[data-up]', box).forEach((b) => { b.onclick = () => move(Number(b.dataset.up), Number(b.dataset.up) - 1); });
    $$('[data-down]', box).forEach((b) => { b.onclick = () => move(Number(b.dataset.down), Number(b.dataset.down) + 1); });
    $('#newFaq').onclick = () => faqForm(null, load);
  }
  await load();
}

function faqForm(faq, reload) {
  const f = faq || { is_published: 1 };
  openModal(faq ? 'Edit FAQ' : 'Add FAQ', `
    <div class="field"><label>Question</label><input type="text" id="fq" value="${esc(f.question || '')}"></div>
    <div class="field"><label>Answer</label><textarea id="fa" rows="4">${esc(f.answer || '')}</textarea>
      <div class="hint">Placeholders: {{phone}} {{address}} {{clinic}} {{whatsapp}}</div></div>
    <label class="check"><input type="checkbox" id="fp" ${f.is_published ? 'checked' : ''}><span>Publish on the website</span></label>`, {
    footer: '<button class="btn btn-ghost" id="fCancel">Cancel</button><button class="btn btn-primary" id="fSave">Save</button>',
  });
  $('#fCancel').onclick = closeModal;
  $('#fSave').onclick = async () => {
    const body = { question: $('#fq').value.trim(), answer: $('#fa').value.trim(), is_published: $('#fp').checked };
    if (!body.question || !body.answer) { toastErr('Question and answer are required.'); return; }
    try {
      if (faq) await api(`/api/admin/faqs/${faq.id}`, { method: 'PUT', body });
      else await api('/api/admin/faqs', { method: 'POST', body });
      toastOk('Saved'); closeModal(); reload();
    } catch (err) { toastErr(err.message); }
  };
}

/* ══════════ Homepage content ══════════ */
const HOMEPAGE_FIELDS = [
  ['Hero', [
    ['hero_eyebrow', 'Eyebrow line', 'text'],
    ['hero_title', 'Headline', 'textarea', 'Line breaks are preserved.'],
    ['hero_lede', 'Intro paragraph', 'textarea'],
    ['hero_cta_label', 'Button label', 'text'],
    ['hero_trust_text', 'Floating trust card', 'text'],
  ]],
  ['About the dentist', [
    ['about_title', 'Section title', 'text'],
    ['about_body', 'Body text', 'textarea'],
  ]],
  ['Clinic story', [
    ['story_title', 'Section title', 'text'],
    ['story_body', 'Body text', 'textarea', 'Leave blank to hide this section.'],
  ]],
  ['Services section', [
    ['services_title', 'Section title', 'text'],
    ['services_lede', 'Intro text', 'textarea'],
  ]],
  ['Gallery section', [
    ['gallery_title', 'Section title', 'text'],
    ['gallery_lede', 'Intro text', 'textarea'],
  ]],
  ['Reviews & closing call to action', [
    ['reviews_title', 'Reviews title', 'text'],
    ['cta_title', 'Closing headline', 'text'],
    ['cta_body', 'Closing text', 'textarea'],
  ]],
];

export async function renderHomepage(view) {
  const { settings } = await api('/api/admin/clinic');
  const media = await api('/api/admin/gallery/media');

  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>Homepage content</h2><p class="card-sub">Everything the visitor reads on the front page</p></div>
        <button class="btn btn-primary btn-sm" id="hSave">Save changes</button>
      </div>
      ${HOMEPAGE_FIELDS.map(([group, fields]) => `
        <fieldset><legend>${esc(group)}</legend>
          ${fields.map(([key, label, type, hint]) => `
            <div class="field">
              <label>${esc(label)}</label>
              ${type === 'textarea'
                ? `<textarea data-field="${key}" rows="3">${esc(settings[key] || '')}</textarea>`
                : `<input type="text" data-field="${key}" value="${esc(settings[key] || '')}">`}
              ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
            </div>`).join('')}
        </fieldset>`).join('')}

      <fieldset><legend>Hero image</legend>
        <div class="field"><label>Photograph shown beside the headline</label>
          <select data-field="hero_media_id">
            <option value="">No image — show the placeholder card</option>
            ${media.map((m) => `<option value="${m.id}" ${settings.hero_media_id === m.id ? 'selected' : ''}>${esc(m.original_name || m.key)} (${m.width}×${m.height})</option>`).join('')}
          </select>
          <div class="hint">Upload images in <a href="#/gallery">Gallery &amp; Media</a> first.</div>
        </div>
      </fieldset>
    </div>`;

  $('#hSave').onclick = async () => {
    const body = {};
    $$('[data-field]', view).forEach((el) => {
      const k = el.dataset.field;
      if (k === 'hero_media_id') body[k] = el.value ? Number(el.value) : null;
      else body[k] = el.value.trim() || null;
    });
    try {
      await api('/api/admin/clinic', { method: 'PUT', body });
      toastOk('Homepage content saved');
    } catch (err) { toastErr(err.message); }
  };
}
