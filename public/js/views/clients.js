// SanoLicores — Clientes: lista con filtros (frecuentes, al mayor, fiado, envases…), búsqueda, importar y exportar
import { store, clientBadge, CLIENT_STATUS } from '../store.js';
import { saveClient } from '../ops.js';
import { esc, usd, normalize, debounce, emptyState, fmtDate, toast, download, toCSV, parseCSV, openModal, setBusy, todayKey, loc } from '../utils.js';
import { icon } from '../icons.js';
import { avatar, openClient, clientForm, clientLine, alertsHTML, pointsHTML } from '../client.js';

const FILTERS = {
  all: ['Todos', () => true],
  frecuente: ['Frecuentes', (c) => store.clientStatus(c) === 'frecuente'],
  mayor: ['Al mayor', (c) => c.type === 'mayor'],
  envases: ['Deben envases', (c) => store.emptiesOwed(c).length > 0],
  dormido: ['Dejaron de venir', (c) => store.clientStatus(c) === 'dormido'],
  nuevo: ['Nuevos (30 días)', (c) => (c.createdAt || '') >= new Date(Date.now() - 30 * 864e5).toISOString()],
  saldo: ['Con fiado', (c) => (Number(c.balance) || 0) > 0.009],
  inactivo: ['Inactivos', (c) => store.clientStatus(c) === 'inactivo'],
  baja: ['De baja', (c) => c.active === false]
};

