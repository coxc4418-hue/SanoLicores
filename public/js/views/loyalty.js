// SanoLicores — Fidelidad: clientes que dejaron de venir, fiados, clientes al mayor, cumpleaños y puntos
import { store } from '../store.js';
import { markNotified } from '../ops.js';
import { esc, usd, emptyState, fmtDate, fmtDateTime, toast, openModal } from '../utils.js';
import { icon } from '../icons.js';
import { avatar, openClient, payDebtModal, alertsHTML } from '../client.js';
import { waClient } from '../shared.js';

const TABS = { volver: 'Para que vuelvan', fiados: 'Fiados', mayor: 'Al mayor', cumples: 'Cumpleaños', puntos: 'Puntos' };

export function mount(el, { navigate, params = {} }) {
  let tab = TABS[params.tab] ? params.tab : 'volver';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Fidelidad</h1><p class="view-sub">El cliente de todos los fines de semana es el que hace el negocio: cuídalo, cóbrale a tiempo y escríbele si deja de venir.</p></div></div>
    <div class="tabs" id="l-tabs">${Object.entries(TABS).map(([k, v]) => `<button data-t="${k}">${v}<span class="tab-n" data-n="${k}" hidden></span></button>`).join('')}</div>
    <div id="l-body" class="mt"></div>`;
  const $ = (s) => el.querySelector(s);
  const set = (k, n) => { const b = el.querySelector(`[data-n="${k}"]`); if (b) { b.hidden = !n; b.textContent = n; } };

  function draw() {
    el.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    set('volver', store.dormantClients.length); set('fiados', store.debtors.length); set('cumples', store.birthdaysWithin(7).length);
    ({ volver, fiados, mayor, cumples, puntos })[tab]();
  }

  function volver() {
    const list = store.dormantClients;
    const offer = store.settings.comebackOffer || '';
    $('#l-body').innerHTML = `<div class="card"><div class="between"><div class="small">Clientes con 3 o más compras que no vienen hace más de <b>${Number(store.settings.dormantDays) || 21} días</b>, ordenados por lo que han gastado.${offer ? `<div class="t-sub mt-xs">${icon('gift')} Oferta del mensaje: ${esc(offer)}</div>` : ''}</div><button class="btn btn-ghost btn-sm" id="l-cfg">${icon('settings')} Ajustar</button></div></div>
      ${list.length ? `<div class="card mt"><div class="list">${list.map((c) => `<div class="list-item">${avatar(c)}<div class="grow" style="min-width:0"><button class="linkish ellipsis" data-c="${c.id}"><b>${esc(c.name)}</b></button><div class="t-sub">hace ${store.daysAway(c)} días · ${c.visits || 0} compras · gastó ${usd(c.totalSpent || 0)}${c.favorite ? ` · ${esc(c.favorite)}` : ''}</div>${c.notified?.volver ? `<span class="badge badge-success">${icon('check')} escrito ${fmtDate(c.notified.volver)}</span>` : ''}</div>${c.phone ? `<button class="btn btn-whatsapp btn-sm" data-wa="${c.id}">${icon('whatsapp')}<span class="hide-sm"> Escribir</span></button>` : ''}</div>`).join('')}</div></div>`
        : `<div class="mt">${emptyState('checkCircle', 'Tus buenos clientes siguen viniendo', 'Cuando un cliente frecuente deje de comprar, aparecerá aquí para que le escribas con una promoción.')}</div>`}`;
    $('#l-cfg').onclick = () => navigate('ajustes', { tab: 'fidelidad' });
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => openClient(b.dataset.c));
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = async () => { const c = store.client(b.dataset.wa); waClient('volver', { client: c }); await markNotified(c, 'volver').catch(() => {}); });
  }

  function fiados() {
    const list = store.debtors;
    $('#l-body').innerHTML = list.length ? `<div class="card"><div class="card-head"><div class="card-title">${icon('wallet')} Clientes con fiado</div><b>${usd(store.totalDebt)}</b></div><div class="list">${list.map((c) => { const lim = Number(c.creditLimit) || 0; const over = lim > 0 && (Number(c.balance) || 0) >= lim; return `<div class="list-item">${avatar(c)}<div class="grow" style="min-width:0"><button class="linkish" data-c="${c.id}"><b>${esc(c.name)}</b></button><div class="t-sub">${esc(c.phone || '')}${lim ? ` · límite ${usd(lim)}` : ''}${c.notified?.deuda ? ` · recordado ${fmtDate(c.notified.deuda)}` : ''}</div>${over ? '<span class="badge badge-danger">Llegó a su límite</span>' : ''}</div><b class="text-danger num">${usd(c.balance)}</b>${c.phone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${c.id}">${icon('whatsapp')}</button>` : ''}<button class="btn btn-primary btn-sm" data-pay="${c.id}">${icon('dollar')}<span class="hide-sm"> Cobrar</span></button></div>`; }).join('')}</div></div>`
      : emptyState('checkCircle', 'Nadie debe', 'Lo que fíes al vender queda aquí para cobrarlo después. Puedes poner un límite de fiado a cada cliente.');
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => openClient(b.dataset.c));
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => { const c = store.client(b.dataset.wa); waClient('deuda', { client: c }); markNotified(c, 'deuda').catch(() => {}); });
    el.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => payDebtModal(store.client(b.dataset.pay)));
  }

  function mayor() {
    const list = store.liveClients.filter((c) => c.type === 'mayor').sort((a, b) => (Number(b.totalSpent) || 0) - (Number(a.totalSpent) || 0));
    $('#l-body').innerHTML = list.length ? `<div class="card"><div class="small muted" style="margin-bottom:8px">Bodegas, bares, restaurantes y organizadores de eventos: pagan el precio al mayor automáticamente al elegirlos en la caja.</div><div class="list">${list.map((c) => `<div class="list-item">${avatar(c)}<div class="grow" style="min-width:0"><button class="linkish" data-c="${c.id}"><b>${esc(c.name)}</b></button><div class="t-sub">${esc(c.business || '')}${c.business ? ' · ' : ''}${c.visits || 0} compras · ${usd(c.totalSpent || 0)}${c.lastVisitAt ? ` · última ${fmtDate(c.lastVisitAt)}` : ''}</div>${alertsHTML(c)}</div><button class="btn btn-primary btn-sm" data-sell="${c.id}" title="Vender">${icon('cart')}</button></div>`).join('')}</div></div>`
      : emptyState('crate', 'Sin clientes al mayor', 'Marca a un cliente como “Al mayor” en su ficha y define el precio al mayor de cada producto en Inventario.');
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => openClient(b.dataset.c));
    el.querySelectorAll('[data-sell]').forEach((b) => b.onclick = () => navigate('vender', { clientId: b.dataset.sell }));
  }

  function cumples() {
    const list = store.birthdaysWithin(30);
    $('#l-body').innerHTML = list.length ? `<div class="card"><div class="list">${list.map((c) => `<div class="list-item">${avatar(c)}<div class="grow"><button class="linkish" data-c="${c.id}"><b>${esc(c.name)}</b></button><div class="t-sub">${c.inDays === 0 ? '🎂 ¡Hoy!' : `en ${c.inDays} día(s) · ${fmtDate(c.birthDate.replace(/^\d{4}/, String(new Date().getFullYear())))}`}</div></div>${c.phone ? `<button class="btn btn-whatsapp btn-sm" data-wa="${c.id}">${icon('whatsapp')} Felicitar</button>` : ''}</div>`).join('')}</div></div>`
      : emptyState('cake', 'Sin cumpleaños en los próximos 30 días', 'Registra la fecha de nacimiento en la ficha del cliente: un cumpleaños es la mejor excusa para venderle la botella de la celebración.');
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => openClient(b.dataset.c));
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => waClient('cumple', { client: store.client(b.dataset.wa) }));
  }

  function puntos() {
    const L = store.loyalty;
    const list = store.liveClients.filter((c) => Number(c.points) > 0).sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 100);
    $('#l-body').innerHTML = `<div class="card"><div class="small">${L.enabled ? `Programa activo: <b>1 punto por cada ${usd(L.per)}</b> de compra · cada punto vale <b>${usd(L.pointValue)}</b> · canje desde <b>${L.minRedeem} pts</b>.` : 'El programa de puntos está apagado.'} <button class="linkish" id="l-cfg">Configurar</button></div></div>
      ${list.length ? `<div class="card mt"><div class="list">${list.map((c) => `<div class="list-item">${avatar(c)}<div class="grow"><button class="linkish" data-c="${c.id}"><b>${esc(c.name)}</b></button><div class="t-sub">${c.visits || 0} compra(s)</div></div><span class="badge badge-violet">${icon('star')} ${Math.floor(c.points)} pts · ${usd(Math.floor(c.points) * L.pointValue)}</span>${c.phone ? `<button class="btn btn-whatsapp btn-icon btn-sm" data-wa="${c.id}">${icon('whatsapp')}</button>` : ''}</div>`).join('')}</div></div>` : emptyState('star', 'Aún nadie tiene puntos', 'Se suman solos al vender a un cliente registrado.')}`;
    $('#l-cfg').onclick = () => navigate('ajustes', { tab: 'fidelidad' });
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => openClient(b.dataset.c));
    el.querySelectorAll('[data-wa]').forEach((b) => b.onclick = () => waClient('puntos', { client: store.client(b.dataset.wa) }));
  }

  el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  draw();
  const off = store.on('clients', () => draw());
  return () => off();
}
