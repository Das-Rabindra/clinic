import {
  api, $, $$, esc, pill, fmtDateTime, emptyState, toastOk, toastErr,
  openModal, closeModal, confirmAction, state,
} from '../core.js';

/* ══════════ Admin users ══════════ */
export async function renderUsers(view) {
  async function load() {
    view.innerHTML = '<div class="spin"></div>';
    const users = await api('/api/admin/users');
    const isOwner = state.user.role === 'owner';

    view.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div><h2>Admin users</h2><p class="card-sub">Roles: owner (full control) · admin (settings &amp; content) · staff (day-to-day operations)</p></div>
          ${isOwner ? '<button class="btn btn-primary btn-sm" id="addUser">Add user</button>' : ''}
        </div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>${users.map((u) => `
            <tr>
              <td class="t-strong">${esc(u.name)}${u.id === state.user.id ? ' <span class="t-muted">(you)</span>' : ''}</td>
              <td>${esc(u.email)}</td>
              <td><span class="pill pill-info">${esc(u.role)}</span></td>
              <td>${u.is_active ? '<span class="pill pill-confirmed">active</span>' : '<span class="pill pill-disabled">disabled</span>'}</td>
              <td class="t-muted">${u.last_login_at ? fmtDateTime(u.last_login_at) : 'never'}</td>
              <td><div class="t-actions">
                ${isOwner ? `
                  <button class="btn btn-ghost btn-xs" data-edit="${u.id}">Edit</button>
                  <button class="btn btn-ghost btn-xs" data-reset="${u.id}">Reset password</button>
                  ${u.id !== state.user.id ? `<button class="btn btn-danger btn-xs" data-del="${u.id}">Remove</button>` : ''}
                ` : ''}
              </div></td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div class="card">
        <h2>Your password</h2>
        <p class="card-sub">Changing your password signs you out of all devices.</p>
        <div class="frow">
          <div class="field"><label>Current password</label><input type="password" id="pwCur" autocomplete="current-password"></div>
          <div class="field"><label>New password</label><input type="password" id="pwNew" autocomplete="new-password">
            <div class="hint">At least 12 characters.</div></div>
        </div>
        <button class="btn btn-primary btn-sm" id="pwSave">Change password</button>
      </div>`;

    $('#pwSave').onclick = async () => {
      try {
        const r = await api('/api/auth/change-password', {
          method: 'POST',
          body: { current_password: $('#pwCur').value, new_password: $('#pwNew').value },
        });
        toastOk(r.message);
        setTimeout(() => { window.location.href = '/admin/login'; }, 1500);
      } catch (err) { toastErr(err.message); }
    };

    const add = $('#addUser');
    if (add) add.onclick = () => userForm(null, load);
    $$('[data-edit]', view).forEach((b) => { b.onclick = () => userForm(users.find((u) => u.id === Number(b.dataset.edit)), load); });
    $$('[data-reset]', view).forEach((b) => {
      b.onclick = async () => {
        if (!await confirmAction('Reset password', 'Generate a temporary password and sign this user out everywhere?', { confirmLabel: 'Reset', danger: false })) return;
        const r = await api(`/api/admin/users/${b.dataset.reset}/reset-password`, { method: 'POST' });
        openModal('Temporary password', `
          <p style="font-size:13.5px;">Share this with the user through a secure channel. It is shown once and cannot be retrieved again.</p>
          <div class="code" style="font-size:16px; padding:12px; display:block; text-align:center; margin-top:12px;">${esc(r.temporary_password)}</div>`);
      };
    });
    $$('[data-del]', view).forEach((b) => {
      b.onclick = async () => {
        if (!await confirmAction('Remove user', 'Remove this admin account? They are signed out immediately.', { confirmLabel: 'Remove' })) return;
        try { await api(`/api/admin/users/${b.dataset.del}`, { method: 'DELETE' }); toastOk('User removed'); load(); }
        catch (err) { toastErr(err.message); }
      };
    });
  }
  await load();
}

function userForm(user, reload) {
  openModal(user ? `Edit ${user.name}` : 'Add admin user', `
    <div class="field"><label>Name</label><input type="text" id="uName" value="${esc(user?.name || '')}"></div>
    ${user ? '' : '<div class="field"><label>Email</label><input type="email" id="uEmail"></div>'}
    <div class="field"><label>Role</label>
      <select id="uRole">
        <option value="staff" ${user?.role === 'staff' ? 'selected' : ''}>Staff — appointments, patients, enquiries</option>
        <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>Admin — also content, clinic settings, integrations</option>
        <option value="owner" ${user?.role === 'owner' ? 'selected' : ''}>Owner — full control including admin users</option>
      </select>
    </div>
    ${user ? `<label class="check"><input type="checkbox" id="uActive" ${user.is_active ? 'checked' : ''}><span>Account is active</span></label>` : `
      <div class="field"><label>Password (optional)</label><input type="password" id="uPw" autocomplete="new-password">
        <div class="hint">Leave blank to generate a temporary password.</div></div>`}`, {
    footer: '<button class="btn btn-ghost" id="uCancel">Cancel</button><button class="btn btn-primary" id="uSave">Save</button>',
  });

  $('#uCancel').onclick = closeModal;
  $('#uSave').onclick = async () => {
    try {
      if (user) {
        await api(`/api/admin/users/${user.id}`, {
          method: 'PUT',
          body: { name: $('#uName').value.trim(), role: $('#uRole').value, is_active: $('#uActive').checked },
        });
        toastOk('User updated');
        closeModal();
      } else {
        const body = { name: $('#uName').value.trim(), email: $('#uEmail').value.trim(), role: $('#uRole').value };
        if ($('#uPw').value) body.password = $('#uPw').value;
        const r = await api('/api/admin/users', { method: 'POST', body });
        closeModal();
        if (r.temporary_password) {
          openModal('Temporary password', `
            <p style="font-size:13.5px;">Account created for <strong>${esc(r.user.email)}</strong>. Share this password securely — it is shown only once.</p>
            <div class="code" style="font-size:16px; padding:12px; display:block; text-align:center; margin-top:12px;">${esc(r.temporary_password)}</div>`);
        } else toastOk('User created');
      }
      reload();
    } catch (err) { toastErr(err.message); }
  };
}

/* ══════════ Integrations ══════════ */
export async function renderIntegrations(view) {
  async function load() {
    view.innerHTML = '<div class="spin"></div>';
    const data = await api('/api/admin/integrations');
    const get = (p) => data.integrations.find((i) => i.provider === p) || { config: {}, has_secrets: false, status: 'not_configured' };
    const wa = get('whatsapp'), gb = get('google_business'), smtp = get('smtp');

    view.innerHTML = `
      <div class="banner banner-info">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5.5-3.8 9.7-8 11-4.2-1.3-8-5.5-8-11V6l8-4z"/></svg>
        <span>Credentials are encrypted before they are stored and are never sent back to the browser. Saved secrets show as “stored” — leave a field blank to keep the existing value.</span>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h2>WhatsApp Cloud API</h2>
            <p class="card-sub">Sends booking confirmations, reminders and clinic alerts</p></div>
          <div class="btn-row">
            <span class="pill pill-${esc(wa.status)}">${esc(String(wa.status).replace(/_/g, ' '))}</span>
            <button class="btn btn-ghost btn-sm" data-test="whatsapp">Test connection</button>
          </div>
        </div>
        <div class="frow">
          <div class="field"><label>Phone number ID</label>
            <input type="text" data-wa="phone_number_id" value="${esc(wa.config.phone_number_id || '')}" placeholder="From Meta → WhatsApp → API Setup"></div>
          <div class="field"><label>Access token</label>
            <input type="password" data-was="token" placeholder="${wa.has_secrets ? '•••••••• stored' : 'Permanent access token'}">
            <div class="hint">A permanent System User token is recommended over a temporary one.</div></div>
        </div>
        <div class="frow">
          <div class="field"><label>API version</label><input type="text" data-wa="api_version" value="${esc(wa.config.api_version || 'v21.0')}"></div>
          <div class="field"><label>Template language</label><input type="text" data-wa="template_lang" value="${esc(wa.config.template_lang || 'en')}"></div>
        </div>
        <label class="check"><input type="checkbox" data-wa="use_templates" ${wa.config.use_templates !== false ? 'checked' : ''}>
          <span>Send using pre-approved message templates<br>
          <span class="hint">Meta requires approved templates for messages outside the 24-hour customer service window. Template names must match the notification templates: booking_received, appointment_confirmed, reminder_24h, reminder_2h, rescheduled, cancelled, follow_up, new_appointment_admin.</span></span></label>
        <label class="check"><input type="checkbox" data-waen ${wa.is_enabled ? 'checked' : ''}><span>Enable WhatsApp sending</span></label>
        <button class="btn btn-primary btn-sm" data-save="whatsapp">Save WhatsApp settings</button>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h2>Google Business Profile</h2><p class="card-sub">Fetches genuine Google reviews for the website</p></div>
          <div class="btn-row">
            <span class="pill pill-${esc(gb.status)}">${esc(String(gb.status).replace(/_/g, ' '))}</span>
            <a class="btn btn-ghost btn-sm" href="#/reviews">Open Reviews</a>
          </div>
        </div>
        <div class="frow">
          <div class="field"><label>OAuth client ID</label>
            <input type="text" data-gb="client_id" value="${esc(gb.config.client_id || '')}" placeholder="xxxxx.apps.googleusercontent.com"></div>
          <div class="field"><label>OAuth client secret</label>
            <input type="password" data-gbs="client_secret" placeholder="${gb.has_secrets ? '•••••••• stored' : 'GOCSPX-…'}"></div>
        </div>
        <div class="field"><label>Authorised redirect URI</label>
          <div class="code" style="display:block; padding:9px;">${esc(data.runtime.google.redirect_uri)}</div>
          <div class="hint">Add this exact URI to your OAuth client in the Google Cloud Console.</div></div>
        <button class="btn btn-primary btn-sm" data-save="google_business">Save Google settings</button>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h2>Email (SMTP)</h2><p class="card-sub">Optional. Sends appointment emails and admin password resets.</p></div>
          <div class="btn-row">
            <span class="pill pill-${esc(smtp.status)}">${esc(String(smtp.status).replace(/_/g, ' '))}</span>
            <button class="btn btn-ghost btn-sm" data-test="smtp">Test connection</button>
          </div>
        </div>
        <div class="frow">
          <div class="field"><label>Host</label><input type="text" data-sm="host" value="${esc(smtp.config.host || '')}" placeholder="smtp.example.com"></div>
          <div class="field"><label>Port</label><input type="number" data-sm="port" value="${esc(smtp.config.port || 587)}"></div>
        </div>
        <div class="frow">
          <div class="field"><label>Username</label><input type="text" data-sms="user" placeholder="${smtp.has_secrets ? '•••••••• stored' : 'SMTP username'}"></div>
          <div class="field"><label>Password</label><input type="password" data-sms="pass" placeholder="${smtp.has_secrets ? '•••••••• stored' : 'SMTP password'}"></div>
        </div>
        <div class="field"><label>From address</label><input type="text" data-sm="from" value="${esc(smtp.config.from || '')}" placeholder="Samal Dental Care &lt;noreply@example.com&gt;"></div>
        <label class="check"><input type="checkbox" data-sm="secure" ${smtp.config.secure ? 'checked' : ''}><span>Use TLS on connect (port 465)</span></label>
        <label class="check"><input type="checkbox" data-smen ${smtp.is_enabled ? 'checked' : ''}><span>Enable email sending</span></label>
        <button class="btn btn-primary btn-sm" data-save="smtp">Save email settings</button>
      </div>`;

    const collect = (attr, secretAttr) => {
      const config = {}, secrets = {};
      $$(`[data-${attr}]`, view).forEach((el) => {
        const k = el.dataset[attr];
        if (el.type === 'checkbox') config[k] = el.checked;
        else if (el.type === 'number') config[k] = Number(el.value);
        else config[k] = el.value.trim();
      });
      $$(`[data-${secretAttr}]`, view).forEach((el) => {
        if (el.value.trim()) secrets[el.dataset[secretAttr]] = el.value.trim();
      });
      return { config, secrets };
    };

    $$('[data-save]', view).forEach((btn) => {
      btn.onclick = async () => {
        const p = btn.dataset.save;
        let payload;
        if (p === 'whatsapp') {
          payload = collect('wa', 'was');
          payload.is_enabled = $('[data-waen]', view).checked;
        } else if (p === 'google_business') {
          payload = collect('gb', 'gbs');
          payload.is_enabled = true;
        } else {
          payload = collect('sm', 'sms');
          payload.is_enabled = $('[data-smen]', view).checked;
        }
        try {
          await api(`/api/admin/integrations/${p}`, { method: 'PUT', body: payload });
          toastOk('Settings saved');
          load();
        } catch (err) { toastErr(err.message); }
      };
    });

    $$('[data-test]', view).forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = 'Testing…';
        try {
          const r = await api(`/api/admin/integrations/${btn.dataset.test}/test`, { method: 'POST' });
          if (r.ok) toastOk('Connection successful');
          else toastErr(r.error);
        } catch (err) { toastErr(err.message); }
        load();
      };
    });
  }
  await load();
}

