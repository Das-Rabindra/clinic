import {
  api, $, $$, esc, pill, fmtDate, fmtDateTime, localPhone, emptyState, toastOk, toastErr,
  openModal, closeModal, confirmAction, today, addDays, WEEKDAYS,
} from '../core.js';

const STATUSES = ['pending', 'confirmed', 'rescheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'];

/* ══════════ List view ══════════ */
export async function renderAppointments(view, preset = {}) {
  const filters = { from: '', to: '', status: '', q: '', ...preset };

  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>All appointments</h2><p class="card-sub">Filter, review and act on every booking</p></div>
        <button class="btn btn-primary btn-sm" id="newAppt">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          Add appointment
        </button>
      </div>
      <div class="filters">
        <div class="field"><label>From</label><input type="date" id="fFrom" value="${esc(filters.from)}"></div>
        <div class="field"><label>To</label><input type="date" id="fTo" value="${esc(filters.to)}"></div>
        <div class="field"><label>Status</label>
          <select id="fStatus">
            <option value="">All statuses</option>
            ${STATUSES.map((s) => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${esc(s.replace(/_/g, ' '))}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="flex:1; min-width:190px;"><label>Search</label>
          <input type="text" id="fQ" placeholder="Name, phone or booking ID" value="${esc(filters.q)}">
        </div>
        <button class="btn btn-ghost btn-sm" id="applyF">Apply</button>
        <button class="btn btn-ghost btn-sm" id="clearF">Clear</button>
      </div>
      <div id="apptList"><div class="spin"></div></div>
    </div>`;

  async function load() {
    const params = new URLSearchParams();
    ['from', 'to', 'status', 'q'].forEach((k) => { if (filters[k]) params.set(k, filters[k]); });
    params.set('limit', '100');
    const box = $('#apptList');
    box.innerHTML = '<div class="spin"></div>';
    try {
      const data = await api('/api/admin/appointments?' + params);
      box.innerHTML = data.rows.length ? table(data) : emptyState('No appointments match these filters.', 'calendar');
      bindRowActions(box, load);
    } catch (err) {
      box.innerHTML = `<div class="banner banner-err"><span>${esc(err.message)}</span></div>`;
    }
  }

  $('#applyF').onclick = () => {
    filters.from = $('#fFrom').value;
    filters.to = $('#fTo').value;
    filters.status = $('#fStatus').value;
    filters.q = $('#fQ').value.trim();
    load();
  };
  $('#clearF').onclick = () => {
    ['fFrom', 'fTo', 'fQ'].forEach((id) => { $('#' + id).value = ''; });
    $('#fStatus').value = '';
    Object.assign(filters, { from: '', to: '', status: '', q: '' });
    load();
  };
  $('#fQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#applyF').click(); });
  $('#newAppt').onclick = () => openBookingModal(load);

  await load();
  if (location.hash.includes('new=1')) openBookingModal(load);
}

function table(data) {
  return `
    <div class="table-wrap"><table class="data">
      <thead><tr>
        <th>Booking</th><th>Patient</th><th>Phone</th><th>Service</th>
        <th>Date</th><th>Time</th><th>Status</th><th>Created</th><th></th>
      </tr></thead>
      <tbody>${data.rows.map((a) => `
        <tr>
          <td><span class="code">${esc(a.ref)}</span></td>
          <td class="t-strong">${esc(a.patient_name)}</td>
          <td class="mono" style="font-size:12px;">${esc(localPhone(a.patient_phone))}</td>
          <td>${esc(a.service_name || '—')}</td>
          <td>${fmtDate(a.date)}</td>
          <td class="mono" style="font-size:12px;">${esc(a.time_label)}</td>
          <td>${pill(a.status)}</td>
          <td class="t-muted">${fmtDateTime(a.created_at)}</td>
          <td><div class="t-actions">
            <button class="btn btn-ghost btn-xs" data-view="${a.id}">View</button>
            ${a.status === 'pending' ? `<button class="btn btn-accent btn-xs" data-act="confirm" data-id="${a.id}">Confirm</button>` : ''}
          </div></td>
        </tr>`).join('')}</tbody>
    </table></div>
    <p class="t-muted" style="margin-top:11px;">Showing ${data.rows.length} of ${data.total}</p>`;
}

function bindRowActions(root, reload) {
  $$('[data-view]', root).forEach((b) => { b.onclick = () => openDetail(b.dataset.view, reload); });
  $$('[data-act="confirm"]', root).forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { await api(`/api/admin/appointments/${b.dataset.id}/confirm`, { method: 'POST' }); toastOk('Confirmed'); reload(); }
      catch (err) { toastErr(err.message); b.disabled = false; }
    };
  });
}

/* ══════════ Detail ══════════ */
async function openDetail(id, reload) {
  const a = await api(`/api/admin/appointments/${id}`);
  const canAct = !['cancelled', 'completed', 'no_show'].includes(a.status);

  openModal(`Appointment ${a.ref}`, `
    <dl class="kv">
      <dt>Patient</dt><dd class="t-strong">${esc(a.patient_name)} <span class="code">${esc(a.patient_code)}</span></dd>
      <dt>Mobile</dt><dd><a href="tel:+${esc(a.patient_phone)}">${esc(localPhone(a.patient_phone))}</a>
        &nbsp;<a href="https://wa.me/${esc(a.patient_phone)}" target="_blank" rel="noopener">WhatsApp</a></dd>
      ${a.patient_email ? `<dt>Email</dt><dd>${esc(a.patient_email)}</dd>` : ''}
      <dt>Service</dt><dd>${esc(a.service_name || '—')} (${a.duration_min} min)</dd>
      <dt>Dentist</dt><dd>${esc(a.doctor_name)}</dd>
      <dt>When</dt><dd class="t-strong">${fmtDate(a.date)} at ${esc(a.time_label)}</dd>
      <dt>Status</dt><dd>${pill(a.status)}</dd>
      <dt>Source</dt><dd>${esc(a.source)}${a.is_new_patient ? ' · new patient' : ''}</dd>
      ${a.reason ? `<dt>Reason</dt><dd>${esc(a.reason)}</dd>` : ''}
      ${a.message ? `<dt>Message</dt><dd>${esc(a.message)}</dd>` : ''}
      ${a.cancel_reason ? `<dt>Cancel reason</dt><dd>${esc(a.cancel_reason)}</dd>` : ''}
      <dt>Booked</dt><dd class="t-muted">${fmtDateTime(a.created_at)}</dd>
    </dl>

    <h4 style="margin:20px 0 9px; font-size:13px;">History</h4>
    <div style="font-size:12.5px;">
      ${a.history.map((h) => `
        <div style="padding:6px 0; border-bottom:1px solid var(--line);">
          <span class="t-muted">${fmtDateTime(h.created_at)}</span> —
          ${h.from_status ? `${esc(h.from_status)} &rarr; ` : ''}<strong>${esc(h.to_status)}</strong>
          ${h.note ? `<div class="t-muted">${esc(h.note)}</div>` : ''}
          ${h.by_name ? `<div class="t-muted">by ${esc(h.by_name)}</div>` : ''}
        </div>`).join('') || '<p class="t-muted">No history.</p>'}
    </div>`, {
    footer: canAct ? `
      ${a.status === 'pending' ? '<button class="btn btn-accent" data-do="confirm">Confirm</button>' : ''}
      <button class="btn btn-ghost" data-do="checked_in">Check in</button>
      <button class="btn btn-ghost" data-do="completed">Complete</button>
      <button class="btn btn-ghost" data-do="reschedule">Reschedule</button>
      <button class="btn btn-ghost" data-do="no_show">No-show</button>
      <button class="btn btn-danger" data-do="cancel">Cancel</button>`
      : '<button class="btn btn-ghost" data-do="close">Close</button>',
    wide: true,
  });

  $$('[data-do]').forEach((btn) => {
    btn.onclick = async () => {
      const action = btn.dataset.do;
      if (action === 'close') return closeModal();
      try {
        if (action === 'confirm') {
          await api(`/api/admin/appointments/${id}/confirm`, { method: 'POST' });
          toastOk('Appointment confirmed — patient notification queued');
        } else if (action === 'cancel') {
          const ok = await confirmAction('Cancel appointment',
            `Cancel ${a.ref} for ${a.patient_name}? The slot is freed and the patient is notified.`,
            { confirmLabel: 'Cancel appointment' });
          if (!ok) return;
          await api(`/api/admin/appointments/${id}/cancel`, {
            method: 'POST', body: { reason: 'Cancelled by clinic', notify_patient: true },
          });
          toastOk('Appointment cancelled');
        } else if (action === 'reschedule') {
          return openReschedule(a, reload);
        } else {
          await api(`/api/admin/appointments/${id}/status`, { method: 'POST', body: { status: action } });
          toastOk(`Marked ${action.replace('_', ' ')}`);
        }
        closeModal();
        reload();
      } catch (err) { toastErr(err.message); }
    };
  });
}

/* ══════════ Reschedule ══════════ */
async function openReschedule(appt, reload) {
  openModal(`Reschedule ${appt.ref}`, `
    <p class="card-sub">Currently ${fmtDate(appt.date)} at ${esc(appt.time_label)}. Pick a new date to see free times.</p>
    <div class="field"><label>New date</label>
      <input type="date" id="rsDate" value="${esc(appt.date)}" min="${today()}">
    </div>
    <div id="rsSlots"><p class="t-muted">Choose a date to load available times.</p></div>`, {
    footer: '<button class="btn btn-ghost" id="rsCancel">Cancel</button><button class="btn btn-primary" id="rsGo" disabled>Reschedule</button>',
  });

  let chosen = null;
  const slotBox = $('#rsSlots');

  async function loadSlots() {
    const date = $('#rsDate').value;
    if (!date) return;
    slotBox.innerHTML = '<div class="spin"></div>';
    chosen = null;
    $('#rsGo').disabled = true;
    try {
      const qs = new URLSearchParams({ date });
      if (appt.service_id) qs.set('service_id', String(appt.service_id));
      if (appt.doctor_id) qs.set('doctor_id', String(appt.doctor_id));
      const data = await api('/api/admin/appointments/availability/grid?' + qs);
      if (!data.open) {
        slotBox.innerHTML = `<div class="banner banner-warn"><span>Clinic is closed on this date${data.reason_text ? ` — ${esc(data.reason_text)}` : ''}.</span></div>`;
        return;
      }
      slotBox.innerHTML = `<div class="field"><label>Available times</label>
        <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(92px,1fr)); gap:7px;">
          ${data.slots.map((s) => `
            <button type="button" class="btn ${s.available ? 'btn-ghost' : ''} btn-sm"
              data-slot="${esc(s.time)}" ${s.available ? '' : 'disabled title="Not available"'}
              style="${s.available ? '' : 'opacity:.4;'}">${esc(s.label)}</button>`).join('')}
        </div></div>`;
      $$('[data-slot]', slotBox).forEach((b) => {
        b.onclick = () => {
          chosen = b.dataset.slot;
          $$('[data-slot]', slotBox).forEach((x) => x.classList.remove('btn-primary'));
          b.classList.add('btn-primary');
          $('#rsGo').disabled = false;
        };
      });
    } catch (err) {
      slotBox.innerHTML = `<div class="banner banner-err"><span>${esc(err.message)}</span></div>`;
    }
  }

  $('#rsDate').onchange = loadSlots;
  $('#rsCancel').onclick = closeModal;
  $('#rsGo').onclick = async () => {
    try {
      await api(`/api/admin/appointments/${appt.id}/reschedule`, {
        method: 'POST', body: { date: $('#rsDate').value, time: chosen },
      });
      toastOk('Appointment rescheduled — patient notification queued');
      closeModal();
      reload();
    } catch (err) { toastErr(err.message); }
  };
  await loadSlots();
}

/* ══════════ New booking ══════════ */
async function openBookingModal(reload) {
  const { services } = await api('/api/admin/services');
  const bookable = services.filter((s) => s.is_active && s.bookable);

  openModal('Add appointment', `
    <div class="frow">
      <div class="field"><label>Patient name</label><input type="text" id="naName" placeholder="Full name"><span class="err">Required</span></div>
      <div class="field"><label>Mobile number</label><input type="tel" id="naPhone" placeholder="10-digit mobile"><span class="err">Required</span></div>
    </div>
    <div class="frow">
      <div class="field"><label>Email (optional)</label><input type="email" id="naEmail"></div>
      <div class="field"><label>Service</label>
        <select id="naService">${bookable.map((s) => `<option value="${s.id}">${esc(s.name)} (${s.duration_min} min)</option>`).join('')}</select>
      </div>
    </div>
    <div class="frow">
      <div class="field"><label>Date</label><input type="date" id="naDate" value="${today()}" min="${today()}"></div>
      <div class="field"><label>Booked via</label>
        <select id="naSource"><option value="phone">Phone call</option><option value="walkin">Walk-in</option><option value="admin">Admin</option></select>
      </div>
    </div>
    <div class="field"><label>Note (optional)</label><textarea id="naMessage" rows="2"></textarea></div>
    <div id="naSlots"></div>`, {
    footer: '<button class="btn btn-ghost" id="naCancel">Cancel</button><button class="btn btn-primary" id="naGo" disabled>Create appointment</button>',
    wide: true,
  });

  let chosen = null;

  async function loadSlots() {
    const box = $('#naSlots');
    box.innerHTML = '<div class="spin"></div>';
    chosen = null;
    $('#naGo').disabled = true;
    try {
      const qs = new URLSearchParams({ date: $('#naDate').value, service_id: $('#naService').value });
      const data = await api('/api/admin/appointments/availability/grid?' + qs);
      if (!data.open) {
        box.innerHTML = `<div class="banner banner-warn"><span>Clinic is closed on this date${data.reason_text ? ` — ${esc(data.reason_text)}` : ''}.</span></div>`;
        return;
      }
      box.innerHTML = `<div class="field"><label>Choose a time</label>
        <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(92px,1fr)); gap:7px;">
          ${data.slots.map((s) => `
            <button type="button" class="btn ${s.available ? 'btn-ghost' : ''} btn-sm" data-slot="${esc(s.time)}"
              ${s.available ? '' : `disabled title="${esc(s.reason || 'unavailable')}"`}
              style="${s.available ? '' : 'opacity:.4;'}">${esc(s.label)}</button>`).join('')}
        </div></div>`;
      $$('[data-slot]', box).forEach((b) => {
        b.onclick = () => {
          chosen = b.dataset.slot;
          $$('[data-slot]', box).forEach((x) => x.classList.remove('btn-primary'));
          b.classList.add('btn-primary');
          $('#naGo').disabled = false;
        };
      });
    } catch (err) {
      box.innerHTML = `<div class="banner banner-err"><span>${esc(err.message)}</span></div>`;
    }
  }

  $('#naDate').onchange = loadSlots;
  $('#naService').onchange = loadSlots;
  $('#naCancel').onclick = closeModal;
  $('#naGo').onclick = async () => {
    const name = $('#naName').value.trim();
    const phone = $('#naPhone').value.trim();
    if (!name || !phone) { toastErr('Patient name and mobile number are required.'); return; }
    try {
      const body = {
        name, phone, date: $('#naDate').value, time: chosen,
        service_id: Number($('#naService').value), source: $('#naSource').value,
      };
      if ($('#naEmail').value.trim()) body.email = $('#naEmail').value.trim();
      if ($('#naMessage').value.trim()) body.message = $('#naMessage').value.trim();
      const res = await api('/api/admin/appointments', { method: 'POST', body });
      toastOk(`Appointment ${res.appointment.ref} created`);
      closeModal();
      reload();
    } catch (err) { toastErr(err.message); }
  };
  await loadSlots();
}

/* ══════════ Pending queue ══════════ */
export async function renderPending(view) {
  return renderAppointments(view, { status: 'pending' });
}

/* ══════════ Calendar ══════════ */
export async function renderCalendar(view) {
  let mode = 'day';
  let anchor = today();

  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>Calendar</h2><p class="card-sub" id="calSub"></p></div>
        <div class="btn-row">
          <button class="btn btn-ghost btn-sm" id="cPrev">&larr;</button>
          <button class="btn btn-ghost btn-sm" id="cToday">Today</button>
          <button class="btn btn-ghost btn-sm" id="cNext">&rarr;</button>
        </div>
      </div>
      <div class="tabs">
        <button class="tab active" data-mode="day">Day</button>
        <button class="tab" data-mode="week">Week</button>
        <button class="tab" data-mode="month">Month</button>
      </div>
      <div id="calBody"><div class="spin"></div></div>
    </div>`;

  function range() {
    if (mode === 'day') return { from: anchor, to: anchor };
    if (mode === 'week') {
      const [y, m, d] = anchor.split('-').map(Number);
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      const from = addDays(anchor, -dow);
      return { from, to: addDays(from, 6) };
    }
    const first = anchor.slice(0, 8) + '01';
    const [y, m] = anchor.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { from: addDays(first, -new Date(first + 'T00:00:00Z').getUTCDay()), to: last, first, last };
  }

  async function load() {
    const r = range();
    $('#calBody').innerHTML = '<div class="spin"></div>';
    $('#calSub').textContent = mode === 'day' ? fmtDate(anchor) : `${fmtDate(r.from)} — ${fmtDate(r.to)}`;
    try {
      const rows = await api(`/api/admin/appointments/calendar?from=${r.from}&to=${r.to}`);
      $('#calBody').innerHTML = mode === 'month' ? monthView(rows, r) : listView(rows, r);
      $$('[data-open]', $('#calBody')).forEach((el) => {
        el.onclick = () => openDetail(el.dataset.open, load);
      });
    } catch (err) {
      $('#calBody').innerHTML = `<div class="banner banner-err"><span>${esc(err.message)}</span></div>`;
    }
  }

  function listView(rows, r) {
    const days = [];
    for (let d = r.from; d <= r.to; d = addDays(d, 1)) days.push(d);
    return days.map((date) => {
      const dayRows = rows.filter((x) => x.date === date);
      const [y, m, dd] = date.split('-').map(Number);
      const label = WEEKDAYS[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
      return `
        <div style="margin-bottom:20px;">
          <h4 style="font-size:13.5px; margin-bottom:9px;">
            ${esc(label)}, ${fmtDate(date)}
            <span class="t-muted" style="font-weight:400;">— ${dayRows.length} appointment${dayRows.length === 1 ? '' : 's'}</span>
          </h4>
          ${dayRows.length ? `<div class="day-list">${dayRows.map((a) => `
            <div class="day-row" data-open="${a.id}" style="cursor:pointer;">
              <span class="day-time">${esc(a.time_label)}</span>
              <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center;">
                <div>
                  <div class="t-strong">${esc(a.patient)}</div>
                  <div class="t-muted">${esc(a.service)} &middot; ${esc(localPhone(a.phone))}</div>
                </div>
                ${pill(a.status)}
              </div>
            </div>`).join('')}</div>`
            : '<p class="t-muted" style="font-size:12.5px;">No appointments.</p>'}
        </div>`;
    }).join('');
  }

  function monthView(rows, r) {
    const byDate = {};
    rows.forEach((a) => { (byDate[a.date] = byDate[a.date] || []).push(a); });
    const monthKey = anchor.slice(0, 7);
    let html = '<div class="cal-wrap"><div class="cal-month-grid">' +
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="cal-hdr">${d}</div>`).join('');
    let cursor = r.from;
    const end = addDays(r.last, 6 - new Date(r.last + 'T00:00:00Z').getUTCDay());
    while (cursor <= end) {
      const list = byDate[cursor] || [];
      const other = !cursor.startsWith(monthKey);
      html += `<div class="cal-cell ${other ? 'other' : ''} ${cursor === today() ? 'today' : ''}">
        <div class="cal-date">${Number(cursor.slice(8))}</div>
        ${list.slice(0, 4).map((a) => `
          <div class="cal-appt pill-${esc(a.status)}" data-open="${a.id}" title="${esc(a.patient)} — ${esc(a.service)}">
            ${esc(a.time_label)} ${esc(a.patient)}
          </div>`).join('')}
        ${list.length > 4 ? `<div class="t-muted" style="font-size:10px;">+${list.length - 4} more</div>` : ''}
      </div>`;
      cursor = addDays(cursor, 1);
    }
    return html + '</div></div>';
  }

  $$('.tab', view).forEach((tab) => {
    tab.onclick = () => {
      mode = tab.dataset.mode;
      $$('.tab', view).forEach((t) => t.classList.toggle('active', t === tab));
      load();
    };
  });
  $('#cPrev').onclick = () => { anchor = addDays(anchor, mode === 'day' ? -1 : mode === 'week' ? -7 : -30); load(); };
  $('#cNext').onclick = () => { anchor = addDays(anchor, mode === 'day' ? 1 : mode === 'week' ? 7 : 30); load(); };
  $('#cToday').onclick = () => { anchor = today(); load(); };

  await load();
}
