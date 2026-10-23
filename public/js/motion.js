/* Samal Dental Care — cinematic motion.
   Everything here is decoration on top of a page that already works: content
   is only ever hidden under html.motion (set in <head> only when the visitor
   has not asked for reduced motion), and every effect moves transform,
   opacity or clip-path — never layout. */
(function () {
  'use strict';
  var root = document.documentElement;
  var motion = root.classList.contains('motion');

  /* ---------- Scroll reveals ----------
     [data-reveal] rises in; [data-reveal="image"] wipes open. Siblings in a
     [data-reveal-group] stagger. Revealed once, then left alone. */
  var targets = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  document.querySelectorAll('[data-reveal-group]').forEach(function (g) {
    Array.prototype.forEach.call(g.querySelectorAll('[data-reveal]'), function (el, i) {
      el.style.setProperty('--reveal-i', String(Math.min(i, 6)));
    });
  });
  if (!motion || !('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    /* An image reveal starts clipped to nothing, and Chrome's observer
       honours clip-path — a zero-area target never "intersects". So image
       reveals are watched through their (unclipped) parent instead. */
    var watched = new Map();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        (watched.get(e.target) || []).forEach(function (el) { el.classList.add('is-in'); });
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    targets.forEach(function (el) {
      var probe = el.getAttribute('data-reveal') === 'image' ? el.parentElement : el;
      if (!watched.has(probe)) { watched.set(probe, []); io.observe(probe); }
      watched.get(probe).push(el);
    });
    /* Anything already on screen at load (a deep link, a refresh mid-page)
       reveals at once rather than waiting for a scroll that may not come. */
    requestAnimationFrame(function () {
      targets.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('is-in');
      });
    });
  }

  /* ---------- Header over the hero ----------
     Transparent while the cinematic hero is under it, solid after. Without
     JS the header simply stays solid. */
  var hero = document.querySelector('[data-hero]');
  var header = document.querySelector('.site-header');
  if (hero && header && 'IntersectionObserver' in window) {
    header.classList.add('site-header--over-hero');
    var sentinel = new IntersectionObserver(function (entries) {
      var over = entries[0].isIntersecting;
      header.classList.toggle('is-transparent', over);
    }, { rootMargin: '-72px 0px 0px 0px', threshold: 0.12 });
    sentinel.observe(hero);
  }

  /* ---------- Hero parallax and scroll choreography ----------
     As the visitor scrolls on, the photograph drifts at a fraction of the
     scroll speed (desktop), the words lift away a little faster and fade, and
     the scene dims. That reads as a camera moving on, not a page scrolling.
     Motion-allowed only; one rAF per frame at most; stops past the hero.
     Transform and opacity only, so nothing reflows. */
  var media = hero && hero.querySelector('[data-parallax]');
  var words = hero && hero.querySelector('[data-hero-content]');
  var dim = hero && hero.querySelector('[data-hero-dim]');
  var drift = window.matchMedia('(min-width: 768px)').matches;
  if (motion && hero && (media || words)) {
    var ticking = false;
    var update = function () {
      ticking = false;
      var y = window.scrollY;
      var h = hero.offsetHeight;
      if (y > h) return;
      var p = Math.min(1, y / (h * 0.75));
      if (media && drift) media.style.transform = 'translate3d(0,' + (y * 0.18).toFixed(1) + 'px,0) scale(1.06)';
      if (words) {
        words.style.transform = y ? 'translate3d(0,' + (-y * 0.12).toFixed(1) + 'px,0)' : '';
        words.style.opacity = y ? (1 - p * 0.85).toFixed(3) : '';
      }
      if (dim) dim.style.opacity = (p * 0.55).toFixed(3);
    };
    window.addEventListener('scroll', function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }
})();
