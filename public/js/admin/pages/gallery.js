import { api, $, $$, esc, emptyState, toastOk, toastErr, openModal, closeModal, confirmAction } from '../core.js';

const CATEGORY_LABELS = {
  clinic: 'Clinic', reception: 'Reception', treatment_room: 'Treatment room',
  exterior: 'Exterior', equipment: 'Equipment', waiting_area: 'Waiting area',
  team: 'Team', doctor: 'Doctor', treatment: 'Patient work (before & after)',
};

export async function renderGallery(view) {
  let tab = 'items';

  view.innerHTML = `
    <div class="tabs">
      <button class="tab active" data-tab="items">Gallery items</button>
      <button class="tab" data-tab="media">Media library</button>
    </div>
    <div id="gBody"><div class="spin"></div></div>`;

  $$('.tab', view).forEach((t) => {
    t.onclick = () => {
      tab = t.dataset.tab;
      $$('.tab', view).forEach((x) => x.classList.toggle('active', x === t));
      render();
    };
  });

  async function render() {
    if (tab === 'items') await renderItems($('#gBody'), render);
    else await renderMedia($('#gBody'), render);
  }
  await render();
}

/* ══════════ Gallery items ══════════ */
async function renderItems(box, reload) {
  box.innerHTML = '<div class="spin"></div>';
  const data = await api('/api/admin/gallery');

  box.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>Gallery items</h2><p class="card-sub">Published items appear on the public website</p></div>
        <button class="btn btn-primary btn-sm" id="addItem">Add gallery item</button>
      </div>

      <div class="banner banner-info">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5.5-3.8 9.7-8 11-4.2-1.3-8-5.5-8-11V6l8-4z"/></svg>
        <span><strong>Patient photographs.</strong> Anything in the <em>Patient work</em> category cannot be published until written patient consent is recorded. Use descriptive titles such as “Before &amp; After — Smile Restoration”, never a patient's name.</span>
      </div>

      ${data.items.length ? `
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Order</th><th>Image</th><th>Title</th><th>Category</th><th>Consent</th><th>Status</th><th></th></tr></thead>
          <tbody>${data.items.map((g, i) => `
            <tr>
              <td>
                <button class="btn btn-ghost btn-xs" data-up="${i}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
                <button class="btn btn-ghost btn-xs" data-down="${i}" ${i === data.items.length - 1 ? 'disabled' : ''}>&darr;</button>
              </td>
              <td><img class="thumb" src="${esc(g.thumb_url || g.image_url)}" alt=""></td>
              <td><div class="t-strong">${esc(g.title)}</div><div class="t-muted">${esc(g.description || '')}</div></td>
              <td>${esc(CATEGORY_LABELS[g.category] || g.category)}</td>
              <td>${g.category === 'treatment'
                ? (g.consent_confirmed
                  ? '<span class="pill pill-confirmed">confirmed</span>'
                  : '<span class="pill pill-cancelled">required</span>')
                : '<span class="t-muted">n/a</span>'}</td>
              <td>${g.is_published ? '<span class="pill pill-confirmed">live</span>' : '<span class="pill pill-disabled">hidden</span>'}</td>
              <td><div class="t-actions">
                <button class="btn btn-ghost btn-xs" data-pub="${g.id}" data-to="${g.is_published ? 0 : 1}">${g.is_published ? 'Unpublish' : 'Publish'}</button>
                <button class="btn btn-ghost btn-xs" data-edit="${g.id}">Edit</button>
                <button class="btn btn-danger btn-xs" data-del="${g.id}">Delete</button>
              </div></td>
            </tr>`).join('')}</tbody>
        </table></div>` : emptyState('No gallery items yet. Upload photos in the Media library, then add them here.', 'image')}
    </div>`;

  $('#addItem').onclick = () => itemForm(null, data, reload);
  $$('[data-edit]', box).forEach((b) => {
    b.onclick = () => itemForm(data.items.find((g) => g.id === Number(b.dataset.edit)), data, reload);
  });
  $$('[data-pub]', box).forEach((b) => {
    b.onclick = async () => {
      try {
        await api(`/api/admin/gallery/${b.dataset.pub}/publish`, {
          method: 'POST', body: { published: b.dataset.to === '1' },
        });
        toastOk(b.dataset.to === '1' ? 'Published' : 'Unpublished');
        reload();
      } catch (err) {
        if (err.code === 'CONSENT_REQUIRED') {
          toastErr('Confirm patient consent before publishing this photograph.');
        } else toastErr(err.message);
      }
    };
  });
  $$('[data-del]', box).forEach((b) => {
    b.onclick = async () => {
      if (!await confirmAction('Delete gallery item', 'Remove this item from the gallery?', { confirmLabel: 'Delete' })) return;
      await api(`/api/admin/gallery/${b.dataset.del}`, { method: 'DELETE' });
      toastOk('Deleted'); reload();
    };
  });
  const move = async (from, to) => {
    const ids = data.items.map((g) => g.id);
    const [x] = ids.splice(from, 1);
    ids.splice(to, 0, x);
    await api('/api/admin/gallery/reorder', { method: 'POST', body: { ids } });
    reload();
  };
  $$('[data-up]', box).forEach((b) => { b.onclick = () => move(Number(b.dataset.up), Number(b.dataset.up) - 1); });
  $$('[data-down]', box).forEach((b) => { b.onclick = () => move(Number(b.dataset.down), Number(b.dataset.down) + 1); });
}

async function itemForm(item, data, reload) {
  const media = await api('/api/admin/gallery/media');
  const g = item || { category: 'clinic', is_published: 0, consent_confirmed: 0 };

  openModal(item ? 'Edit gallery item' : 'Add gallery item', `
    ${item ? '' : `<div class="field"><label>Image</label>
      <select id="giMedia">
        <option value="">Choose an uploaded image…</option>
        ${media.map((m) => `<option value="${m.id}">${esc(m.original_name || m.key)} (${m.width}×${m.height})</option>`).join('')}
      </select>
      <div class="hint">No images listed? Upload them in the Media library tab first.</div></div>`}

    <div class="field"><label>Title</label>
      <input type="text" id="giTitle" value="${esc(g.title || '')}" placeholder="e.g. Before &amp; After — Smile Restoration">
      <div class="hint">Describe the treatment, never the patient.</div>
    </div>
    <div class="field"><label>Description (optional)</label><textarea id="giDesc" rows="2">${esc(g.description || '')}</textarea></div>
    <div class="field"><label>Category</label>
      <select id="giCat">${Object.entries(CATEGORY_LABELS).map(([k, v]) =>
        `<option value="${k}" ${g.category === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
    </div>
    <div class="field"><label>After photo (optional, for before &amp; after pairs)</label>
      <select id="giAfter">
        <option value="">None</option>
        ${media.map((m) => `<option value="${m.id}" ${g.after_media_id === m.id ? 'selected' : ''}>${esc(m.original_name || m.key)}</option>`).join('')}
      </select>
    </div>

    <fieldset id="consentBox" ${g.category === 'treatment' ? '' : 'hidden'}>
      <legend>Patient consent</legend>
      <label class="check">
        <input type="checkbox" id="giConsent" ${g.consent_confirmed ? 'checked' : ''}>
        <span><strong>I confirm written patient consent has been obtained</strong> for this photograph to be published publicly on the clinic website.
        <br><span class="hint">Your name and the date are recorded in the audit log. Publishing is blocked without this.</span></span>
      </label>
      <div class="field"><label>Consent reference (optional)</label>
        <input type="text" id="giConsentNote" value="${esc(g.consent_note || '')}" placeholder="e.g. Signed consent form on file, 12 Sep 2026">
      </div>
    </fieldset>

    <label class="check"><input type="checkbox" id="giPub" ${g.is_published ? 'checked' : ''}>
      <span>Publish on the website</span></label>`, {
    footer: '<button class="btn btn-ghost" id="giCancel">Cancel</button><button class="btn btn-primary" id="giSave">Save</button>',
    wide: true,
  });

  $('#giCat').onchange = () => {
    $('#consentBox').hidden = $('#giCat').value !== 'treatment';
  };
  $('#giCancel').onclick = closeModal;
  $('#giSave').onclick = async () => {
    const body = {
      title: $('#giTitle').value.trim(),
      description: $('#giDesc').value.trim() || null,
      category: $('#giCat').value,
      after_media_id: $('#giAfter').value ? Number($('#giAfter').value) : null,
      is_published: $('#giPub').checked,
      consent_confirmed: $('#giConsent') ? $('#giConsent').checked : false,
      consent_note: $('#giConsentNote') ? ($('#giConsentNote').value.trim() || null) : null,
    };
    if (!body.title) { toastErr('A title is required.'); return; }
    try {
      if (item) {
        await api(`/api/admin/gallery/${item.id}`, { method: 'PUT', body });
      } else {
        const mediaId = Number($('#giMedia').value);
        if (!mediaId) { toastErr('Choose an image.'); return; }
        await api('/api/admin/gallery', { method: 'POST', body: { ...body, media_id: mediaId } });
      }
      toastOk('Saved');
      closeModal();
      reload();
    } catch (err) {
      if (err.code === 'CONSENT_REQUIRED') toastErr(err.message);
      else toastErr(err.message);
    }
  };
}

/**
 * Put an uploaded image somewhere on the public site.
 *
 * The library and the places a photo can appear used to be separate screens,
 * so uploading looked like it had done nothing. This closes that loop.
 */
async function placeImage(mediaId, reload) {
  const doctors = await api('/api/admin/doctors');
  const doctor = doctors[0];

  openModal('Where should this photo appear?', `
    <div class="choice-list">
      <button type="button" class="place-option" data-place="hero">
        <strong>Hero area</strong>
        <span>The large photo beside the headline at the top of the homepage.</span>
      </button>
      <button type="button" class="place-option" data-place="doctor">
        <strong>Dentist's portrait</strong>
        <span>Shown in the About section${doctor ? ` for ${esc(doctor.name)}` : ''}.</span>
      </button>
      <button type="button" class="place-option" data-place="treatment">
        <strong>Treatment card</strong>
        <span>The photo on one of the treatment cards, and at the top of that treatment's page.</span>
      </button>
      <button type="button" class="place-option" data-place="gallery">
        <strong>Gallery</strong>
        <span>Added to “A closer look at the clinic”. You will be asked for a caption.</span>
      </button>
      <button type="button" class="place-option" data-place="logo">
        <strong>Clinic logo</strong>
        <span>Replaces the mark in the header and footer.</span>
      </button>
    </div>
    <div id="placeExtra"></div>`, {
    footer: '<button class="btn btn-ghost" id="placeCancel">Cancel</button>',
    wide: true,
  });

  $('#placeCancel').onclick = closeModal;

  $$('.place-option').forEach((btn) => {
    btn.onclick = async () => {
      const where = btn.dataset.place;
      try {
        if (where === 'hero') {
          await api('/api/admin/clinic', { method: 'PUT', body: { hero_media_id: mediaId } });
          toastOk('Set as the hero photo — refresh the website to see it');
          closeModal(); reload();
        } else if (where === 'logo') {
          await api('/api/admin/clinic', { method: 'PUT', body: { logo_media_id: mediaId } });
          toastOk('Set as the clinic logo');
          closeModal(); reload();
        } else if (where === 'doctor') {
          if (!doctor) { toastErr('No dentist record exists yet.'); return; }
          await api(`/api/admin/doctors/${doctor.id}`, { method: 'PUT', body: { photo_media_id: mediaId } });
          toastOk(`Set as ${doctor.name}'s photo`);
          closeModal(); reload();
        } else if (where === 'treatment') {
          const { services } = await api('/api/admin/services');
          const choices = services.filter((sv) => !sv.deleted_at);
          if (!choices.length) { toastErr('No treatments exist yet.'); return; }
          $('#placeExtra').innerHTML = `
            <hr style="border:none; border-top:1px solid var(--line); margin:18px 0;">
            <div class="field"><label>Which treatment?</label>
              <select id="txPick">${choices.map((sv) =>
                `<option value="${sv.id}">${esc(sv.name)}${sv.image_url ? ' — replaces the current photo' : ''}</option>`).join('')}</select>
            </div>
            <button class="btn btn-primary" id="txGo">Use for this treatment</button>`;
          $('#txGo').onclick = async () => {
            try {
              await api(`/api/admin/services/${$('#txPick').value}`, {
                method: 'PUT', body: { image_media_id: mediaId },
              });
              toastOk('Set as the treatment photo');
              closeModal(); reload();
            } catch (err) { toastErr(err.message); }
          };
        } else {
          // The gallery needs a caption, so ask for one in place.
          $('#placeExtra').innerHTML = `
            <hr style="border:none; border-top:1px solid var(--line); margin:18px 0;">
            <div class="field"><label>Caption shown on the website</label>
              <input type="text" id="galTitle" placeholder="e.g. Reception area" autofocus></div>
            <div class="field"><label>Category</label>
              <select id="galCat">${Object.entries(CATEGORY_LABELS)
                .filter(([k]) => k !== 'treatment')
                .map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
              <div class="hint">Patient before-and-after photos are added from the Gallery items tab, where consent is recorded.</div>
            </div>
            <button class="btn btn-primary" id="galGo">Add to gallery</button>`;
          $('#galTitle').focus();
          $('#galGo').onclick = async () => {
            const title = $('#galTitle').value.trim();
            if (!title) { toastErr('Give the photo a short caption.'); return; }
            try {
              await api('/api/admin/gallery', {
                method: 'POST',
                body: { media_id: mediaId, title, category: $('#galCat').value, is_published: true },
              });
              toastOk('Added to the gallery and published');
              closeModal(); reload();
            } catch (err) { toastErr(err.message); }
          };
        }
      } catch (err) { toastErr(err.message); }
    };
  });
}

/* ══════════ Media library ══════════ */
async function renderMedia(box, reload) {
  box.innerHTML = '<div class="spin"></div>';
  const media = await api('/api/admin/gallery/media');

  box.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h2>Media library</h2>
        <p class="card-sub">JPEG, PNG or WebP up to 10 MB. Images are re-encoded and all EXIF data (including GPS location) is removed automatically.</p></div></div>

      <div class="banner banner-info">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/></svg>
        <span><strong>Uploading stores a photo here; it does not place it on the website yet.</strong>
        Once uploaded, press <em>Use this photo</em> on the image and choose where it should appear —
        the hero area, the dentist's portrait, the gallery, or the logo.</span>
      </div>

      <div class="field">
        <label>Upload to folder</label>
        <select id="upFolder">
          <option value="clinic">Clinic photos</option>
          <option value="treatment-results">Patient work / treatment results</option>
          <option value="doctor">Doctor</option>
          <option value="services">Services</option>
          <option value="branding">Branding (logo, favicon, social image)</option>
        </select>
      </div>

      <div class="dropzone" id="dz">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5-5 5 5M12 5v13"/></svg>
        <strong>Click to choose images</strong> or drag them here
        <input type="file" id="fileInput" accept="image/jpeg,image/png,image/webp" multiple hidden>
      </div>
      <div id="upStatus"></div>

      <div style="margin-top:20px;">
        ${media.length ? `<div class="media-grid">${media.map((m) => `
          <div class="media-tile">
            <img src="${esc(m.thumb_url)}" alt="" loading="lazy">
            <div class="mt-body">
              <div class="mt-title">${esc(m.original_name || m.key)}</div>
              <div class="mt-meta">${m.width}×${m.height} · ${Math.round(m.bytes / 1024)} KB · ${esc(m.folder)}</div>
            </div>
            <div class="mt-actions">
              <button class="btn btn-accent btn-xs" data-use="${m.id}">Use this photo</button>
              <a class="btn btn-ghost btn-xs" href="${esc(m.url)}" target="_blank" rel="noopener">View</a>
              <button class="btn btn-danger btn-xs" data-delm="${m.id}">Delete</button>
            </div>
          </div>`).join('')}</div>` : emptyState('No images uploaded yet.', 'image')}
      </div>
    </div>`;

  const dz = $('#dz');
  const input = $('#fileInput');
  dz.onclick = () => input.click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    upload(e.dataTransfer.files);
  };
  input.onchange = () => upload(input.files);

  async function upload(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    const status = $('#upStatus');
    status.innerHTML = `<div class="banner banner-info"><span>Uploading ${list.length} image(s)…</span></div>`;
    let ok = 0;
    const errors = [];
    for (const file of list) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('folder', $('#upFolder').value);
      try {
        await api('/api/admin/gallery/media', { method: 'POST', body: fd });
        ok++;
      } catch (err) { errors.push(`${file.name}: ${err.message}`); }
    }
    if (errors.length) {
      status.innerHTML = `<div class="banner banner-err"><span>${esc(errors.join(' · '))}</span></div>`;
    }
    if (ok) toastOk(`${ok} image(s) uploaded`);
    reload();
  }

  $$('[data-use]', box).forEach((b) => {
    b.onclick = () => placeImage(Number(b.dataset.use), reload);
  });

  $$('[data-delm]', box).forEach((b) => {
    b.onclick = async () => {
      if (!await confirmAction('Delete image', 'Permanently delete this image? Gallery items using it will be removed too.', { confirmLabel: 'Delete' })) return;
      try { await api(`/api/admin/gallery/media/${b.dataset.delm}`, { method: 'DELETE' }); toastOk('Image deleted'); reload(); }
      catch (err) { toastErr(err.message); }
    };
  });
}
