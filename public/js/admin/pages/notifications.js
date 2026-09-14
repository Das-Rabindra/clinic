import { api, $, $$, esc, pill, fmtDateTime, emptyState, toastOk, toastErr, openModal } from '../core.js';

export async function renderNotifications(view) {
  let filter = '';

  async function load() {
    view.innerHTML = '<div class="spin"></div>';
    const data = await api('/api/admin/notifications' + (filter ? '?status=' + filter : ''));
    const p = data.providers;

    view.innerHTML = `
      <div class="grid g2" style="margin-bottom:16px;">
        <div class="card">
          <h3>WhatsApp</h3>
          <p class="card-sub">WhatsApp Cloud API (Meta)</p>
          ${p.whatsapp.configured
            ? '<span class="pill pill-confirmed">configured</span>'
            : `<span class="pill pill-not_configured">not configured</span>
               <p class="card-sub" style="margin-top:9px;">Messages are queued and recorded, never silently dropped. Add credentials in <a href="#/integrations">Integrations</a> and retry them.</p>`}
        </div>
        <div class="card">
          <h3>Email</h3>
          <p class="card-sub">SMTP</p>
          ${p.email.configured
            ? '<span class="pill pill-confirmed">configured</span>'
            : '<span class="pill pill-not_configured">not configured</span>'}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div><h2>Notification log</h2>
            <p class="card-sub">Every message the system attempted to send. Appointments are never affected by delivery failures.</p></div>
          ${data.failed_count ? '<button class="btn btn-accent btn-sm" id="retryAll">Retry all failed (' + data.failed_count + ')</button>' : ''}
        </div>
        <div class="tabs">
          ${['', 'queued', 'sent', 'failed', 'not_configured'].map((s) => `
            <button class="tab ${filter === s ? 'active' : ''}" data-status="${s}">${esc(s ? s.replace(/_/g, ' ') : 'All')}</button>`).join('')}
        </div>
        ${data.rows.length ? `
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Created</th><th>Channel</th><th>Template</th><th>Recipient</th><th>Booking</th><th>Status</th><th>Attempts</th><th></th></tr></thead>
            <tbody>${data.rows.map((n) => `
              <tr>
                <td class="t-muted">${fmtDateTime(n.created_at)}</td>
                <td>${esc(n.channel)}</td>
                <td>${esc(String(n.template).replace(/_/g, ' '))}</td>
                <td class="mono" style="font-size:12px;">${esc(n.recipient)}</td>
                <td>${n.appointment_ref ? `<span class="code">${esc(n.appointment_ref)}</span>` : '—'}</td>
                <td>${pill(n.status)}</td>
                <td>${n.attempts}/${n.max_attempts}</td>
                <td><div class="t-actions">
                  <button class="btn btn-ghost btn-xs" data-detail="${n.id}">Details</button>
                  ${['failed', 'not_configured'].includes(n.status)
                    ? `<button class="btn btn-accent btn-xs" data-retry="${n.id}">Retry</button>` : ''}
                </div></td>
              </tr>`).join('')}</tbody>
          </table></div>
          <p class="t-muted" style="margin-top:11px;">Showing ${data.rows.length} of ${data.total}</p>`
          : emptyState('No notifications yet.', 'inbox')}
      </div>`;

    $$('.tab', view).forEach((t) => {
      t.onclick = () => { filter = t.dataset.status; load(); };
    });
    $$('[data-retry]', view).forEach((b) => {
      b.onclick = async () => {
        b.disabled = true; b.textContent = '…';
        try {
          const r = await api(`/api/admin/notifications/${b.dataset.retry}/retry`, { method: 'POST' });
          if (r.ok) toastOk('Notification sent');
          else toastErr(r.notification.last_error || 'Still failing');
        } catch (err) { toastErr(err.message); }
        load();
      };
    });
    $$('[data-detail]', view).forEach((b) => {
      b.onclick = async () => {
        const d = await api(`/api/admin/notifications/${b.dataset.detail}`);
        openModal('Notification detail', `
          <dl class="kv">
            <dt>Channel</dt><dd>${esc(d.notification.channel)}</dd>
            <dt>Template</dt><dd>${esc(d.notification.template)}</dd>
            <dt>Recipient</dt><dd>${esc(d.notification.recipient)} (${esc(d.notification.recipient_role)})</dd>
            <dt>Status</dt><dd>${pill(d.notification.status)}</dd>
            <dt>Attempts</dt><dd>${d.notification.attempts} of ${d.notification.max_attempts}</dd>
            ${d.notification.provider ? `<dt>Provider</dt><dd>${esc(d.notification.provider)}</dd>` : ''}
            ${d.notification.last_error ? `<dt>Last error</dt><dd style="color:var(--danger);">${esc(d.notification.last_error)}</dd>` : ''}
          </dl>
          ${d.notification.body_preview ? `
            <div class="field" style="margin-top:16px;"><label>Message</label>
              <div style="background:var(--paper-dim); padding:12px; border-radius:8px; font-size:12.5px;
                          white-space:pre-wrap; line-height:1.6;">${esc(d.notification.body_preview)}</div></div>` : ''}
          <h4 style="margin:18px 0 9px; font-size:13px;">Delivery attempts</h4>
          ${d.logs.length ? d.logs.map((l) => `
            <div style="padding:8px 0; border-bottom:1px solid var(--line); font-size:12.5px;">
              <span class="t-muted">${fmtDateTime(l.created_at)}</span> — attempt ${l.attempt} — ${pill(l.status)}
              ${l.http_status ? ` <span class="t-muted">HTTP ${l.http_status}</span>` : ''}
              ${l.error ? `<div style="color:var(--danger); margin-top:3px;">${esc(l.error)}</div>` : ''}
            </div>`).join('') : '<p class="t-muted">No attempts logged.</p>'}`, { wide: true });
      };
    });
    const retryAll = $('#retryAll');
    if (retryAll) {
      retryAll.onclick = async () => {
        retryAll.disabled = true; retryAll.textContent = 'Retrying…';
        const r = await api('/api/admin/notifications/retry-failed', { method: 'POST' });
        toastOk(`Retried ${r.attempted}: ${r.sent} sent, ${r.failed} still failing`);
        load();
      };
    }
  }

  await load();
}
