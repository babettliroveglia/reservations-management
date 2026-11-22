// Staff admin: bookings, closures, settings. The admin Worker checks the Cloudflare Access login on every request.
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, attrs = {}, text) => { const e = Object.assign(document.createElement(tag), attrs); if (text != null) e.textContent = text; return e; };
  const euro = cents => (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
  const longDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  async function api(path, method = 'GET', body) {
    const res = await fetch(path, {
      method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
    return data;
  }

  function message(id, text, kind) {
    $(id).innerHTML = '';
    if (text) $(id).appendChild(el('p', { className: `msg ${kind}` }, text));
  }

  // Tabs
  for (const name of ['bookings', 'closures', 'settings']) {
    $(`tab-${name}`).addEventListener('click', () => {
      for (const other of ['bookings', 'closures', 'settings']) {
        $(`tab-${other}`).setAttribute('aria-selected', String(other === name));
        $(`panel-${other}`).hidden = other !== name;
      }
      if (name === 'closures') loadClosures();
      if (name === 'settings') loadSettings();
    });
  }

  // Bookings
  const state = { me: null, bookings: [] };
  const people = b => [`${b.adults} ad.`, b.teens ? `${b.teens} rag.` : '', b.children ? `${b.children} bamb.` : ''].filter(Boolean).join(', ');
  const peopleLong = b => [
    `${b.adults} ${b.adults === 1 ? 'adulto' : 'adulti'}`,
    b.teens ? `${b.teens} ${b.teens === 1 ? 'ragazzo' : 'ragazzi'} (13–17)` : '',
    b.children ? `${b.children} ${b.children === 1 ? 'bambino' : 'bambini'} (0–12)` : '',
  ].filter(Boolean).join(', ');
  const stamp = iso => iso ? new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' }) : '';

  async function loadBookings() {
    const box = $('bookings');
    box.textContent = 'Caricamento…';
    try { ({ bookings: state.bookings } = await api(`/api/bookings?from=${$('from').value}&to=${$('to').value}`)); }
    catch (err) { box.textContent = err.message; return; }
    renderBookings();
  }

  function renderBookings() {
    const box = $('bookings');
    const q = $('search').value.trim().toLowerCase();
    let bookings = state.bookings;
    if (!$('show-cancelled').checked) bookings = bookings.filter(b => b.status === 'confirmed');
    if (q) bookings = bookings.filter(b => [b.name, b.email, b.phone, b.notes].join(' ').toLowerCase().includes(q));
    box.innerHTML = '';
    if (!bookings.length) { box.appendChild(el('p', { className: 'empty' }, q ? 'Nessuna prenotazione trovata.' : 'Nessuna prenotazione in questo periodo.')); return; }

    const groups = new Map();
    for (const b of bookings) {
      const key = `${b.date} ${b.time}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }
    for (const [key, list] of groups) {
      const [date, time] = key.split(' ');
      const total = list.filter(b => b.status === 'confirmed').reduce((n, b) => n + b.guests, 0);
      const h = el('h2', { className: 'day' }, `${longDate(date)}, ${time} `);
      h.appendChild(el('span', { className: 'slot' }, `· ${total} ospiti`));
      box.appendChild(h);
      const table = el('table');
      table.innerHTML = '<thead><tr><th>Nome</th><th>Degustazione</th><th>Ospiti</th><th>Contatti</th><th>Note</th><th>Totale</th><th></th></tr></thead>';
      const tbody = el('tbody');
      for (const b of list) {
        const tr = el('tr', { className: b.status });
        const nameCell = el('td');
        const open = el('button', { type: 'button', className: 'open', title: 'Apri la prenotazione' }, b.name);
        open.addEventListener('click', () => showBooking(b.id));
        nameCell.appendChild(open);
        tr.appendChild(nameCell);
        for (const v of [b.tasting_name, people(b), [b.email, b.phone].filter(Boolean).join('\n'), b.notes, euro(b.price_cents)]) {
          tr.appendChild(el('td', { style: 'white-space:pre-line' }, v));
        }
        const actions = el('td');
        const cell = el('div', { className: 'actions-cell' });
        if (b.status === 'confirmed') {
          const edit = el('button', { type: 'button', className: 'secondary' }, 'Modifica');
          edit.addEventListener('click', () => editBooking(b));
          cell.appendChild(edit);
          cell.appendChild(cancelButton(b, 'Annulla', loadBookings));
        } else {
          cell.textContent = b.cancelled_by === 'guest' ? 'annullata dal cliente' : `annullata da ${b.cancelled_by ?? ''}`;
        }
        actions.appendChild(cell);
        tr.appendChild(actions);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      const wrap = el('div', { className: 'table-wrap' });
      wrap.appendChild(table);
      box.appendChild(wrap);
    }
  }

  /** A cancel button that asks once more before cancelling. */
  function cancelButton(b, label, after) {
    const cancel = el('button', { type: 'button', className: 'link' }, label);
    cancel.addEventListener('click', async () => {
      if (cancel.dataset.armed !== '1') { cancel.dataset.armed = '1'; cancel.textContent = 'Conferma annullamento'; return; }
      try { await api(`/api/bookings/${b.id}/cancel`, 'POST', {}); after(); }
      catch (err) { cancel.textContent = err.message; }
    });
    return cancel;
  }

  // Booking details and editing, in a dialog
  const dialog = $('booking-dialog');
  $('dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (dialog.dataset.changed === '1') loadBookings(); dialog.dataset.changed = ''; });

  async function showBooking(id) {
    let b;
    try { b = await api(`/api/bookings/${id}`); } catch (err) { alertInList(err.message); return; }
    $('booking-form').hidden = true;
    const view = $('dialog-view');
    view.hidden = false;
    view.innerHTML = '';
    $('dialog-title').textContent = `${b.name}`;
    const badge = el('span', { className: `badge ${b.status}` }, b.status === 'confirmed' ? 'confermata' : 'annullata');
    view.appendChild(badge);

    const dl = el('dl', { className: 'details' });
    const row = (label, value) => { if (value == null || value === '') return; dl.appendChild(el('dt', {}, label)); const dd = el('dd'); if (value instanceof Node) dd.appendChild(value); else dd.textContent = value; dl.appendChild(dd); };
    row('Degustazione', b.tasting_name);
    row('Quando', `${longDate(b.date)}, ore ${b.time}`);
    row('Ospiti', peopleLong(b));
    row('Totale', `${euro(b.price_cents)} · da pagare in cantina`);
    row('Email', b.email ? el('a', { href: `mailto:${b.email}` }, b.email) : '');
    row('Telefono', b.phone ? el('a', { href: `tel:${b.phone.replace(/[^\d+]/g, '')}` }, b.phone) : '');
    row('Note', b.notes);
    row('Prenotata', `${stamp(b.created_at)} · ${b.created_by ? `inserita da ${b.created_by}` : 'online dal cliente'}`);
    if (b.updated_at) row('Modificata', `${stamp(b.updated_at)} da ${b.updated_by}`);
    if (b.status === 'cancelled') row('Annullata', `${stamp(b.cancelled_at)} ${b.cancelled_by === 'guest' ? 'dal cliente' : `da ${b.cancelled_by}`}`);
    if (state.me.publicUrl) {
      const box = el('div', { className: 'linkbox' });
      const input = el('input', { type: 'text', readOnly: true, value: `${state.me.publicUrl}/prenotazione?t=${b.token}` });
      input.setAttribute('aria-label', 'Link del cliente');
      const copy = el('button', { type: 'button', className: 'secondary' }, 'Copia');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(input.value); copy.textContent = 'Copiato'; } catch { input.select(); }
      });
      box.append(input, copy);
      row('Link del cliente', box);
    }
    view.appendChild(dl);

    if (b.status === 'confirmed') {
      const actions = el('div', { className: 'actions' });
      const edit = el('button', { type: 'button' }, 'Modifica');
      edit.addEventListener('click', () => editBooking(b));
      actions.append(edit, cancelButton(b, 'Annulla la prenotazione', () => { dialog.dataset.changed = '1'; showBooking(b.id); }));
      view.appendChild(actions);
    }
    if (!dialog.open) dialog.showModal();
  }

  function alertInList(text) {
    $('bookings').prepend(el('p', { className: 'msg error' }, text));
  }

  // The form, for a new booking (b = null) or to change one.
  let editing = null;
  function fillTimes(selected) {
    const times = [...new Set([...state.me.slotTimes, ...(selected ? [selected] : [])])].sort();
    $('f-time').innerHTML = '';
    for (const t of times) $('f-time').add(new Option(t, t));
    $('f-time').value = selected ?? times[0];
  }

  function updatePrice() {
    const t = state.me.tastings.find(x => x.id === $('f-tasting').value);
    if (!t) { $('f-price').textContent = ''; return; }
    const adultsOnly = t.teen_discount_pct == null;
    for (const id of ['f-teens', 'f-children']) {
      $(id).disabled = adultsOnly;
      if (adultsOnly) $(id).value = 0;
    }
    $('f-adults').min = t.min_adults; $('f-adults').max = t.max_adults;
    const a = Number($('f-adults').value) || 0, r = Number($('f-teens').value) || 0;
    const teen = adultsOnly ? 0 : Math.round(t.price_adult_cents * (100 - t.teen_discount_pct) / 100);
    $('f-price').textContent = `Totale ${euro(a * t.price_adult_cents + r * teen)} · adulti da ${t.min_adults} a ${t.max_adults}`
      + (adultsOnly ? ' · solo adulti' : ` · ragazzi ${t.teen_discount_pct}% di sconto, bambini gratis`);
  }

  function editBooking(b) {
    editing = b;
    $('dialog-view').hidden = true;
    const form = $('booking-form');
    form.hidden = false;
    message('form-message', '');
    $('dialog-title').textContent = b ? `Modifica: ${b.name}` : 'Nuova prenotazione';
    $('f-tasting').innerHTML = '';
    for (const t of state.me.tastings) $('f-tasting').add(new Option(`${t.name} (${euro(t.price_adult_cents)})`, t.id));
    $('f-tasting').value = b ? b.tasting_id : state.me.tastings[0].id;
    $('f-date').value = b ? b.date : '';
    $('f-date').min = b && b.date < state.me.today ? b.date : state.me.today;
    fillTimes(b?.time);
    $('f-adults').value = b ? b.adults : 2;
    $('f-teens').value = b ? b.teens : 0;
    $('f-children').value = b ? b.children : 0;
    for (const f of ['name', 'email', 'phone', 'notes']) $(`f-${f}`).value = b ? b[f] : '';
    $('f-save').textContent = b ? 'Salva le modifiche' : 'Crea la prenotazione';
    $('f-save').disabled = false;
    updatePrice();
    if (!dialog.open) dialog.showModal();
    $(b ? 'f-tasting' : 'f-date').focus();
  }

  for (const id of ['f-tasting', 'f-adults', 'f-teens', 'f-children']) $(id).addEventListener('input', updatePrice);
  $('f-cancel').addEventListener('click', () => { if (editing) showBooking(editing.id); else dialog.close(); });
  $('new-booking').addEventListener('click', () => editBooking(null));

  $('booking-form').addEventListener('submit', async e => {
    e.preventDefault();
    message('form-message', '');
    const body = {
      tasting: $('f-tasting').value, date: $('f-date').value, time: $('f-time').value,
      adults: Number($('f-adults').value) || 0, teens: Number($('f-teens').value) || 0, children: Number($('f-children').value) || 0,
      name: $('f-name').value, email: $('f-email').value, phone: $('f-phone').value, notes: $('f-notes').value,
    };
    if (!body.date) { message('form-message', 'Scegli il giorno.', 'error'); $('f-date').focus(); return; }
    $('f-save').disabled = true;
    try {
      const saved = editing ? await api(`/api/bookings/${editing.id}`, 'PUT', body) : await api('/api/bookings', 'POST', body);
      dialog.dataset.changed = '1';
      await showBooking(saved.id);
    } catch (err) {
      message('form-message', err.message, 'error');
      $('f-save').disabled = false;
    }
  });

  // Closures
  async function loadClosures() {
    const list = $('closures');
    list.innerHTML = '';
    let closures;
    try { ({ closures } = await api('/api/closures')); } catch (err) { list.textContent = err.message; return; }
    if (!closures.length) { list.appendChild(el('li', { className: 'empty' }, 'Nessuna chiusura straordinaria in programma.')); return; }
    for (const c of closures) {
      const li = el('li');
      li.appendChild(el('span', {}, `${longDate(c.date)}${c.reason ? ` — ${c.reason}` : ''}`));
      const remove = el('button', { type: 'button', className: 'link' }, 'Riapri');
      remove.addEventListener('click', async () => {
        try { await api(`/api/closures/${c.date}`, 'DELETE', {}); loadClosures(); } catch (err) { message('closure-message', err.message, 'error'); }
      });
      li.appendChild(remove);
      list.appendChild(li);
    }
  }

  $('closure-form').addEventListener('submit', async e => {
    e.preventDefault();
    const date = $('closure-date').value;
    try {
      const { bookingsOnThatDay } = await api(`/api/closures/${date}`, 'PUT', { reason: $('closure-reason').value });
      message('closure-message', bookingsOnThatDay
        ? `Giorno chiuso. Attenzione: ci sono già ${bookingsOnThatDay} prenotazioni in quel giorno, da gestire a parte.`
        : 'Giorno chiuso.', bookingsOnThatDay ? 'error' : 'ok');
      $('closure-form').reset();
      loadClosures();
    } catch (err) { message('closure-message', err.message, 'error'); }
  });

  // Settings
  async function loadSettings() {
    try {
      const s = await api('/api/settings');
      $('slot-times').value = s.slotTimes.join(', ');
      $('slot-capacity').value = s.slotCapacity;
      $('horizon-days').value = s.horizonDays;
    } catch (err) { message('settings-message', err.message, 'error'); }
  }

  $('settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/settings', 'PUT', {
        slotTimes: $('slot-times').value.split(',').map(t => t.trim()).filter(Boolean),
        slotCapacity: Number($('slot-capacity').value),
        horizonDays: Number($('horizon-days').value),
      });
      message('settings-message', 'Impostazioni salvate.', 'ok');
      loadSettings();
      state.me = await api('/api/me');
    } catch (err) { message('settings-message', err.message, 'error'); }
  });

  async function start() {
    try {
      const me = await api('/api/me');
      state.me = me;
      $('me').textContent = me.email;
      $('from').value = me.today;
      $('to').value = addDays(me.today, 30);
    } catch (err) { $('bookings').textContent = err.message; return; }
    $('range').addEventListener('submit', e => { e.preventDefault(); loadBookings(); });
    $('show-cancelled').addEventListener('change', renderBookings);
    $('search').addEventListener('input', renderBookings);
    loadBookings();
  }
  start();
})();