/* ══════════ SEO ══════════ */
export async function renderSeo(view) {
  const [{ settings }, seo, media] = await Promise.all([
    api('/api/admin/clinic'),
    api('/api/admin/seo'),
    api('/api/admin/gallery/media'),
  ]);

  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>Search engine optimisation</h2><p class="card-sub">Page metadata and social sharing</p></div>
        <button class="btn btn-primary btn-sm" id="seoSave">Save</button>
      </div>
      <div class="field"><label>Page title</label>
        <input type="text" data-field="seo_title" value="${esc(settings.seo_title || '')}" maxlength="200">
        <div class="hint">Aim for 50–60 characters.</div></div>
      <div class="field"><label>Meta description</label>
        <textarea data-field="seo_description" rows="2" maxlength="400">${esc(settings.seo_description || '')}</textarea>
        <div class="hint">Aim for 150–160 characters.</div></div>
      <div class="field"><label>Canonical URL</label>
        <input type="text" data-field="seo_canonical" value="${esc(settings.seo_canonical || '')}" placeholder="${esc(seo.meta.canonical)}">
        <div class="hint">Leave blank to use the website URL from Clinic Information.</div></div>
      <div class="frow">
        <div class="field"><label>Social sharing title</label><input type="text" data-field="og_title" value="${esc(settings.og_title || '')}"></div>
        <div class="field"><label>Social sharing description</label><input type="text" data-field="og_description" value="${esc(settings.og_description || '')}"></div>
      </div>
      <div class="field"><label>Social sharing image</label>
        <select data-field="og_image_media_id">
          <option value="">Use the hero image</option>
          ${media.map((m) => `<option value="${m.id}" ${settings.og_image_media_id === m.id ? 'selected' : ''}>${esc(m.original_name || m.key)} (${m.width}×${m.height})</option>`).join('')}
        </select>
        <div class="hint">1200×630 works best.</div></div>
      <fieldset><legend>Branding</legend>
        <div class="frow">
          <div class="field"><label>Logo</label>
            <select data-field="logo_media_id">
              <option value="">Default logo</option>
              ${media.map((m) => `<option value="${m.id}" ${settings.logo_media_id === m.id ? 'selected' : ''}>${esc(m.original_name || m.key)}</option>`).join('')}
            </select></div>
          <div class="field"><label>Favicon</label>
            <select data-field="favicon_media_id">
              <option value="">Default favicon</option>
              ${media.map((m) => `<option value="${m.id}" ${settings.favicon_media_id === m.id ? 'selected' : ''}>${esc(m.original_name || m.key)}</option>`).join('')}
            </select></div>
        </div>
      </fieldset>
    </div>

    <div class="card">
      <h2>Generated structured data</h2>
      <p class="card-sub">This is what search engines read. Rating markup only appears when genuine Google reviews have been synced.</p>
      <pre class="code" style="display:block; padding:14px; overflow-x:auto; white-space:pre; font-size:11.5px; line-height:1.6;">${esc(JSON.stringify(seo.structured_data, null, 2))}</pre>
    </div>

    <div class="card">
      <h2>robots.txt</h2>
      <pre class="code" style="display:block; padding:14px; white-space:pre; font-size:11.5px;">${esc(seo.robots_txt)}</pre>
      <div class="btn-row" style="margin-top:12px;">
        <a class="btn btn-ghost btn-sm" href="/robots.txt" target="_blank" rel="noopener">View robots.txt</a>
        <a class="btn btn-ghost btn-sm" href="/sitemap.xml" target="_blank" rel="noopener">View sitemap.xml</a>
      </div>
    </div>`;

  $('#seoSave').onclick = async () => {
    const body = {};
    $$('[data-field]', view).forEach((el) => {
      const k = el.dataset.field;
      if (k.endsWith('_media_id')) body[k] = el.value ? Number(el.value) : null;
      else body[k] = el.value.trim() || null;
    });
    try { await api('/api/admin/clinic', { method: 'PUT', body }); toastOk('SEO settings saved'); }
    catch (err) { toastErr(err.message); }
  };
}

/* ══════════ Audit log ══════════ */
export async function renderAudit(view) {
  let q = '';
  view.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h2>Audit log</h2>
        <p class="card-sub">Every change to clinic data, appointments and content</p></div></div>
      <div class="filters">
        <div class="field" style="flex:1;"><input type="text" id="aq" placeholder="Search actions or descriptions"></div>
        <button class="btn btn-ghost btn-sm" id="aSearch">Search</button>
      </div>
      <div id="aList"><div class="spin"></div></div>
    </div>`;

  async function load() {
    const box = $('#aList');
    box.innerHTML = '<div class="spin"></div>';
    const data = await api('/api/admin/audit-logs?limit=150' + (q ? '&q=' + encodeURIComponent(q) : ''));
    box.innerHTML = data.rows.length ? `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>When</th><th>User</th><th>Action</th><th>Description</th></tr></thead>
        <tbody>${data.rows.map((a) => `
          <tr>
            <td class="t-muted" style="white-space:nowrap;">${fmtDateTime(a.created_at)}</td>
            <td>${esc(a.user_name || a.user_email || 'system')}</td>
            <td><span class="code">${esc(a.action)}</span></td>
            <td>${esc(a.summary || '')}</td>
          </tr>`).join('')}</tbody>
      </table></div>
      <p class="t-muted" style="margin-top:11px;">Showing ${data.rows.length} of ${data.total}</p>`
      : emptyState('No audit entries match.', 'inbox');
  }

  $('#aSearch').onclick = () => { q = $('#aq').value.trim(); load(); };
  $('#aq').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#aSearch').click(); });
  await load();
}
