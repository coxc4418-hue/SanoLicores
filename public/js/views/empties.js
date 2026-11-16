// SanoLicores — Envases retornables: vacíos en depósito, prestados a clientes, entregas al proveedor y movimientos
import { store } from '../store.js';
import { emptiesToSupplier, countEmpties, markNotified } from '../ops.js';
import { esc, usd, emptyState, fmtDateTime, toast, openModal, setBusy, parseNum, addDays, startOfDay, endOfDay } from '../utils.js';
import { icon } from '../icons.js';
import { avatar, openClient, returnEmptiesModal } from '../client.js';
import { waClient, printDoc } from '../shared.js';
import { requirePin } from '../auth.js';

const TABS = { deposito: 'Vacíos en depósito', prestados: 'Prestados a clientes', movimientos: 'Movimientos' };
const TYPE = { venta: ['Venta', 'brand'], devuelto: ['Cliente devolvió', 'success'], deposito: ['Depósito devuelto', 'warning'], proveedor: ['Entregados al proveedor', 'info'], conteo: ['Conteo físico', 'neutral'], anulacion: ['Anulación', 'danger'] };
const ic = (c) => (/gaver|caja/i.test(c?.name || '') ? 'crate' : 'bottle');

export function mount(el, { navigate, params = {} }) {
  let tab = TABS[params.tab] ? params.tab : 'deposito';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Envases retornables</h1><p class="view-sub">Botellas y gaveras: lo que entra al vender, lo que se presta, lo que devuelves al proveedor. Nada se pierde.</p></div>
      <div class="view-actions"><button class="btn btn-secondary" id="e-cfg">${icon('settings')} Tipos y depósito</button><button class="btn btn-primary" id="e-in">${icon('rotate')} Recibir vacíos</button></div></div>
    <div class="tabs" id="e-tabs">${Object.entries(TABS).map(([k, v]) => `<button data-t="${k}">${v}<span class="tab-n" data-n="${k}" hidden></span></button>`).join('')}</div>
    <div id="e-body" class="mt"></div>`;
  const $ = (s) => el.querySelector(s);
  const set = (k, n) => { const b = el.querySelector(`[data-n="${k}"]`); if (b) { b.hidden = !n; b.textContent = n; } };

  function draw() {
    el.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    set('prestados', store.emptyDebtors.length);
    ({ deposito, prestados, movimientos })[tab]();
  }

  function deposito() {
    const C = store.containers;
    const lent = store.totalLent;
    if (!C.length) { $('#e-body').innerHTML = emptyState('rotate', 'Sin envases configurados', 'Agrega los tipos de envase retornable (botella 1/3, botella 1 L, gavera…) en Configuración → Envases.'); return; }
    const value = C.reduce((a, c) => a + store.emptiesStock(c.id) * (Number(c.deposit) || 0), 0);
    $('#e-body').innerHTML = `<div class="kpis kpis-sm">${C.map((c) => `<div class="card kpi"><div class="kpi-top"><span class="kpi-label">${esc(c.name)}</span><span class="kpi-icon tone-brand">${icon(ic(c))}</span></div><div class="kpi-value">${store.emptiesStock(c.id)}</div><div class="kpi-sub">en depósito · ${usd((Number(c.deposit) || 0))} c/u${lent[c.id] ? ` · <span class="text-warning">${lent[c.id]} prestados</span>` : ''}</div></div>`).join('')}</div>
      <div class="card mt"><div class="between emp-value"><div><b>Valor de los vacíos en depósito: ${usd(value)}</b><div class="small muted">Es plata que tienes en botellas: entrégalos al proveedor cuando te traiga la mercancía.</div></div>
        <div class="row row-wrap" style="gap:6px"><button class="btn btn-secondary btn-sm" id="e-sup">${icon('truck')} Entregar al proveedor</button><button class="btn btn-secondary btn-sm" id="e-count">${icon('clipboard')} Conteo</button><button class="btn btn-ghost btn-sm" id="e-print">${icon('print')} Imprimir</button></div></div></div>
      <div class="card mt"><div class="small muted">${icon('info')} Cómo funciona: al vender un producto retornable, la caja pregunta cuántos vacíos trae el cliente. Los que trae entran aquí; los que faltan se cobran como depósito o se le prestan (quedan en su cuenta hasta que los devuelva).</div></div>`;
    $('#e-sup').onclick = supplierModal;
    $('#e-count').onclick = countModal;
    $('#e-print').onclick = () => printDoc('Envases retornables', `<table><thead><tr><th>Envase</th><th class="r">En depósito</th><th class="r">Prestados</th><th class="r">Depósito c/u</th><th class="r">Valor en depósito</th></tr></thead><tbody>${C.map((c) => `<tr><td>${esc(c.name)}</td><td class="r">${store.emptiesStock(c.id)}</td><td class="r">${lent[c.id] || 0}</td><td class="r">${usd(c.deposit)}</td><td class="r">${usd(store.emptiesStock(c.id) * (Number(c.deposit) || 0))}</td></tr>`).join('')}</tbody></table>
      <h2>Clientes con envases prestados</h2><table><thead><tr><th>Cliente</th><th>Teléfono</th><th>Debe</th></tr></thead><tbody>${store.emptyDebtors.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.phone || '')}</td><td>${store.emptiesOwed(x).map((o) => `${o.n} ${esc(o.c?.name || '')}`).join(', ')}</td></tr>`).join('')}</tbody></table>`);
  }

  function prestados() {
    const list = store.emptyDebtors.sort((a, b) => store.emptiesOwed(b).reduce((s, x) => s + x.n, 0) - store.emptiesOwed(a).reduce((s, x) => s + x.n, 0));
    $('#e-body').innerHTML = list.length ? `<div class="card"><div class="list">${list.map((c) => `<div class="list-item">${avatar(c)}<div class="grow" style="min-width:0"><button class="linkish" data-c="${c.id}"><b>${esc(c.name)}</b></button><div class="t-sub">${store.emptiesOwed(c).map((x) => `${x.n} ${esc(x.c?.name || '')}`).join(' · ')}${c.notified?.envases ? ` · recordado ${fmtDateTime(c.notified.envases)}` : ''}</div></div>
        ${c.phone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${c.id}" title="Recordar por WhatsApp">${icon('whatsapp')}</button>` : ''}<button class="btn btn-primary btn-sm" data-ret="${c.id}">${icon('rotate')}<span class="hide-sm"> Recibir</span></button></div>`).join('')}</div></div>`
      : emptyState('checkCircle', 'Nadie debe envases', 'Cuando prestes vacíos en una venta (por ejemplo, a un cliente de confianza que se lleva la caja), aparecerá aquí hasta que los devuelva.');
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => openClient(b.dataset.c, { tab: 'envases' }));
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => { const c = store.client(b.dataset.wa); waClient('envases', { client: c }); markNotified(c, 'envases').catch(() => {}); });
    el.querySelectorAll('[data-ret]').forEach((b) => b.onclick = () => returnEmptiesModal(store.client(b.dataset.ret), { mode: 'prestados' }));
  }

  async function movimientos() {
    $('#e-body').innerHTML = '<div class="empty"><div class="spinner"></div></div>';
    let rows = [];
    try { rows = (await store.listBetween('empties_logs', 'date', startOfDay(addDays(new Date(), -30)).toISOString(), endOfDay(new Date()).toISOString())).sort((a, b) => (b.date || '').localeCompare(a.date || '')); } catch (e) { console.error(e); }
    if (tab !== 'movimientos') return;
    $('#e-body').innerHTML = `<div class="card card-flush"><div class="small muted" style="padding:14px 16px 6px">Últimos 30 días · ${rows.length} movimiento(s)</div>${rows.length ? `<div class="table-wrap"><table class="table table-cards"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Envase</th><th class="r">Depósito</th><th class="r">Prestados</th><th class="hide-sm">Cliente / ref.</th></tr></thead><tbody>${rows.slice(0, 400).map((r) => { const [l, tone] = TYPE[r.type] || [r.type, 'neutral']; return `<tr><td class="small nowrap">${fmtDateTime(r.date)}</td><td><span class="badge badge-${tone}">${l}</span>${r.charged ? ` <span class="t-sub">${r.charged} cobrados ${usd(r.deposit || 0)}</span>` : r.deposit ? ` <span class="t-sub">${usd(r.deposit)}</span>` : ''}</td><td>${esc(store.container(r.containerId)?.name || r.containerId)}</td><td class="r num ${r.qty < 0 ? 'text-danger' : r.qty > 0 ? 'text-success' : ''}"><b>${r.qty ? (r.qty > 0 ? '+' : '') + r.qty : '—'}</b></td><td class="r num">${r.lent ? (r.lent > 0 ? '+' : '') + r.lent : '—'}</td><td class="hide-sm small muted">${esc(r.clientName || '')}${r.ref ? ` · ${esc(r.ref)}` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : `<div style="padding:8px 16px 20px">${emptyState('history', 'Sin movimientos de envases')}</div>`}</div>`;
  }

  function qtyRows(def = () => '') {
    return `<div class="list">${store.containers.map((c) => `<div class="list-item"><span class="kpi-icon tone-brand" style="width:34px;height:34px">${icon(ic(c))}</span><div class="grow" style="min-width:0"><b>${esc(c.name)}</b><div class="t-sub">en depósito ${store.emptiesStock(c.id)}</div></div><input class="input input-sm r" style="width:90px" inputmode="numeric" data-q="${c.id}" value="${def(c)}" placeholder="0"></div>`).join('')}</div>`;
  }
  const readQty = (m) => Object.fromEntries([...m.el.querySelectorAll('[data-q]')].map((i) => [i.dataset.q, i.value.trim() === '' ? null : Math.max(0, Math.round(parseNum(i.value) || 0))]));

  function supplierModal() {
    const m = openModal({
      title: 'Entregar vacíos al proveedor', sub: 'Salen del depósito', size: 'md',
      body: `<div class="stack"><div class="field"><label>Proveedor</label><select class="select" data-s><option value="">—</option>${store.suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>${qtyRows((c) => store.emptiesStock(c.id) || '')}<div class="field"><label>Nota</label><input class="input" data-n placeholder="Ej.: cambio por 10 cajas de Polar"></div><div class="error-msg" data-err></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Registrar entrega</button>`
    });
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      setBusy(e.currentTarget, true);
      try { await emptiesToSupplier({ items: Object.fromEntries(Object.entries(readQty(m)).filter(([, v]) => v)), supplierId: m.el.querySelector('[data-s]').value || null, note: m.el.querySelector('[data-n]').value }); m.close(); toast('Entrega registrada'); }
      catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; setBusy(e.currentTarget, false); }
    };
  }
  function countModal() {
    const m = openModal({
      title: 'Conteo de vacíos', sub: 'Escribe lo que cuentas en el depósito', size: 'md',
      body: `<div class="stack">${qtyRows()}<div class="error-msg" data-err></div></div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Ajustar</button>`
    });
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      if (!(await requirePin('Ajustar el conteo de envases'))) return;
      setBusy(e.currentTarget, true);
      try { const n = await countEmpties(Object.fromEntries(Object.entries(readQty(m)).filter(([, v]) => v != null))); m.close(); toast(n ? `${n} envase(s) ajustado(s)` : 'Sin diferencias'); }
      catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; setBusy(e.currentTarget, false); }
    };
  }

  el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  $('#e-in').onclick = () => returnEmptiesModal();
  $('#e-cfg').onclick = () => navigate('ajustes', { tab: 'envases' });
  draw();
  const off = store.on('*', (evt) => { if (['empties', 'clients', 'settings'].includes(evt) && tab !== 'movimientos') draw(); });
  return () => off();
}
