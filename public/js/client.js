// SanoLicores — Clientes: buscador, formulario, ficha (compras, fiado, envases prestados, puntos) y tarjeta digital
import { store, clientBadge, SEX } from './store.js';
import { saveClient, setClientActive, renewCardCode, cardUrl, payBalance, adjustPoints, receiveEmpties, markNotified } from './ops.js';
import { CLIENT_TYPES, productLine, searchText, catIcon } from './licor.js';
import { openModal, esc, usd, toast, setBusy, fmtDate, fmtDateTime, loc, normalize, debounce, initials, colorFor, confirmDialog, emptyState, printHTML, num, parseNum } from './utils.js';
import { icon } from './icons.js';
import { qrDataURL, waClient, printReceipt, PRINT_HEAD } from './shared.js';
import { requirePin } from './auth.js';

const nav = async (route, params = {}) => { const { navigate } = await import('./main.js'); navigate(route, { params, force: true }); };

export function avatar(c, size = '') { return `<span class="avatar ${size}" style="background:${colorFor(c?.name)}">${esc(initials(c?.name))}</span>`; }
export function hydratePhotos() {}
export const clientLine = (c) => {
  const bits = [];
  if (c?.type === 'mayor') bits.push(c.business ? `al mayor · ${c.business}` : 'al mayor');
  const d = store.daysAway(c);
  if (d == null) bits.push('sin compras aún');
  else bits.push(d === 0 ? 'compró hoy' : d === 1 ? 'compró ayer' : `última compra hace ${d} días`);
  return esc(bits.join(' · '));
};
/** Etiquetas importantes: al mayor, fiado y envases prestados */
export function alertsHTML(c) {
  if (!c) return '';
  const owed = store.emptiesOwed(c);
  const bits = [
    c.type === 'mayor' ? `<span class="badge badge-violet">${icon('crate')} Al mayor</span>` : '',
    (Number(c.balance) || 0) > 0.009 ? `<span class="badge badge-danger">Fiado ${usd(c.balance)}</span>` : '',
    ...owed.map((x) => `<span class="badge badge-warning">${icon('rotate')} Debe ${x.n} ${esc(x.c?.short || x.c?.name || 'envases')}</span>`)
  ].filter(Boolean);
  return bits.length ? `<div class="row row-wrap" style="gap:4px">${bits.join('')}</div>` : '';
}
export function pointsHTML(c) {
  const L = store.loyalty;
  if (!L?.enabled) return '';
  const pts = Math.floor(Number(c?.points) || 0);
  return `<span class="badge badge-violet">${icon('star')} ${pts} pts${L.pointValue ? ` · ${usd(pts * L.pointValue)}` : ''}</span>`;
}

