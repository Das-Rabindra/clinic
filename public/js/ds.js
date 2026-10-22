/* Samal Dental Care — design-system behaviour.
   Progressive enhancement only: every primitive is usable as rendered HTML,
   and this file adds focus management, keyboard support and state. No
   dependencies; ~4 KB unminified. */
(function () {
  'use strict';

  document.documentElement.classList.add('ds-js');

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (el) {
      return el.offsetParent !== null || el === document.activeElement;
    });
  }

  /* ---------- Navigation drawer ----------
     A modal panel: focus moves in, Tab cycles between the toggle and the
     panel's links, Esc or any link closes it, focus returns to the toggle. */
  document.querySelectorAll('[data-nav-toggle]').forEach(function (toggle) {
    var drawer = document.getElementById(toggle.getAttribute('aria-controls'));
    if (!drawer) return;
    var label = toggle.querySelector('[data-nav-label]');

    function setOpen(open) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (label) label.textContent = open ? 'Close' : 'Menu';
      if (open) drawer.setAttribute('data-open', ''); else drawer.removeAttribute('data-open');
      document.body.style.overflow = open ? 'hidden' : '';
      if (open) {
        var first = focusables(drawer)[0];
        if (first) first.focus();
      }
    }

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    drawer.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', function (e) {
      if (toggle.getAttribute('aria-expanded') !== 'true') return;
      if (e.key === 'Escape') { setOpen(false); toggle.focus(); return; }
      if (e.key !== 'Tab') return;
      var ring = [toggle].concat(focusables(drawer));
      var i = ring.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); ring[ring.length - 1].focus(); }
      else if (!e.shiftKey && i === ring.length - 1) { e.preventDefault(); ring[0].focus(); }
      else if (i === -1) { e.preventDefault(); ring[0].focus(); }
    });
    /* Crossing into the desktop layout with the drawer open would leave the
       page scroll-locked behind a drawer that CSS has hidden. */
    window.matchMedia('(min-width: 1024px)').addEventListener('change', function (mq) {
      if (mq.matches && toggle.getAttribute('aria-expanded') === 'true') setOpen(false);
    });
  });

  /* ---------- Sticky header elevation ---------- */
  var header = document.querySelector('.site-header');
  if (header) {
    var onScroll = function () {
      if (window.scrollY > 4) header.setAttribute('data-scrolled', '');
      else header.removeAttribute('data-scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Accordion ----------
     Panels start collapsed only once this script runs; one may be open at a
     time is NOT enforced — each answer opens independently. */
  document.querySelectorAll('[data-accordion] .accordion__trigger').forEach(function (btn) {
    var panel = document.getElementById(btn.getAttribute('aria-controls'));
    if (!panel) return;
    if (btn.getAttribute('aria-expanded') !== 'true') panel.setAttribute('data-collapsed', '');
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      if (open) panel.setAttribute('data-collapsed', ''); else panel.removeAttribute('data-collapsed');
    });
  });

  /* ---------- Dialog ----------
     Native <dialog>.showModal() makes the rest of the page inert and handles
     Esc. Added here: open/close triggers, backdrop click, and returning focus
     to whatever opened it. */
  document.querySelectorAll('[data-dialog-open]').forEach(function (opener) {
    var dialog = document.getElementById(opener.getAttribute('data-dialog-open'));
    if (!dialog || typeof dialog.showModal !== 'function') return;
    opener.addEventListener('click', function () {
      dialog._opener = opener;
      dialog.showModal();
      var first = dialog.querySelector('[autofocus]') || focusables(dialog).filter(function (el) {
        return !el.matches('.dialog__close');
      })[0];
      if (first) first.focus();
    });
  });
  document.querySelectorAll('dialog.dialog').forEach(function (dialog) {
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) dialog.close();          // backdrop
      if (e.target.closest('[data-dialog-close]')) dialog.close();
    });
    /* Chrome lets Tab leave a modal dialog for the browser UI and lands on
       <body> when it comes back; keep the cycle inside the dialog instead. */
    dialog.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var ring = focusables(dialog);
      if (!ring.length) return;
      var i = ring.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); ring[ring.length - 1].focus(); }
      else if (!e.shiftKey && i === ring.length - 1) { e.preventDefault(); ring[0].focus(); }
    });
    dialog.addEventListener('close', function () {
      if (dialog._opener) dialog._opener.focus();
    });
  });

  /* ---------- Mobile action bar ----------
     Steps aside while a text field has focus (the on-screen keyboard is up)
     or while any [data-bar-yield] region — the booking form — is on screen,
     so it never covers a control the patient is using. */
  var bar = document.querySelector('[data-action-bar]');
  if (bar) {
    var typing = false;
    var inView = new Set();
    var sync = function () {
      if (typing || inView.size) bar.setAttribute('data-yield', ''); else bar.removeAttribute('data-yield');
    };
    document.addEventListener('focusin', function (e) {
      typing = e.target.matches('input:not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]), textarea, select');
      sync();
    });
    document.addEventListener('focusout', function () { typing = false; setTimeout(sync, 0); });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) inView.add(en.target); else inView.delete(en.target); });
        sync();
      }, { threshold: 0.15 });
      document.querySelectorAll('[data-bar-yield]').forEach(function (el) { io.observe(el); });
    }
  }

  /* ---------- Form validation pattern ----------
     data-validate forms: on submit, mark invalid fields with aria-invalid,
     put the message in the field's error element (already linked through
     aria-describedby), announce a summary in the form's live region, and
     move focus to the first problem. Values are never cleared. */
  document.querySelectorAll('form[data-validate]').forEach(function (form) {
    var live = form.querySelector('[data-form-status]');
    form.addEventListener('submit', function (e) {
      var problems = [];
      form.querySelectorAll('[data-rule]').forEach(function (field) {
        var err = document.getElementById(field.getAttribute('data-error-id'));
        var value = field.value.trim();
        var rule = field.getAttribute('data-rule');
        var message = '';
        if (rule === 'required' && !value) message = field.getAttribute('data-message');
        if (rule === 'mobile' && !/^(?:\+?91)?[6-9]\d{9}$/.test(value.replace(/[\s-]/g, ''))) message = field.getAttribute('data-message');
        field.setAttribute('aria-invalid', String(Boolean(message)));
        if (!message) field.removeAttribute('aria-invalid');
        if (err) err.textContent = message;
        if (message) problems.push(field);
      });
      e.preventDefault();
      if (problems.length) {
        if (live) live.textContent = problems.length === 1 ? 'There is 1 problem with this form.' : 'There are ' + problems.length + ' problems with this form.';
        problems[0].focus();
        return;
      }
      if (live) live.textContent = 'Looks good. (Preview only — nothing was sent.)';
    });
  });
})();
