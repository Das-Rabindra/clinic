/* Booking wizard, and "find or cancel my booking".

   Every date and time shown comes from the server:
     GET  /api/appointments/calendar      which days have free times
     GET  /api/appointments/availability  the free times on one day
   The client never invents or keeps slots of its own; picking one is a
   request, and the server re-checks it on submit (POST /api/appointments).
   Confirmation is shown only after a 201 with a booking reference.

   Accessibility: each step change moves focus to the step heading and is
   announced; errors are written next to their fields (aria-describedby),
   summarised in a live region, and focus goes to the first problem. Nothing
   the patient typed is cleared on any error. No form data is ever logged. */
(function () {
  'use strict';

  var shell = document.getElementById('bookingShell');
  if (!shell) return;

  var stepsEl = document.getElementById('bookingSteps');
  var bodyEl = document.getElementById('bookingBody');
  var footEl = document.getElementById('bookingFoot');
  var backBtn = document.getElementById('bookBack');
  var nextBtn = document.getElementById('bookNext');
  var statusEl = document.getElementById('bookingStatus');

  var SERVICES = [];
  try { SERVICES = JSON.parse(shell.dataset.services || '[]'); } catch (e) { SERVICES = []; }
  var BOOKABLE = SERVICES.filter(function (s) { return s.bookable; });
  var TEL = shell.dataset.tel || '';
  var PHONE = shell.dataset.phone || '';
  var WHATSAPP = shell.dataset.whatsapp || '';

  var STEPS = ['Treatment', 'Date', 'Time', 'Your details', 'Review'];
  var TITLES = ['Choose a treatment', 'Choose a date', 'Choose a time', 'Your details', 'Check and confirm'];

  var state = {
    step: 0, serviceId: null, date: null, time: null, slotLabel: null,
    name: '', phone: '', email: '', message: '', isNew: true,
    calendarMonth: null, days: [], nextAvailable: null, slots: [],
    busy: false, submitting: false,
    notice: null,        // { kind, title, text, retry, fallback }
    errors: {},          // field -> message
    result: null,
  };

  /* ---------- helpers ---------- */
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
  function announce(text) {
    if (!statusEl) return;
    statusEl.textContent = '';
    setTimeout(function () { statusEl.textContent = text; }, 30);
  }
  function svc() { return BOOKABLE.filter(function (s) { return s.id === state.serviceId; })[0] || null; }

  var ICON = {
    check: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    info: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    left: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    right: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  };

  /* Network: same-origin JSON, CSRF header on writes. A rejected CSRF token
     means the server did nothing, so one retry with a fresh token is safe. */
  async function api(url, options, retried) {
    var opts = Object.assign({}, options || {});
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    opts.credentials = 'same-origin';
    if (opts.method && opts.method !== 'GET') {
      var token = cookie('sdc_csrf');
      if (!token || retried) {
        var r = await fetch('/api/csrf', { credentials: 'same-origin' });
        token = (await r.json()).token;
      }
      opts.headers['X-CSRF-Token'] = token;
    }
    var res;
    try { res = await fetch(url, opts); }
    catch (e) { var ne = new Error('network'); ne.code = 'NETWORK'; throw ne; }
    var data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    if (!res.ok) {
      if (data.code === 'CSRF' && !retried) return api(url, options, true);
      var err = new Error(data.error || 'Something went wrong.');
      err.code = data.code || (res.status >= 500 ? 'SERVER' : 'ERROR');
      err.status = res.status;
      err.fields = data.fields || null;
      throw err;
    }
    return data;
  }

  function fallbackHtml() {
    var parts = [];
    if (TEL) parts.push('<a class="button button--secondary button--small" href="' + esc(TEL) + '" data-track="call_clicked">Call ' + esc(PHONE) + '</a>');
    if (WHATSAPP) parts.push('<a class="button button--secondary button--small" href="' + esc(WHATSAPP) + '" target="_blank" rel="noopener" data-track="whatsapp_clicked">WhatsApp</a>');
    return parts.length ? '<div class="cluster booking__fallback">' + parts.join('') + '</div>' : '';
  }

  function noticeHtml(n) {
    if (!n) return '';
    var icon = n.kind === 'success' ? ICON.check : n.kind === 'info' ? ICON.info : ICON.error;
    return '<div class="notice notice--' + n.kind + ' booking__notice" tabindex="-1" id="bookingNotice"' +
      (n.kind === 'error' ? ' role="alert"' : '') + '>' +
      '<span class="notice__icon">' + icon + '</span><div class="notice__body">' +
      (n.title ? '<p class="notice__title">' + esc(n.title) + '</p>' : '') +
      (n.text ? '<p>' + esc(n.text) + '</p>' : '') +
      (n.retry ? '<p><button type="button" class="button button--secondary button--small" data-retry>Try again</button></p>' : '') +
      (n.fallback ? fallbackHtml() : '') +
      '</div></div>';
  }

  /* ---------- step indicator ---------- */
  function renderSteps() {
    if (state.result) { stepsEl.innerHTML = ''; stepsEl.hidden = true; return; }
    stepsEl.hidden = false;
    var list = STEPS.map(function (label, i) {
      var cls = i === state.step ? 'is-current' : (i < state.step ? 'is-done' : '');
      return '<li class="booking-progress__step ' + cls + '"' + (i === state.step ? ' aria-current="step"' : '') + '>' +
        '<span class="booking-progress__num" aria-hidden="true">' + (i < state.step ? ICON.check : (i + 1)) + '</span>' +
        '<span class="booking-progress__label">' + esc(label) +
        (i < state.step ? '<span class="visually-hidden-ds"> (done)</span>' : '') + '</span></li>';
    }).join('');
    stepsEl.innerHTML =
      '<p class="booking-progress__compact" aria-hidden="true">Step ' + (state.step + 1) + ' of ' + STEPS.length +
        ' &middot; ' + esc(STEPS[state.step]) + '</p>' +
      '<div class="booking-progress__bar" aria-hidden="true"><span style="width:' + ((state.step + 1) / STEPS.length * 100) + '%"></span></div>' +
      '<ol class="booking-progress__list" aria-label="Booking steps">' + list + '</ol>';
  }

  /* ---------- body ---------- */
  function heading() {
    return '<h3 class="booking__title" id="bookingTitle" tabindex="-1">' +
      '<span class="visually-hidden-ds">Step ' + (state.step + 1) + ' of ' + STEPS.length + ': </span>' +
      esc(TITLES[state.step]) + '</h3>';
  }

  function renderTreatment() {
    if (!BOOKABLE.length) {
      return heading() + '<div class="booking__empty"><p>Online booking is not available right now. Please call or message the clinic.</p>' + fallbackHtml() + '</div>';
    }
    return heading() +
      '<p class="booking__hint">Pick the reason for your visit. The appointment length is set for you.</p>' +
      '<fieldset class="fieldset"><legend class="visually-hidden-ds">Treatment</legend><div class="booking__choices">' +
      BOOKABLE.map(function (s) {
        return '<label class="option-card booking__choice">' +
          '<input type="radio" name="bkService" value="' + s.id + '"' + (state.serviceId === s.id ? ' checked' : '') + '>' +
          '<span><span class="option-card__title">' + esc(s.name) + '</span>' +
          '<span class="option-card__meta">' + esc(s.duration) + ' min' + (s.category ? ' &middot; ' + esc(s.category) : '') + '</span>' +
          (s.desc ? '<span class="booking__choice-desc">' + esc(s.desc) + '</span>' : '') +
          '</span></label>';
      }).join('') + '</div></fieldset>';
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = [['Sun', 'Sunday'], ['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'], ['Thu', 'Thursday'], ['Fri', 'Friday'], ['Sat', 'Saturday']];

  function longDate(d) {
    if (!d) return '';
    var p = d.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  function shortDate(d) {
    var p = d.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  }

  function renderDate() {
    var html = heading();
    if (state.busy) return html + loadingHtml('Loading available days…');
    var free = state.days.filter(function (d) { return d.open && d.available_count > 0; });
    if (!free.length) {
      return html + (state.notice ? '' : '<div class="booking__empty"><p>There are no free appointments online in the coming weeks. The clinic may still be able to fit you in — please call or message.</p>' + fallbackHtml() + '</div>');
    }
    if (state.nextAvailable && state.nextAvailable.date) {
      var na = state.nextAvailable;
      html += '<p class="booking__hint">Earliest free time: <button type="button" class="button button--text button--small booking__jump" data-date="' + esc(na.date) + '">' +
        esc(shortDate(na.date)) + (na.label ? ', ' + esc(na.label) : '') + '</button></p>';
    }
    var byDate = {};
    state.days.forEach(function (d) { byDate[d.date] = d; });
    var ym = state.calendarMonth.split('-');
    var year = +ym[0], mon = +ym[1] - 1;
    var first = new Date(Date.UTC(year, mon, 1));
    var daysInMonth = new Date(Date.UTC(year, mon + 1, 0)).getUTCDate();
    var key = year + '-' + String(mon + 1).padStart(2, '0');
    var firstMonth = state.days[0].date.slice(0, 7);
    var lastMonth = state.days[state.days.length - 1].date.slice(0, 7);

    html += '<div class="cal"><div class="cal__head">' +
      '<button type="button" class="button button--secondary button--small cal__nav" data-month="-1" aria-label="Previous month"' + (key <= firstMonth ? ' disabled' : '') + '>' + ICON.left + '</button>' +
      '<h4 class="cal__month" id="calMonth" aria-live="polite">' + MONTHS[mon] + ' ' + year + '</h4>' +
      '<button type="button" class="button button--secondary button--small cal__nav" data-month="1" aria-label="Next month"' + (key >= lastMonth ? ' disabled' : '') + '>' + ICON.right + '</button>' +
      '</div><div class="cal__grid" role="group" aria-labelledby="calMonth">';
    DOW.forEach(function (d) { html += '<span class="cal__dow" aria-hidden="true">' + d[0] + '</span>'; });
    for (var i = 0; i < first.getUTCDay(); i++) html += '<span class="cal__pad" aria-hidden="true"></span>';
    for (var day = 1; day <= daysInMonth; day++) {
      var ds = key + '-' + String(day).padStart(2, '0');
      var info = byDate[ds];
      var n = info && info.open ? info.available_count : 0;
      var label = shortDate(ds) + (n ? ', ' + n + ' time' + (n === 1 ? '' : 's') + ' available' : ', no times available');
      var sel = state.date === ds;
      html += '<button type="button" class="cal__day' + (n ? ' has-times' : '') + '" data-date="' + ds + '"' +
        (n ? ' aria-pressed="' + sel + '"' : ' disabled') + ' aria-label="' + esc(label) + '">' +
        '<span>' + day + '</span>' + (n ? '<span class="cal__dot" aria-hidden="true"></span>' : '') + '</button>';
    }
    html += '</div><p class="cal__legend"><span class="cal__dot" aria-hidden="true"></span> Has free times. Days without a dot are full or closed.</p></div>';
    return html;
  }

  function renderTime() {
    var html = heading() + '<p class="booking__hint">Free times on <strong>' + esc(longDate(state.date)) + '</strong>' +
      (svc() ? ', for ' + esc(svc().name) + ' (' + esc(svc().duration) + ' min)' : '') + '.</p>';
    if (state.busy) return html + loadingHtml('Loading free times…');
    if (!state.slots.length) {
      return html + (state.notice ? '' : '<div class="booking__empty"><p>No times are left on this day.</p>' +
        '<p><button type="button" class="button button--secondary button--small" data-goto="1">Choose another day</button></p></div>');
    }
    var groups = [['Morning', []], ['Afternoon', []], ['Evening', []]];
    state.slots.forEach(function (s) {
      var h = parseInt(s.time.split(':')[0], 10);
      groups[h < 12 ? 0 : h < 16 ? 1 : 2][1].push(s);
    });
    groups.forEach(function (g, gi) {
      if (!g[1].length) return;
      html += '<div class="booking__slot-group"><h4 class="booking__slot-heading" id="slotGroup' + gi + '">' + g[0] + '</h4>' +
        '<div class="slot-grid" role="group" aria-labelledby="slotGroup' + gi + '">' +
        g[1].map(function (s) {
          var on = state.time === s.time;
          return '<button type="button" class="slot-option" data-time="' + esc(s.time) + '" data-label="' + esc(s.label) + '" aria-pressed="' + on + '">' +
            '<span class="slot-option__check">' + ICON.check + '</span><span class="slot-option__time">' + esc(s.label) + '</span></button>';
        }).join('') + '</div></div>';
    });
    return html;
  }

  function field(id, key, label, input, hint, optional) {
    var err = state.errors[key];
    var describedBy = (hint ? id + 'Hint ' : '') + id + 'Err';
    return '<div class="form-field">' +
      '<label class="form-label" for="' + id + '">' + label + (optional ? ' <span class="form-label__optional">(optional)</span>' : '') + '</label>' +
      (hint ? '<p class="form-hint" id="' + id + 'Hint">' + hint + '</p>' : '') +
      input.replace('%A%', ' aria-describedby="' + describedBy + '"' + (err ? ' aria-invalid="true"' : '')) +
      '<p class="form-error" id="' + id + 'Err">' + (err ? ICON.error + esc(err) : '') + '</p></div>';
  }

  function renderDetails() {
    return heading() +
      '<p class="booking__hint">The clinic uses these to confirm your appointment. Nothing is shared with anyone else.</p>' +
      '<div class="booking__form">' +
      field('bkName', 'name', 'Full name', '<input class="input" id="bkName" name="name" type="text" autocomplete="name" maxlength="120" value="' + esc(state.name) + '"%A%>') +
      field('bkPhone', 'phone', 'Mobile number', '<input class="input" id="bkPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="' + esc(state.phone) + '"%A%>', '10-digit mobile number. The clinic will confirm on this number.') +
      field('bkEmail', 'email', 'Email', '<input class="input" id="bkEmail" name="email" type="email" autocomplete="email" maxlength="200" value="' + esc(state.email) + '"%A%>', null, true) +
      field('bkMessage', 'message', 'Anything the dentist should know?', '<textarea class="textarea" id="bkMessage" name="message" rows="3" maxlength="1000"%A%>' + esc(state.message) + '</textarea>', 'For example, which tooth is troubling you. Please do not include medical history here.', true) +
      '<fieldset class="fieldset form-field"><legend class="form-label">Have you visited the clinic before?</legend><div class="booking__two">' +
        '<label class="option-card"><input type="radio" name="bkNew" value="1"' + (state.isNew ? ' checked' : '') + '><span class="option-card__title">First visit</span></label>' +
        '<label class="option-card"><input type="radio" name="bkNew" value="0"' + (!state.isNew ? ' checked' : '') + '><span class="option-card__title">I have been before</span></label>' +
      '</div></fieldset></div>';
  }

  function row(label, value) {
    return '<div class="booking__summary-row"><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  }

  function renderReview() {
    var s = svc();
    return heading() + '<p class="booking__hint">Please check the details. You can go back to change anything.</p>' +
      '<dl class="booking__summary">' +
      row('Treatment', s ? s.name : 'Consultation') + row('Date', longDate(state.date)) +
      row('Time', state.slotLabel || state.time) + (s ? row('Length', s.duration + ' minutes') : '') +
      row('Name', state.name) + row('Mobile', state.phone) + (state.email ? row('Email', state.email) : '') +
      row('Visit', state.isNew ? 'First visit' : 'Returning patient') +
      '</dl>' +
      '<p class="form-hint booking__policy">By confirming you agree to the <a class="link" href="/privacy">privacy and appointment policy</a>.</p>';
  }

  function renderResult() {
    var a = state.result;
    var confirmed = a.status === 'confirmed';
    var ics = '/api/appointments/' + encodeURIComponent(a.ref) + '/calendar.ics?phone=' + encodeURIComponent(state.phone);
    return '<div class="booking__done">' +
      '<h3 class="booking__title" id="bookingTitle" tabindex="-1">' + (confirmed ? 'Appointment confirmed' : 'Appointment requested') + '</h3>' +
      '<p>' + (confirmed ? 'Your appointment is booked.' : 'The clinic has your request and will confirm it with you on ' + esc(state.phone) + '.') + '</p>' +
      '<div class="booking__ref"><span>Booking reference</span><strong>' + esc(a.ref) + '</strong></div>' +
      '<dl class="booking__summary">' + row('Date', a.date_label) + row('Time', a.time) +
        (a.service ? row('Treatment', a.service) : '') + (a.doctor ? row('Dentist', a.doctor) : '') + '</dl>' +
      '<p class="form-hint">Keep the reference. With your mobile number it lets you look up or cancel this appointment below.</p>' +
      '<div class="cluster">' +
        '<a class="button button--primary button--small" href="' + esc(ics) + '">Add to calendar</a>' +
        (WHATSAPP ? '<a class="button button--secondary button--small" href="' + esc(WHATSAPP) + '" target="_blank" rel="noopener" data-track="whatsapp_clicked">WhatsApp the clinic</a>' : '') +
        '<button type="button" class="button button--text button--small" id="bookAnother">Book another appointment</button>' +
      '</div></div>';
  }

  function loadingHtml(text) {
    return '<div class="booking__loading" aria-busy="true"><span class="spinner-ds" aria-hidden="true"></span><span>' + esc(text) + '</span></div>';
  }

  var RENDER = [renderTreatment, renderDate, renderTime, renderDetails, renderReview];

  function render(focusTarget) {
    /* Re-rendering replaces the body. If focus was inside it (say on the
       step heading while the calendar loaded), put it back on the heading
       rather than letting it fall to <body>. */
    var hadFocus = bodyEl.contains(document.activeElement);
    renderSteps();
    var html = state.result ? renderResult() : (noticeHtml(state.notice) + RENDER[state.step]());
    bodyEl.innerHTML = html;
    shell.setAttribute('aria-busy', String(state.busy || state.submitting));
    updateFoot();
    bind();
    if (focusTarget === 'title' || (!focusTarget && hadFocus)) { var t = document.getElementById('bookingTitle'); if (t) t.focus({ preventScroll: true }); }
    if (focusTarget === 'notice') { var n = document.getElementById('bookingNotice'); if (n) n.focus(); }
    if (focusTarget && focusTarget.indexOf('#') === 0) { var f = bodyEl.querySelector(focusTarget); if (f) f.focus(); }
  }

  function updateFoot() {
    footEl.hidden = Boolean(state.result);
    backBtn.hidden = state.step === 0;
    var last = state.step === STEPS.length - 1;
    nextBtn.textContent = last ? (state.submitting ? 'Booking…' : 'Confirm booking') : 'Continue';
    nextBtn.disabled = state.busy || state.submitting || !canAdvance();
    if (state.submitting) nextBtn.setAttribute('aria-busy', 'true'); else nextBtn.removeAttribute('aria-busy');
    backBtn.disabled = state.submitting;
  }

  function canAdvance() {
    if (state.step === 0) return Boolean(state.serviceId);
    if (state.step === 1) return Boolean(state.date);
    if (state.step === 2) return Boolean(state.time);
    return true;
  }

  function scrollIntoViewIfNeeded() {
    var r = shell.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.5) {
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      shell.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function goTo(step) {
    state.step = step;
    state.notice = null;
    render('title');
    scrollIntoViewIfNeeded();
    announce('Step ' + (step + 1) + ' of ' + STEPS.length + ': ' + TITLES[step]);
    if (step === 1 && !state.days.length) loadCalendar();
    if (step === 2) loadSlots();
  }

  /* ---------- events ---------- */
  function bind() {
    bodyEl.querySelectorAll('input[name="bkService"]').forEach(function (r) {
      r.addEventListener('change', function () {
        var id = Number(r.value);
        if (id !== state.serviceId) { state.date = null; state.time = null; state.days = []; }
        state.serviceId = id;
        updateFoot();
      });
    });
    bodyEl.querySelectorAll('.cal__day[data-date]:not([disabled]), .booking__jump').forEach(function (b) {
      b.addEventListener('click', function () {
        if (state.date !== b.dataset.date) state.time = null;
        state.date = b.dataset.date;
        state.calendarMonth = state.date.slice(0, 7);
        render('#' + 'calMonth');
        var picked = bodyEl.querySelector('.cal__day[data-date="' + state.date + '"]');
        if (picked) picked.focus();
        announce(longDate(state.date) + ' selected');
      });
    });
    bodyEl.querySelectorAll('.cal__nav').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = state.calendarMonth.split('-');
        var d = new Date(Date.UTC(+p[0], +p[1] - 1 + Number(b.dataset.month), 1));
        state.calendarMonth = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
        render();
        var same = bodyEl.querySelector('.cal__nav[data-month="' + b.dataset.month + '"]');
        (same && !same.disabled ? same : bodyEl.querySelector('.cal__day.has-times') || document.getElementById('calMonth')).focus();
      });
    });
    bodyEl.querySelectorAll('.slot-option[data-time]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.time = b.dataset.time;
        state.slotLabel = b.dataset.label;
        bodyEl.querySelectorAll('.slot-option[data-time]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        updateFoot();
        announce(b.dataset.label + ' selected');
      });
    });
    var inputs = { bkName: 'name', bkPhone: 'phone', bkEmail: 'email', bkMessage: 'message' };
    Object.keys(inputs).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () { state[inputs[id]] = el.value; });
    });
    bodyEl.querySelectorAll('input[name="bkNew"]').forEach(function (r) {
      r.addEventListener('change', function () { state.isNew = r.value === '1'; });
    });
    bodyEl.querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { goTo(Number(b.dataset.goto)); });
    });
    var retry = bodyEl.querySelector('[data-retry]');
    if (retry) retry.addEventListener('click', function () {
      state.notice = null;
      if (state.step === 1) loadCalendar();
      else if (state.step === 2) loadSlots();
      else render('title');
    });
    var another = document.getElementById('bookAnother');
    if (another) another.addEventListener('click', function () {
      Object.assign(state, { step: 0, serviceId: null, date: null, time: null, slotLabel: null, message: '', result: null, notice: null, errors: {}, days: [] });
      goTo(0);
    });
  }

  /* ---------- validation (mirrors the server; the server decides) ---------- */
  function validateDetails() {
    var e = {};
    if (state.name.trim().length < 2) e.name = 'Please enter your name.';
    if (!/^(?:91|0)?[6-9]\d{9}$/.test(state.phone.replace(/\D/g, ''))) e.phone = 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9.';
    if (state.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(state.email.trim())) e.email = 'Enter a valid email address, or leave it blank.';
    state.errors = e;
    return Object.keys(e);
  }
  function showFieldErrors(keys) {
    var ids = { name: '#bkName', phone: '#bkPhone', email: '#bkEmail', message: '#bkMessage' };
    var firstKey = ['name', 'phone', 'email', 'message'].filter(function (k) { return keys.indexOf(k) !== -1; })[0];
    render(firstKey ? ids[firstKey] : 'title');
    announce(keys.length === 1 ? 'There is 1 problem with your details.' : 'There are ' + keys.length + ' problems with your details.');
  }

  /* ---------- data ---------- */
  function errorNotice(err, what) {
    if (err.code === 'RATE_LIMITED') return { kind: 'error', title: 'Too many attempts', text: 'Please wait a little and try again, or contact the clinic directly.', fallback: true };
    if (err.code === 'NETWORK') return { kind: 'error', title: 'No connection', text: 'Could not reach the clinic' + (what ? ' to ' + what : '') + '. Check your connection and try again.', retry: true, fallback: true };
    return { kind: 'error', title: 'Something went wrong', text: 'Could not ' + (what || 'continue') + ' just now. Please try again, or contact the clinic.', retry: true, fallback: true };
  }

  async function loadCalendar() {
    state.busy = true; render();
    announce('Loading available days');
    try {
      var qs = new URLSearchParams({ days: '60' });
      if (state.serviceId) qs.set('service_id', String(state.serviceId));
      var data = await api('/api/appointments/calendar?' + qs);
      state.days = data.days || [];
      state.nextAvailable = data.next_available || null;
      var firstFree = state.days.filter(function (d) { return d.open && d.available_count > 0; })[0];
      var start = state.date || (firstFree ? firstFree.date : (state.days[0] || {}).date);
      state.calendarMonth = start ? start.slice(0, 7) : null;
      if (state.date && !state.days.some(function (d) { return d.date === state.date && d.open && d.available_count > 0; })) state.date = null;
      state.busy = false;
      render();
      announce(firstFree ? 'Calendar loaded. Days with free times can be selected.' : 'No free days found online.');
    } catch (err) {
      state.busy = false; state.days = [];
      state.notice = errorNotice(err, 'load the calendar');
      render('notice');
    }
  }

  async function loadSlots() {
    state.busy = true; render();
    announce('Loading free times');
    try {
      var qs = new URLSearchParams({ date: state.date });
      if (state.serviceId) qs.set('service_id', String(state.serviceId));
      var data = await api('/api/appointments/availability?' + qs);
      state.slots = (data.slots || []).filter(function (s) { return s.available; });
      if (state.time && !state.slots.some(function (s) { return s.time === state.time; })) { state.time = null; state.slotLabel = null; }
      state.busy = false;
      render(state.notice ? 'notice' : null);
      if (!state.notice) announce(state.slots.length ? state.slots.length + ' free times' : 'No times are left on this day');
    } catch (err) {
      state.busy = false; state.slots = [];
      state.notice = errorNotice(err, 'load the free times');
      render('notice');
    }
  }

  async function submit() {
    if (state.submitting) return;                 // in-flight guard
    state.submitting = true; state.notice = null; updateFoot();
    announce('Booking your appointment');
    try {
      var payload = {
        name: state.name.trim(), phone: state.phone.trim(),
        date: state.date, time: state.time, is_new_patient: state.isNew,
      };
      if (state.email.trim()) payload.email = state.email.trim();
      if (state.serviceId) payload.service_id = state.serviceId;
      if (state.message.trim()) payload.message = state.message.trim();
      var data = await api('/api/appointments', { method: 'POST', body: JSON.stringify(payload) });
      state.submitting = false;
      state.result = data.appointment;
      render('title');
      scrollIntoViewIfNeeded();
      announce((data.appointment.status === 'confirmed' ? 'Appointment confirmed' : 'Appointment requested') + '. Booking reference ' + data.appointment.ref);
      track('appointment_booked');
    } catch (err) {
      state.submitting = false;
      handleSubmitError(err);
    }
  }

  function handleSubmitError(err) {
    var code = err.code;
    if (code === 'SLOT_TAKEN' || code === 'SLOT_UNAVAILABLE') {
      state.time = null; state.slotLabel = null; state.step = 2;
      state.notice = { kind: 'error', title: 'That time has just gone', text: 'Someone else booked it a moment ago. Your details are kept — please choose another time.' };
      render('notice'); loadSlots(); return;
    }
    if (['CLOSED', 'HOLIDAY', 'PAST_DATE', 'BEYOND_HORIZON', 'INVALID_DATE'].indexOf(code) !== -1) {
      state.date = null; state.time = null; state.step = 1; state.days = [];
      state.notice = { kind: 'error', title: 'That day is not available', text: err.message + ' Your details are kept — please choose another day.' };
      render('notice'); loadCalendar(); return;
    }
    if (code === 'VALIDATION' && err.fields) {
      state.errors = err.fields; state.step = 3; state.notice = null;
      showFieldErrors(Object.keys(err.fields)); return;
    }
    if (code === 'INVALID_PHONE') {
      state.errors = { phone: err.message }; state.step = 3;
      showFieldErrors(['phone']); return;
    }
    if (code === 'INVALID_SERVICE') {
      state.step = 0; state.serviceId = null;
      state.notice = { kind: 'error', title: 'Please choose another treatment', text: err.message, fallback: true };
      render('notice'); return;
    }
    if (code === 'PATIENT_BLOCKED' || code === 'NO_DOCTOR') {
      state.notice = { kind: 'error', title: 'Online booking is not possible', text: err.message, fallback: true };
      render('notice'); return;
    }
    if (code === 'NETWORK') {
      /* The request may or may not have reached the clinic. Say so, rather
         than inviting a blind retry that could book twice. */
      state.notice = { kind: 'error', title: 'No connection', text: 'We could not confirm whether your booking went through. Please check your connection and try again; if you are unsure, call or message the clinic before booking again.', fallback: true };
      render('notice'); return;
    }
    state.notice = errorNotice(err, 'book the appointment');
    state.notice.retry = false;
    render('notice');
  }

  /* ---------- buttons ---------- */
  nextBtn.addEventListener('click', function () {
    if (state.busy || state.submitting || !canAdvance()) return;
    if (state.step === 3) {
      var problems = validateDetails();
      if (problems.length) { showFieldErrors(problems); return; }
    }
    if (state.step === STEPS.length - 1) { submit(); return; }
    state.errors = {};
    goTo(state.step + 1);
  });
  backBtn.addEventListener('click', function () {
    if (state.step === 0 || state.submitting) return;
    goTo(state.step - 1);
  });

  /* ---------- entry points ---------- */
  async function startWithService(serviceId) {
    if (!BOOKABLE.some(function (s) { return s.id === serviceId; })) return false;
    if (serviceId !== state.serviceId) { state.date = null; state.time = null; state.days = []; }
    state.serviceId = serviceId; state.result = null;
    goTo(1);
    return true;
  }

  /* Book links on treatment cards: /#appointment?treatment=<slug>. On this
     page they open the wizard in place; elsewhere they simply navigate here. */
  document.querySelectorAll('.book-service').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      startWithService(Number(link.dataset.service));
    });
  });

  /* Arriving with /#appointment?treatment=<slug>. The query lives in the
     fragment so the homepage is never served under a duplicate URL. */
  function preselectFromHash() {
    var hash = window.location.hash || '';
    var q = hash.indexOf('?');
    if (q === -1) return;
    var slug = new URLSearchParams(hash.slice(q + 1)).get('treatment');
    var match = slug && SERVICES.filter(function (s) { return s.slug === slug; })[0];
    history.replaceState(null, '', hash.slice(0, q));
    if (match) startWithService(match.id);
  }

  function track(event) {
    try {
      if (typeof window.gtag === 'function') window.gtag('event', event, {});
      else if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event: event });
    } catch (e) { /* never break booking */ }
  }

  render();
  preselectFromHash();
  window.addEventListener('hashchange', preselectFromHash);

  /* ==================================================================
     Find or cancel a booking — GET /api/appointments/:ref?phone= and
     POST /api/appointments/:ref/cancel. Both need the reference AND the
     mobile number it was booked with; the server checks both.
  ================================================================== */
  var manage = document.getElementById('manageForm');
  if (manage) {
    var out = document.getElementById('manageResult');
    var live = manage.querySelector('[data-form-status]');
    var current = null;   // { ref, phone, appt }

    function view(a) {
      var cancellable = ['pending', 'confirmed', 'rescheduled'].indexOf(a.status) !== -1;
      var statusText = { pending: 'Requested — awaiting confirmation', confirmed: 'Confirmed', rescheduled: 'Rescheduled', cancelled: 'Cancelled', completed: 'Completed', no_show: 'Missed', checked_in: 'Checked in' }[a.status] || a.status;
      return '<div class="card manage__card" tabindex="-1" id="manageCard"><div class="card__body">' +
        '<h3 class="card__title">Booking ' + esc(a.ref) + '</h3>' +
        '<dl class="booking__summary">' + row('Status', statusText) + row('Date', a.date_label) + row('Time', a.time) +
        (a.service ? row('Treatment', a.service) : '') + '</dl>' +
        (cancellable
          ? '<div id="manageActions"><p class="form-hint">To change the time, call or message the clinic.</p>' +
            '<button type="button" class="button button--secondary button--small" id="manageCancel">Cancel this appointment</button></div>'
          : '<p class="form-hint">This appointment can no longer be changed online.</p>') +
        fallbackHtml() + '</div></div>';
    }

    manage.addEventListener('ds:valid', async function () {
      var ref = manage.ref.value.trim().toUpperCase();
      var phone = manage.phone.value.trim();
      var btn = manage.querySelector('[type=submit]');
      btn.disabled = true; btn.setAttribute('aria-busy', 'true');
      out.innerHTML = '';
      try {
        var a = await api('/api/appointments/' + encodeURIComponent(ref) + '?phone=' + encodeURIComponent(phone));
        current = { ref: ref, phone: phone, appt: a };
        out.innerHTML = view(a);
        bindManage();
        document.getElementById('manageCard').focus();
        live.textContent = 'Booking found.';
      } catch (err) {
        var msg = err.code === 'NOT_FOUND' || err.status === 404
          ? 'No appointment matches that reference and mobile number. Check both and try again.'
          : err.code === 'RATE_LIMITED' ? 'Too many attempts. Please wait a little, or contact the clinic.'
          : err.code === 'VALIDATION' ? 'Please check the mobile number.'
          : 'Could not look that up just now. Please try again, or contact the clinic.';
        out.innerHTML = noticeHtml({ kind: 'error', title: 'Not found', text: msg, fallback: true });
        document.getElementById('bookingNotice').focus();
      } finally {
        btn.disabled = false; btn.removeAttribute('aria-busy');
      }
    });

    function bindManage() {
      var cancel = document.getElementById('manageCancel');
      if (!cancel) return;
      cancel.addEventListener('click', function () {
        /* A second, explicit step — cancelling is not undoable online. */
        document.getElementById('manageActions').innerHTML =
          '<div class="notice notice--warning" role="alert"><span class="notice__icon">' + ICON.info + '</span><div class="notice__body">' +
          '<p class="notice__title">Cancel ' + esc(current.appt.date_label) + ' at ' + esc(current.appt.time) + '?</p>' +
          '<p>This frees the time for another patient and cannot be undone online.</p>' +
          '<div class="cluster"><button type="button" class="button button--primary button--small" id="manageConfirm">Yes, cancel it</button>' +
          '<button type="button" class="button button--text button--small" id="manageKeep">Keep my appointment</button></div></div></div>';
        document.getElementById('manageConfirm').focus();
        document.getElementById('manageKeep').addEventListener('click', function () {
          out.innerHTML = view(current.appt); bindManage(); document.getElementById('manageCancel').focus();
        });
        document.getElementById('manageConfirm').addEventListener('click', async function () {
          var b = this;
          if (b.getAttribute('aria-busy') === 'true') return;
          b.disabled = true; b.setAttribute('aria-busy', 'true'); b.textContent = 'Cancelling…';
          try {
            var res = await api('/api/appointments/' + encodeURIComponent(current.ref) + '/cancel',
              { method: 'POST', body: JSON.stringify({ phone: current.phone }) });
            current.appt = res.appointment;
            out.innerHTML = noticeHtml({ kind: 'success', title: 'Appointment cancelled', text: 'Booking ' + current.ref + ' on ' + res.appointment.date_label + ' is cancelled. Thank you for letting the clinic know.' });
            document.getElementById('bookingNotice').focus();
          } catch (err) {
            var msg = err.code === 'NOT_CANCELLABLE' ? err.message : 'Could not cancel just now. Please try again, or call the clinic.';
            out.innerHTML = view(current.appt) + noticeHtml({ kind: 'error', title: 'Not cancelled', text: msg, fallback: true });
            bindManage();
            document.getElementById('bookingNotice').focus();
          }
        });
      });
    }
  }
})();
