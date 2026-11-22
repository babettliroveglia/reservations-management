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
  async function loadBookings() {
    const box = $('bookings');
    box.textContent = 'Caricamento…';
    let bookings;
    try { ({ bookings } = await api(`/api/bookings?from=${$('from').value}&to=${$('to').value}`)); }
    catch (err) { box.textContent = err.message; return; }
    if (!$('show-cancelled').checked) bookings = bookings.filter(b => b.status === 'confirmed');
    box.innerHTML = '';
    if (!bookings.length) { box.appendChild(el('p', { className: 'empty' }, 'Nessuna prenotazione in questo periodo.')); return; }

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
      table.innerHTML = '<thead><tr><th>Degustazione</th><th>Ospiti</th><th>Nome</th><th>Contatti</th><th>Note</th><th>Totale</th><th></th></tr></thead>';
      const tbody = el('tbody');
      for (const b of list) {
        const tr = el('tr', { className: b.status });
        const people = [`${b.adults} ad.`, b.teens ? `${b.teens} rag.` : '', b.children ? `${b.children} bamb.` : ''].filter(Boolean).join(', ');
        for (const v of [b.tasting_name, people, b.name, `${b.email}\n${b.phone}`, b.notes, euro(b.price_cents)]) {
          tr.appendChild(el('td', { style: 'white-space:pre-line' }, v));
        }
        const actions = el('td');
        if (b.status === 'confirmed') {
          const cancel = el('button', { type: 'button', className: 'link' }, 'Annulla');
          cancel.addEventListener('click', async () => {
            if (cancel.dataset.armed !== '1') { cancel.dataset.armed = '1'; cancel.textContent = 'Conferma annullamento'; return; }
            try { await api(`/api/bookings/${b.id}/cancel`, 'POST', {}); loadBookings(); }
            catch (err) { cancel.textContent = err.message; }
          });
          actions.appendChild(cancel);
        } else {
          actions.textContent = b.cancelled_by === 'guest' ? 'annullata dal cliente' : `annullata da ${b.cancelled_by ?? ''}`;
        }
        tr.appendChild(actions);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      const wrap = el('div', { className: 'table-wrap' });
      wrap.appendChild(table);
      box.appendChild(wrap);
    }
  }

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
    } catch (err) { message('settings-message', err.message, 'error'); }
  });

  async function start() {
    try {
      const me = await api('/api/me');
      $('me').textContent = me.email;
      $('from').value = me.today;
      $('to').value = addDays(me.today, 30);
    } catch (err) { $('bookings').textContent = err.message; return; }
    $('range').addEventListener('submit', e => { e.preventDefault(); loadBookings(); });
    $('show-cancelled').addEventListener('change', loadBookings);
    loadBookings();
  }
  start();
})();
