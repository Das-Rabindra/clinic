import {
  api, $, $$, esc, fmtDate, emptyState, toastOk, toastErr, openModal, closeModal,
  confirmAction, minToHHMM, hhmmToMin, WEEKDAYS, today,
} from '../core.js';

/* ══════════ Clinic information ══════════ */
export async function renderClinic(view) {
  const { settings } = await api('/api/admin/clinic');

  const text = (key, label, hint = '', type = 'text') => `
    <div class="field"><label>${esc(label)}</label>
      <input type="${type}" data-field="${key}" value="${esc(settings[key] ?? '')}">
      ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
      <span class="err"></span></div>`;

  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>Clinic information</h2><p class="card-sub">Used across the website, notifications and structured data</p></div>
        <button class="btn btn-primary btn-sm" id="cSave">Save changes</button>
      </div>

      <fieldset><legend>Basic information</legend>
        <div class="frow">${text('name', 'Clinic name')}${text('doctor_name', 'Lead dentist')}</div>
        <div class="frow">${text('qualification', 'Qualifications')}${text('registration', 'Registration number')}</div>
        ${text('institution', 'Institution')}
        ${text('tagline', 'Tagline')}
        <div class="field"><label>Clinic description</label>
          <textarea data-field="description" rows="3">${esc(settings.description || '')}</textarea>
          <div class="hint">Used for the meta description fallback and structured data.</div></div>
      </fieldset>

      <fieldset><legend>Contact</legend>
        <div class="frow">
          ${text('phone', 'Phone (display)', 'Shown on the website, e.g. 9124839288')}
          ${text('phone_intl', 'Phone (dialling)', 'Used in tel: links, e.g. +919124839288')}
        </div>
        <div class="frow">
          ${text('whatsapp', 'WhatsApp number', 'Digits with country code, e.g. 919124839288')}
          ${text('email', 'Email', '', 'email')}
        </div>
        ${text('site_url', 'Website URL', 'Used for canonical and Open Graph tags, e.g. https://samaldentalcare.com', 'url')}
      </fieldset>

      <fieldset><legend>Address &amp; location</legend>
        <div class="frow">${text('address_line1', 'Address line 1')}${text('address_line2', 'Address line 2')}</div>
        <div class="frow3">${text('area', 'Area')}${text('city', 'City')}${text('state', 'State')}</div>
        <div class="frow">${text('postal_code', 'Postal code')}${text('country', 'Country')}</div>
        ${text('maps_url', 'Google Maps place URL', 'The share link for the clinic’s exact pin')}
        ${text('place_id', 'Google Place ID', 'Optional; improves directions accuracy')}
        <div class="frow">
          ${text('latitude', 'Latitude', 'e.g. 20.8397', 'number')}
          ${text('longitude', 'Longitude', 'e.g. 85.1010', 'number')}
        </div>
        <div class="hint">With latitude and longitude set, the website shows an exact pin and precise directions. Changing them updates the public site immediately.</div>
      </fieldset>

      <fieldset><legend>Booking rules</legend>
        <div class="frow3">
          <div class="field"><label>Slot interval (minutes)</label>
            <input type="number" data-field="slot_interval_min" value="${settings.slot_interval_min}" min="5" max="240" step="5">
            <div class="hint">The booking grid step.</div></div>
          <div class="field"><label>Minimum notice (hours)</label>
            <input type="number" data-field="booking_lead_hours" value="${settings.booking_lead_hours}" min="0" max="168">
            <div class="hint">Patients cannot book closer than this.</div></div>
          <div class="field"><label>Booking window (days)</label>
            <input type="number" data-field="booking_horizon_days" value="${settings.booking_horizon_days}" min="1" max="365">
            <div class="hint">How far ahead booking is allowed.</div></div>
        </div>
        <label class="check"><input type="checkbox" data-field="auto_confirm" ${settings.auto_confirm ? 'checked' : ''}>
          <span>Automatically confirm online bookings<br>
          <span class="hint">Leave off to review each request before confirming.</span></span></label>
        ${text('timezone', 'Timezone', 'IANA name, e.g. Asia/Kolkata')}
      </fieldset>

      <fieldset><legend>Social &amp; reviews</legend>
        ${text('reviews_url', 'Google reviews URL', 'The "write a review" or reviews link for the clinic')}
        <div class="frow">${text('instagram_url', 'Instagram')}${text('facebook_url', 'Facebook')}</div>
      </fieldset>
    </div>`;

  $('#cSave').onclick = async () => {
    const body = {};
    $$('[data-field]', view).forEach((el) => {
      const k = el.dataset.field;
      if (el.type === 'checkbox') body[k] = el.checked;
      else if (el.type === 'number') body[k] = el.value === '' ? null : Number(el.value);
      else body[k] = el.value.trim() || null;
    });
    try {
      const r = await api('/api/admin/clinic', { method: 'PUT', body });
      toastOk(r.changed.length ? `Saved (${r.changed.length} field${r.changed.length === 1 ? '' : 's'} changed)` : 'Saved');
    } catch (err) { toastErr(err.message); }
  };
}

/* ══════════ Working hours ══════════ */
/*
 * A card per day rather than a wide table: on a phone the old six-column grid
 * needed horizontal scrolling to reach the closing time, which is exactly the
 * field the clinic changes most often.
 */
export async function renderHours(view) {
  const { hours } = await api('/api/admin/clinic');
  const byDay = Object.fromEntries(hours.map((h) => [h.weekday, h]));
  const order = [1, 2, 3, 4, 5, 6, 0];   // Monday first, as a clinic reads it

  const dayCard = (w) => {
    const h = byDay[w] || { is_open: 0, open_min: 480, close_min: 1260 };
    const hasBreak = h.break_start_min != null && h.break_end_min != null;
    return `
      <div class="day-card${h.is_open ? '' : ' is-closed'}" data-day="${w}">
        <div class="day-card-head">
          <span class="day-card-name">${esc(WEEKDAYS[w])}</span>
          <label class="switch">
            <input type="checkbox" data-k="is_open" ${h.is_open ? 'checked' : ''}>
            <span class="switch-track"><span class="switch-knob"></span></span>
            <span class="switch-label">${h.is_open ? 'Open' : 'Closed'}</span>
          </label>
        </div>
        <div class="day-card-body">
          <div class="time-pair">
            <label>Opens<input type="time" data-k="open" value="${minToHHMM(h.open_min)}"></label>
            <label>Closes<input type="time" data-k="close" value="${minToHHMM(h.close_min)}"></label>
          </div>
          <label class="check break-toggle">
            <input type="checkbox" data-k="has_break" ${hasBreak ? 'checked' : ''}>
            <span>Break during the day</span>
          </label>
          <div class="time-pair break-pair" ${hasBreak ? '' : 'hidden'}>
            <label>Break from<input type="time" data-k="bstart" value="${hasBreak ? minToHHMM(h.break_start_min) : '13:00'}"></label>
            <label>Break to<input type="time" data-k="bend" value="${hasBreak ? minToHHMM(h.break_end_min) : '15:00'}"></label>
          </div>
        </div>
      </div>`;
  };

  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>Working hours</h2>
          <p class="card-sub">Patient booking slots are generated from these hours. Changes appear on the website immediately.</p></div>
        <button class="btn btn-primary" id="hSave">Save hours</button>
      </div>

      <div class="bulk-bar">
        <strong>Set every day at once</strong>
        <div class="bulk-fields">
          <label>Opens<input type="time" id="bulkOpen" value="08:00"></label>
          <label>Closes<input type="time" id="bulkClose" value="21:00"></label>
          <label class="check" style="margin:0;"><input type="checkbox" id="bulkBreak" checked><span>with break</span></label>
          <label>From<input type="time" id="bulkBs" value="13:00"></label>
          <label>To<input type="time" id="bulkBe" value="15:00"></label>
          <button class="btn btn-ghost btn-sm" id="bulkApply">Apply to all days</button>
        </div>
      </div>

      <div class="day-grid">${order.map(dayCard).join('')}</div>

      <div class="save-bar">
        <span class="t-muted" id="hStatus">Every day can have its own hours — switch any day off to close it.</span>
        <button class="btn btn-primary" id="hSave2">Save hours</button>
      </div>
    </div>`;

  /* Keep each card's visual state in step with its toggles. */
  function wire(card) {
    const openBox = $('[data-k="is_open"]', card);
    const label = $('.switch-label', card);
    const breakBox = $('[data-k="has_break"]', card);
    const breakPair = $('.break-pair', card);
    openBox.onchange = () => {
      card.classList.toggle('is-closed', !openBox.checked);
      label.textContent = openBox.checked ? 'Open' : 'Closed';
    };
    breakBox.onchange = () => { breakPair.hidden = !breakBox.checked; };
  }
  $$('.day-card', view).forEach(wire);

  $('#bulkApply').onclick = () => {
    const open = $('#bulkOpen').value;
    const close = $('#bulkClose').value;
    const useBreak = $('#bulkBreak').checked;
    const bs = $('#bulkBs').value;
    const be = $('#bulkBe').value;
    $$('.day-card', view).forEach((card) => {
      $('[data-k="is_open"]', card).checked = true;
      $('[data-k="open"]', card).value = open;
      $('[data-k="close"]', card).value = close;
      $('[data-k="has_break"]', card).checked = useBreak;
      $('[data-k="bstart"]', card).value = bs;
      $('[data-k="bend"]', card).value = be;
      $('.break-pair', card).hidden = !useBreak;
      card.classList.remove('is-closed');
      $('.switch-label', card).textContent = 'Open';
    });
    toastOk('Applied to all seven days — remember to save');
  };

  async function save(btn) {
    const payload = [];
    for (const card of $$('.day-card', view)) {
      const g = (k) => $(`[data-k="${k}"]`, card);
      const weekday = Number(card.dataset.day);
      const isOpen = g('is_open').checked;
      const openMin = hhmmToMin(g('open').value);
      const closeMin = hhmmToMin(g('close').value);
      const useBreak = g('has_break').checked;
      const bs = hhmmToMin(g('bstart').value);
      const be = hhmmToMin(g('bend').value);

      if (isOpen) {
        if (openMin == null || closeMin == null || closeMin <= openMin) {
          toastErr(`${WEEKDAYS[weekday]}: closing time must be after opening time.`);
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        if (useBreak && (bs == null || be == null || be <= bs || bs < openMin || be > closeMin)) {
          toastErr(`${WEEKDAYS[weekday]}: the break must sit inside opening hours.`);
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
      payload.push({
        weekday, is_open: isOpen,
        open_min: openMin ?? 480, close_min: closeMin ?? 1260,
        break_start_min: useBreak ? bs : null,
        break_end_min: useBreak ? be : null,
      });
    }
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Saving…';
    try {
      await api('/api/admin/clinic/hours', { method: 'PUT', body: { hours: payload } });
      toastOk('Working hours saved — booking availability updated');
      const openDays = payload.filter((p) => p.is_open).length;
      $('#hStatus').textContent = `${openDays} day${openDays === 1 ? '' : 's'} open per week.`;
    } catch (err) {
      toastErr(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  $('#hSave').onclick = (e) => save(e.currentTarget);
  $('#hSave2').onclick = (e) => save(e.currentTarget);
}

/* ══════════ Holidays & blocked slots ══════════ */
export async function renderHolidays(view) {
  async function load() {
    view.innerHTML = '<div class="spin"></div>';
    const [holidays, blocked] = await Promise.all([
      api('/api/admin/clinic/holidays?from=' + today()),
      api('/api/admin/clinic/blocked-slots?from=' + today()),
    ]);

    view.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div><h2>Holidays &amp; closures</h2><p class="card-sub">Whole days the clinic is closed. Patients cannot book these dates.</p></div>
          <button class="btn btn-primary btn-sm" id="addHol">Add closure</button>
        </div>
        ${holidays.length ? `
          <div class="table-wrap"><table class="data">
            <thead><tr><th>From</th><th>To</th><th>Type</th><th>Reason</th><th></th></tr></thead>
            <tbody>${holidays.map((h) => `
              <tr>
                <td>${fmtDate(h.date)}</td>
                <td>${h.end_date ? fmtDate(h.end_date) : '<span class="t-muted">same day</span>'}</td>
                <td>${h.is_full_day ? 'Full day' : `${minToHHMM(h.start_min)}–${minToHHMM(h.end_min)}`}</td>
                <td>${esc(h.reason || '—')}</td>
                <td><div class="t-actions"><button class="btn btn-danger btn-xs" data-delh="${h.id}">Remove</button></div></td>
              </tr>`).join('')}</tbody>
          </table></div>` : emptyState('No upcoming closures.', 'calendar')}
      </div>

      <div class="card">
        <div class="card-head">
          <div><h2>Blocked time</h2><p class="card-sub">Shorter blocks — meetings, equipment servicing, personal time</p></div>
          <button class="btn btn-primary btn-sm" id="addBlk">Block time</button>
        </div>
        ${blocked.length ? `
          <div class="table-wrap"><table class="data">
            <thead><tr><th>Date</th><th>Time</th><th>Reason</th><th></th></tr></thead>
            <tbody>${blocked.map((b) => `
              <tr>
                <td>${fmtDate(b.date)}</td>
                <td class="mono" style="font-size:12px;">${minToHHMM(b.start_min)} – ${minToHHMM(b.end_min)}</td>
                <td>${esc(b.reason || '—')}</td>
                <td><div class="t-actions"><button class="btn btn-danger btn-xs" data-delb="${b.id}">Remove</button></div></td>
              </tr>`).join('')}</tbody>
          </table></div>` : emptyState('No blocked time.', 'calendar')}
      </div>`;

    $('#addHol').onclick = () => holidayForm(load);
    $('#addBlk').onclick = () => blockForm(load);
    $$('[data-delh]', view).forEach((b) => {
      b.onclick = async () => {
        if (!await confirmAction('Remove closure', 'Reopen this date for booking?', { confirmLabel: 'Remove' })) return;
        await api(`/api/admin/clinic/holidays/${b.dataset.delh}`, { method: 'DELETE' });
        toastOk('Closure removed'); load();
      };
    });
    $$('[data-delb]', view).forEach((b) => {
      b.onclick = async () => {
        await api(`/api/admin/clinic/blocked-slots/${b.dataset.delb}`, { method: 'DELETE' });
        toastOk('Block removed'); load();
      };
    });
  }
  await load();
}

function holidayForm(reload) {
  openModal('Add a closure', `
    <div class="frow">
      <div class="field"><label>From date</label><input type="date" id="hDate" value="${today()}"></div>
      <div class="field"><label>To date (optional)</label><input type="date" id="hEnd"><div class="hint">For a multi-day closure.</div></div>
    </div>
    <div class="field"><label>Reason</label><input type="text" id="hReason" placeholder="e.g. Festival holiday"></div>
    <label class="check"><input type="checkbox" id="hFull" checked><span>Closed all day</span></label>
    <div class="frow" id="hPartial" hidden>
      <div class="field"><label>Closed from</label><input type="time" id="hStart" value="09:00"></div>
      <div class="field"><label>Closed until</label><input type="time" id="hUntil" value="13:00"></div>
    </div>`, {
    footer: '<button class="btn btn-ghost" id="hCancel">Cancel</button><button class="btn btn-primary" id="hGo">Add closure</button>',
  });
  $('#hFull').onchange = () => { $('#hPartial').hidden = $('#hFull').checked; };
  $('#hCancel').onclick = closeModal;
  $('#hGo').onclick = async () => {
    const body = {
      date: $('#hDate').value,
      end_date: $('#hEnd').value || null,
      reason: $('#hReason').value.trim() || null,
      is_full_day: $('#hFull').checked,
    };
    if (!body.is_full_day) {
      body.start_min = hhmmToMin($('#hStart').value);
      body.end_min = hhmmToMin($('#hUntil').value);
    }
    try {
      await api('/api/admin/clinic/holidays', { method: 'POST', body });
      toastOk('Closure added'); closeModal(); reload();
    } catch (err) { toastErr(err.message); }
  };
}

function blockForm(reload) {
  openModal('Block time', `
    <div class="field"><label>Date</label><input type="date" id="bDate" value="${today()}"></div>
    <div class="frow">
      <div class="field"><label>From</label><input type="time" id="bStart" value="09:00"></div>
      <div class="field"><label>To</label><input type="time" id="bEnd" value="10:00"></div>
    </div>
    <div class="field"><label>Reason</label><input type="text" id="bReason" placeholder="e.g. Equipment servicing"></div>`, {
    footer: '<button class="btn btn-ghost" id="bCancel">Cancel</button><button class="btn btn-primary" id="bGo">Block time</button>',
  });
  $('#bCancel').onclick = closeModal;
  $('#bGo').onclick = async () => {
    try {
      await api('/api/admin/clinic/blocked-slots', {
        method: 'POST',
        body: {
          date: $('#bDate').value,
          start_min: hhmmToMin($('#bStart').value),
          end_min: hhmmToMin($('#bEnd').value),
          reason: $('#bReason').value.trim() || null,
        },
      });
      toastOk('Time blocked'); closeModal(); reload();
    } catch (err) { toastErr(err.message); }
  };
}

/* ══════════ Doctors ══════════ */
export async function renderDoctors(view) {
  async function load() {
    view.innerHTML = '<div class="spin"></div>';
    const doctors = await api('/api/admin/doctors');
    const media = await api('/api/admin/gallery/media');

    view.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div><h2>Doctors</h2><p class="card-sub">Each doctor has their own booking calendar and working hours</p></div>
          <button class="btn btn-primary btn-sm" id="addDoc">Add doctor</button>
        </div>
        ${doctors.map((d) => `
          <div style="padding:16px 0; border-bottom:1px solid var(--line);">
            <div style="display:flex; gap:14px; align-items:flex-start; flex-wrap:wrap;">
              ${d.photo_url ? `<img class="thumb" style="width:64px; height:64px;" src="${esc(d.photo_url)}" alt="">` : ''}
              <div style="flex:1; min-width:200px;">
                <div class="t-strong" style="font-size:15px;">${esc(d.name)}</div>
                <div class="t-muted">${esc(d.qualification || '')}${d.registration ? ' · ' + esc(d.registration) : ''}</div>
                ${d.specialization ? `<div class="t-muted">${esc(d.specialization)}</div>` : ''}
                <div class="t-muted" style="margin-top:5px;">
                  ${d.schedule.length
                    ? `Custom hours on ${d.schedule.length} day(s)`
                    : 'Follows clinic working hours'}
                </div>
              </div>
              <div class="t-actions">
                ${d.is_active ? '<span class="pill pill-confirmed">active</span>' : '<span class="pill pill-disabled">inactive</span>'}
                <button class="btn btn-ghost btn-xs" data-edit="${d.id}">Edit</button>
                <button class="btn btn-ghost btn-xs" data-sched="${d.id}">Working hours</button>
                <button class="btn btn-danger btn-xs" data-del="${d.id}">Remove</button>
              </div>
            </div>
          </div>`).join('') || emptyState('No doctors yet.', 'inbox')}
      </div>`;

    $('#addDoc').onclick = () => docForm(null, media, load);
    $$('[data-edit]', view).forEach((b) => {
      b.onclick = () => docForm(doctors.find((d) => d.id === Number(b.dataset.edit)), media, load);
    });
    $$('[data-sched]', view).forEach((b) => {
      b.onclick = () => scheduleForm(doctors.find((d) => d.id === Number(b.dataset.sched)), load);
    });
    $$('[data-del]', view).forEach((b) => {
      b.onclick = async () => {
        if (!await confirmAction('Remove doctor', 'Remove this doctor? Existing appointments are kept.', { confirmLabel: 'Remove' })) return;
        try { await api(`/api/admin/doctors/${b.dataset.del}`, { method: 'DELETE' }); toastOk('Doctor removed'); load(); }
        catch (err) { toastErr(err.message); }
      };
    });
  }
  await load();
}

function docForm(doc, media, reload) {
  const d = doc || { is_active: 1, currency: 'INR' };
  openModal(doc ? `Edit ${doc.name}` : 'Add doctor', `
    <div class="frow">
      <div class="field"><label>Name</label><input type="text" data-f="name" value="${esc(d.name || '')}"></div>
      <div class="field"><label>Qualification</label><input type="text" data-f="qualification" value="${esc(d.qualification || '')}"></div>
    </div>
    <div class="frow">
      <div class="field"><label>Registration</label><input type="text" data-f="registration" value="${esc(d.registration || '')}"></div>
      <div class="field"><label>Specialization</label><input type="text" data-f="specialization" value="${esc(d.specialization || '')}"></div>
    </div>
    <div class="field"><label>Biography</label><textarea data-f="bio" rows="3">${esc(d.bio || '')}</textarea></div>
    <div class="frow3">
      <div class="field"><label>Years of experience</label><input type="number" data-f="experience_years" value="${d.experience_years ?? ''}" min="0" max="80"></div>
      <div class="field"><label>Languages</label><input type="text" data-f="languages" value="${esc(d.languages || '')}"></div>
      <div class="field"><label>Consultation fee</label><input type="number" data-f="consultation_fee" value="${d.consultation_fee ?? ''}" min="0"></div>
    </div>
    <div class="field"><label>Photo</label>
      <select data-f="photo_media_id">
        <option value="">No photo</option>
        ${media.map((m) => `<option value="${m.id}" ${d.photo_media_id === m.id ? 'selected' : ''}>${esc(m.original_name || m.key)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>Slot interval override (minutes)</label>
      <input type="number" data-f="slot_interval_min" value="${d.slot_interval_min ?? ''}" min="5" max="240" step="5">
      <div class="hint">Leave blank to use the clinic default.</div></div>
    <label class="check"><input type="checkbox" data-f="is_active" ${d.is_active ? 'checked' : ''}><span>Active and bookable</span></label>`, {
    footer: '<button class="btn btn-ghost" id="dCancel">Cancel</button><button class="btn btn-primary" id="dSave">Save</button>',
    wide: true,
  });

  $('#dCancel').onclick = closeModal;
  $('#dSave').onclick = async () => {
    const body = {};
    $$('[data-f]').forEach((el) => {
      const k = el.dataset.f;
      if (el.type === 'checkbox') body[k] = el.checked;
      else if (el.type === 'number' || k === 'photo_media_id') body[k] = el.value === '' ? null : Number(el.value);
      else body[k] = el.value.trim() || null;
    });
    if (!body.name) { toastErr('Name is required.'); return; }
    try {
      if (doc) await api(`/api/admin/doctors/${doc.id}`, { method: 'PUT', body });
      else await api('/api/admin/doctors', { method: 'POST', body });
      toastOk('Saved'); closeModal(); reload();
    } catch (err) { toastErr(err.message); }
  };
}

function scheduleForm(doc, reload) {
  const byDay = Object.fromEntries(doc.schedule.map((s) => [s.weekday, s]));
  const order = [1, 2, 3, 4, 5, 6, 0];
  openModal(`Working hours — ${doc.name}`, `
    <p class="card-sub">Leave “inherit” ticked to follow the clinic's opening hours for that day.</p>
    <div class="table-wrap"><table class="data" style="min-width:0;">
      <thead><tr><th>Day</th><th>Inherit</th><th>Open</th><th>From</th><th>To</th><th>Break</th></tr></thead>
      <tbody>${order.map((w) => {
        const s = byDay[w];
        return `<tr data-day="${w}">
          <td class="t-strong">${esc(WEEKDAYS[w].slice(0, 3))}</td>
          <td><input type="checkbox" data-k="inherit" ${s ? '' : 'checked'}></td>
          <td><input type="checkbox" data-k="is_open" ${!s || s.is_open ? 'checked' : ''}></td>
          <td><input type="time" data-k="open" value="${minToHHMM(s?.open_min ?? 540)}" style="width:110px;"></td>
          <td><input type="time" data-k="close" value="${minToHHMM(s?.close_min ?? 1140)}" style="width:110px;"></td>
          <td style="display:flex; gap:4px;">
            <input type="time" data-k="bstart" value="${s?.break_start_min != null ? minToHHMM(s.break_start_min) : ''}" style="width:104px;">
            <input type="time" data-k="bend" value="${s?.break_end_min != null ? minToHHMM(s.break_end_min) : ''}" style="width:104px;">
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`, {
    footer: '<button class="btn btn-ghost" id="sCancel">Cancel</button><button class="btn btn-primary" id="sSave">Save hours</button>',
    wide: true,
  });

  $('#sCancel').onclick = closeModal;
  $('#sSave').onclick = async () => {
    const schedule = $$('tr[data-day]').map((tr) => {
      const g = (k) => $(`[data-k="${k}"]`, tr);
      return {
        weekday: Number(tr.dataset.day),
        inherit: g('inherit').checked,
        is_open: g('is_open').checked,
        open_min: hhmmToMin(g('open').value) ?? 540,
        close_min: hhmmToMin(g('close').value) ?? 1140,
        break_start_min: hhmmToMin(g('bstart').value),
        break_end_min: hhmmToMin(g('bend').value),
      };
    });
    try {
      await api(`/api/admin/doctors/${doc.id}/schedule`, { method: 'PUT', body: { schedule } });
      toastOk('Working hours saved'); closeModal(); reload();
    } catch (err) { toastErr(err.message); }
  };
}
