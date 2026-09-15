/* Multi-step booking wizard.
   Every slot shown here comes from GET /api/appointments/availability — the
   client never invents times, and the server re-validates on submit. */
(function () {
  'use strict';

  var shell = document.getElementById('bookingShell');
  if (!shell) return;

  var stepsEl = document.getElementById('bookingSteps');
  var bodyEl = document.getElementById('bookingBody');
  var footEl = document.getElementById('bookingFoot');
  var backBtn = document.getElementById('bookBack');
  var nextBtn = document.getElementById('bookNext');

  var SERVICES = [];
  try { SERVICES = JSON.parse(shell.dataset.services || '[]'); } catch (e) { SERVICES = []; }
  var BOOKABLE = SERVICES.filter(function (s) { return s.bookable; });

  var STEPS = ['Treatment', 'Date', 'Time', 'Your details', 'Confirm'];
  var state = {
    step: 0, serviceId: null, date: null, time: null, slotLabel: null,
    name: '', phone: '', email: '', message: '', isNew: true,
    calendarMonth: null, days: [], slots: [], busy: false, error: null, result: null,
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cookie(name) {
    return document.cookie.split('; ').reduce(function (acc, part) {
      var kv = part.split('=');
      return kv[0] === name ? decodeURIComponent(kv.slice(1).join('=')) : acc;
    }, '');
  }

  async function api(url, options) {
    var opts = options || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (opts.method && opts.method !== 'GET') {
      var token = cookie('sdc_csrf');
      if (!token) {
        try {
          var r = await fetch('/api/csrf', { credentials: 'same-origin' });
          token = (await r.json()).token;
        } catch (e) { /* fall through; server will reject and we show the error */ }
      }
      opts.headers['X-CSRF-Token'] = token;
    }
    opts.credentials = 'same-origin';
    var res = await fetch(url, opts);
    var data = null;
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) {
      var err = new Error((data && data.error) || 'Something went wrong. Please try again.');
      err.code = data && data.code;
      err.fields = data && data.fields;
      throw err;
    }
    return data;
  }

  /* ---------- Rendering ---------- */
  function renderSteps() {
    stepsEl.innerHTML = STEPS.map(function (label, i) {
      var cls = i === state.step ? 'bstep active' : (i < state.step ? 'bstep done' : 'bstep');
      return '<div class="' + cls + '">Step ' + (i + 1) + '<span>' + esc(label) + '</span></div>';
    }).join('');
  }

  function alertHtml(message, kind) {
    var icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>';
    return '<div class="booking-alert alert-' + (kind || 'error') + '">' + icon + '<span>' + esc(message) + '</span></div>';
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function renderBody() {
    var html = '';
    if (state.error) html += alertHtml(state.error, 'error');

    if (state.step === 0) {
      html += '<div class="booking-title">Choose a treatment</div>';
      html += '<p class="booking-hint">Pick the reason for your visit. Appointment length is set automatically.</p>';
      if (!BOOKABLE.length) {
        html += '<div class="booking-empty">Online booking is not available right now. Please call the clinic.</div>';
      } else {
        html += '<div class="choice-grid">' + BOOKABLE.map(function (s) {
          return '<button type="button" class="choice" data-service="' + s.id + '" aria-pressed="' +
            (state.serviceId === s.id) + '">' +
            '<div class="choice-name">' + esc(s.name) + '</div>' +
            '<div class="choice-meta">' + s.duration + ' min' + (s.category ? ' · ' + esc(s.category) : '') + '</div>' +
            (s.desc ? '<div class="choice-desc">' + esc(s.desc) + '</div>' : '') +
            '</button>';
        }).join('') + '</div>';
      }
    }

    else if (state.step === 1) {
      html += '<div class="booking-title">Choose a date</div>';
      html += '<p class="booking-hint">Only days with free appointments can be selected.</p>';
      html += renderCalendar();
    }

    else if (state.step === 2) {
      html += '<div class="booking-title">Choose a time</div>';
      html += '<p class="booking-hint">Times shown are currently available on ' + esc(prettyDate(state.date)) + '.</p>';
      if (state.busy) {
        html += '<div class="spinner"></div>';
      } else if (!state.slots.length) {
        html += '<div class="booking-empty">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
          'No times are left on this date. Please choose another day.</div>';
      } else {
        var groups = { Morning: [], Afternoon: [], Evening: [] };
        state.slots.forEach(function (s) {
          var h = parseInt(s.time.split(':')[0], 10);
          (h < 12 ? groups.Morning : h < 16 ? groups.Afternoon : groups.Evening).push(s);
        });
        Object.keys(groups).forEach(function (g) {
          if (!groups[g].length) return;
          html += '<div class="slot-group"><h4>' + g + '</h4><div class="slot-grid">' +
            groups[g].map(function (s) {
              return '<button type="button" class="slot" data-time="' + s.time + '" data-label="' + esc(s.label) +
                '" aria-pressed="' + (state.time === s.time) + '">' + esc(s.label) + '</button>';
            }).join('') + '</div></div>';
        });
      }
    }

    else if (state.step === 3) {
      html += '<div class="booking-title">Your details</div>';
      html += '<p class="booking-hint">The clinic uses these to confirm your appointment.</p>';
      html += '<div class="field" id="f-name"><label for="bkName">Full name</label>' +
        '<input type="text" id="bkName" autocomplete="name" placeholder="Your full name" value="' + esc(state.name) + '">' +
        '<span class="field-error">Please enter your name.</span></div>';
      html += '<div class="field-row">' +
        '<div class="field" id="f-phone"><label for="bkPhone">Mobile number</label>' +
        '<input type="tel" id="bkPhone" inputmode="numeric" autocomplete="tel" placeholder="10-digit mobile number" value="' + esc(state.phone) + '">' +
        '<span class="field-error">Enter a valid 10-digit mobile number.</span></div>' +
        '<div class="field" id="f-email"><label for="bkEmail">Email <span style="color:#8A948A;">(optional)</span></label>' +
        '<input type="email" id="bkEmail" autocomplete="email" placeholder="you@example.com" value="' + esc(state.email) + '">' +
        '<span class="field-error">Enter a valid email address.</span></div>' +
        '</div>';
      html += '<div class="field"><label for="bkMessage">Anything the dentist should know? <span style="color:#8A948A;">(optional)</span></label>' +
        '<textarea id="bkMessage" rows="3" placeholder="Symptoms, previous treatment, preferred dentist...">' + esc(state.message) + '</textarea></div>';
      html += '<div class="field"><label>Have you visited before?</label>' +
        '<div style="display:flex; gap:9px; margin-top:6px;">' +
        '<button type="button" class="choice" data-new="1" aria-pressed="' + (state.isNew === true) + '" style="flex:1;"><div class="choice-name">New patient</div></button>' +
        '<button type="button" class="choice" data-new="0" aria-pressed="' + (state.isNew === false) + '" style="flex:1;"><div class="choice-name">Returning patient</div></button>' +
        '</div></div>';
    }

    else if (state.step === 4 && !state.result) {
      var svc = BOOKABLE.filter(function (s) { return s.id === state.serviceId; })[0];
      html += '<div class="booking-title">Confirm your appointment</div>';
      html += '<p class="booking-hint">Please check these details before confirming.</p>';
      html += '<div class="summary-card">' +
        row('Treatment', svc ? svc.name : '—') +
        row('Date', prettyDate(state.date)) +
        row('Time', state.slotLabel || state.time) +
        (svc ? row('Duration', svc.duration + ' minutes') : '') +
        row('Name', state.name) +
        row('Mobile', state.phone) +
        (state.email ? row('Email', state.email) : '') +
        '</div>';
      if (state.busy) html += '<div class="spinner"></div>';
    }

    else if (state.result) {
      var a = state.result;
      html = '<div class="booking-done">' +
        '<div class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg></div>' +
        '<div class="booking-title">Appointment ' + esc(a.status === 'confirmed' ? 'confirmed' : 'requested') + '</div>' +
        '<p class="booking-hint">' + (a.status === 'confirmed'
          ? 'Your appointment is confirmed. We look forward to seeing you.'
          : 'The clinic has received your request and will confirm shortly.') + '</p>' +
        '<div class="booking-ref">' + esc(a.ref) + '</div>' +
        '<div class="summary-card" style="text-align:left;">' +
          row('Date', a.date_label) + row('Time', a.time) +
          row('Service', a.service) + row('Dentist', a.doctor) +
        '</div>' +
        '<div class="done-actions">' +
          '<a class="btn btn-outline-dark btn-sm" id="icsLink" href="#">Add to Calendar</a>' +
          (window.__SDC_WHATSAPP ? '<a class="btn btn-whatsapp btn-sm" href="' + window.__SDC_WHATSAPP + '" target="_blank" rel="noopener">WhatsApp Clinic</a>' : '') +
          '<button type="button" class="btn btn-outline-dark btn-sm" id="bookAnother">Book another</button>' +
        '</div>' +
        '<p style="margin-top:20px; font-size:12.5px; color:#7C8A78;">Keep your booking ID safe &mdash; you will need it, along with your mobile number, to reschedule or cancel.</p>' +
        '</div>';
    }

    bodyEl.innerHTML = html;
    bindBody();
    updateFoot();
  }

  function row(label, value) {
    return '<div class="summary-row"><span class="summary-label">' + esc(label) +
      '</span><span class="summary-value">' + esc(value) + '</span></div>';
  }

  function prettyDate(d) {
    if (!d) return '';
    var parts = d.split('-');
    var dt = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    return dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  function renderCalendar() {
    if (state.busy) return '<div class="spinner"></div>';
    var byDate = {};
    state.days.forEach(function (d) { byDate[d.date] = d; });

    var month = state.calendarMonth ? new Date(state.calendarMonth + '-01T00:00:00Z') : new Date();
    var year = month.getUTCFullYear ? month.getUTCFullYear() : month.getFullYear();
    var mon = month.getUTCMonth ? month.getUTCMonth() : month.getMonth();

    var first = new Date(Date.UTC(year, mon, 1));
    var daysInMonth = new Date(Date.UTC(year, mon + 1, 0)).getUTCDate();
    var startDow = first.getUTCDay();

    var firstAvail = state.days.length ? state.days[0].date : null;
    var lastAvail = state.days.length ? state.days[state.days.length - 1].date : null;
    var prevDisabled = !firstAvail || (year + '-' + String(mon + 1).padStart(2, '0')) <= firstAvail.slice(0, 7);
    var nextDisabled = !lastAvail || (year + '-' + String(mon + 1).padStart(2, '0')) >= lastAvail.slice(0, 7);

    var html = '<div class="cal-head">' +
      '<button type="button" class="cal-nav" id="calPrev" aria-label="Previous month"' + (prevDisabled ? ' disabled' : '') + '>&larr;</button>' +
      '<span class="cal-month">' + MONTHS[mon] + ' ' + year + '</span>' +
      '<button type="button" class="cal-nav" id="calNext" aria-label="Next month"' + (nextDisabled ? ' disabled' : '') + '>&rarr;</button>' +
      '</div><div class="cal-grid">';

    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(function (d) { html += '<div class="cal-dow">' + d + '</div>'; });
    for (var i = 0; i < startDow; i++) html += '<div class="cal-day empty"></div>';

    for (var day = 1; day <= daysInMonth; day++) {
      var dateStr = year + '-' + String(mon + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      var info = byDate[dateStr];
      var free = info && info.open && info.available_count > 0;
      html += '<button type="button" class="cal-day' + (state.date === dateStr ? ' selected' : '') + '"' +
        ' data-date="' + dateStr + '"' + (free ? '' : ' disabled') +
        ' aria-label="' + dateStr + (free ? ', ' + info.available_count + ' slots' : ', unavailable') + '">' +
        day + (free ? '<span class="cal-dot"></span>' : '') + '</button>';
    }
    html += '</div><div class="cal-legend"><span class="cal-dot"></span> Appointments available</div>';
    return html;
  }

  /* ---------- Interaction ---------- */
  function bindBody() {
    bodyEl.querySelectorAll('[data-service]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.serviceId = Number(btn.dataset.service);
        state.date = null; state.time = null; state.error = null;
        renderBody();
      });
    });

    bodyEl.querySelectorAll('[data-date]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.date = btn.dataset.date;
        state.time = null;
        renderBody();
      });
    });

    var prev = document.getElementById('calPrev');
    var next = document.getElementById('calNext');
    if (prev) prev.addEventListener('click', function () { shiftMonth(-1); });
    if (next) next.addEventListener('click', function () { shiftMonth(1); });

    bodyEl.querySelectorAll('[data-time]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.time = btn.dataset.time;
        state.slotLabel = btn.dataset.label;
        renderBody();
      });
    });

    bodyEl.querySelectorAll('[data-new]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.isNew = btn.dataset.new === '1';
        renderBody();
      });
    });

    ['bkName', 'bkPhone', 'bkEmail', 'bkMessage'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () {
        var key = { bkName: 'name', bkPhone: 'phone', bkEmail: 'email', bkMessage: 'message' }[id];
        state[key] = el.value;
        var field = el.closest('.field');
        if (field) field.classList.remove('invalid');
      });
    });

    var another = document.getElementById('bookAnother');
    if (another) {
      another.addEventListener('click', function () {
        state = Object.assign(state, {
          step: 0, serviceId: null, date: null, time: null, slotLabel: null,
          message: '', result: null, error: null,
        });
        renderSteps(); renderBody();
      });
    }

    var ics = document.getElementById('icsLink');
    if (ics && state.result) {
      ics.href = '/api/appointments/' + encodeURIComponent(state.result.ref) +
        '/calendar.ics?phone=' + encodeURIComponent(state.phone);
    }
  }

  function shiftMonth(delta) {
    var base = state.calendarMonth ? state.calendarMonth + '-01' : new Date().toISOString().slice(0, 8) + '01';
    var d = new Date(base + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() + delta);
    state.calendarMonth = d.toISOString().slice(0, 7);
    renderBody();
  }

  function updateFoot() {
    footEl.hidden = Boolean(state.result);
    backBtn.style.visibility = state.step === 0 ? 'hidden' : 'visible';
    nextBtn.disabled = state.busy || !canAdvance();
    nextBtn.textContent = state.step === 4 ? 'Confirm Booking' : 'Continue';
  }

  function canAdvance() {
    if (state.step === 0) return Boolean(state.serviceId);
    if (state.step === 1) return Boolean(state.date);
    if (state.step === 2) return Boolean(state.time);
    if (state.step === 3) return true;   // validated on click, with field errors
    return true;
  }

  function validateDetails() {
    var ok = true;
    var nameField = document.getElementById('f-name');
    var phoneField = document.getElementById('f-phone');
    var emailField = document.getElementById('f-email');
    [nameField, phoneField, emailField].forEach(function (f) { if (f) f.classList.remove('invalid'); });

    if (!state.name || state.name.trim().length < 2) { nameField.classList.add('invalid'); ok = false; }
    var digits = String(state.phone).replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(digits) && !/^91[6-9]\d{9}$/.test(digits)) {
      phoneField.classList.add('invalid'); ok = false;
    }
    if (state.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(state.email)) {
      emailField.classList.add('invalid'); ok = false;
    }
    return ok;
  }

  async function loadCalendar() {
    state.busy = true; state.error = null; renderBody();
    try {
      var qs = new URLSearchParams({ days: '60' });
      if (state.serviceId) qs.set('service_id', String(state.serviceId));
      var data = await api('/api/appointments/calendar?' + qs);
      state.days = data.days || [];
      var firstFree = state.days.filter(function (d) { return d.open && d.available_count > 0; })[0];
      state.calendarMonth = (firstFree ? firstFree.date : (state.days[0] || {}).date || '').slice(0, 7) || null;
    } catch (err) {
      state.error = err.message;
      state.days = [];
    } finally {
      state.busy = false; renderBody();
    }
  }

  async function loadSlots() {
    state.busy = true; state.error = null; renderBody();
    try {
      var qs = new URLSearchParams({ date: state.date });
      if (state.serviceId) qs.set('service_id', String(state.serviceId));
      var data = await api('/api/appointments/availability?' + qs);
      state.slots = (data.slots || []).filter(function (s) { return s.available; });
    } catch (err) {
      state.error = err.message;
      state.slots = [];
    } finally {
      state.busy = false; renderBody();
    }
  }

  async function submit() {
    state.busy = true; state.error = null; renderBody();
    try {
      var payload = {
        name: state.name.trim(),
        phone: state.phone.trim(),
        date: state.date,
        time: state.time,
        is_new_patient: state.isNew,
      };
      if (state.email) payload.email = state.email.trim();
      if (state.serviceId) payload.service_id = state.serviceId;
      if (state.message) payload.message = state.message.trim();

      var data = await api('/api/appointments', { method: 'POST', body: JSON.stringify(payload) });
      state.result = data.appointment;
      renderSteps();
    } catch (err) {
      state.error = err.message;
      // If the slot vanished mid-flow, send the patient back to pick another.
      if (err.code === 'SLOT_TAKEN' || err.code === 'SLOT_UNAVAILABLE') {
        state.time = null;
        state.step = 2;
        renderSteps();
        await loadSlots();
        return;
      }
    } finally {
      state.busy = false; renderBody();
    }
  }

  nextBtn.addEventListener('click', async function () {
    if (state.busy) return;
    if (state.step === 3 && !validateDetails()) return;

    if (state.step === 4) { await submit(); return; }

    state.step++;
    state.error = null;
    renderSteps();

    if (state.step === 1) { await loadCalendar(); return; }
    if (state.step === 2) { await loadSlots(); return; }
    renderBody();
  });

  backBtn.addEventListener('click', function () {
    if (state.step === 0) return;
    state.step--;
    state.error = null;
    renderSteps();
    renderBody();
  });

  /* Jump straight into the wizard with a treatment already chosen. */
  async function startWithService(serviceId) {
    if (!BOOKABLE.some(function (s) { return s.id === serviceId; })) return false;
    state.serviceId = serviceId;
    state.step = 1;
    state.result = null;
    state.error = null;
    renderSteps();
    var target = document.getElementById('appointment');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await loadCalendar();
    return true;
  }

  /* "Book" buttons on treatment cards and detail pages. On the homepage these
     open the wizard in place; on a treatment page the button is a link to
     /#appointment?treatment=<slug>, which the block below picks up on arrival. */
  document.querySelectorAll('.book-service').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      var id = Number(btn.dataset.service);
      if (!document.getElementById('bookingShell')) return;   // let the link navigate
      e.preventDefault();
      startWithService(id);
    });
  });

  /*
   * Arriving from a treatment page: /#appointment?treatment=root-canal-treatment
   *
   * The query lives in the fragment rather than the URL's own query string so
   * the browser still scrolls to #appointment on its own, and so the homepage
   * is never served under a second, duplicate URL that a crawler would index
   * separately from "/".
   */
  function preselectFromHash() {
    var hash = window.location.hash || '';
    var q = hash.indexOf('?');
    if (q === -1) return;
    var params = new URLSearchParams(hash.slice(q + 1));
    var slug = params.get('treatment');
    var match = slug && SERVICES.filter(function (s) { return s.slug === slug; })[0];
    if (!match) return;
    startWithService(match.id);
    // Drop the query from the address bar; the selection is now in the wizard.
    history.replaceState(null, '', hash.slice(0, q));
  }

  renderSteps();
  renderBody();
  preselectFromHash();
  window.addEventListener('hashchange', preselectFromHash);
})();
