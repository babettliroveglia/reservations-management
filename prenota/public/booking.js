// Booking page: tasting → party → day → time → details. Talks to the Worker's /api.
(() => {
  const $ = id => document.getElementById(id);
  const euro = cents => (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0 });
  const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const DOW = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
  const longDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const state = { config: null, tasting: null, month: null, days: new Map(), date: null, time: null, turnstileToken: null };

  async function api(path, options) {
    const res = await fetch(path, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Errore di rete. Riprova.');
    return body;
  }

  const enable = (id, on) => $(id).setAttribute('aria-disabled', on ? 'false' : 'true');

  function options(select, from, to, value) {
    select.innerHTML = '';
    for (let n = from; n <= to; n++) select.add(new Option(String(n), String(n)));
    select.value = String(Math.min(Math.max(value, from), to));
  }

  const party = () => ({
    adults: Number($('adults').value) || 0,
    teens: state.tasting?.teen_discount_pct == null ? 0 : Number($('teens').value) || 0,
    children: state.tasting?.teen_discount_pct == null ? 0 : Number($('children').value) || 0,
  });
  const guests = () => { const p = party(); return p.adults + p.teens + p.children; };

  function price() {
    const t = state.tasting, p = party();
    const teen = t.teen_discount_pct == null ? 0 : Math.round(t.price_adult_cents * (100 - t.teen_discount_pct) / 100);
    return p.adults * t.price_adult_cents + p.teens * teen;
  }

  // 1. Tastings
  function renderTastings() {
    const box = $('tastings');
    box.innerHTML = '';
    for (const t of state.config.tastings) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tasting';
      b.setAttribute('aria-pressed', 'false');
      const h = Math.floor(t.duration_min / 60), min = t.duration_min % 60;
      const duration = [h ? `${h} ${h === 1 ? 'ora' : 'ore'}` : '', min ? `${min} minuti` : ''].filter(Boolean).join(' e ');
      const who = t.teen_discount_pct == null ? `solo adulti, da ${t.min_adults} a ${t.max_adults} persone`
        : `ragazzi 13–17 anni sconto ${t.teen_discount_pct}%, bambini 0–12 gratis`;
      b.innerHTML = `<span class="title"><span></span><span class="price"></span></span><p class="meta"></p><p class="desc"></p>`;
      b.querySelector('.title span').textContent = t.name;
      b.querySelector('.price').textContent = `${euro(t.price_adult_cents)} a persona`;
      b.querySelector('.meta').textContent = `Durata ${duration} · ${who}`;
      b.querySelector('.desc').textContent = t.description;
      b.addEventListener('click', () => chooseTasting(t, b));
      box.appendChild(b);
    }
  }

  function chooseTasting(t, button) {
    state.tasting = t;
    for (const b of document.querySelectorAll('.tasting')) b.setAttribute('aria-pressed', String(b === button));
    const adultsOnly = t.teen_discount_pct == null;
    options($('adults'), t.min_adults, t.max_adults, Number($('adults').value) || 2);
    options($('teens'), 0, 10, Number($('teens').value) || 0);
    options($('children'), 0, 10, Number($('children').value) || 0);
    $('teens-field').hidden = adultsOnly;
    $('children-field').hidden = adultsOnly;
    $('party-hint').textContent = adultsOnly
      ? `${t.name} è riservata agli adulti: da ${t.min_adults} a ${t.max_adults} persone.`
      : `Adulti da ${t.min_adults} a ${t.max_adults}.`;
    enable('step-party', true);
    enable('step-date', true);
    partyChanged();
  }

  // 2. Party
  function partyChanged() {
    $('total').innerHTML = `Totale: <strong>${euro(price())}</strong> · da pagare in cantina`;
    renderCalendar();
    if (state.date) renderTimes();
  }

  // 3. Calendar
  async function loadMonth(year, month) {
    state.month = { year, month };
    const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    renderCalendar();
    try {
      const { days: list } = await api(`/api/availability?from=${first}&days=${days}`);
      for (const d of list) state.days.set(d.date, d);
    } catch (err) {
      $('calendar').textContent = err.message;
      return;
    }
    if (state.month.year === year && state.month.month === month) renderCalendar();
  }

  function dayStatus(date) {
    const d = state.days.get(date);
    if (!d) return { ok: false, label: 'non disponibile' };
    if (d.closed) return { ok: false, label: `chiuso: ${d.closed}` };
    const best = Math.max(0, ...d.slots.map(s => s.available));
    if (best === 0) return { ok: false, label: 'non disponibile' };
    if (best < guests()) return { ok: false, label: `posti insufficienti per ${guests()} persone` };
    return { ok: true, label: 'posti disponibili' };
  }

  function renderCalendar() {
    if (!state.month) return;
    const { year, month } = state.month;
    $('month-label').textContent = `${MONTHS[month]} ${year}`;
    const today = state.config.today;
    const [ty, tm] = today.split('-').map(Number);
    $('prev-month').disabled = year < ty || (year === ty && month <= tm - 1);
    const last = new Date(Date.parse(`${today}T00:00:00Z`) + state.config.horizonDays * 86_400_000);
    $('next-month').disabled = year > last.getUTCFullYear() || (year === last.getUTCFullYear() && month >= last.getUTCMonth());

    const cal = $('calendar');
    cal.innerHTML = '';
    for (const d of DOW) { const el = document.createElement('div'); el.className = 'dow'; el.textContent = d; el.setAttribute('aria-hidden', 'true'); cal.appendChild(el); }
    const firstDow = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
    for (let i = 0; i < firstDow; i++) { const el = document.createElement('div'); el.className = 'day blank'; cal.appendChild(el); }
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let n = 1; n <= days; n++) {
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
      const status = dayStatus(date);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'day';
      b.disabled = !status.ok;
      b.setAttribute('aria-pressed', String(state.date === date));
      b.setAttribute('aria-label', `${longDate(date)}: ${status.label}`);
      b.innerHTML = `<span>${n}</span>${status.ok ? '<span class="dot" aria-hidden="true">●</span>' : ''}`;
      b.addEventListener('click', () => chooseDate(date));
      cal.appendChild(b);
    }
    if (state.date && !dayStatus(state.date).ok) { state.date = null; state.time = null; renderTimes(); }
  }

  function chooseDate(date) {
    state.date = date;
    state.time = null;
    renderCalendar();
    renderTimes();
    enable('step-time', true);
    $('step-time').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // 4. Times
  function renderTimes() {
    const box = $('times');
    box.innerHTML = '';
    if (!state.date) { $('time-hint').textContent = 'Scegli prima il giorno.'; enable('step-time', false); enable('step-details', false); return; }
    $('time-hint').textContent = longDate(state.date);
    for (const s of state.days.get(state.date)?.slots ?? []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'time';
      b.disabled = s.available < guests();
      b.setAttribute('aria-pressed', String(state.time === s.time));
      b.innerHTML = `<strong>${s.time}</strong><span>${s.available === 0 ? 'completo' : s.available < guests() ? 'posti insufficienti' : `${s.available} posti liberi`}</span>`;
      b.addEventListener('click', () => {
        state.time = s.time;
        renderTimes();
        enable('step-details', true);
        $('step-details').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      box.appendChild(b);
    }
    if (state.time && !(state.days.get(state.date)?.slots ?? []).some(s => s.time === state.time && s.available >= guests())) state.time = null;
    enable('step-details', Boolean(state.time));
  }

  // 5. Submit
  function showMessage(text, kind = 'error') {
    $('form-message').innerHTML = text ? `<p class="message ${kind}"></p>` : '';
    if (text) $('form-message').firstChild.textContent = text;
  }

  async function submit(e) {
    e.preventDefault();
    showMessage('');
    const missing = ['name', 'email', 'phone'].find(id => !$(id).value.trim());
    if (missing) { showMessage('Compila nome, email e telefono.'); $(missing).focus(); return; }
    if (!$('privacy').checked) { showMessage('Per prenotare serve il consenso al trattamento dei dati.'); return; }
    if (state.config.turnstileSiteKey && !state.turnstileToken) { showMessage('Attendi la verifica anti-spam, poi riprova.'); return; }
    $('submit').disabled = true;
    try {
      const { token } = await api('/api/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tasting: state.tasting.id, date: state.date, time: state.time, ...party(),
          name: $('name').value, email: $('email').value, phone: $('phone').value, notes: $('notes').value,
          privacy: true, turnstileToken: state.turnstileToken,
        }),
      });
      location.href = `/prenotazione?t=${token}&nuova=1`;
    } catch (err) {
      showMessage(err.message);
      $('submit').disabled = false;
      if (window.turnstile) { window.turnstile.reset(); state.turnstileToken = null; }
      state.days.clear();
      loadMonth(state.month.year, state.month.month).then(renderTimes);
    }
  }

  function loadTurnstile(siteKey) {
    window.onTurnstileLoad = () => window.turnstile.render('#turnstile', {
      sitekey: siteKey, language: 'it',
      callback: token => { state.turnstileToken = token; },
      'expired-callback': () => { state.turnstileToken = null; },
    });
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
    s.async = true;
    document.head.appendChild(s);
  }

  async function start() {
    try {
      state.config = await api('/api/tastings');
    } catch (err) {
      $('tastings').textContent = err.message;
      return;
    }
    renderTastings();
    for (const id of ['adults', 'teens', 'children']) $(id).addEventListener('change', partyChanged);
    $('prev-month').addEventListener('click', () => { const { year, month } = state.month; loadMonth(month ? year : year - 1, month ? month - 1 : 11); });
    $('next-month').addEventListener('click', () => { const { year, month } = state.month; loadMonth(month === 11 ? year + 1 : year, (month + 1) % 12); });
    $('booking').addEventListener('submit', submit);
    const [y, m] = state.config.today.split('-').map(Number);
    loadMonth(y, m - 1);
    if (state.config.turnstileSiteKey) loadTurnstile(state.config.turnstileSiteKey);
  }

  start();
})();
