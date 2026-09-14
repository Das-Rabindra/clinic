/* Admin console entry: hash router, sidebar, notification bell. */
import { api, state, $, esc, toast } from './core.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderAppointments, renderCalendar, renderPending } from './pages/appointments.js';
import { renderPatients } from './pages/patients.js';
import { renderEnquiries } from './pages/enquiries.js';
import { renderServices } from './pages/services.js';
import { renderGallery } from './pages/gallery.js';
import { renderReviews } from './pages/reviews.js';
import { renderFaqs, renderHomepage } from './pages/content.js';
import { renderClinic, renderHours, renderHolidays, renderDoctors } from './pages/clinic.js';
import { renderNotifications } from './pages/notifications.js';
import { renderUsers, renderIntegrations, renderSeo, renderAudit } from './pages/settings.js';

const NAV = [
  { group: null, items: [{ id: 'dashboard', label: 'Dashboard', icon: 'grid' }] },
  {
    group: 'Appointments', items: [
      { id: 'calendar', label: 'Calendar', icon: 'calendar' },
      { id: 'appointments', label: 'All Appointments', icon: 'list' },
      { id: 'pending', label: 'Pending Requests', icon: 'clock', badge: 'pending' },
    ],
  },
  {
    group: 'People', items: [
      { id: 'patients', label: 'Patient Directory', icon: 'users' },
      { id: 'enquiries', label: 'Enquiries', icon: 'message', badge: 'enquiries' },
    ],
  },
  {
    group: 'Website', items: [
      { id: 'homepage', label: 'Homepage', icon: 'home' },
      { id: 'services', label: 'Services', icon: 'tooth' },
      { id: 'gallery', label: 'Gallery', icon: 'image' },
      { id: 'reviews', label: 'Reviews', icon: 'star' },
      { id: 'faqs', label: 'FAQ', icon: 'help' },
    ],
  },
  {
    group: 'Clinic', items: [
      { id: 'clinic', label: 'Clinic Information', icon: 'building' },
      { id: 'hours', label: 'Working Hours', icon: 'clock' },
      { id: 'holidays', label: 'Holidays & Blocks', icon: 'calendar-x' },
      { id: 'doctors', label: 'Doctors', icon: 'stethoscope' },
    ],
  },
  {
    group: 'System', items: [
      { id: 'notifications', label: 'Notifications', icon: 'bell', badge: 'failed' },
      { id: 'integrations', label: 'Integrations', icon: 'plug' },
      { id: 'users', label: 'Admin Users', icon: 'shield' },
      { id: 'seo', label: 'SEO', icon: 'search' },
      { id: 'audit', label: 'Audit Log', icon: 'file' },
    ],
  },
];

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  calendar: '<path d="M8 2v4M16 2v4M3.5 9h17M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>',
  'calendar-x': '<path d="M8 2v4M16 2v4M3.5 9h17M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M10 14l4 4M14 14l-4 4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
  message: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>',
  home: '<path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  tooth: '<path d="M12 3c2.5 0 3.5 1 5 1s3-1 3 2c0 4-1 5-1.5 9-.4 3-1 6-2.5 6s-1.6-4-2-6c-.3-1.5-.6-2-2-2s-1.7.5-2 2c-.4 2-.5 6-2 6s-2.1-3-2.5-6C5.5 11 4.5 10 4.5 6c0-3 1.5-2 3-2s2.5-1 4.5-1z"/>',
  image: '<rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12.5" r="3.4"/>',
  star: '<path d="M12 17.3l-6.2 3.3 1.2-6.9L2 8.9l7-1L12 1.5l3 6.4 7 1-5 4.8 1.2 6.9z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 3.5M12 17h.01"/>',
  building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M8 7h4M8 11h4M8 15h4"/>',
  stethoscope: '<path d="M6 3v6a4 4 0 0 0 8 0V3M4 3h3M13 3h3"/><circle cx="18" cy="15" r="3"/><path d="M10 13v1a4 4 0 0 0 5 3.9"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v5"/>',
  shield: '<path d="M12 2l8 4v6c0 5.5-3.8 9.7-8 11-4.2-1.3-8-5.5-8-11V6l8-4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
};

