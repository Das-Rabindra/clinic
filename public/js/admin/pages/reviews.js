import { api, $, $$, esc, fmtDateTime, fmtDate, today, emptyState, toastOk, toastErr, openModal, closeModal, confirmAction } from '../core.js';

export async function renderReviews(view) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');

  async function load() {
    view.innerHTML = '<div class="spin"></div>';
    const data = await api('/api/admin/reviews');
    const c = data.connection;

    /* Honest connection state: what is wired up, what is missing, and when the
       last successful sync happened even if the latest one failed. */
    let banner = '';
    if (params.get('google_connected')) {
      banner = '<div class="banner banner-ok"><span>Google account connected. Choose the clinic location below, then sync.</span></div>';
    } else if (params.get('google_error')) {
      banner = `<div class="banner banner-err"><span>${esc(params.get('google_error'))}</span></div>`;
    }
    if (c.last_error) {
      banner += `<div class="banner banner-err">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>
        <span><strong>Google Reviews could not be synchronised.</strong> ${esc(c.last_error)}<br>
        Last successful sync: ${c.last_sync_at ? fmtDateTime(c.last_sync_at) : 'never'}. The website continues to show the reviews from that sync.</span></div>`;
    }

    view.innerHTML = `
      ${banner}
      <div class="card">
        <div class="card-head">
          <div><h2>Google Business Profile</h2>
            <p class="card-sub">Reviews are fetched through the official Google Business Profile API. Nothing is scraped and no review text can be edited.</p></div>
          <div class="btn-row">
            ${c.connected ? `
              <button class="btn btn-primary btn-sm" id="syncBtn">Sync now</button>
              <button class="btn btn-ghost btn-sm" id="pickLoc">Change location</button>
              <button class="btn btn-danger btn-sm" id="disconnectBtn">Disconnect</button>`
              : '<button class="btn btn-primary btn-sm" id="connectBtn">Connect Google Business Profile</button>'}
          </div>
        </div>

        <dl class="kv">
          <dt>OAuth credentials</dt>
          <dd>${c.oauth_configured
            ? '<span class="pill pill-confirmed">configured</span>'
            : '<span class="pill pill-not_configured">not configured</span> — add a client ID and secret in <a href="#/integrations">Integrations</a>'}</dd>
          <dt>Connection</dt><dd><span class="pill pill-${esc(c.status)}">${esc(String(c.status).replace(/_/g, ' '))}</span></dd>
          ${c.location_title || c.location_name ? `<dt>Location</dt><dd>${esc(c.location_title || c.location_name)}</dd>` : ''}
          <dt>Last sync</dt><dd>${c.last_sync_at ? fmtDateTime(c.last_sync_at) : '<span class="t-muted">never</span>'}</dd>
          <dt>Reviews stored</dt><dd>${c.review_count}</dd>
          <dt>Redirect URI</dt><dd><span class="code">${esc(c.redirect_uri)}</span><div class="hint">Register this exact URI in your Google Cloud OAuth client.</div></dd>
        </dl>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h2>Reviews &amp; testimonials</h2>
            <p class="card-sub">
              ${data.aggregate.count} shown · average ${data.aggregate.average ?? '—'}.
              ${data.aggregate_verified?.count
                ? `${data.aggregate_verified.count} of them are Google reviews, and only those feed the star rating search engines see.`
                : 'None are Google reviews yet, so no star rating is published to search engines.'}
            </p></div>
          <button class="btn btn-primary btn-sm" id="addTestimonial">Add a patient testimonial</button>
        </div>
        ${data.reviews.length ? `
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Rating</th><th>Author</th><th>Review</th><th>Source</th><th>Date</th><th>Visible</th><th></th></tr></thead>
            <tbody>${data.reviews.map((r) => `
              <tr>
                <td style="color:var(--honey); white-space:nowrap;">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
                <td class="t-strong">${esc(r.author_name)}</td>
                <td style="max-width:320px;">${esc(String(r.text || '—').slice(0, 140))}${(r.text || '').length > 140 ? '…' : ''}</td>
                <td>${r.source === 'manual'
                  ? `<span class="pill pill-info">clinic</span>${r.collected_via ? `<div class="t-muted">${esc(r.collected_via)}</div>` : ''}`
                  : '<span class="pill pill-confirmed">Google</span>'}</td>
                <td class="t-muted">${r.reviewed_at ? fmtDate(String(r.reviewed_at).slice(0, 10)) : '—'}</td>
                <td>${r.is_visible ? '<span class="pill pill-confirmed">shown</span>' : '<span class="pill pill-disabled">hidden</span>'}</td>
                <td><div class="t-actions">
                  <button class="btn btn-ghost btn-xs" data-vis="${r.id}" data-to="${r.is_visible ? 0 : 1}">${r.is_visible ? 'Hide' : 'Show'}</button>
                  <button class="btn btn-ghost btn-xs" data-feat="${r.id}" data-to="${r.is_featured ? 0 : 1}">${r.is_featured ? 'Unfeature' : 'Feature'}</button>
                  ${r.source === 'manual' ? `<button class="btn btn-danger btn-xs" data-delt="${r.id}">Delete</button>` : ''}
                </div></td>
              </tr>`).join('')}</tbody>
          </table></div>`
          : emptyState('No reviews synced yet. Connect the Google Business Profile and run a sync — the website shows only genuine synced reviews.', 'star')}
      </div>`;

    const connect = $('#connectBtn');
    if (connect) {
      connect.onclick = async () => {
        try {
          const r = await api('/api/admin/reviews/connect', { method: 'POST' });
          window.location.href = r.auth_url;
        } catch (err) {
          if (err.code === 'NOT_CONFIGURED') {
            openModal('Google OAuth is not configured', `
              <p style="font-size:13.5px; line-height:1.7;">To connect the clinic's Google Business Profile you first need a Google Cloud OAuth client:</p>
              <ol style="font-size:13px; line-height:1.9; padding-left:20px; color:#4B564F;">
                <li>Create a project in the Google Cloud Console.</li>
                <li>Enable the <strong>My Business Account Management</strong>, <strong>My Business Business Information</strong> and <strong>Google My Business</strong> APIs.</li>
                <li>Create an OAuth 2.0 Client ID of type <strong>Web application</strong>.</li>
                <li>Add this redirect URI exactly:<br><span class="code">${esc(err.redirect_uri || '')}</span></li>
                <li>Paste the client ID and secret into <a href="#/integrations">Integrations</a>.</li>
              </ol>`, { footer: '<button class="btn btn-primary" onclick="location.hash=\'#/integrations\'">Open Integrations</button>' });
          } else toastErr(err.message);
        }
      };
    }

    const sync = $('#syncBtn');
    if (sync) {
      sync.onclick = async () => {
        sync.disabled = true; sync.textContent = 'Syncing…';
        try {
          const r = await api('/api/admin/reviews/sync', { method: 'POST' });
          if (r.ok) toastOk(`Synced ${r.synced} review(s)`);
          else toastErr(r.error);
        } catch (err) { toastErr(err.message); }
        load();
      };
    }

    const disconnect = $('#disconnectBtn');
    if (disconnect) {
      disconnect.onclick = async () => {
        await api('/api/admin/reviews/disconnect', { method: 'POST' });
        toastOk('Disconnected'); load();
      };
    }

    const pick = $('#pickLoc');
    if (pick) pick.onclick = () => pickLocation(load);

    $('#addTestimonial').onclick = () => testimonialForm(load);
    $$('[data-delt]', view).forEach((b) => {
      b.onclick = async () => {
        if (!await confirmAction('Delete testimonial',
          'Remove this testimonial from the website? Google reviews cannot be deleted here — hide them instead.',
          { confirmLabel: 'Delete' })) return;
        try { await api(`/api/admin/reviews/testimonials/${b.dataset.delt}`, { method: 'DELETE' }); toastOk('Testimonial deleted'); load(); }
        catch (err) { toastErr(err.message); }
      };
    });

    $$('[data-vis]', view).forEach((b) => {
      b.onclick = async () => {
        await api(`/api/admin/reviews/${b.dataset.vis}/visibility`, { method: 'POST', body: { visible: b.dataset.to === '1' } });
        load();
      };
    });
    $$('[data-feat]', view).forEach((b) => {
      b.onclick = async () => {
        await api(`/api/admin/reviews/${b.dataset.feat}/feature`, { method: 'POST', body: { featured: b.dataset.to === '1' } });
        load();
      };
    });

    if (params.get('google_connected')) pickLocation(load);
  }

  await load();
}

