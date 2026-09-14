import { api, $, $$, esc, pill, fmtDateTime, localPhone, emptyState, toastOk, toastErr, openModal, closeModal } from '../core.js';

export async function renderEnquiries(view) {
  let filter = '';

  view.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h2>Enquiries</h2><p class="card-sub">Website leads that have not booked an appointment</p></div></div>
      <div class="tabs" id="eTabs">
        <button class="tab active" data-status="">All</button>
        <button class="tab" data-status="new">New</button>
        <button class="tab" data-status="contacted">Contacted</button>
        <button class="tab" data-status="converted">Converted</button>
        <button class="tab" data-status="archived">Archived</button>
      </div>
      <div id="eList"><div class="spin"></div></div>
    </div>`;

  async function load() {
    const box = $('#eList');
    box.innerHTML = '<div class="spin"></div>';
    const data = await api('/api/admin/enquiries' + (filter ? '?status=' + filter : ''));
    box.innerHTML = data.rows.length ? `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Received</th><th>Name</th><th>Phone</th><th>Prefers</th><th>Message</th><th>Status</th><th></th></tr></thead>
        <tbody>${data.rows.map((e) => `
          <tr>
            <td class="t-muted">${fmtDateTime(e.created_at)}</td>
            <td class="t-strong">${esc(e.name)}</td>
            <td class="mono" style="font-size:12px;">${esc(localPhone(e.phone))}</td>
            <td>${esc(e.preferred_contact)}</td>
            <td style="max-width:260px;">${esc(String(e.message || '—').slice(0, 90))}${(e.message || '').length > 90 ? '…' : ''}</td>
            <td>${pill(e.status)}</td>
            <td><div class="t-actions">
              <a class="btn btn-ghost btn-xs" href="tel:+${esc(e.phone)}">Call</a>
              <a class="btn btn-ghost btn-xs" href="https://wa.me/${esc(e.phone)}" target="_blank" rel="noopener">WhatsApp</a>
              <button class="btn btn-ghost btn-xs" data-open="${e.id}">Manage</button>
            </div></td>
          </tr>`).join('')}</tbody>
      </table></div>` : emptyState('No enquiries here.', 'inbox');
    $$('[data-open]', box).forEach((b) => { b.onclick = () => manage(data.rows.find((x) => x.id === Number(b.dataset.open)), load); });
  }

  $$('.tab', view).forEach((tab) => {
    tab.onclick = () => {
      filter = tab.dataset.status;
      $$('.tab', view).forEach((t) => t.classList.toggle('active', t === tab));
      load();
    };
  });
  await load();
}

function manage(e, reload) {
  openModal(`Enquiry from ${e.name}`, `
    <dl class="kv">
      <dt>Name</dt><dd class="t-strong">${esc(e.name)}</dd>
      <dt>Phone</dt><dd>${esc(localPhone(e.phone))}</dd>
      ${e.email ? `<dt>Email</dt><dd>${esc(e.email)}</dd>` : ''}
      <dt>Prefers</dt><dd>${esc(e.preferred_contact)}</dd>
      <dt>Received</dt><dd>${fmtDateTime(e.created_at)}</dd>
      <dt>Status</dt><dd>${pill(e.status)}</dd>
    </dl>
    ${e.message ? `<div class="field" style="margin-top:16px;"><label>Message</label>
      <div style="background:var(--paper-dim); padding:12px; border-radius:8px; font-size:13px; line-height:1.6;">${esc(e.message)}</div></div>` : ''}
    <div class="field"><label>Internal notes</label><textarea id="eNotes" rows="2">${esc(e.notes || '')}</textarea></div>`, {
    footer: `<button class="btn btn-ghost" data-set="contacted">Mark contacted</button>
             <button class="btn btn-accent" data-set="convert">Convert to patient</button>
             <button class="btn btn-ghost" data-set="archived">Archive</button>
             <button class="btn btn-primary" data-set="save">Save notes</button>`,
    wide: true,
  });

  $$('[data-set]').forEach((btn) => {
    btn.onclick = async () => {
      const action = btn.dataset.set;
      try {
        if (action === 'convert') {
          const r = await api(`/api/admin/enquiries/${e.id}/convert`, { method: 'POST' });
          toastOk(`Converted to patient ${r.patient.code}`);
        } else if (action === 'save') {
          await api(`/api/admin/enquiries/${e.id}`, { method: 'PUT', body: { notes: $('#eNotes').value } });
          toastOk('Notes saved');
        } else {
          await api(`/api/admin/enquiries/${e.id}`, {
            method: 'PUT', body: { status: action, notes: $('#eNotes').value },
          });
          toastOk(`Marked ${action}`);
        }
        closeModal();
        reload();
      } catch (err) { toastErr(err.message); }
    };
  });
}