const ROUTES = {
  dashboard: { title: 'Dashboard', render: renderDashboard },
  calendar: { title: 'Appointment Calendar', render: renderCalendar },
  appointments: { title: 'All Appointments', render: renderAppointments },
  pending: { title: 'Pending Requests', render: renderPending },
  patients: { title: 'Patient Directory', render: renderPatients },
  enquiries: { title: 'Enquiries', render: renderEnquiries },
  homepage: { title: 'Homepage Content', render: renderHomepage },
  services: { title: 'Services', render: renderServices },
  gallery: { title: 'Gallery & Media', render: renderGallery },
  reviews: { title: 'Google Reviews', render: renderReviews },
  faqs: { title: 'Frequently Asked Questions', render: renderFaqs },
  clinic: { title: 'Clinic Information', render: renderClinic },
  hours: { title: 'Working Hours', render: renderHours },
  holidays: { title: 'Holidays & Blocked Slots', render: renderHolidays },
  doctors: { title: 'Doctors', render: renderDoctors },
  notifications: { title: 'Notifications', render: renderNotifications },
  integrations: { title: 'Integrations', render: renderIntegrations },
  users: { title: 'Admin Users', render: renderUsers },
  seo: { title: 'SEO', render: renderSeo },
  audit: { title: 'Audit Log', render: renderAudit },
};

const badges = { pending: 0, enquiries: 0, failed: 0 };

function renderNav() {
  const current = currentRoute();
  $('#sbNav').innerHTML = NAV.map((section) => `
    <div class="sb-group">
      ${section.group ? `<h5>${esc(section.group)}</h5>` : ''}
      ${section.items.map((item) => {
        const count = item.badge ? badges[item.badge] : 0;
        return `<a class="sb-link ${item.id === current ? 'active' : ''}" href="#/${item.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${ICONS[item.icon] || ''}</svg>
          <span>${esc(item.label)}</span>
          ${count > 0 ? `<span class="sb-badge">${count}</span>` : ''}
        </a>`;
      }).join('')}
    </div>`).join('');
}

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
  return ROUTES[hash] ? hash : 'dashboard';
}

async function route() {
  const id = currentRoute();
  const def = ROUTES[id];
  $('#pageTitle').textContent = def.title;
  document.title = `${def.title} — Clinic Admin`;
  $('#view').innerHTML = '<div class="spin"></div>';
  renderNav();
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('show');
  try {
    await def.render($('#view'));
  } catch (err) {
    $('#view').innerHTML = `<div class="banner banner-err"><span>${esc(err.message)}</span></div>`;
  }
  await refreshBadges();
}

export async function refreshBadges() {
  try {
    const d = await api('/api/admin/dashboard');
    badges.pending = d.counts.pending || 0;
    badges.enquiries = d.new_enquiries || 0;
    badges.failed = d.notifications.failed || 0;
    const unread = d.notifications.unread || 0;
    $('#alertCount').textContent = unread ? String(unread) : '';
    renderNav();
  } catch { /* badge refresh is best-effort */ }
}

/* Notification bell */
$('#alertsBtn').addEventListener('click', async () => {
  const { openModal } = await import('./core.js');
  const { fmtDateTime } = await import('./core.js');
  const data = await api('/api/admin/alerts');
  const body = data.items.length
    ? data.items.map((a) => `
      <div style="padding:11px 0; border-bottom:1px solid var(--line); ${a.is_read ? 'opacity:.6;' : ''}">
        <div style="display:flex; gap:9px; align-items:flex-start;">
          <span class="pill pill-${esc(a.severity)}">${esc(a.severity)}</span>
          <div style="flex:1;">
            <div style="font-weight:600; font-size:13px; color:var(--pine-700);">${esc(a.title)}</div>
            ${a.body ? `<div style="font-size:12.5px; color:#5B665A; margin-top:3px;">${esc(a.body)}</div>` : ''}
            <div style="font-size:11px; color:#8A948A; margin-top:4px;">${fmtDateTime(a.created_at)}</div>
          </div>
        </div>
      </div>`).join('')
    : '<div class="empty">No notifications yet.</div>';

  openModal('Notifications', body, {
    footer: '<button class="btn btn-ghost" id="markAll">Mark all as read</button>',
  });
  const btn = document.getElementById('markAll');
  if (btn) {
    btn.onclick = async () => {
      await api('/api/admin/alerts/read-all', { method: 'POST' });
      (await import('./core.js')).closeModal();
      toast('All notifications marked as read');
      refreshBadges();
    };
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

$('#burger').addEventListener('click', () => {
  $('#sidebar').classList.add('open');
  $('#scrim').classList.add('show');
});
$('#scrim').addEventListener('click', () => {
  $('#sidebar').classList.remove('open');
  $('#scrim').classList.remove('show');
});

window.addEventListener('hashchange', route);

(async function boot() {
  try {
    const me = await api('/api/auth/me');
    state.csrf = me.csrf_token;
    state.user = me.user;
  } catch {
    window.location.href = '/admin/login';
    return;
  }
  if (!location.hash) location.hash = '#/dashboard';
  await route();
  // Keep badges current without a websocket; cheap single query.
  setInterval(refreshBadges, 60000);
})();