/**
 * Add a testimonial the clinic collected directly.
 *
 * The consent checkbox is not decoration: a real person's name and words are
 * being published, and fabricating a review is an unfair trade practice under
 * the Consumer Protection Act. The attestation and who made it are recorded in
 * the audit log.
 */
function testimonialForm(reload) {
  openModal('Add a patient testimonial', `
    <div class="banner banner-warn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>
      <span>Only add words a real patient actually said or wrote, and only with their
      permission. Invented reviews are unlawful, and published testimonials are the
      kind of thing patients and regulators check.</span>
    </div>

    <div class="frow">
      <div class="field"><label>Patient name as it should appear</label>
        <input type="text" id="tName" placeholder="e.g. Anita R.">
        <div class="hint">A first name and initial is fine, and is kinder on their privacy.</div></div>
      <div class="field"><label>Rating</label>
        <select id="tRating">
          <option value="5">★★★★★ — 5</option>
          <option value="4">★★★★☆ — 4</option>
          <option value="3">★★★☆☆ — 3</option>
          <option value="2">★★☆☆☆ — 2</option>
          <option value="1">★☆☆☆☆ — 1</option>
        </select></div>
    </div>
    <div class="field"><label>What the patient said</label>
      <textarea id="tText" rows="4" placeholder="Their own words, as closely as possible."></textarea></div>
    <div class="frow">
      <div class="field"><label>Date</label><input type="date" id="tDate" value="${today()}"></div>
      <div class="field"><label>How it was collected</label>
        <input type="text" id="tVia" placeholder="e.g. WhatsApp message, feedback card">
        <div class="hint">Recorded internally; not shown on the website.</div></div>
    </div>

    <fieldset>
      <legend>Consent</legend>
      <label class="check">
        <input type="checkbox" id="tConsent">
        <span><strong>I confirm this is a real patient of this clinic, these are their own
        words, and they agreed to them being published on the website.</strong>
        <br><span class="hint">Your name and the date are recorded in the audit log.</span></span>
      </label>
      <div class="field"><label>Reference (optional)</label>
        <input type="text" id="tConsentNote" placeholder="e.g. consent given on WhatsApp, 2 Sep"></div>
    </fieldset>

    <label class="check"><input type="checkbox" id="tVisible" checked>
      <span>Show on the website</span></label>`, {
    footer: '<button class="btn btn-ghost" id="tCancel">Cancel</button><button class="btn btn-primary" id="tSave">Add testimonial</button>',
    wide: true,
  });

  $('#tCancel').onclick = closeModal;
  $('#tSave').onclick = async () => {
    const body = {
      author_name: $('#tName').value.trim(),
      rating: Number($('#tRating').value),
      text: $('#tText').value.trim(),
      reviewed_at: $('#tDate').value || undefined,
      collected_via: $('#tVia').value.trim(),
      consent_note: $('#tConsentNote').value.trim(),
      consent_confirmed: $('#tConsent').checked,
      is_visible: $('#tVisible').checked,
    };
    if (!body.author_name || !body.text) { toastErr('Add the patient name and what they said.'); return; }
    if (body.is_visible && !body.consent_confirmed) {
      toastErr('Confirm the patient agreed before publishing their words.'); return;
    }
    try {
      await api('/api/admin/reviews/testimonials', { method: 'POST', body });
      toastOk('Testimonial added');
      closeModal(); reload();
    } catch (err) { toastErr(err.message); }
  };
}