// ======================================================================
// BUSCAR / ELEGIR CLIENTE
// ======================================================================
export function pickClient({ title = 'Buscar cliente', allowNew = true } = {}) {
  return new Promise((resolve) => {
    let picked = null;
    const m = openModal({
      title, size: 'md',
      body: `<div class="stack"><label class="search search-big">${icon('search')}<input data-q placeholder="Nombre, cédula, teléfono, negocio o N° de cliente…" autocomplete="off" autofocus></label><div class="pick-list" data-l></div></div>`,
      footer: `${allowNew ? `<button class="btn btn-secondary" data-new style="margin-right:auto">${icon('userPlus')} Cliente nuevo</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button>`,
      onClose: () => resolve(picked)
    });
    const draw = (q = '') => {
      const t = normalize(q); const d = q.replace(/\D/g, '');
      const list = store.clients.filter((x) => x.active !== false && (!t || normalize(`${x.name} ${x.number || ''} ${x.idDoc || ''} ${x.business || ''}`).includes(t) || (d.length >= 3 && (String(x.phone || '').replace(/\D/g, '').includes(d) || String(x.idDoc || '').replace(/\D/g, '').includes(d))))).slice(0, 40);
      m.el.querySelector('[data-l]').innerHTML = list.length ? list.map((x) => `<button type="button" class="list-item" data-id="${x.id}">${avatar(x)}<div class="grow" style="min-width:0"><b class="ellipsis">${esc(x.name)}</b><div class="t-sub">${esc(x.number)}${x.idDoc ? ' · ' + esc(x.idDoc) : ''}${x.phone ? ' · ' + esc(x.phone) : ''}</div>${alertsHTML(x)}</div>${clientBadge(store.clientStatus(x))}</button>`).join('')
        : emptyState('users', t ? 'Sin resultados' : 'Aún no hay clientes', allowNew ? 'Regístralo con “Cliente nuevo”.' : '');
      m.el.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { picked = store.client(b.dataset.id); m.close(); });
    };
    m.el.querySelector('[data-q]').oninput = debounce((e) => draw(e.target.value), 80);
    m.el.querySelector('[data-q]').onkeydown = (e) => { if (e.key === 'Enter') { const f = store.findClient(e.target.value); if (f) { picked = f; m.close(); } } };
    const nb = m.el.querySelector('[data-new]');
    if (nb) nb.onclick = async () => { const q = m.el.querySelector('[data-q]').value.trim(); const isNum = /\d{6,}/.test(q); const r = await clientForm(null, { name: isNum ? '' : q, idDoc: isNum ? q : '' }); if (r) { picked = r; m.close(); } };
    draw();
  });
}

// ======================================================================
// FORMULARIO DEL CLIENTE
// ======================================================================
export function clientForm(client = null, preset = {}) {
  const x = { type: 'detal', ...preset, ...(client || {}) };
  return new Promise((resolve) => {
    let saved = null;
    const m = openModal({
      title: client ? 'Editar cliente' : 'Nuevo cliente', sub: client ? esc(client.number) : 'Con nombre y teléfono basta. Los clientes “al mayor” pagan el precio al mayor.', size: 'lg',
      body: `<form data-f autocomplete="off">
        <div class="seg seg-block" data-type>${Object.entries(CLIENT_TYPES).map(([k, v]) => `<button type="button" data-v="${k}" class="${x.type === k ? 'on' : ''}">${k === 'mayor' ? icon('crate') : icon('user')} ${v.label}</button>`).join('')}</div>
        <div class="hint mt-xs" data-type-hint>${esc(CLIENT_TYPES[x.type]?.hint || 'Cliente de mostrador: paga el precio normal.')}</div>
        <div class="form-grid mt">
          <div class="field full"><label>Nombre y apellido *</label><input class="input" name="name" value="${esc(x.name || '')}" autofocus></div>
          <div class="field" data-biz><label>Negocio</label><input class="input" name="business" value="${esc(x.business || '')}" placeholder="Ej.: Bodega La Esquina, Bar El Tambor"></div>
          <div class="field"><label>${esc(loc().id)}</label><input class="input" name="idDoc" value="${esc(x.idDoc || '')}" placeholder="Opcional"></div>
          <div class="field"><label>Teléfono / WhatsApp</label><input class="input" name="phone" inputmode="tel" value="${esc(x.phone || '')}" placeholder="Para promociones y recordatorios"></div>
          <div class="field"><label>Fecha de nacimiento</label><input class="input" type="date" name="birthDate" value="${esc(x.birthDate || '')}"></div>
          <div class="field"><label>Sexo</label><select class="select" name="sex"><option value="">—</option>${Object.entries(SEX).map(([k, v]) => `<option value="${k}" ${x.sex === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>Límite de fiado</label><input class="input" name="creditLimit" inputmode="decimal" value="${x.creditLimit ? num(x.creditLimit) : ''}" placeholder="0 = sin límite"><span class="hint">Hasta cuánto se le puede fiar.</span></div>
          <div class="field"><label>Correo</label><input class="input" name="email" inputmode="email" value="${esc(x.email || '')}"></div>
          <div class="field full"><label>Dirección (para delivery)</label><input class="input" name="address" value="${esc(x.address || '')}"></div>
          <div class="field full"><label>Lo que suele llevar</label><input class="input" name="favorite" value="${esc(x.favorite || '')}" placeholder="Ej.: caja de Polar Pilsen fría los viernes, Ron Cacique 500"></div>
          <div class="field full"><label>Notas</label><input class="input" name="notes" value="${esc(x.notes || '')}" placeholder="Ej.: paga por pago móvil; recoge su hermano"></div>
        </div>
        <div class="error-msg mt" data-err></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} ${client ? 'Guardar' : 'Registrar cliente'}</button>`,
      onClose: () => resolve(saved)
    });
    const F = m.el.querySelector('[data-f]').elements;
    let type = x.type === 'mayor' ? 'mayor' : 'detal';
    const syncType = () => {
      m.el.querySelectorAll('[data-type] [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === type));
      m.el.querySelector('[data-type-hint]').textContent = CLIENT_TYPES[type]?.hint || 'Cliente de mostrador: paga el precio normal.';
      m.el.querySelector('[data-biz]').hidden = type !== 'mayor';
    };
    m.el.querySelectorAll('[data-type] [data-v]').forEach((b) => b.onclick = () => { type = b.dataset.v; syncType(); });
    syncType();
    m.el.querySelector('[data-f]').onsubmit = (e) => { e.preventDefault(); m.el.querySelector('[data-ok]').click(); };
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      const err = m.el.querySelector('[data-err]'); err.textContent = '';
      if (!F.name.value.trim()) { err.textContent = 'Escribe el nombre del cliente.'; F.name.focus(); return; }
      const btn = e.currentTarget; setBusy(btn, true, 'Guardando…');
      const data = { name: F.name.value, type, business: type === 'mayor' ? F.business.value : '', idDoc: F.idDoc.value, phone: F.phone.value, birthDate: F.birthDate.value, sex: F.sex.value, address: F.address.value, creditLimit: parseNum(F.creditLimit.value), email: F.email.value, favorite: F.favorite.value, notes: F.notes.value };
      try {
        saved = await saveClient(data, client?.id || null);
        m.close();
        toast(client ? 'Cliente actualizado' : `Cliente registrado: ${saved.number}`);
      } catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
    };
  });
}

/** Busca un producto del inventario (modal). Resuelve con el producto o null. */
export function pickProduct({ title = 'Buscar producto', filter = null } = {}) {
  return new Promise((resolve) => {
    let picked = null;
    const m = openModal({ title, size: 'md', body: `<div class="stack"><label class="search search-big">${icon('search')}<input data-q placeholder="Nombre, tipo, marca o código…" autofocus autocomplete="off"></label><div class="pick-list" data-l></div></div>`, footer: '<button class="btn btn-secondary" data-close>Cancelar</button>', onClose: () => resolve(picked) });
    const draw = (q = '') => {
      const t = normalize(q);
      const exact = store.byBarcode(q);
      const list = (exact ? [exact] : store.products.filter((p) => p.active !== false && (!filter || filter(p)) && (!t || searchText(p).includes(t)))).slice(0, 40);
      m.el.querySelector('[data-l]').innerHTML = list.map((p) => `<button type="button" class="list-item" data-id="${p.id}"><span class="kpi-icon tone-brand" style="width:36px;height:36px">${icon(catIcon(p.category))}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(p.name)}</b><div class="t-sub ellipsis">${esc(productLine(p))}</div></div><b class="num">${usd(p.price)}</b></button>`).join('') || emptyState('box', 'Sin resultados');
      m.el.querySelectorAll('[data-id]').forEach((b) => b.onclick = () => { picked = store.product(b.dataset.id); m.close(); });
    };
    m.el.querySelector('[data-q]').oninput = debounce((e) => draw(e.target.value), 80);
    draw();
  });
}

// ======================================================================
// ENVASES: el cliente devuelve vacíos prestados
// ======================================================================
export function returnEmptiesModal(c0 = null, { mode: mode0 = null } = {}) {
  return new Promise((resolve) => {
    let c = c0; let done = null;
    let mode = mode0 || (c && store.emptiesOwed(c).length ? 'prestados' : 'deposito');
    const m = openModal({
      title: 'Recibir envases vacíos', sub: 'Entran al depósito de vacíos', size: 'md',
      body: `<div class="stack">
        <button type="button" class="btn btn-secondary btn-block" data-c>${icon('user')} <span data-cn>${c ? esc(c.name) : 'Elegir cliente'}</span></button>
        <div class="seg seg-block" data-mode><button type="button" data-v="prestados">Devuelve lo que se le prestó</button><button type="button" data-v="deposito">Se le devuelve el depósito</button></div>
        <div data-rows></div><div class="box small" data-sum></div><div class="error-msg" data-err></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Recibir</button>`,
      onClose: () => resolve(done)
    });
    const q = (s) => m.el.querySelector(s);
    const val = {};
    const paint = () => {
      m.el.querySelectorAll('[data-mode] [data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
      const owed = c ? Object.fromEntries(store.emptiesOwed(c).map((x) => [x.id, x.n])) : {};
      q('[data-rows]').innerHTML = store.containers.length ? `<div class="list">${store.containers.map((ct) => `<div class="list-item"><span class="kpi-icon tone-brand" style="width:34px;height:34px">${icon(ct.id === 'gav' ? 'crate' : 'bottle')}</span><div class="grow" style="min-width:0"><b>${esc(ct.name)}</b><div class="t-sub">depósito ${usd(ct.deposit)}${mode === 'prestados' && c ? ` · debe <b>${owed[ct.id] || 0}</b>` : ''}</div></div><input class="input input-sm r" style="width:90px" inputmode="numeric" data-ct="${ct.id}" value="${val[ct.id] ?? ''}" placeholder="0"></div>`).join('')}</div>` : emptyState('rotate', 'Sin envases configurados', 'Agrégalos en Configuración → Envases.');
      m.el.querySelectorAll('[data-ct]').forEach((i) => i.oninput = () => { val[i.dataset.ct] = i.value; sum(); });
      sum();
    };
    const sum = () => {
      const n = Object.values(val).reduce((a, v) => a + (Math.round(parseNum(v)) || 0), 0);
      const money = Object.entries(val).reduce((a, [id, v]) => a + (Math.round(parseNum(v)) || 0) * (Number(store.container(id)?.deposit) || 0), 0);
      q('[data-sum]').innerHTML = mode === 'deposito' ? `${n} envase(s) · se devuelven <b>${usd(money)}</b> de la caja` : `${n} envase(s) se descuentan de lo que ${c ? esc(c.name.split(' ')[0]) : 'el cliente'} tiene prestado`;
    };
    m.el.querySelectorAll('[data-mode] [data-v]').forEach((b) => b.onclick = () => { mode = b.dataset.v; paint(); });
    q('[data-c]').onclick = async () => { const p = await pickClient({ title: '¿Quién trae los envases?' }); if (p) { c = p; q('[data-cn]').textContent = p.name; if (store.emptiesOwed(p).length) mode = 'prestados'; paint(); } };
    paint();
    q('[data-ok]').onclick = async (e) => {
      const items = Object.fromEntries(Object.entries(val).map(([k, v]) => [k, Math.round(parseNum(v)) || 0]));
      if (mode === 'deposito' && Object.values(items).some((n) => n > 0) && !(await requirePin('Devolver depósito de envases'))) return;
      setBusy(e.currentTarget, true);
      try {
        done = await receiveEmpties({ client: c ? store.client(c.id) || c : null, items, mode });
        m.close(); toast(done.refund ? `Envases recibidos · devuelto ${usd(done.refund)}` : 'Envases recibidos');
      } catch (ex) { q('[data-err]').textContent = ex.message; setBusy(e.currentTarget, false); }
    };
  });
}

// ======================================================================
// FICHA DEL CLIENTE
// ======================================================================
const TABS = { resumen: 'Resumen', compras: 'Compras', envases: 'Envases' };
export async function openClient(id, { tab = 'resumen' } = {}) {
  let cl = store.client(id) || await store.getClient(id);
  if (!cl) { toast('Cliente no encontrado', 'warning'); return; }
  const cache = {};
  const m = openModal({ title: '', size: 'xl', body: '<div data-root></div>' });
  m.el.querySelector('.modal').classList.add('member-modal');
  const root = m.el.querySelector('[data-root]');
  const load = async (k, fn) => (cache[k] ??= await fn().catch((e) => { console.error(e); return []; }));
  const off = store.on('clients', () => { const n = store.client(id); if (n) { cl = n; cache.empties = null; header(); draw(); } });
  const close0 = m.close; m.close = () => { off(); close0(); };

  root.innerHTML = `<div data-head></div><div class="tabs mt" data-tabs>${Object.entries(TABS).map(([k, v]) => `<button data-t="${k}">${v}</button>`).join('')}</div><div data-body class="mt"></div>`;
  const $ = (q) => root.querySelector(q);

  function header() {
    const st = store.clientStatus(cl);
    const bal = Number(cl.balance) || 0;
    const owed = store.emptiesOwed(cl);
    $('[data-head]').innerHTML = `<div class="mhead">
      ${avatar(cl, 'avatar-xl')}
      <div class="grow" style="min-width:0">
        <div class="row row-wrap"><h2 class="mhead-name">${esc(cl.name)}</h2>${clientBadge(st)}${pointsHTML(cl)}</div>
        <div class="t-sub">${esc(cl.number)}${cl.idDoc ? ` · ${esc(loc().id)} ${esc(cl.idDoc)}` : ''}${cl.phone ? ` · ${esc(cl.phone)}` : ''}${cl.sex ? ` · ${SEX[cl.sex]}` : ''}</div>
        <div class="small mt">${clientLine(cl)}</div>
        ${alertsHTML(cl) ? `<div class="mt-xs">${alertsHTML(cl)}</div>` : ''}
      </div>
      <button class="x-btn" data-x aria-label="Cerrar">${icon('x')}</button>
    </div>
    <div class="mactions">
      <button class="btn btn-primary" data-a="sell">${icon('cart')} Vender</button>
      ${bal > 0.009 ? `<button class="btn btn-secondary" data-a="debt">${icon('dollar')} Cobrar fiado</button>` : ''}
      ${owed.length ? `<button class="btn btn-secondary" data-a="emp">${icon('rotate')} Recibir envases</button>` : ''}
      <button class="btn btn-secondary" data-a="card">${icon('qr')} Tarjeta</button>
      <button class="btn btn-whatsapp" data-a="wa">${icon('whatsapp')} WhatsApp</button>
      <button class="btn btn-ghost" data-a="edit">${icon('edit')} Editar</button>
      <button class="btn btn-ghost btn-icon" data-a="more" title="Más opciones">${icon('menu')}</button>
    </div>`;
    $('[data-x]').onclick = () => m.close();
    root.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => action(b.dataset.a));
  }

  async function action(a) {
    if (a === 'sell') { m.close(); nav('vender', { clientId: cl.id }); }
    if (a === 'debt') { await payDebtModal(cl); cache.sales = null; draw(); }
    if (a === 'emp') { if (await returnEmptiesModal(cl, { mode: 'prestados' })) { cache.empties = null; tab = 'envases'; draw(); } }
    if (a === 'card') cardModal(cl);
    if (a === 'edit') { const r = await clientForm(cl); if (r) { cl = { ...cl, ...r }; header(); draw(); } }
    if (a === 'wa') waMenu(cl);
    if (a === 'more') moreMenu();
  }

  function moreMenu() {
    const mm = openModal({
      title: 'Más opciones', sub: esc(cl.name), size: 'sm',
      body: `<div class="list">
        ${store.loyalty.enabled ? `<button class="list-item" data-o="pts">${icon('star')}<div class="grow"><b>Ajustar puntos</b><div class="t-sub">Cortesía o corrección (PIN)</div></div></button>` : ''}
        <button class="list-item" data-o="code">${icon('refresh')}<div class="grow"><b>Nuevo código de tarjeta</b><div class="t-sub">Si compartió su enlace</div></div></button>
        <button class="list-item" data-o="baja">${icon(cl.active === false ? 'unlock' : 'x')}<div class="grow"><b>${cl.active === false ? 'Reactivar cliente' : 'Dar de baja'}</b><div class="t-sub">${cl.active === false ? 'Vuelve a la lista' : 'Se conserva su historial'}</div></div></button>
      </div>`,
      footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
    });
    mm.el.querySelector('[data-o="pts"]')?.addEventListener('click', async () => {
      mm.close();
      if (!(await requirePin('Ajustar puntos'))) return;
      const f = openModal({ title: 'Puntos', sub: esc(cl.name), size: 'sm', body: `<div class="form-grid"><div class="field"><label>Puntos</label><input class="input" type="number" min="0" data-p value="${Math.floor(Number(cl.points) || 0)}"></div><div class="field full"><label>Motivo</label><input class="input" data-why placeholder="Ej.: cortesía"></div></div>`, footer: '<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>' });
      f.el.querySelector('[data-ok]').onclick = async () => { await adjustPoints(cl, f.el.querySelector('[data-p]').value, f.el.querySelector('[data-why]').value); f.close(); toast('Puntos actualizados'); };
    });
    mm.el.querySelector('[data-o="code"]').onclick = async () => {
      mm.close();
      if (!(await confirmDialog({ title: 'Nuevo código de tarjeta', message: 'El enlace anterior de su tarjeta dejará de funcionar.', confirmText: 'Generar' }))) return;
      const code = await renewCardCode(cl); cl = { ...cl, cardCode: code }; toast('Código renovado'); cardModal(cl);
    };
    mm.el.querySelector('[data-o="baja"]').onclick = async () => {
      mm.close();
      if (cl.active === false) { await setClientActive(cl, true); toast('Cliente reactivado'); return; }
      if (!(await confirmDialog({ title: 'Dar de baja', message: `${esc(cl.name)} dejará de aparecer en la lista y en los avisos. Su historial se conserva.`, confirmText: 'Dar de baja', danger: true }))) return;
      await setClientActive(cl, false); toast('Cliente dado de baja', 'warning');
    };
  }

  async function draw() {
    root.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    const body = $('[data-body]');
    body.innerHTML = '<div class="empty"><div class="spinner"></div></div>';
    try { await TAB_RENDER[tab](body); } catch (e) { console.error(e); body.innerHTML = emptyState('alert', 'No se pudo cargar', esc(e.message)); }
  }

  const TAB_RENDER = {
    async resumen(body) {
      const qr = cl.cardCode ? await qrDataURL(cardUrl(cl.cardCode), 3) : '';
      const sales = await load('sales', () => store.clientSales(cl.id));
      const top = {};
      for (const s of sales.filter((x) => x.status !== 'voided' && x.kind === 'venta')) for (const i of s.items || []) if (i.productId) top[i.name] = (top[i.name] || 0) + (Number(i.qty) || 0) * (Number(i.factor) || 1);
      const fav = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const owed = store.emptiesOwed(cl);
      body.innerHTML = `<div class="grid-main">
        <div class="stack">
          <div class="kpis kpis-sm">
            <div class="card kpi"><div class="kpi-label">Compras</div><div class="kpi-value">${cl.visits || 0}</div><div class="kpi-sub">desde ${fmtDate(cl.createdAt)}</div></div>
            <div class="card kpi"><div class="kpi-label">Gasto total</div><div class="kpi-value">${usd(cl.totalSpent || 0)}</div><div class="kpi-sub">${cl.visits ? `ticket promedio ${usd((cl.totalSpent || 0) / cl.visits)}` : '—'}</div></div>
            <div class="card kpi"><div class="kpi-label">Fiado</div><div class="kpi-value ${(Number(cl.balance) || 0) > 0.009 ? 'text-danger' : ''}">${usd(cl.balance || 0)}</div><div class="kpi-sub">${Number(cl.creditLimit) > 0 ? `límite ${usd(cl.creditLimit)}` : 'sin límite'}</div></div>
            <div class="card kpi"><div class="kpi-label">Envases prestados</div><div class="kpi-value">${owed.reduce((a, x) => a + x.n, 0)}</div><div class="kpi-sub">${owed.length ? owed.map((x) => `${x.n} ${esc(x.c?.short || '')}`).join(' · ') : 'ninguno'}</div></div>
          </div>
          <div class="card"><div class="card-title">${icon('star')} Lo que más compra</div>${fav.length ? `<div class="list mt-xs">${fav.map(([n, q]) => `<div class="list-item"><div class="grow">${esc(n)}</div><b class="num">${num(q, 0)} und</b></div>`).join('')}</div>` : '<div class="small muted mt-xs">Aún sin compras.</div>'}${cl.favorite ? `<div class="small mt">${icon('info')} ${esc(cl.favorite)}</div>` : ''}</div>
          <div class="card"><div class="card-title">${icon('info')} Datos</div>
            <div class="kv-grid mt">
              <div class="kv"><span>Tipo</span><b>${esc(CLIENT_TYPES[cl.type]?.label || 'Detal')}${cl.business ? ' · ' + esc(cl.business) : ''}</b></div>
              <div class="kv"><span>Cumpleaños</span><b>${cl.birthDate ? fmtDate(cl.birthDate) : '—'}</b></div>
              ${cl.address ? `<div class="kv kv-1"><span>Dirección</span><b>${esc(cl.address)}</b></div>` : ''}
              ${cl.notes ? `<div class="kv kv-1"><span>Notas</span><b>${esc(cl.notes)}</b></div>` : ''}
            </div></div>
        </div>
        <div class="stack">
          ${store.loyalty.enabled ? `<div class="card"><div class="card-title">${icon('star')} Puntos</div><div class="kpi-value mt">${Math.floor(Number(cl.points) || 0)} <small>pts</small></div><div class="small muted">${store.loyalty.pointValue ? `Equivalen a <b>${usd(Math.floor(Number(cl.points) || 0) * store.loyalty.pointValue)}</b> de descuento` : ''}</div></div>` : ''}
          <div class="card center">${qr ? `<img src="${qr}" class="qr-img" alt="QR">` : ''}<div class="mono small mt-xs">${esc(cl.cardCode || '')}</div><div class="small muted">Tarjeta digital: puntos, fiado y envases</div><button class="btn btn-secondary btn-sm mt" data-card>${icon('whatsapp')} Enviar tarjeta</button></div>
        </div>
      </div>`;
      body.querySelector('[data-card]').onclick = () => waClient('tarjeta', { client: cl });
    },
    async compras(body) {
      const sales = await load('sales', () => store.clientSales(cl.id));
      body.innerHTML = sales.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Documento</th><th>Fecha</th><th>Detalle</th><th class="r">Total</th><th></th></tr></thead><tbody>${sales.map((s) => `<tr style="${s.status === 'voided' ? 'opacity:.5' : ''}"><td><b>${esc(s.number)}</b>${s.status === 'voided' ? ' <span class="badge badge-danger">Anulado</span>' : ''}${s.mayor ? ' <span class="badge badge-violet">Mayor</span>' : ''}</td><td class="small">${fmtDateTime(s.date)}</td><td class="small">${(s.items || []).map((i) => esc(i.name)).join(', ')}</td><td class="r num"><b>${usd(s.total)}</b>${s.credit ? `<div class="t-sub text-danger">fiado ${usd(s.credit)}</div>` : ''}</td><td class="r"><button class="btn btn-ghost btn-icon btn-sm" data-pr="${s.id}">${icon('print')}</button></td></tr>`).join('')}</tbody></table></div>`
        : emptyState('receipt', 'Sin compras registradas');
      body.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => printReceipt(sales.find((s) => s.id === b.dataset.pr)));
    },
    async envases(body) {
      const logs = await load('empties', () => store.clientEmpties(cl.id));
      const owed = store.emptiesOwed(cl);
      const TY = { venta: 'Venta', devuelto: 'Devolvió', deposito: 'Depósito devuelto', anulacion: 'Anulación' };
      body.innerHTML = `<div class="between"><div class="row row-wrap" style="gap:6px">${owed.length ? owed.map((x) => `<span class="badge badge-warning">${icon('rotate')} Debe ${x.n} ${esc(x.c?.name || '')}</span>`).join('') : '<span class="badge badge-success">No debe envases</span>'}</div><button class="btn btn-primary btn-sm" data-ret>${icon('rotate')} Recibir envases</button></div>
        ${logs.length ? `<div class="table-wrap mt"><table class="table"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Envase</th><th class="r">Trajo</th><th class="r">Prestado</th><th class="r">Depósito</th></tr></thead><tbody>${logs.map((l) => `<tr><td class="small nowrap">${fmtDateTime(l.date)}</td><td>${esc(TY[l.type] || l.type)}${l.ref ? ` <span class="t-sub">${esc(l.ref)}</span>` : ''}</td><td>${esc(store.container(l.containerId)?.name || l.containerId)}</td><td class="r num">${l.qty > 0 ? l.qty : '—'}</td><td class="r num ${l.lent > 0 ? 'text-warning' : l.lent < 0 ? 'text-success' : ''}">${l.lent ? (l.lent > 0 ? '+' : '') + l.lent : '—'}</td><td class="r num">${l.deposit ? usd(l.deposit) : l.charged ? `${l.charged} cobrados` : '—'}</td></tr>`).join('')}</tbody></table></div>` : emptyState('rotate', 'Sin movimientos de envases', 'Cuando lleve cerveza o refresco retornable, aquí verás los vacíos que trajo, los cobrados y los prestados.')}`;
      body.querySelector('[data-ret]').onclick = async () => { if (await returnEmptiesModal(cl)) { cache.empties = null; draw(); } };
    }
  };

  root.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  header(); draw();
}

function waMenu(cl) {
  const L = store.loyalty;
  const opts = [
    ['tarjeta', 'Enviar su tarjeta', 'Puntos, fiado y envases'],
    ...(store.settings.shop?.enabled !== false && store.settings.shop?.slug ? [['catalogo', 'Enlace para pedir en línea', 'Catálogo con precios']] : []),
    ...(store.emptiesOwed(cl).length ? [['envases', 'Recordar envases prestados', store.emptiesOwed(cl).map((x) => `${x.n} ${x.c?.short || ''}`).join(', ')]] : []),
    ...((Number(cl.balance) || 0) > 0.009 ? [['deuda', 'Recordar lo fiado', usd(cl.balance)]] : []),
    ...(L.enabled && Number(cl.points) > 0 ? [['puntos', 'Sus puntos', `${Math.floor(cl.points)} pts`]] : []),
    ['volver', 'Promoción para que vuelva', 'Te extrañamos'],
    ['cumple', 'Feliz cumpleaños', 'Con un detalle'],
    ['libre', 'Mensaje libre', 'Escribe lo que quieras']
  ];
  const m = openModal({
    title: 'WhatsApp', sub: esc(cl.name), size: 'sm',
    body: `<div class="list">${opts.map(([k, t, s]) => `<button class="list-item" data-k="${k}">${icon('whatsapp')}<div class="grow"><b>${esc(t)}</b><div class="t-sub">${esc(s)}</div></div></button>`).join('')}</div>`,
    footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
  });
  m.el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
    const k = b.dataset.k; m.close();
    waClient(k, { client: cl });
    if (['volver', 'envases', 'deuda'].includes(k)) markNotified(cl, k).catch(() => {});
  });
}

// ======================================================================
// FIADO Y TARJETA
// ======================================================================
export async function payDebtModal(cl) {
  const { openPay, showPaid } = await import('./pay.js');
  const bal = Number(cl.balance) || 0;
  const out = await openPay({ title: 'Cobrar fiado', sub: esc(cl.name), amount: bal, editable: true, max: bal, onConfirm: async (r) => { const res = await payBalance(cl, { amount: r.amount, payments: r.payments }); if (r.print) printReceipt(res.sale); return res; } });
  if (out) showPaid(out.sale, { title: 'Abono registrado', onPrint: () => printReceipt(out.sale) });
}
export async function cardModal(cl) {
  const qr = await qrDataURL(cardUrl(cl.cardCode), 5);
  const m = openModal({
    title: 'Tarjeta del cliente', sub: esc(cl.name), size: 'sm',
    body: `<div class="center stack" style="align-items:center"><img src="${qr}" class="qr-img lg" alt="QR"><div class="mono small">${esc(cl.cardCode)}</div>${pointsHTML(cl)}
      <div class="small muted">El cliente abre el enlace en su teléfono: ve sus puntos, lo que tenga fiado, los envases en préstamo y el botón para pedir en línea. En el mostrador, escanea su QR para encontrarlo al instante.</div></div>`,
    footer: `<button class="btn btn-secondary" data-copy>${icon('copy')} Copiar</button><button class="btn btn-secondary" data-pr>${icon('print')} Imprimir</button><button class="btn btn-whatsapp" data-wa>${icon('whatsapp')} Enviar</button>`
  });
  m.el.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(cardUrl(cl.cardCode)); toast('Enlace copiado'); } catch (_) { toast(cardUrl(cl.cardCode), 'info', 6000); } };
  m.el.querySelector('[data-pr]').onclick = () => printCard(cl);
  m.el.querySelector('[data-wa]').onclick = () => waClient('tarjeta', { client: cl });
}
/** Tarjeta de cliente tamaño CR80 */
export async function printCard(cl) {
  const qr = await qrDataURL(cardUrl(cl.cardCode), 6);
  printHTML(`<!DOCTYPE html><html><head>${PRINT_HEAD}<title>Tarjeta ${esc(cl.number)}</title><style>
    @page { size: auto; margin: 10mm; } body { font-family: Arial, Helvetica, sans-serif; }
    .card { width: 85.6mm; height: 54mm; border-radius: 3.5mm; overflow: hidden; position: relative; background: linear-gradient(135deg,#5b1027,#1f0710); color: #fff; display: flex; box-shadow: 0 0 0 .2mm #999; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .l { flex: 1; padding: 4mm; display: flex; flex-direction: column; gap: 1.2mm; }
    .brand { font-size: 2.6mm; letter-spacing: .4mm; text-transform: uppercase; color: #fbbf24; font-weight: 700; }
    .shop { font-size: 3.6mm; font-weight: 700; }
    .nm { font-size: 3.9mm; font-weight: 800; line-height: 1.1; margin-top: auto; } .num { font-size: 2.6mm; color: #fde68a; }
    .ic { font-size: 8mm; line-height: 1; }
    .r { width: 30mm; background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1mm; color: #111; }
    .r img { width: 25mm; height: 25mm; } .r small { font-size: 2.1mm; font-family: monospace; }
  </style></head><body>
  <div class="card"><div class="l"><div class="brand">Cliente · SanoLicores</div><div class="shop">${esc(store.businessName)}</div><div class="ic">🥂</div>
    <div class="nm">${esc(cl.name)}</div><div class="num">${esc(cl.number)}${store.settings.phone ? ' · ' + esc(store.settings.phone) : ''}</div></div>
    <div class="r"><img src="${qr}"><small>${esc(cl.cardCode)}</small><small>Tu tarjeta digital</small></div></div>
  </body></html>`);
}
