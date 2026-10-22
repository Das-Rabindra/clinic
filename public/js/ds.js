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
      }, { threshold: 0, rootMargin: '0px 0px 120px 0px' });
      document.querySelectorAll('[data-bar-yield]').forEach(function (el) { io.observe(el); });
    }
  }

  /* ---------- Form validation pattern ----------
     data-validate forms: on submit, mark invalid fields with aria-invalid,
     put the message in the field's error element (already linked through
     aria-describedby), announce a summary in the form's live region, and
     move focus to the first problem. Values are never cleared.

     Rules mirror the server's, never stricter: the server has the last word
     and a client rule it would not enforce only turns patients away.
       required — any non-blank value
       name     — at least 2 characters          (zName)
       phone    — at least 10 digits, at most 15 (zPhone: 10–20 characters)
       mobile   — Indian mobile, 6–9 then 9 digits, optional 91 prefix

     A form with data-validate-js is submitted by its own script: when it is
     valid the native submit is cancelled and a "ds:valid" event fires on it. */
  var RULES = {
    required: function (v) { return v.length > 0; },
    name: function (v) { return v.length >= 2; },
    phone: function (v) { var d = v.replace(/\D/g, ''); return d.length >= 10 && d.length <= 15; },
    mobile: function (v) { return /^(?:\+?91)?[6-9]\d{9}$/.test(v.replace(/[\s-]/g, '')); },
  };

  function setFieldError(field, message) {
    var err = document.getElementById(field.getAttribute('data-error-id') ||
      (field.getAttribute('aria-describedby') || '').split(' ').pop());
    if (message) field.setAttribute('aria-invalid', 'true'); else field.removeAttribute('aria-invalid');
    if (err) err.textContent = message || '';
  }

  function announceProblems(form, fields) {
    var live = form.querySelector('[data-form-status]');
    if (live) live.textContent = fields.length === 1 ? 'There is 1 problem with this form.' : 'There are ' + fields.length + ' problems with this form.';
    fields[0].focus();
  }

  document.querySelectorAll('form[data-validate]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      var problems = [];
      form.querySelectorAll('[data-rule]').forEach(function (field) {
        var check = RULES[field.getAttribute('data-rule')];
        var ok = !check || check(field.value.trim());
        setFieldError(field, ok ? '' : field.getAttribute('data-message'));
        if (!ok) problems.push(field);
      });
      if (problems.length) { e.preventDefault(); announceProblems(form, problems); return; }
      var live = form.querySelector('[data-form-status]');
      if (live) live.textContent = '';
      if (form.hasAttribute('data-validate-js')) {
        e.preventDefault();
        form.dispatchEvent(new CustomEvent('ds:valid'));
      }
    });
  });

  /* Shared with page scripts that map server-side field errors back onto
     the form using the same pattern. */
  window.dsForm = { setFieldError: setFieldError, announceProblems: announceProblems };
})();