async function pickLocation(reload) {
  openModal('Choose the clinic location', '<div class="spin"></div>');
  try {
    const { accounts } = await api('/api/admin/reviews/google/accounts');
    if (!accounts.length) {
      $('#modalBody').innerHTML = '<div class="banner banner-warn"><span>No Google Business accounts were returned for this Google user.</span></div>';
      return;
    }
    $('#modalBody').innerHTML = `
      <div class="field"><label>Google account</label>
        <select id="accSel">${accounts.map((a) => `<option value="${esc(a.name)}">${esc(a.accountName || a.name)}</option>`).join('')}</select>
      </div>
      <div id="locBox"><div class="spin"></div></div>`;

    async function loadLocations() {
      const box = $('#locBox');
      box.innerHTML = '<div class="spin"></div>';
      try {
        const { locations } = await api('/api/admin/reviews/google/locations?account=' + encodeURIComponent($('#accSel').value));
        box.innerHTML = locations.length ? `
          <div class="field"><label>Clinic location</label>
            <select id="locSel">${locations.map((l) => `<option value="${esc(l.name)}" data-title="${esc(l.title)}">${esc(l.title)}${l.address ? ' — ' + esc(l.address) : ''}</option>`).join('')}</select>
          </div>
          <button class="btn btn-primary" id="saveLoc">Use this location</button>`
          : '<div class="banner banner-warn"><span>No locations found under this account.</span></div>';
        const save = $('#saveLoc');
        if (save) {
          save.onclick = async () => {
            const sel = $('#locSel');
            await api('/api/admin/reviews/google/location', {
              method: 'POST',
              body: {
                account_name: $('#accSel').value,
                location_name: sel.value,
                location_title: sel.selectedOptions[0].dataset.title,
              },
            });
            toastOk('Location selected — running first sync');
            closeModal();
            await api('/api/admin/reviews/sync', { method: 'POST' });
            reload();
          };
        }
      } catch (err) {
        box.innerHTML = `<div class="banner banner-err"><span>${esc(err.message)}</span></div>`;
      }
    }
    $('#accSel').onchange = loadLocations;
    await loadLocations();
  } catch (err) {
    $('#modalBody').innerHTML = `<div class="banner banner-err"><span>${esc(err.message)}</span></div>`;
  }
}
