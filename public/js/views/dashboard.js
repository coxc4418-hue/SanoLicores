// SanoLicores — Inicio: el día de la licorería de un vistazo
import { store } from '../store.js';
import { esc, usd, fmtLongDate, todayKey, emptyState, fmtDate } from '../utils.js';
import { icon } from '../icons.js';
import { avatar, openClient, clientForm, returnEmptiesModal } from '../client.js';
import { waClient } from '../shared.js';
import { expBadge, stockText, productLine, catIcon } from '../licor.js';
import { markNotified } from '../ops.js';

export function mount(el, { navigate }) {
  const h = new Date().getHours();
  const hello = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">${hello} ${h < 12 ? '☀️' : h < 19 ? '🍻' : '🌙'}</h1><p class="view-sub">${fmtLongDate()} · ${esc(store.businessName)}</p></div>
      <div class="view-actions" data-tour="quick">
        <button class="btn btn-primary" data-q="sell">${icon('cart')} Vender <kbd class="hide-sm">F1</kbd></button>
        <button class="btn btn-secondary" data-q="emp">${icon('rotate')} Recibir vacíos</button>
        <button class="btn btn-secondary" data-q="buy">${icon('truck')} Recibir compra</button>
        <button class="btn btn-ghost" data-q="new">${icon('userPlus')} Cliente</button>
      </div></div>
    <div id="d-ord"></div>
    <div class="kpis" data-tour="kpis" id="d-kpis"></div>
    <div class="grid-2 mt-lg">
      <div class="card" data-tour="follow"><div class="card-head"><div class="card-title">${icon('users')} Clientes: fiado, envases y para recuperar</div><button class="btn btn-ghost btn-sm" data-go="fidelizar">Ver todo</button></div><div id="d-follow"></div></div>
      <div class="card"><div class="card-head"><div class="card-title">${icon('trend')} Más vendidos (7 días)</div><button class="btn btn-ghost btn-sm" data-go="reportes">Reportes</button></div><div id="d-top"></div></div>
    </div>
    <div class="grid-2 mt-lg">
      <div class="card" data-tour="low"><div class="card-head"><div class="card-title">${icon('alert')} Por reponer</div><button class="btn btn-ghost btn-sm" data-go="compras">Hacer pedido</button></div><div id="d-low"></div></div>
      <div class="card" data-tour="expiry"><div class="card-head"><div class="card-title">${icon('calendar')} Vencimientos próximos</div><button class="btn btn-ghost btn-sm" data-go="inventario">Inventario</button></div><div id="d-exp"></div></div>
    </div>`;
  const $ = (s) => el.querySelector(s);
  el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => navigate(b.dataset.go));
  $('[data-q="sell"]').onclick = () => navigate('vender');
  $('[data-q="buy"]').onclick = () => navigate('compras', { tab: 'recibir' });
  $('[data-q="emp"]').onclick = () => returnEmptiesModal();
  $('[data-q="new"]').onclick = async () => { const c = await clientForm(); if (c) openClient(c.id); };

  function orders() {
    const list = store.pendingOrders;
    const fresh = store.newOrders;
    const lic = store.licenseDays;
    $('#d-ord').innerHTML = (list.length ? `<div class="banner req-banner"><span>${icon('bag')} <b>${list.length} pedido(s) en línea</b> por atender${fresh.length ? ` · ${fresh.length} nuevo(s)` : ''}: ${list.slice(0, 3).map((o) => `${esc((o.name || '').split(' ')[0])} (${o.items?.length || 0})`).join(', ')}</span><button class="btn btn-sm btn-primary" id="d-ord-go">Atender</button></div>` : '')
      + (lic != null && lic <= 30 ? `<div class="banner offline-banner"><span>${icon('shield')} ${lic < 0 ? `La licencia de expendio de licores <b>venció</b> el ${fmtDate(store.settings.licenseExpires)}.` : `La licencia de expendio de licores vence ${lic === 0 ? '<b>hoy</b>' : `en <b>${lic} día(s)</b>`} (${fmtDate(store.settings.licenseExpires)}).`} Renuévala a tiempo.</span><button class="btn btn-sm btn-secondary" id="d-lic">Ver</button></div>` : '');
    $('#d-ord-go')?.addEventListener('click', () => navigate('pedidos'));
    $('#d-lic')?.addEventListener('click', () => navigate('ajustes', { tab: 'negocio' }));
  }

  function kpis() {
    const t = todayKey();
    const sales = store.recentSales.filter((s) => s.dayKey === t && s.status !== 'voided' && s.kind !== 'abono');
    const total = sales.reduce((a, s) => a + (Number(s.total) || 0), 0);
    const deposits = sales.reduce((a, s) => a + (s.items || []).filter((i) => i.kind === 'envase').reduce((x, i) => x + (Number(i.total) || 0), 0), 0);
    const margin = sales.reduce((a, s) => a + (Number(s.total) || 0) - (Number(s.cost) || 0), 0) - deposits;
    const low = store.lowProducts.length; const out = store.outProducts.length;
    const expd = store.expiredLots.length; const exp = store.expiringProducts.length;
    const inStock = store.containers.reduce((a, c) => a + store.emptiesStock(c.id), 0);
    const lent = Object.values(store.totalLent).reduce((a, n) => a + n, 0);
    const pay = store.totalPayable;
    const overdue = store.payables.filter((p) => p.dueDate && p.dueDate <= t).length;
    $('#d-kpis').innerHTML = `
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Ventas de hoy</span><span class="kpi-icon tone-success">${icon('dollar')}</span></div><div class="kpi-value">${usd(total)}</div><div class="kpi-sub">${sales.length} venta(s)${sales.length ? ` · ticket ${usd(total / sales.length)}` : ''}${store.openShift ? '' : ' · <span class="text-warning">caja cerrada</span>'}</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Ganancia bruta hoy</span><span class="kpi-icon tone-brand">${icon('trend')}</span></div><div class="kpi-value">${usd(margin)}</div><div class="kpi-sub">${total ? `margen ${Math.round(margin / Math.max(0.01, total - deposits) * 100)}%` : 'sobre el costo de lo vendido'}</div></div>
      <div class="card kpi kpi-link" data-go2="inventario" data-p="bajo"><div class="kpi-top"><span class="kpi-label">Stock bajo</span><span class="kpi-icon tone-warning">${icon('box')}</span></div><div class="kpi-value">${low}</div><div class="kpi-sub">${out ? `<span class="text-danger">${out} agotado(s)</span>` : 'ninguno agotado'}</div></div>
      <div class="card kpi kpi-link" data-go2="envases"><div class="kpi-top"><span class="kpi-label">Envases</span><span class="kpi-icon tone-violet">${icon('rotate')}</span></div><div class="kpi-value">${inStock}</div><div class="kpi-sub">vacíos en depósito${lent ? ` · <span class="text-warning">${lent} prestados</span>` : ''}</div></div>
      <div class="card kpi kpi-link" data-go2="fidelizar" data-p="fiados"><div class="kpi-top"><span class="kpi-label">Fiado por cobrar</span><span class="kpi-icon tone-danger">${icon('wallet')}</span></div><div class="kpi-value">${usd(store.totalDebt)}</div><div class="kpi-sub">${store.debtors.length} cliente(s)</div></div>
      <div class="card kpi kpi-link" data-go2="compras" data-p="pagar"><div class="kpi-top"><span class="kpi-label">Por pagar</span><span class="kpi-icon tone-info">${icon('truck')}</span></div><div class="kpi-value">${usd(pay)}</div><div class="kpi-sub">${overdue ? `<span class="text-danger">${overdue} factura(s) vencida(s)</span>` : exp ? `${exp} producto(s) por vencer${expd ? ` · ${expd} vencido(s)` : ''}` : 'a proveedores'}</div></div>`;
    el.querySelectorAll('[data-go2]').forEach((b) => b.onclick = () => navigate(b.dataset.go2, b.dataset.p ? { tab: b.dataset.p } : {}));
  }

  function expiry() {
    const list = store.expiringLots(Math.max(30, Number(store.settings.expiryAlertDays) || 90)).slice(0, 7);
    $('#d-exp').innerHTML = list.length ? `<div class="list">${list.map((l) => `<div class="list-item"><span class="kpi-icon tone-${l.exp < todayKey() ? 'danger' : 'warning'}" style="width:36px;height:36px">${icon(catIcon(l.p.category))}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(l.p.name)}</b><div class="t-sub">Lote ${esc(l.lot || 's/l')} · ${stockText(l.p, l.qty)} · vence ${fmtDate(l.exp)}</div></div>${expBadge(l.exp)}</div>`).join('')}</div>`
      : emptyState('checkCircle', 'Sin vencimientos cercanos', 'Ningún lote vence en los próximos días.');
  }

  function follow() {
    const dorm = store.dormantClients.slice(0, 4);
    const emp = store.emptyDebtors.slice(0, 3);
    const bd = store.birthdaysToday;
    $('#d-follow').innerHTML = `
      <div class="follow-sums"><div><b>${store.debtors.length}</b><span>con fiado</span></div><div><b>${store.emptyDebtors.length}</b><span>deben envases</span></div><div><b>${store.dormantClients.length}</b><span>dejaron de venir</span></div><div><b>${store.birthdaysWithin(7).length}</b><span>cumpleaños (7 d)</span></div></div>
      ${emp.length ? `<div class="section-title mt">${icon('rotate')} Deben envases</div><div class="list">${emp.map((c) => `<div class="list-item">${avatar(c)}<div class="grow" style="min-width:0"><button class="linkish ellipsis" data-c="${c.id}"><b>${esc(c.name)}</b></button><div class="t-sub">${store.emptiesOwed(c).map((x) => `${x.n} ${esc(x.c?.short || '')}`).join(' · ')}</div></div>${c.phone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wk="envases" data-id="${c.id}" title="Recordar por WhatsApp">${icon('whatsapp')}</button>` : ''}</div>`).join('')}</div>` : ''}
      ${dorm.length ? `<div class="section-title mt">${icon('heart')} Buenos clientes que dejaron de venir</div><div class="list">${dorm.map((c) => `<div class="list-item">${avatar(c)}<div class="grow" style="min-width:0"><button class="linkish ellipsis" data-c="${c.id}"><b>${esc(c.name)}</b></button><div class="t-sub">hace ${store.daysAway(c)} días · ${c.visits || 0} compras · ${usd(c.totalSpent || 0)}${c.notified?.volver ? ' · ya se le escribió' : ''}</div></div>${c.phone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wk="volver" data-id="${c.id}" title="Enviar promoción">${icon('whatsapp')}</button>` : ''}</div>`).join('')}</div>` : ''}
      ${bd.length ? `<div class="section-title mt">${icon('cake')} Cumpleaños hoy</div><div class="list">${bd.map((c) => `<div class="list-item">${avatar(c)}<div class="grow"><button class="linkish" data-c="${c.id}"><b>${esc(c.name)}</b></button></div>${c.phone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wk="cumple" data-id="${c.id}">${icon('whatsapp')}</button>` : ''}</div>`).join('')}</div>` : ''}
      ${!dorm.length && !bd.length && !emp.length ? emptyState('checkCircle', 'Todo al día', 'Aquí verás a quién recordarle sus envases, a quién felicitar y a qué buenos clientes escribirles para que vuelvan.') : ''}`;
    el.querySelectorAll('#d-follow [data-c]').forEach((b) => b.onclick = () => openClient(b.dataset.c));
    el.querySelectorAll('#d-follow [data-wk]').forEach((b) => b.onclick = () => { const c = store.client(b.dataset.id); waClient(b.dataset.wk, { client: c }); if (b.dataset.wk !== 'cumple') markNotified(c, b.dataset.wk).catch(() => {}); });
  }

  function low() {
    const list = store.lowProducts.sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0)).slice(0, 7);
    $('#d-low').innerHTML = list.length ? `<div class="list">${list.map((p) => `<div class="list-item"><span class="kpi-icon tone-${(Number(p.stock) || 0) <= 0 ? 'danger' : 'warning'}" style="width:36px;height:36px">${icon(catIcon(p.category))}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(p.name)}</b><div class="t-sub ellipsis">${esc(productLine(p))}</div></div><div class="r"><b class="${(Number(p.stock) || 0) <= 0 ? 'text-danger' : ''}">${(Number(p.stock) || 0) <= 0 ? 'Agotado' : stockText(p)}</b><div class="t-sub">mín. ${stockText(p, p.minStock || 0)}</div></div></div>`).join('')}</div>`
      : emptyState('checkCircle', 'Inventario completo', 'Ningún producto por debajo del mínimo.');
  }

  function top() {
    const m = new Map();
    for (const s of store.recentSales) {
      if (s.status === 'voided') continue;
      for (const i of s.items || []) if (i.productId) { const r = m.get(i.productId) || { name: i.name, units: 0, total: 0 }; r.units += i.qty * (i.factor || 1); r.total += Number(i.total) || 0; m.set(i.productId, r); }
    }
    const list = [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 6);
    const max = list[0]?.[1].total || 1;
    $('#d-top').innerHTML = list.length ? `<div class="stack" style="gap:10px">${list.map(([, r]) => `<div><div class="between small"><b class="ellipsis">${esc(r.name)}</b><span class="num">${usd(r.total)}</span></div><div class="bar mt-xs"><span style="width:${Math.max(4, r.total / max * 100)}%"></span></div><div class="t-sub">${r.units} unidad(es)</div></div>`).join('')}</div>`
      : emptyState('chart', 'Aún sin ventas', 'Aquí verás tus productos estrella.');
  }

  const all = () => { orders(); kpis(); expiry(); follow(); low(); top(); };
  all();
  const off = store.on('*', (evt) => {
    if (evt === 'orders') orders();
    if (evt === 'products') { kpis(); expiry(); low(); }
    if (evt === 'clients') { kpis(); follow(); }
    if (evt === 'empties') kpis();
    if (evt === 'sales' || evt === 'shift' || evt === 'payables') { kpis(); top(); }
    if (evt === 'settings') all();
  });
  return () => off();
}