export function mount(el) {
  let filter = 'all'; let q = ''; let sort = 'name';
  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Clientes</h1><p class="view-sub" id="c-sub"></p></div>
    <div class="view-actions"><button class="btn btn-secondary" id="c-imp">${icon('upload')} Importar</button><button class="btn btn-secondary" id="c-exp">${icon('download')} Exportar</button><button class="btn btn-primary" id="c-new">${icon('userPlus')} Nuevo cliente</button></div></div>
    <div class="card card-flush">
      <div class="toolbar"><label class="search">${icon('search')}<input id="c-q" placeholder="Nombre, cédula, teléfono, negocio, N° o código de tarjeta…"></label>
        <div class="row" style="gap:6px">
        <select class="select select-sm" id="c-sort" style="width:auto"><option value="name">A–Z</option><option value="recent">Última compra</option><option value="visits">Más compras</option><option value="spent">Más gasto</option><option value="debt">Más fiado</option></select></div></div>
      <div class="chips" id="c-chips" data-tour="filters" style="padding:0 14px 12px"></div>
      <div id="c-list"></div>
    </div>`;
  const $ = (s) => el.querySelector(s);

  const rows = () => {
    const t = normalize(q); const d = q.replace(/\D/g, '');
    const f = FILTERS[filter][1];
    const list = store.clients.filter((c) => (filter === 'baja' ? c.active === false : c.active !== false && f(c))
      && (!t || normalize(`${c.name} ${c.number} ${c.cardCode || ''} ${c.idDoc || ''} ${c.business || ''}`).includes(t) || (d.length >= 3 && (String(c.phone || '').replace(/\D/g, '').includes(d) || String(c.idDoc || '').replace(/\D/g, '').includes(d)))));
    const S = {
      name: (a, b) => a.name.localeCompare(b.name, 'es'),
      recent: (a, b) => (b.lastVisitAt || '').localeCompare(a.lastVisitAt || ''),
      visits: (a, b) => (b.visits || 0) - (a.visits || 0),
      spent: (a, b) => (b.totalSpent || 0) - (a.totalSpent || 0),
      debt: (a, b) => (Number(b.balance) || 0) - (Number(a.balance) || 0)
    };
    return list.sort(S[sort]);
  };

  function draw() {
    const live = store.liveClients.length;
    $('#c-sub').textContent = `${live} cliente(s) · ${store.liveClients.filter(FILTERS.mayor[1]).length} al mayor · fiado ${usd(store.totalDebt)} · ${store.emptyDebtors.length} deben envases`;
    $('#c-chips').innerHTML = Object.entries(FILTERS).map(([k, [l, fn]]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l} <span class="count">${k === 'baja' ? store.clients.filter((c) => c.active === false).length : store.liveClients.filter(fn).length}</span></button>`).join('');
    el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; draw(); });
    const list = rows();
    $('#c-list').innerHTML = list.length ? `<div class="table-wrap"><table class="table table-hover table-cards"><thead><tr><th>Cliente</th><th class="hide-sm">Última compra</th><th class="hide-sm">Fiado y envases</th><th class="r hide-sm">Gasto</th><th class="c">Estado</th></tr></thead><tbody>
      ${list.slice(0, 300).map((c) => `<tr data-id="${c.id}" style="cursor:pointer">
        <td><div class="row">${avatar(c)}<div style="min-width:0"><div class="t-name ellipsis">${esc(c.name)}</div><div class="t-sub">${esc(c.number)}${c.idDoc ? ' · ' + esc(c.idDoc) : ''}${c.phone ? ' · ' + esc(c.phone) : ''}</div></div></div></td>
        <td class="hide-sm small">${clientLine(c)}${c.favorite ? `<div class="t-sub ellipsis">${esc(c.favorite)}</div>` : ''}</td>
        <td class="hide-sm">${alertsHTML(c) || '<span class="faint">—</span>'}</td>
        <td class="r num hide-sm">${usd(c.totalSpent || 0)}<div class="t-sub">${c.visits || 0} compra(s)</div></td>
        <td class="c">${clientBadge(store.clientStatus(c))}</td></tr>`).join('')}
    </tbody></table></div>${list.length > 300 ? `<div class="small muted center" style="padding:10px">Mostrando 300 de ${list.length}. Usa la búsqueda.</div>` : ''}`
      : `<div style="padding:8px 16px 20px">${store.clients.length ? emptyState('users', 'Nadie en este filtro', q ? 'Prueba con otra búsqueda.' : '') : emptyState('users', 'Aún no hay clientes', 'Regístralos al vender o impórtalos desde Excel (CSV).')}</div>`;
    el.querySelectorAll('[data-id]').forEach((r) => r.onclick = () => openClient(r.dataset.id));
  }

  $('#c-q').oninput = debounce((e) => { q = e.target.value; draw(); }, 100);
  $('#c-q').onkeydown = (e) => { if (e.key === 'Enter') { const c = store.findClient(e.target.value); if (c) openClient(c.id); } };
  $('#c-sort').onchange = (e) => { sort = e.target.value; draw(); };
  $('#c-new').onclick = async () => { const c = await clientForm(); if (c) openClient(c.id); };
  $('#c-exp').onclick = () => exportCSV(rows());
  $('#c-imp').onclick = () => importCSV();
  draw();
  return store.on('clients', draw);
}

function exportCSV(list) {
  const t = todayKey();
  const head = ['N°', 'Nombre', 'Tipo', 'Negocio', loc().id, 'Teléfono', 'Correo', 'Nacimiento', 'Sexo', 'Dirección', 'Suele llevar', 'Estado', 'Compras', 'Última compra', 'Puntos', 'Fiado', 'Límite de fiado', 'Envases prestados', 'Gasto total', 'Registro'];
  const data = list.map((c) => {
    return [c.number, c.name, c.type === 'mayor' ? 'Al mayor' : 'Detal', c.business || '', c.idDoc || '', c.phone || '', c.email || '', c.birthDate || '', c.sex || '', c.address || '', c.favorite || '', CLIENT_STATUS[store.clientStatus(c)]?.label || '', c.visits || 0, (c.lastVisitAt || '').slice(0, 10), Math.floor(Number(c.points) || 0), Number(c.balance) || 0, Number(c.creditLimit) || 0, store.emptiesOwed(c).map((x) => `${x.n} ${x.c?.name || ''}`).join('; '), Number(c.totalSpent) || 0, (c.createdAt || '').slice(0, 10)];
  });
  download(`clientes-${t}.csv`, toCSV([head, ...data]), 'text/csv;charset=utf-8');
  toast(`${data.length} cliente(s) exportados`);
}

