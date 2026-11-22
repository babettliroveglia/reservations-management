// The guest's own booking: /prenotazione?t=<token>. Shows the details and lets them cancel.
(() => {
  const box = document.getElementById('booking');
  const params = new URLSearchParams(location.search);
  const token = params.get('t') ?? '';
  const isNew = params.has('nuova');
  const euro = cents => (cents / 100).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: cents % 100 ? 2 : 0 });
  const longDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const el = (tag, attrs = {}, text) => { const e = Object.assign(document.createElement(tag), attrs); if (text != null) e.textContent = text; return e; };

  // The link without "nuova", so a reload doesn't show "booking confirmed" again.
  if (isNew) history.replaceState(null, '', `/prenotazione?t=${token}`);
  const link = `${location.origin}/prenotazione?t=${token}`;

  function render(b) {
    box.innerHTML = '';
    const cancelled = b.status === 'cancelled';
    document.getElementById('title').textContent = cancelled ? 'Prenotazione annullata' : isNew ? 'Prenotazione confermata' : 'La tua prenotazione';
    if (cancelled) box.appendChild(el('p', { className: 'message error' }, 'Questa prenotazione è stata annullata.'));
    else if (isNew) box.appendChild(el('p', { className: 'message ok' }, 'Grazie! La tua prenotazione è confermata.'));

    const people = [`${b.adults} ${b.adults === 1 ? 'adulto' : 'adulti'}`];
    if (b.teens) people.push(`${b.teens} ${b.teens === 1 ? 'ragazzo' : 'ragazzi'} (13–17)`);
    if (b.children) people.push(`${b.children} ${b.children === 1 ? 'bambino' : 'bambini'} (0–12)`);
    const dl = el('dl', { className: 'summary' });
    for (const [k, v] of [
      ['Degustazione', b.tasting], ['Giorno', longDate(b.date)], ['Orario', b.time], ['Persone', people.join(', ')],
      ['Totale', `${euro(b.price_cents)}, da pagare in cantina`], ['Nome', b.name], ['Email', b.email], ['Telefono', b.phone],
      ...(b.notes ? [['Note', b.notes]] : []),
    ]) { dl.appendChild(el('dt', {}, k)); dl.appendChild(el('dd', {}, v)); }
    box.appendChild(dl);

    if (!cancelled) {
      const notice = el('div', { className: 'notice' });
      notice.appendChild(el('p', { style: 'margin:0' }, 'Conserva questo link: serve per rivedere o annullare la prenotazione.'));
      const copy = el('div', { className: 'copy' });
      const input = el('input', { type: 'text', readOnly: true, value: link, ariaLabel: 'Link della prenotazione' });
      const btn = el('button', { type: 'button', className: 'btn secondary' }, 'Copia');
      btn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(link); btn.textContent = 'Copiato'; } catch { input.select(); }
      });
      copy.append(input, btn);
      notice.appendChild(copy);
      box.appendChild(notice);
    }

    if (b.cancellable) {
      const p = el('p', { style: 'margin-top:20px' });
      const cancel = el('button', { type: 'button', className: 'btn secondary', id: 'cancel' }, 'Annulla la prenotazione');
      cancel.addEventListener('click', () => confirmCancel(p, cancel));
      p.appendChild(cancel);
      box.appendChild(p);
    }
  }

  function confirmCancel(p, cancel) {
    cancel.remove();
    p.appendChild(el('span', {}, 'Vuoi davvero annullare? '));
    const yes = el('button', { type: 'button', className: 'btn', id: 'confirm-cancel' }, 'Sì, annulla');
    const no = el('button', { type: 'button', className: 'btn secondary', style: 'margin-left:8px' }, 'No');
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      const res = await fetch(`/api/bookings/${token}/cancel`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) render(body);
      else { p.textContent = body.error || 'Errore. Riprova.'; p.className = 'message error'; }
    });
    no.addEventListener('click', () => load());
    p.append(yes, no);
  }

  async function load() {
    if (!/^[0-9a-f]{32}$/.test(token)) { showNotFound(); return; }
    const res = await fetch(`/api/bookings/${token}`);
    if (res.status === 404) { showNotFound(); return; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { box.textContent = body.error || 'Errore. Riprova.'; return; }
    render(body);
  }

  function showNotFound() {
    document.getElementById('title').textContent = 'Prenotazione non trovata';
    box.innerHTML = '';
    box.appendChild(el('p', {}, 'Il link non è valido o è incompleto. Controlla di averlo copiato per intero, oppure scrivici a visit@tenutaroveglia.it.'));
  }

  load();
})();
