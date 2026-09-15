import { api, $, $$, esc, emptyState, toastOk, toastErr, openModal, closeModal, confirmAction } from '../core.js';

export async function renderServices(view) {
  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>Services</h2><p class="card-sub">These appear on the website and drive appointment durations</p></div>
        <button class="btn btn-primary btn-sm" id="newSvc">Add service</button>
      </div>
      <div id="svcList"><div class="spin"></div></div>
    </div>`;

  async function load() {
    const box = $('#svcList');
    const { services, categories } = await api('/api/admin/services');
    box.innerHTML = services.length ? `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Order</th><th>Photo</th><th>Name</th><th>Category</th><th>Duration</th><th>Price</th><th>Bookable</th><th>Status</th><th></th></tr></thead>
        <tbody>${services.map((s, i) => `
          <tr>
            <td>
              <button class="btn btn-ghost btn-xs" data-up="${i}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
              <button class="btn btn-ghost btn-xs" data-down="${i}" ${i === services.length - 1 ? 'disabled' : ''}>&darr;</button>
            </td>
            <td>${s.image_url
              ? `<img src="${esc(s.thumb_url || s.image_url)}" alt="" class="svc-thumb">`
              : '<span class="svc-thumb svc-thumb-empty" title="No photo — the card falls back to illustrated artwork">&mdash;</span>'}</td>
            <td><div class="t-strong">${esc(s.name)}</div><div class="t-muted">${esc(s.short_desc || '')}</div>
              ${s.has_detail_page ? `<a class="t-link" href="/services/${esc(s.slug)}" target="_blank" rel="noopener">/services/${esc(s.slug)}</a>` : '<span class="t-muted">no page</span>'}</td>
            <td>${esc(s.category_name || '—')}</td>
            <td class="mono" style="font-size:12px;">${s.duration_min} min</td>
            <td>${s.show_price && s.price_from ? esc((s.currency === 'INR' ? '₹' : '') + s.price_from) : '<span class="t-muted">hidden</span>'}</td>
            <td>${s.bookable ? 'Yes' : '<span class="t-muted">No</span>'}</td>
            <td>${s.is_active ? '<span class="pill pill-confirmed">active</span>' : '<span class="pill pill-disabled">inactive</span>'}</td>
            <td><div class="t-actions">
              <button class="btn btn-ghost btn-xs" data-edit="${s.id}">Edit</button>
              <button class="btn btn-danger btn-xs" data-del="${s.id}">Delete</button>
            </div></td>
          </tr>`).join('')}</tbody>
      </table></div>` : emptyState('No services yet. Add the treatments this clinic offers.', 'inbox');

    $$('[data-edit]', box).forEach((b) => {
      b.onclick = () => form(services.find((s) => s.id === Number(b.dataset.edit)), categories, load);
    });
    $$('[data-del]', box).forEach((b) => {
      b.onclick = async () => {
        const s = services.find((x) => x.id === Number(b.dataset.del));
        if (!await confirmAction('Delete service', `Remove "${s.name}" from the website? Existing appointments keep their record.`, { confirmLabel: 'Delete' })) return;
        try { await api(`/api/admin/services/${s.id}`, { method: 'DELETE' }); toastOk('Service removed'); load(); }
        catch (err) { toastErr(err.message); }
      };
    });

    const move = async (from, to) => {
      const ids = services.map((s) => s.id);
      const [x] = ids.splice(from, 1);
      ids.splice(to, 0, x);
      await api('/api/admin/services/reorder', { method: 'POST', body: { ids } });
      load();
    };
    $$('[data-up]', box).forEach((b) => { b.onclick = () => move(Number(b.dataset.up), Number(b.dataset.up) - 1); });
    $$('[data-down]', box).forEach((b) => { b.onclick = () => move(Number(b.dataset.down), Number(b.dataset.down) + 1); });

    $('#newSvc').onclick = () => form(null, categories, load);
  }

  await load();
}

function form(svc, categories, reload) {
  const s = svc || { duration_min: 30, bookable: 1, is_active: 1, currency: 'INR', show_price: 0 };
  openModal(svc ? `Edit ${svc.name}` : 'Add service', `
    <div class="field"><label>Service name</label><input type="text" data-field="name" value="${esc(s.name || '')}"><span class="err"></span></div>
    <div class="frow">
      <div class="field"><label>Category</label>
        <input type="text" data-field="category" list="catList" value="${esc(s.category_name || '')}" placeholder="e.g. Restorative">
        <datalist id="catList">${categories.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
      </div>
      <div class="field"><label>Appointment duration (minutes)</label>
        <input type="number" data-field="duration_min" value="${s.duration_min}" min="5" max="480" step="5">
        <div class="hint">Determines how many booking slots this treatment occupies.</div>
      </div>
    </div>
    <div class="field"><label>Short description</label>
      <input type="text" data-field="short_desc" value="${esc(s.short_desc || '')}" maxlength="400">
      <div class="hint">Shown in the services list on the website.</div>
    </div>
    <div class="field"><label>Card photo</label>
      <div class="svc-photo-pick">
        <div class="svc-photo-preview" id="svcPhotoPreview">${s.image_url
          ? `<img src="${esc(s.thumb_url || s.image_url)}" alt="">`
          : '<span>Illustration</span>'}</div>
        <div>
          <button type="button" class="btn btn-ghost btn-sm" id="svcPickPhoto">Choose a photo</button>
          ${s.image_media_id ? '<button type="button" class="btn btn-ghost btn-sm" id="svcClearPhoto">Remove</button>' : ''}
          <div class="hint">A real photograph of this treatment at the clinic is best. Without one
          the card shows an illustration, which looks deliberate but says less than a photo.</div>
        </div>
      </div>
      <input type="hidden" data-field="image_media_id" value="${s.image_media_id ?? ''}">
    </div>

    <details class="svc-more"${(s.long_desc || s.who_needs || s.what_to_expect) ? ' open' : ''}>
      <summary>Treatment page content</summary>
      <div class="hint" style="margin:6px 0 14px;">
        Fills the page at <strong>/services/${esc(s.slug || '…')}</strong>. Leave a box empty and
        that section is simply left off the page.
      </div>
      <div class="field"><label>What it is</label>
        <textarea data-field="long_desc" rows="3">${esc(s.long_desc || '')}</textarea>
      </div>
      <div class="field"><label>When it may be needed</label>
        <textarea data-field="who_needs" rows="3">${esc(s.who_needs || '')}</textarea>
        <div class="hint">The symptoms or situations that bring a patient in for this.</div>
      </div>
      <div class="field"><label>What to expect at the appointment</label>
        <textarea data-field="what_to_expect" rows="3">${esc(s.what_to_expect || '')}</textarea>
      </div>
      <div class="field"><label>What this treatment does for the patient</label>
        <textarea data-field="benefits" rows="4">${esc(s.benefits || '')}</textarea>
        <div class="hint">One per line. Each becomes a ticked point on the page.</div>
      </div>
      <label class="check"><input type="checkbox" data-field="has_detail_page" ${s.has_detail_page !== 0 ? 'checked' : ''}>
        <span>Give this treatment its own page<br><span class="hint">Turn off and the card stops linking anywhere; the page returns "not found".</span></span></label>
      <label class="check"><input type="checkbox" data-field="is_featured" ${s.is_featured ? 'checked' : ''}>
        <span>Show this treatment first<br><span class="hint">Featured treatments lead the card grid and the footer list.</span></span></label>
    </details>

    <details class="svc-more"${(s.seo_title || s.seo_description) ? ' open' : ''}>
      <summary>Search engine listing</summary>
      <div class="hint" style="margin:6px 0 14px;">How this treatment's page appears in Google results.
      Leave both empty and a sensible title is generated from the name and the town.</div>
      <div class="field"><label>Page title</label>
        <input type="text" data-field="seo_title" value="${esc(s.seo_title || '')}" maxlength="120"
               placeholder="e.g. Root Canal Treatment in Talcher | Samal Dental Care">
        <div class="hint">Around 60 characters shows in full.</div>
      </div>
      <div class="field"><label>Description</label>
        <textarea data-field="seo_description" rows="2" maxlength="300">${esc(s.seo_description || '')}</textarea>
        <div class="hint">Around 155 characters shows in full.</div>
      </div>
    </details>
    <div class="frow">
      <div class="field"><label>Starting price (optional)</label>
        <input type="number" data-field="price_from" value="${s.price_from ?? ''}" min="0" step="1">
      </div>
      <div class="field"><label>Currency</label><input type="text" data-field="currency" value="${esc(s.currency || 'INR')}" maxlength="8"></div>
    </div>
    <label class="check"><input type="checkbox" data-field="show_price" ${s.show_price ? 'checked' : ''}>
      <span>Show the starting price on the website<br><span class="hint">Only enable if the clinic wants prices published.</span></span></label>
    <label class="check"><input type="checkbox" data-field="bookable" ${s.bookable ? 'checked' : ''}>
      <span>Patients can book this online</span></label>
    <label class="check"><input type="checkbox" data-field="is_active" ${s.is_active ? 'checked' : ''}>
      <span>Show on the website</span></label>`, {
    footer: '<button class="btn btn-ghost" id="svcCancel">Cancel</button><button class="btn btn-primary" id="svcSave">Save</button>',
  });

  $('#svcCancel').onclick = closeModal;

  const photoField = () => $('[data-field="image_media_id"]');
  const setPhoto = (id, url) => {
    photoField().value = id ?? '';
    $('#svcPhotoPreview').innerHTML = url ? `<img src="${esc(url)}" alt="">` : '<span>Illustration</span>';
  };
  if ($('#svcClearPhoto')) $('#svcClearPhoto').onclick = () => setPhoto(null, null);
  $('#svcPickPhoto').onclick = () => pickPhoto(setPhoto);
  $('#svcSave').onclick = async () => {
    const body = {};
    $$('[data-field]').forEach((el) => {
      const k = el.dataset.field;
      if (el.type === 'checkbox') body[k] = el.checked;
      else if (el.type === 'number') body[k] = el.value === '' ? null : Number(el.value);
      else if (k === 'image_media_id') body[k] = el.value ? Number(el.value) : null;
      else body[k] = el.value.trim() || null;
    });
    if (!body.name) { toastErr('Service name is required.'); return; }
    try {
      if (svc) await api(`/api/admin/services/${svc.id}`, { method: 'PUT', body });
      else await api('/api/admin/services', { method: 'POST', body });
      toastOk(svc ? 'Service updated' : 'Service added');
      closeModal();
      reload();
    } catch (err) { toastErr(err.message); }
  };
}


/**
 * Pick an image from the media library.
 *
 * Opens over the service form rather than replacing it, so a half-filled form
 * is not lost — the caller gets the chosen id back through `onPick` and the
 * form stays exactly as it was.
 */
async function pickPhoto(onPick) {
  const holder = document.createElement('div');
  holder.className = 'picker-layer';
  holder.innerHTML = '<div class="picker-panel"><div class="spin"></div></div>';
  document.body.appendChild(holder);
  const close = () => holder.remove();
  holder.onclick = (e) => { if (e.target === holder) close(); };

  let media = [];
  try { media = await api('/api/admin/gallery/media'); }
  catch (err) { toastErr(err.message); close(); return; }

  const originals = media.filter((m) => !m.variant_of);
  holder.querySelector('.picker-panel').innerHTML = `
    <div class="picker-head">
      <h3>Choose a photo</h3>
      <button type="button" class="btn btn-ghost btn-xs" id="pickClose">Close</button>
    </div>
    ${originals.length ? `<div class="picker-grid">${originals.map((m) => `
      <button type="button" class="picker-item" data-id="${m.id}" data-url="${esc(m.thumb_url || m.url)}">
        <img src="${esc(m.thumb_url || m.url)}" alt="${esc(m.alt || m.original_name || '')}" loading="lazy">
        <span>${esc(m.original_name || '')}</span>
      </button>`).join('')}</div>`
      : `<p class="hint" style="padding:18px 0;">No photos uploaded yet. Go to
         <strong>Gallery &rarr; Media library</strong>, upload one, then come back here.</p>`}`;

  holder.querySelector('#pickClose').onclick = close;
  holder.querySelectorAll('.picker-item').forEach((b) => {
    b.onclick = () => { onPick(Number(b.dataset.id), b.dataset.url); close(); };
  });
}