/** Importa clientes desde CSV (Excel → Guardar como CSV). Detecta columnas por su nombre. */
function importCSV() {
  const m = openModal({
    title: 'Importar clientes', sub: 'Desde Excel o Google Sheets guardado como CSV', size: 'md',
    body: `<div class="stack"><p class="small" style="margin:0">La primera fila debe tener los títulos. Se reconocen: <b>Nombre</b> (obligatorio), <b>Cédula / documento</b>, <b>Teléfono</b>, <b>Correo</b>, <b>Dirección</b>, <b>Negocio</b>, <b>Tipo</b> (detal / mayor), <b>Nacimiento</b> (AAAA-MM-DD o DD/MM/AAAA), <b>Notas</b>. Los teléfonos repetidos se omiten.</p>
      <input type="file" accept=".csv,text/csv" class="input" data-file><div data-prev></div><div class="error-msg" data-err></div></div>`,
    footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok disabled>${icon('upload')} Importar</button>`
  });
  let parsed = [];
  const pick = (h, ...keys) => h.findIndex((x) => keys.some((k) => normalize(x).includes(k)));
  const toDate = (v) => {
    const s = String(v || '').trim(); if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
    if (!d) return '';
    const y = d[3].length === 2 ? (Number(d[3]) > 30 ? '19' : '20') + d[3] : d[3];
    return `${y}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  };
  m.el.querySelector('[data-file]').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rowsIn = parseCSV(await f.text()).filter((r) => r.some((x) => String(x).trim()));
    const h = rowsIn.shift() || [];
    const ix = { idDoc: pick(h, 'cedula', 'documento', 'dni', 'rut', 'ci', 'curp'), address: pick(h, 'direccion'), business: pick(h, 'negocio', 'empresa', 'comercio'), type: pick(h, 'tipo'), name: pick(h, 'nombre', 'name', 'cliente', 'cliente'), phone: pick(h, 'telefono', 'celular', 'whatsapp', 'movil', 'phone'), email: pick(h, 'correo', 'email', 'mail'), birthDate: pick(h, 'nacimiento', 'fecha nac', 'cumple', 'birth'), notes: pick(h, 'nota', 'observ') };
    if (ix.name < 0) { m.el.querySelector('[data-err]').textContent = 'No encontré una columna “Nombre”.'; return; }
    const seen = new Set();
    parsed = rowsIn.map((r) => {
      const g = (k) => (ix[k] >= 0 ? String(r[ix[k]] ?? '').trim() : '');
      return { name: g('name'), idDoc: g('idDoc'), address: g('address'), business: g('business'), type: /mayor/i.test(g('type')) || g('business') ? 'mayor' : 'detal', phone: g('phone'), email: g('email'), birthDate: toDate(g('birthDate')), notes: g('notes') };
    }).filter((x) => {
      if (!x.name) return false;
      const k = x.phone.replace(/\D/g, '').slice(-8);
      if (k.length >= 7) { if (seen.has(k) || store.findByPhone(x.phone)) return false; seen.add(k); }
      return true;
    });
    m.el.querySelector('[data-prev]').innerHTML = `<div class="box small"><b>${parsed.length}</b> cliente(s) nuevos listos para importar${rowsIn.length - parsed.length ? ` · ${rowsIn.length - parsed.length} omitido(s) por estar repetidos o sin nombre` : ''}.<div class="t-sub mt-xs">${parsed.slice(0, 4).map((x) => esc(x.name)).join(' · ')}${parsed.length > 4 ? '…' : ''}</div></div>`;
    m.el.querySelector('[data-ok]').disabled = !parsed.length;
  };
  m.el.querySelector('[data-ok]').onclick = async (e) => {
    const btn = e.currentTarget; setBusy(btn, true, 'Importando…');
    let ok = 0;
    for (const x of parsed) {
      try { await saveClient(x); ok++; btn.textContent = `Importando ${ok}/${parsed.length}…`; } catch (err) { console.warn(err.message); }
    }
    m.close(); toast(`${ok} cliente(s) importados`);
  };
}
