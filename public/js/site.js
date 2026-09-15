/* Samal Dental Care — public site behaviour.
   Progressive enhancement only: every section is already rendered server-side. */
(function () {
  'use strict';

  /* ---------- Mobile nav ---------- */
  var menuToggle = document.getElementById('menuToggle');
  var mobilePanel = document.getElementById('mobilePanel');
  if (menuToggle && mobilePanel) {
    menuToggle.addEventListener('click', function () {
      /* The stylesheet keys the open panel off `.show` and the animated
         hamburger off `.open`; toggling any other class left the menu
         invisible while reporting aria-expanded="true". */
      var open = mobilePanel.classList.toggle('show');
      menuToggle.setAttribute('aria-expanded', String(open));
      menuToggle.classList.toggle('open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    });
    function closeMenu() {
      mobilePanel.classList.remove('show');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.classList.remove('open');
      document.body.style.overflow = '';
    }
    mobilePanel.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', closeMenu);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mobilePanel.classList.contains('show')) {
        closeMenu();
        menuToggle.focus();
      }
    });
  }

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll('.faq-q').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.closest('.faq-item');
      var isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(function (o) {
        o.classList.remove('open');
        o.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ---------- Gallery filter + lightbox ---------- */
  var items = Array.prototype.slice.call(document.querySelectorAll('.gallery-item'));
  var lightbox = document.getElementById('lightbox');

  document.querySelectorAll('.gallery-filter').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var filter = btn.dataset.filter;
      document.querySelectorAll('.gallery-filter').forEach(function (b) {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      items.forEach(function (item) {
        item.hidden = !(filter === 'all' || item.dataset.category === filter);
      });
    });
  });

  if (lightbox && items.length) {
    var media = document.getElementById('lightboxMedia');
    var titleEl = document.getElementById('lightboxTitle');
    var descEl = document.getElementById('lightboxDesc');
    var countEl = document.getElementById('lightboxCount');
    var lastFocus = null;
    var current = 0;

    function visible() { return items.filter(function (i) { return !i.hidden; }); }

    function render(index) {
      var list = visible();
      if (!list.length) return;
      current = (index + list.length) % list.length;
      var item = list[current];
      var img = item.querySelector('img');
      var caption = item.querySelector('.gi-caption');
      media.innerHTML = '';
      var full = document.createElement('img');
      full.className = 'lb-img';
      full.src = img.dataset.full || img.src;
      full.alt = img.alt || '';
      media.appendChild(full);
      titleEl.textContent = caption ? caption.textContent : '';
      descEl.textContent = item.dataset.description || '';
      countEl.textContent = (current + 1) + ' / ' + list.length;
    }

    function open(item) {
      lastFocus = document.activeElement;
      render(visible().indexOf(item));
      lightbox.classList.add('show');
      document.body.style.overflow = 'hidden';
      document.getElementById('lightboxClose').focus();
    }
    function close() {
      lightbox.classList.remove('show');
      document.body.style.overflow = '';
      if (lastFocus) lastFocus.focus();
    }

    items.forEach(function (item) {
      item.addEventListener('click', function () { open(item); });
    });
    document.getElementById('lightboxClose').addEventListener('click', close);
    document.getElementById('lightboxPrev').addEventListener('click', function () { render(current - 1); });
    document.getElementById('lightboxNext').addEventListener('click', function () { render(current + 1); });
    lightbox.addEventListener('click', function (e) { if (e.target === lightbox) close(); });
    document.addEventListener('keydown', function (e) {
      if (!lightbox.classList.contains('show')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') render(current - 1);
      if (e.key === 'ArrowRight') render(current + 1);
    });
  }

  /* ---------- Lazy map (defer the third-party iframe until it is near) ---------- */
  var map = document.getElementById('mapEmbed');
  if (map && map.dataset.src) {
    if ('IntersectionObserver' in window) {
      var mapIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            map.src = map.dataset.src;
            mapIO.unobserve(map);
          }
        });
      }, { rootMargin: '250px' });
      mapIO.observe(map);
    } else {
      map.src = map.dataset.src;
    }
  }

  /* ---------- Testimonial slider ----------
     The track is a real scroll container, so this only adds arrows, dots and
     keyboard paging on top of behaviour that already works without it. */
  document.querySelectorAll('[data-slider]').forEach(function (slider) {
    var track = slider.querySelector('.tm-track');
    var prev = slider.querySelector('[data-slider-prev]');
    var next = slider.querySelector('[data-slider-next]');
    var dotsEl = slider.querySelector('[data-slider-dots]');
    if (!track) return;

    var cards = Array.prototype.slice.call(track.children);
    if (cards.length < 2) { slider.querySelector('.tm-controls').hidden = true; return; }

    function perView() {
      var cardWidth = cards[0].getBoundingClientRect().width;
      if (!cardWidth) return 1;
      return Math.max(1, Math.round(track.clientWidth / cardWidth));
    }
    function pageCount() { return Math.max(1, Math.ceil(cards.length / perView())); }
    function currentPage() {
      var per = perView();
      var cardWidth = cards[0].getBoundingClientRect().width;
      var gap = parseFloat(getComputedStyle(track).columnGap || '0') || 0;
      var step = (cardWidth + gap) * per;
      return step ? Math.round(track.scrollLeft / step) : 0;
    }

    function buildDots() {
      if (!dotsEl) return;
      dotsEl.innerHTML = '';
      for (var i = 0; i < pageCount(); i++) {
        var d = document.createElement('span');
        d.className = 'tm-dot';
        dotsEl.appendChild(d);
      }
      syncDots();
    }
    function syncDots() {
      if (!dotsEl) return;
      var page = currentPage();
      Array.prototype.forEach.call(dotsEl.children, function (d, i) {
        d.classList.toggle('is-on', i === page);
      });
      /* The track carries a few pixels of padding so card shadows are not
         clipped, and scroll-snap settles on sub-pixel offsets, so "at the
         start" is never exactly 0. The slack is far below one card width. */
      var atStart = track.scrollLeft <= 8;
      var atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 8;
      if (prev) prev.disabled = atStart;
      if (next) next.disabled = atEnd;
    }

    function page(direction) {
      var cardWidth = cards[0].getBoundingClientRect().width;
      var gap = parseFloat(getComputedStyle(track).columnGap || '0') || 0;
      track.scrollBy({ left: direction * (cardWidth + gap) * perView(), behavior: 'smooth' });
    }

    if (prev) prev.addEventListener('click', function () { page(-1); });
    if (next) next.addEventListener('click', function () { page(1); });
    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); page(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); page(-1); }
    });

    var raf = null;
    track.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = null; syncDots(); });
    }, { passive: true });
    window.addEventListener('resize', buildDots);
    buildDots();
  });

  /* ---------- Request a call back ----------
     Posts to /api/enquiries, so the request lands in the admin Enquiries list
     like any other. Nothing is kept in the browser. */
  var cbModal = document.getElementById('callbackModal');
  if (cbModal) {
    var cbCard = document.getElementById('callbackCard');
    var cbForm = document.getElementById('callbackForm');
    var cbDone = document.getElementById('callbackDone');
    var cbSubmit = document.getElementById('cbSubmit');
    var cbLastFocus = null;

    function cookie(name) {
      return document.cookie.split('; ').reduce(function (acc, part) {
        var kv = part.split('=');
        return kv[0] === name ? decodeURIComponent(kv.slice(1).join('=')) : acc;
      }, '');
    }
    function setError(field, message) {
      var el = cbCard.querySelector('[data-error-for="' + field + '"]');
      var wrap = el && el.closest('.field');
      if (el) el.textContent = message || '';
      if (wrap) wrap.classList.toggle('invalid', Boolean(message));
    }
    function clearErrors() {
      cbCard.querySelectorAll('[data-error-for]').forEach(function (el) {
        el.textContent = '';
        var wrap = el.closest('.field');
        if (wrap) wrap.classList.remove('invalid');
      });
    }

    function openCb() {
      cbLastFocus = document.activeElement;
      cbModal.hidden = false;
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(function () { cbModal.classList.add('show'); });
      var first = cbCard.querySelector('input');
      if (first) first.focus();
    }
    function closeCb() {
      cbModal.classList.remove('show');
      document.body.style.overflow = '';
      cbModal.hidden = true;
      if (cbLastFocus) cbLastFocus.focus();
    }

    document.querySelectorAll('[data-callback-open]').forEach(function (b) {
      b.addEventListener('click', openCb);
    });
    cbCard.querySelectorAll('[data-callback-close]').forEach(function (b) {
      b.addEventListener('click', closeCb);
    });
    cbModal.addEventListener('click', function (e) { if (e.target === cbModal) closeCb(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !cbModal.hidden) closeCb();
    });

    cbForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      clearErrors();

      var name = cbForm.name.value.trim();
      var phone = cbForm.phone.value.trim();
      var digits = phone.replace(/\D/g, '');
      var bad = false;
      if (name.length < 2) { setError('name', 'Please enter your name.'); bad = true; }
      if (digits.length < 10) { setError('phone', 'Enter a valid 10-digit mobile number.'); bad = true; }
      if (bad) return;

      cbSubmit.disabled = true;
      var label = cbSubmit.textContent;
      cbSubmit.textContent = 'Sending…';

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
            name: name,
            phone: phone,
            message: cbForm.message.value.trim(),
            preferred_contact: cbForm.preferred_contact.value,
          }),
        });
        var data = {};
        try { data = await res.json(); } catch (err) { data = {}; }

        if (!res.ok) {
          if (data.fields) {
            Object.keys(data.fields).forEach(function (k) { setError(k, data.fields[k]); });
          } else {
            setError('phone', data.error || 'Could not send that just now. Please call the clinic.');
          }
          return;
        }
        cbForm.hidden = true;
        cbDone.hidden = false;
        track('callback_requested');
      } catch (err) {
        setError('phone', 'No connection. Please call the clinic instead.');
      } finally {
        cbSubmit.disabled = false;
        cbSubmit.textContent = label;
      }
    });
  }

  /* ---------- Event signals ----------
     Fired only if the clinic has installed an analytics tag that defines
     window.gtag or window.dataLayer. Nothing is sent otherwise, and no patient
     detail is ever included — only which action was taken. */
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

  /* ---------- Scroll reveal ---------- */
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduceMotion && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal:not(.in)').forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
  }
})();
