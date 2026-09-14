import { api, $, $$, esc, pill, fmtDate, localPhone, emptyState, toastOk, toastErr, openModal, closeModal } from '../core.js';

export async function renderPatients(view) {
  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>Patient directory</h2><p class="card-sub">Search by name, mobile number or patient ID</p></div>
        <button class="btn btn-primary btn-sm" id="newPatient">Add patient</button>
      </div>
      <div class="filters">
        <div class="field" style="flex:1;"><input type="text" id="pq" placeholder="e.g. 9876543210 or John"></div>
        <button class="btn btn-ghost btn-sm" id="pSearch">Search</button>
      </div>
      <div id="pList"><div class="spin"></div></div>
    </div>`;

  async function load() {
    const box = $('#pList');
    box.innerHTML = '<div class="spin"></div>';
    const data = await api('/api/admin/patients?q=' + encodeURIComponent($('#pq').value.trim()));
    box.innerHTML = data.rows.length ? `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Patient ID</th><th>Name</th><th>Mobile</th><th>Visits</th><th>Last visit</th><th>Next visit</th><th></th></tr></thead>
        <tbody>${data.rows.map((p) => `
          <tr>
            <td><span class="code">${esc(p.code)}</span></td>
            <td class="t-strong">${esc(p.name)}${p.is_blocked ? ' <span class="pill pill-cancelled">blocked</span>' : ''}</td>
            <td class="mono" style="font-size:12px;">${esc(localPhone(p.phone))}</td>
            <td>${p.appointment_count}</td>
            <td>${p.last_visit ? fmtDate(p.last_visit) : '<span class="t-muted">—</span>'}</td>
            <td>${p.next_visit ? fmtDate(p.next_visit) : '<span class="t-muted">—</span>'}</td>
            <td><div class="t-actions"><button class="btn btn-ghost btn-xs" data-open="${p.id}">Open</button></div></td>
          </tr>`).join('')}</tbody>
      </table></div>
      <p class="t-muted" style="margin-top:11px;">Showing ${data.rows.length} of ${data.total}</p>`
      : emptyState('No patients match that search.', 'inbox');

    $$('[data-open]', box).forEach((b) => { b.onclick = () => openPatient(b.dataset.open, load); });
  }

  $('#pSearch').onclick = load;
  $('#pq').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  $('#newPatient').onclick = () => openNewPatient(load);
  await load();
}

async function openPatient(id, reload) {
  const d = await api(`/api/admin/patients/${id}`);
  const p = d.patient;

  openModal(`${p.name}`, `
    <dl class="kv">
      <dt>Patient ID</dt><dd><span class="code">${esc(p.code)}</span></dd>
      <dt>Mobile</dt><dd><a href="tel:+${esc(p.phone)}">${esc(localPhone(p.phone))}</a>
        &nbsp;<a href="https://wa.me/${esc(p.phone)}" target="_blank" rel="noopener">WhatsApp</a></dd>
      ${p.email ? `<dt>Email</dt><dd>${esc(p.email)}</dd>` : ''}
      ${p.dob ? `<dt>Date of birth</dt><dd>${esc(p.dob)}</dd>` : ''}
      <dt>Appointments</dt><dd>${d.stats.total} total · ${d.stats.completed} completed · ${d.stats.cancelled} cancelled · ${d.stats.no_show} no-show</dd>
    </dl>

    <div class="field" style="margin-top:18px;">
      <label>Internal notes</label>
      <textarea id="pNotes" rows="3" placeholder="Non-clinical notes only">${esc(p.notes || '')}</textarea>
      <div class="hint">Visible to clinic staff only. Keep clinical records in your practice management system.</div>
    </div>

    <h4 style="margin:18px 0 9px; font-size:13px;">Appointment history</h4>
    ${d.appointments.length ? `
      <div class="table-wrap"><table class="data" style="min-width:0;">
        <thead><tr><th>Date</th><th>Time</th><th>Service</th><th>Status</th></tr></thead>
        <tbody>${d.appointments.map((a) => `
          <tr><td>${fmtDate(a.date)}</td><td class="mono" style="font-size:12px;">${esc(a.time_label)}</td>
              <td>${esc(a.service_name || '—')}</td><td>${pill(a.status)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="t-muted">No appointments yet.</p>'}`, {
    footer: `<button class="btn btn-ghost" id="pClose">Close</button>
             <button class="btn btn-primary" id="pSave">Save notes</button>`,
    wide: true,
  });

  $('#pClose').onclick = closeModal;
  $('#pSave').onclick = async () => {
    try {
      await api(`/api/admin/patients/${id}`, { method: 'PUT', body: { notes: $('#pNotes').value } });
      toastOk('Patient updated');
      closeModal();
      reload();
    } catch (err) { toastErr(err.message); }
  };
}

function openNewPatient(reload) {
  openModal('Add patient', `
    <div class="frow">
      <div class="field"><label>Full name</label><input type="text" id="npName"></div>
      <div class="field"><label>Mobile number</label><input type="tel" id="npPhone" placeholder="10-digit mobile"></div>
    </div>
    <div class="frow">
      <div class="field"><label>Email (optional)</label><input type="email" id="npEmail"></div>
      <div class="field"><label>Date of birth (optional)</label><input type="date" id="npDob"></div>
    </div>
    <div class="field"><label>Notes (optional)</label><textarea id="npNotes" rows="2"></textarea></div>`, {
    footer: '<button class="btn btn-ghost" id="npCancel">Cancel</button><button class="btn btn-primary" id="npSave">Add patient</button>',
  });

  $('#npCancel').onclick = closeModal;
  $('#npSave').onclick = async () => {
    try {
      await api('/api/admin/patients', {
        method: 'POST',
        body: {
          name: $('#npName').value.trim(), phone: $('#npPhone').value.trim(),
          email: $('#npEmail').value.trim(), dob: $('#npDob').value,
          notes: $('#npNotes').value.trim(),
        },
      });
      toastOk('Patient added');
      closeModal();
      reload();
    } catch (err) { toastErr(err.message); }
  };
}
