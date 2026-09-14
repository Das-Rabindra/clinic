import { api, $, $$, esc, emptyState, toastOk, toastErr, openModal, closeModal, confirmAction } from '../core.js';

export async function renderServices(view) {
  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>Services</h2><p class="card-sub">These appear on the website and drive appointment durations</p></div>
        <button class="btn btn-primary btn-sm" id="newSvc">Add service</button>
      </div>
      <div id="svcList"><div class="spin"></div></div>
    </div>`;

  async function load() {
    const box = $('#svcList');
    const { services, categories } = await api('/api/admin/services');
    box.innerHTML = services.length ? `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Order</th><th>Name</th><th>Category</th><th>Duration</th><th>Price</th><th>Bookable</th><th>Status</th><th></th></tr></thead>
        <tbody>${services.map((s, i) => `
          <tr>
            <td>
              <button class="btn btn-ghost btn-xs" data-up="${i}" ${i === 0 ? 'disabled' : ''}>&uarr;</button>
              <button class="btn btn-ghost btn-xs" data-down="${i}" ${i === services.length - 1 ? 'disabled' : ''}>&darr;</button>
            </td>
            <td><div class="t-strong">${esc(s.name)}</div><div class="t-muted">${esc(s.short_desc || '')}</div></td>
            <td>${esc(s.category_name || '—')}</td>
            <td class="mono" style="font-size:12px;">${s.duration_min} min</td>
            <td>${s.show_price && s.price_from ? esc((s.currency === 'INR' ? '₹' : '') + s.price_from) : '<span class="t-muted">hidden</span>'}</td>
            <td>${s.bookable ? 'Yes' : '<span class="t-muted">No</span>'}</td>
            <td>${s.is_active ? '<span class="pill pill-confirmed">active</span>' : '<span class="pill pill-disabled">inactive</span>'}</td>
            <td><div class="t-actions">
              <button class="btn btn-ghost btn-xs" data-edit="${s.id}">Edit</button>
              <button class="btn btn-danger btn-xs" data-del="${s.id}">Delete</button>
            </div></td>
          </tr>`).join('')}</tbody>
      </table></div>` : emptyState('No services yet. Add the treatments this clinic offers.', 'inbox');

    $$('[data-edit]', box).forEach((b) => {
      b.onclick = () => form(services.find((s) => s.id === Number(b.dataset.edit)), categories, load);
    });
    $$('[data-del]', box).forEach((b) => {
      b.onclick = async () => {
        const s = services.find((x) => x.id === Number(b.dataset.del));
        if (!await confirmAction('Delete service', `Remove "${s.name}" from the website? Existing appointments keep their record.`, { confirmLabel: 'Delete' })) return;
        try { await api(`/api/admin/services/${s.id}`, { method: 'DELETE' }); toastOk('Service removed'); load(); }
        catch (err) { toastErr(err.message); }
      };
    });

    const move = async (from, to) => {
      const ids = services.map((s) => s.id);
      const [x] = ids.splice(from, 1);
      ids.splice(to, 0, x);
      await api('/api/admin/services/reorder', { method: 'POST', body: { ids } });
      load();
    };
    $$('[data-up]', box).forEach((b) => { b.onclick = () => move(Number(b.dataset.up), Number(b.dataset.up) - 1); });
    $$('[data-down]', box).forEach((b) => { b.onclick = () => move(Number(b.dataset.down), Number(b.dataset.down) + 1); });

    $('#newSvc').onclick = () => form(null, categories, load);
  }

  await load();
}

function form(svc, categories, reload) {
  const s = svc || { duration_min: 30, bookable: 1, is_active: 1, currency: 'INR', show_price: 0 };
  openModal(svc ? `Edit ${svc.name}` : 'Add service', `
    <div class="field"><label>Service name</label><input type="text" data-field="name" value="${esc(s.name || '')}"><span class="err"></span></div>
    <div class="frow">
      <div class="field"><label>Category</label>
        <input type="text" data-field="category" list="catList" value="${esc(s.category_name || '')}" placeholder="e.g. Restorative">
        <datalist id="catList">${categories.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
      </div>
      <div class="field"><label>Appointment duration (minutes)</label>
        <input type="number" data-field="duration_min" value="${s.duration_min}" min="5" max="480" step="5">
        <div class="hint">Determines how many booking slots this treatment occupies.</div>
      </div>
    </div>
    <div class="field"><label>Short description</label>
      <input type="text" data-field="short_desc" value="${esc(s.short_desc || '')}" maxlength="400">
      <div class="hint">Shown in the services list on the website.</div>
    </div>
    <div class="field"><label>Detailed description (optional)</label>
      <textarea data-field="long_desc" rows="3">${esc(s.long_desc || '')}</textarea>
    </div>
    <div class="frow">
      <div class="field"><label>Starting price (optional)</label>
        <input type="number" data-field="price_from" value="${s.price_from ?? ''}" min="0" step="1">
      </div>
      <div class="field"><label>Currency</label><input type="text" data-field="currency" value="${esc(s.currency || 'INR')}" maxlength="8"></div>
    </div>
    <label class="check"><input type="checkbox" data-field="show_price" ${s.show_price ? 'checked' : ''}>
      <span>Show the starting price on the website<br><span class="hint">Only enable if the clinic wants prices published.</span></span></label>
    <label class="check"><input type="checkbox" data-field="bookable" ${s.bookable ? 'checked' : ''}>
      <span>Patients can book this online</span></label>
    <label class="check"><input type="checkbox" data-field="is_active" ${s.is_active ? 'checked' : ''}>
      <span>Show on the website</span></label>`, {
    footer: '<button class="btn btn-ghost" id="svcCancel">Cancel</button><button class="btn btn-primary" id="svcSave">Save</button>',
  });

  $('#svcCancel').onclick = closeModal;
  $('#svcSave').onclick = async () => {
    const body = {};
    $$('[data-field]').forEach((el) => {
      const k = el.dataset.field;
      if (el.type === 'checkbox') body[k] = el.checked;
      else if (el.type === 'number') body[k] = el.value === '' ? null : Number(el.value);
      else body[k] = el.value.trim() || null;
    });
    if (!body.name) { toastErr('Service name is required.'); return; }
    try {
      if (svc) await api(`/api/admin/services/${svc.id}`, { method: 'PUT', body });
      else await api('/api/admin/services', { method: 'POST', body });
      toastOk(svc ? 'Service updated' : 'Service added');
      closeModal();
      reload();
    } catch (err) { toastErr(err.message); }
  };
}
