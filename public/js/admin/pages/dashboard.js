import { api, esc, pill, fmtDate, localPhone, emptyState, toastOk, toastErr } from '../core.js';

export async function renderDashboard(view) {
  const d = await api('/api/admin/dashboard');

  const providerWarning = (!d.notifications.providers.whatsapp.configured)
    ? `<div class="banner banner-warn">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>
         <span><strong>WhatsApp notifications are not configured.</strong> Appointments are still saved and visible here, but patients are not receiving messages. Add credentials in <a href="#/integrations">Settings &rarr; Integrations</a>.</span>
       </div>` : '';

  const failedWarning = d.notifications.failed > 0
    ? `<div class="banner banner-err">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>
         <span><strong>${d.notifications.failed} notification(s) failed to send.</strong> <a href="#/notifications">Review and retry</a>.</span>
       </div>` : '';

  view.innerHTML = `
    ${providerWarning}${failedWarning}

    <div class="grid g5" style="margin-bottom:18px;">
      <div class="stat accent">
        <div class="stat-label">Today</div>
        <div class="stat-value">${d.counts.today_total}</div>
        <div class="stat-note">${d.today_patient_count} patient${d.today_patient_count === 1 ? '' : 's'}</div>
      </div>
      <div class="stat ${d.counts.pending ? 'warn' : ''}">
        <div class="stat-label">Pending</div>
        <div class="stat-value">${d.counts.pending}</div>
        <div class="stat-note">awaiting confirmation</div>
      </div>
      <div class="stat">
        <div class="stat-label">Confirmed</div>
        <div class="stat-value">${d.counts.confirmed}</div>
        <div class="stat-note">all upcoming</div>
      </div>
      <div class="stat">
        <div class="stat-label">Completed</div>
        <div class="stat-value">${d.counts.completed}</div>
        <div class="stat-note">all time</div>
      </div>
      <div class="stat ${d.new_enquiries ? 'accent' : ''}">
        <div class="stat-label">New enquiries</div>
        <div class="stat-value">${d.new_enquiries}</div>
        <div class="stat-note">${d.patients_total} patient${d.patients_total === 1 ? '' : 's'} on file</div>
      </div>
    </div>

    <div class="grid g-2-1">
      <div>
        <div class="card">
          <div class="card-head">
            <div>
              <h2>Today's appointments</h2>
              <p class="card-sub">${fmtDate(d.today)}</p>
            </div>
            <a class="btn btn-ghost btn-sm" href="#/calendar">Open calendar</a>
          </div>
          ${d.today_appointments.length ? `
            <div class="day-list">
              ${d.today_appointments.map((a) => `
                <div class="day-row">
                  <span class="day-time">${esc(a.time)}</span>
                  <div style="display:flex; align-items:center; gap:10px; justify-content:space-between; flex-wrap:wrap;">
                    <div>
                      <div class="t-strong">${esc(a.patient)}</div>
                      <div class="t-muted">${esc(a.service)} &middot; ${esc(localPhone(a.phone))}</div>
                    </div>
                    <div style="display:flex; gap:7px; align-items:center;">
                      ${pill(a.status)}
                      ${a.status === 'pending' ? `<button class="btn btn-accent btn-xs" data-confirm="${a.id}">Confirm</button>` : ''}
                      ${['confirmed', 'rescheduled', 'checked_in'].includes(a.status)
                        ? `<button class="btn btn-ghost btn-xs" data-complete="${a.id}">Complete</button>` : ''}
                    </div>
                  </div>
                </div>`).join('')}
            </div>` : emptyState('No appointments booked for today.', 'calendar')}
        </div>

        <div class="card">
          <div class="card-head"><div><h2>Upcoming</h2><p class="card-sub">Next scheduled appointments</p></div></div>
          ${d.upcoming.length ? `
            <div class="table-wrap"><table class="data">
              <thead><tr><th>Date</th><th>Time</th><th>Patient</th><th>Service</th><th>Status</th></tr></thead>
              <tbody>${d.upcoming.map((a) => `
                <tr>
                  <td>${fmtDate(a.date)}</td>
                  <td class="mono">${esc(a.time)}</td>
                  <td class="t-strong">${esc(a.patient)}</td>
                  <td>${esc(a.service)}</td>
                  <td>${pill(a.status)}</td>
                </tr>`).join('')}</tbody>
            </table></div>` : emptyState('Nothing scheduled yet.', 'calendar')}
        </div>
      </div>

      <div>
        <div class="card">
          <h2>Quick actions</h2>
          <p class="card-sub">Common daily tasks</p>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <a class="btn btn-primary btn-block" href="#/appointments?new=1">Add appointment</a>
            <a class="btn btn-ghost btn-block" href="#/gallery">Upload clinic photos</a>
            <a class="btn btn-ghost btn-block" href="#/clinic">Update clinic information</a>
            <a class="btn btn-ghost btn-block" href="#/services">Manage services</a>
            <a class="btn btn-ghost btn-block" href="#/reviews">Manage reviews</a>
            <a class="btn btn-ghost btn-block" href="#/holidays">Add a closure</a>
          </div>
        </div>

        <div class="card">
          <h2>New enquiries</h2>
          <p class="card-sub">${d.new_enquiries} awaiting contact</p>
          ${d.recent_enquiries.length ? d.recent_enquiries.map((e) => `
            <div style="padding:9px 0; border-bottom:1px solid var(--line);">
              <div class="t-strong">${esc(e.name)}</div>
              <div class="t-muted">${esc(localPhone(e.phone))} &middot; prefers ${esc(e.preferred_contact)}</div>
            </div>`).join('') + '<a class="btn btn-ghost btn-sm" style="margin-top:12px;" href="#/enquiries">View all</a>'
            : '<p class="t-muted">No new enquiries.</p>'}
        </div>

        <div class="card">
          <h2>Recent uploads</h2>
          <p class="card-sub">${d.recent_uploads} image(s) in the last 7 days</p>
          ${d.recent_gallery.length ? `
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:7px;">
              ${d.recent_gallery.map((g) => `
                <img class="thumb" style="width:100%; height:62px;" src="${esc(g.thumb_url)}" alt="${esc(g.title)}" title="${esc(g.title)}${g.is_published ? '' : ' (unpublished)'}">`).join('')}
            </div>` : '<p class="t-muted">No photos uploaded yet.</p>'}
        </div>

        <div class="card">
          <h2>Recent reviews</h2>
          ${d.recent_reviews.length ? d.recent_reviews.map((r) => `
            <div style="padding:9px 0; border-bottom:1px solid var(--line);">
              <div class="t-strong">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} ${esc(r.author_name)}</div>
              ${r.text ? `<div class="t-muted">${esc(String(r.text).slice(0, 90))}${r.text.length > 90 ? '…' : ''}</div>` : ''}
            </div>`).join('')
            : '<p class="t-muted">No reviews synced yet. Connect the Google Business Profile in <a href="#/reviews">Reviews</a>.</p>'}
        </div>
      </div>
    </div>`;

  view.querySelectorAll('[data-confirm]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api(`/api/admin/appointments/${btn.dataset.confirm}/confirm`, { method: 'POST' });
        toastOk('Appointment confirmed');
        renderDashboard(view);
      } catch (err) { toastErr(err.message); btn.disabled = false; }
    };
  });
  view.querySelectorAll('[data-complete]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api(`/api/admin/appointments/${btn.dataset.complete}/status`, {
          method: 'POST', body: { status: 'completed' },
        });
        toastOk('Marked completed');
        renderDashboard(view);
      } catch (err) { toastErr(err.message); btn.disabled = false; }
    };
  });
}
