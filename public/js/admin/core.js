/* Shared helpers for the admin console: API client, DOM utilities, toasts,
   modals and formatting. Every module imports from here. */

export const state = {
  user: JSON.parse(document.body.dataset.user || '{}'),
  csrf: null,
};

export function cookie(name) {
  return document.cookie.split('; ').reduce((acc, part) => {
    const kv = part.split('=');
    return kv[0] === name ? decodeURIComponent(kv.slice(1).join('=')) : acc;
  }, '');
}

/** JSON API client. Redirects to login if the session has expired. */
export async function api(url, options = {}) {
  const opts = { ...options, credentials: 'same-origin' };
  opts.headers = { ...(opts.headers || {}) };
  if (!(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  }
  if (opts.method && opts.method !== 'GET') {
    opts.headers['X-CSRF-Token'] = state.csrf || cookie('sdc_csrf');
  }

  const res = await fetch(url, opts);
  if (res.status === 401) {
    window.location.href = '/admin/login?next=' + encodeURIComponent(location.pathname);
    throw new Error('Session expired.');
  }
  let data = null;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.code = data.code;
    err.fields = data.fields;
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------- DOM ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Toasts ---------- */
export function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = message;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 260);
  }, kind === 'err' ? 6000 : 3600);
}
export const toastOk = (m) => toast(m, 'ok');
export const toastErr = (m) => toast(m, 'err');

/* ---------- Modal ---------- */
const modal = () => document.getElementById('modal');
const modalBox = () => document.getElementById('modalBox');

export function openModal(title, bodyHtml, { footer = '', wide = false } = {}) {
  modalBox().className = 'modal-box' + (wide ? ' wide' : '');
  modalBox().innerHTML = `
    <div class="modal-head">
      <h3>${esc(title)}</h3>
      <button class="modal-close" id="modalClose" aria-label="Close">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div id="modalBody">${bodyHtml}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}`;
  modal().classList.add('show');
  document.body.style.overflow = 'hidden';
  document.getElementById('modalClose').onclick = closeModal;
  modal().onclick = (e) => { if (e.target === modal()) closeModal(); };
  return modalBox();
}

export function closeModal() {
  modal().classList.remove('show');
  document.body.style.overflow = '';
  modalBox().innerHTML = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modal()?.classList.contains('show')) closeModal();
});

export function confirmAction(title, message, { confirmLabel = 'Confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    openModal(title, `<p style="font-size:13.5px; line-height:1.65; color:#4B564F;">${esc(message)}</p>`, {
      footer: `<button class="btn btn-ghost" id="cAbort">Cancel</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cGo">${esc(confirmLabel)}</button>`,
    });
    document.getElementById('cAbort').onclick = () => { closeModal(); resolve(false); };
    document.getElementById('cGo').onclick = () => { closeModal(); resolve(true); };
  });
}

/* ---------- Formatting ---------- */
export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number);
  if (!y) return dateStr;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB',
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(String(value).includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const minToHHMM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  return m ? +m[1] * 60 + +m[2] : null;
}
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
export const pill = (status) =>
  `<span class="pill pill-${esc(status)}">${esc(String(status).replace(/_/g, ' '))}</span>`;
export const localPhone = (p) => (String(p || '').startsWith('91') ? String(p).slice(2) : String(p || ''));

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function emptyState(message, icon = 'inbox') {
  const icons = {
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5L5.5 5z"/>',
    calendar: '<path d="M8 2v4M16 2v4M3.5 9h17M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>',
    image: '<rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12.5" r="3.4"/>',
    star: '<path d="M12 17.3l-6.2 3.3 1.2-6.9L2 8.9l7-1L12 1.5l3 6.4 7 1-5 4.8 1.2 6.9z"/>',
  };
  return `<div class="empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${icons[icon] || icons.inbox}</svg>
    ${esc(message)}
  </div>`;
}
