/* Samal Dental Care — public site behaviour.
   Progressive enhancement only: every section is already rendered server-side. */
(function () {
  'use strict';

  /* ---------- Mobile nav ---------- */
  var menuToggle = document.getElementById('menuToggle');
  var mobilePanel = document.getElementById('mobilePanel');
  if (menuToggle && mobilePanel) {
    menuToggle.addEventListener('click', function () {
      var open = mobilePanel.classList.toggle('open');
      menuToggle.setAttribute('aria-expanded', String(open));
      menuToggle.classList.toggle('active', open);
    });
    mobilePanel.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        mobilePanel.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.classList.remove('active');
      });
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
