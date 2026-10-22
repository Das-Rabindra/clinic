/* Samal Dental Care — behaviour for pages on the new design system.
   Generic primitives (menu, accordion, dialog, action bar, validation) live in
   ds.js; this file wires the clinic-specific pieces: the call-back request,
   the lazy map, scroll-snap carousels and the analytics hook. */
(function () {
  'use strict';

  /* ---------- Request a call back ----------
     Posts to /api/enquiries, so a request lands in Admin → Enquiries as
     before. Nothing is kept in the browser and nothing typed is ever cleared
     on an error. */
  var dialog = document.getElementById('callbackDialog');
  var form = document.getElementById('callbackForm');
  if (dialog && form && typeof dialog.showModal === 'function') {
    var wrap = document.getElementById('cbFormWrap');
    var done = document.getElementById('cbDone');
    var submit = document.getElementById('cbSubmit');
    var failure = document.getElementById('cbFailure');
    var failureText = document.getElementById('cbFailureText');
    var opener = null;

    function cookie(name) {
      return document.cookie.split('; ').reduce(function (acc, part) {
        var kv = part.split('=');
        return kv[0] === name ? decodeURIComponent(kv.slice(1).join('=')) : acc;
      }, '');
    }

    /* Opened from a treatment, the request carries that treatment so the
       clinic knows what the call is about before dialling back. */
    function setTreatment(trigger) {
      var id = trigger && trigger.dataset.service;
      var name = trigger && trigger.dataset.serviceName;
      document.getElementById('cbServiceId').value = id || '';
      document.getElementById('cbTreatmentNote').hidden = !name;
      document.getElementById('cbTreatmentName').textContent = name || '';
    }

    function reset() {
      wrap.hidden = false;
      done.hidden = true;
      failure.hidden = true;
      form.querySelectorAll('[aria-invalid]').forEach(function (f) { window.dsForm.setFieldError(f, ''); });
    }

    document.querySelectorAll('[data-callback-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        opener = btn;
        reset();
        setTreatment(btn);
        /* Opened from inside the mobile menu: close the menu first so focus
           returns somewhere sensible afterwards. */
        var navToggle = document.querySelector('[data-nav-toggle][aria-expanded="true"]');
        if (navToggle) navToggle.click();
        dialog.showModal();
        document.getElementById('cbName').focus();
      });
    });
    dialog.addEventListener('close', function () {
      if (opener && document.contains(opener) && opener.offsetParent !== null) opener.focus();
    });

    form.addEventListener('ds:valid', async function () {
      if (submit.getAttribute('aria-busy') === 'true') return;   // in flight
      failure.hidden = true;
      submit.setAttribute('aria-busy', 'true');
      submit.disabled = true;
      var label = submit.textContent;
      submit.textContent = 'Sending…';
      try {
        var token = cookie('sdc_csrf');
        if (!token) {
          var r = await fetch('/api/csrf', { credentials: 'same-origin' });
          token = (await r.json()).token;
        }
        var res = await fetch('/api/enquiries', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
          body: JSON.stringify({
            name: form.name.value.trim(),
            phone: form.phone.value.trim(),
            message: form.message.value.trim(),
            preferred_contact: form.preferred_contact.value,
            service_id: form.service_id.value ? Number(form.service_id.value) : undefined,
          }),
        });
        var data = {};
        try { data = await res.json(); } catch (err) { data = {}; }

        if (!res.ok) {
          var fields = data.fields ? Object.keys(data.fields)
            .map(function (k) { var f = form.elements[k]; if (f && f.setAttribute) window.dsForm.setFieldError(f, data.fields[k]); return f; })
            .filter(function (f) { return f && f.focus; }) : [];
          if (fields.length) { window.dsForm.announceProblems(form, fields); return; }
          failureText.textContent = (data.error || 'Could not send that just now.') + ' Please call the clinic instead.';
          failure.hidden = false;
          failure.focus();
          return;
        }
        form.reset();
        wrap.hidden = true;
        done.hidden = false;
        document.getElementById('cbDoneTitle').focus();
        track('callback_requested');
      } catch (err) {
        failureText.textContent = 'There is no connection right now. Please call the clinic instead.';
        failure.hidden = false;
        failure.focus();
      } finally {
        submit.removeAttribute('aria-busy');
        submit.disabled = false;
        submit.textContent = label;
      }
    });
  }

  /* ---------- Lazy map: the third-party frame loads only when near ---------- */
  var map = document.querySelector('iframe[data-src]');
  if (map) {
    var load = function () { map.src = map.dataset.src; map.removeAttribute('data-src'); };
    if ('IntersectionObserver' in window) {
      var mapIO = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { load(); mapIO.disconnect(); }
      }, { rootMargin: '300px' });
      mapIO.observe(map);
    } else { load(); }
  }

  /* ---------- Carousels ----------
     A scroll-snap track that already works by touch, trackpad and keyboard
     scrolling. Buttons page through it; they disable at either end. No
     autoplay, ever. */
  document.querySelectorAll('[data-carousel]').forEach(function (root) {
    var track = root.querySelector('[data-carousel-track]');
    var prev = root.querySelector('[data-carousel-prev]');
    var next = root.querySelector('[data-carousel-next]');
    var status = root.querySelector('[data-carousel-status]');
    if (!track) return;
    var items = Array.prototype.slice.call(track.children);
    if (items.length < 2) { root.querySelectorAll('[data-carousel-controls]').forEach(function (c) { c.hidden = true; }); return; }

    function step() {
      var gap = parseFloat(getComputedStyle(track).columnGap || '0') || 0;
      return items[0].getBoundingClientRect().width + gap;
    }
    function sync() {
      var atStart = track.scrollLeft <= 8;
      var atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 8;
      if (prev) prev.disabled = atStart;
      if (next) next.disabled = atEnd;
      if (status) {
        var first = Math.round(track.scrollLeft / step()) + 1;
        var perView = Math.max(1, Math.round(track.clientWidth / step()));
        var last = Math.min(items.length, first + perView - 1);
        status.textContent = (first === last ? first : first + '–' + last) + ' of ' + items.length;
      }
    }
    function go(dir) {
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var perView = Math.max(1, Math.floor(track.clientWidth / step()));
      track.scrollBy({ left: dir * step() * perView, behavior: reduce ? 'auto' : 'smooth' });
    }
    if (prev) prev.addEventListener('click', function () { go(-1); });
    if (next) next.addEventListener('click', function () { go(1); });
    var raf = null;
    track.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = null; sync(); });
    }, { passive: true });
    window.addEventListener('resize', sync);
    sync();
  });

  /* ---------- Event signals ----------
     Unchanged from site.js: fired only if the clinic has installed an
     analytics tag that defines gtag or dataLayer (none is installed), and
     never carrying patient details — only which action was taken. */
  function track(event, params) {
    try {
      if (typeof window.gtag === 'function') window.gtag('event', event, params || {});
      else if (Array.isArray(window.dataLayer)) window.dataLayer.push(Object.assign({ event: event }, params || {}));
    } catch (e) { /* analytics must never break the page */ }
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-track]');
    if (el) track(el.dataset.track);
  });
})();
