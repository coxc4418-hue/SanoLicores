// SanoLicores — Operaciones: ventas (unidad/pack/caja, fría, al mayor, combos, envases, fiado, puntos), clientes,
// envases retornables, inventario, compras, pedidos en línea y caja
import { auth } from './firebase.js';
import { store } from './store.js';
import { round2, round4, nowISO, todayKey, dayKey, PAY_METHODS, addDays, loc, usd, fmtDate, normalize } from './utils.js';
import { consumeLots, restoreLots, addLot, nextExpiry, upb, unitCost, stockText, productLine, isCombo, comboStock, defaultPack, packFactor, packPrice, packLabel, fractionable } from './licor.js';

export const APP_URL = 'https://sano-licores.web.app';
export const by = () => (auth.currentUser?.isAnonymous ? 'demo' : (auth.currentUser?.email || '').split('@')[0] || '—');
const FLOW0 = () => ({ inUSD: 0, inBs: 0, outUSD: 0, outBs: 0 });

const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function genCode(n = 8) { return Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => CODE_ALPHA[x % CODE_ALPHA.length]).join(''); }
export const cardUrl = (code) => `${APP_URL}/tarjeta/${code}`;
export const shopUrl = (slug) => `${APP_URL}/pedido/${slug}`;
export const fmtSeq = (prefix, n, len = 5) => `${prefix}-${String(n).padStart(len, '0')}`;
export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'licoreria';
}

// ======================================================================
// PAGOS Y CAJA
// ======================================================================
export function normalizePays(payments) {
  return (payments || []).filter((p) => p.amount > 0.004).map((p) => ({ method: p.method, currency: loc().cur, amount: round2(p.amount), usd: round4(p.amount) }));
}
export function methodNet(sale) {
  const m = {};
  (sale.payments || []).forEach((p) => { m[p.method] = round4((m[p.method] || 0) + (p.usd || 0)); });
  const ch = Number(sale.changeUSD) || 0;
  if (ch > 0.004) m.efectivo = round4((m.efectivo || 0) - ch);
  return m;
}
export function cashFlowOf(payments, changeUSD) {
  const f = FLOW0();
  for (const p of payments) if (PAY_METHODS[p.method]?.cash) f.inUSD += p.amount;
  if (changeUSD > 0.004) f.outUSD += round2(changeUSD);
  for (const k in f) f[k] = round2(f[k]);
  return f;
}
function shiftIncrements(flow, extra = {}) {
  const u = {};
  for (const k of ['inUSD', 'inBs', 'outUSD', 'outBs']) if (flow[k]) u[k] = store.inc(flow[k]);
  for (const [k, v] of Object.entries(extra)) if (v) u[k] = store.inc(round4(v));
  u.updatedAt = nowISO();
  return u;
}
function preparePayment({ amount, payments }) {
  const shift = store.openShift;
  if (!shift) throw new Error('Abre la caja antes de cobrar (menú Caja).');
  const pays = normalizePays(payments);
  const paidUSD = round4(pays.reduce((a, p) => a + p.usd, 0));
  if (paidUSD < amount - 0.01) throw new Error(`Falta por cobrar ${usd(amount - paidUSD)}.`);
  const changeUSD = round2(Math.max(0, paidUSD - amount));
  return { shift, pays, paidUSD, changeUSD, flow: cashFlowOf(pays, changeUSD), received: round2(paidUSD - changeUSD) };
}
const NO_PAY = () => ({ shift: store.openShift || null, pays: [], paidUSD: 0, changeUSD: 0, flow: FLOW0(), received: 0 });
function addToShift(b, pay) {
  if (!pay.shift || !(pay.received > 0)) return;
  const byMethod = {};
  for (const [k, v] of Object.entries(methodNet({ payments: pay.pays, changeUSD: pay.changeUSD }))) byMethod[`byMethod.${k}`] = v;
  b.update(store.ref('cash_shifts', pay.shift.id), shiftIncrements(pay.flow, { salesCount: 1, salesTotal: pay.received, ...byMethod }));
}
function paymentFields(pay) {
  return {
    rate: 1, payments: pay.pays, paidUSD: pay.paidUSD, changeUSD: pay.changeUSD, changeCurrency: 'USD',
    method: pay.pays.length === 1 ? pay.pays[0].method : pay.pays.length ? 'mixto' : 'ninguno', received: pay.received,
    shiftId: pay.shift?.id || null, cashFlow: pay.flow, fxRate: Number(store.settings.fx?.enabled ? store.settings.fx.rate : 0) || 0
  };
}
export function clientFields(c) {
  return { memberId: c?.id || null, memberName: c?.name || 'Cliente de mostrador', memberPhone: c?.phone || '', memberIdDoc: c?.idDoc || '', memberNumber: c?.number || '' };
}
function newSaleDoc(b, { kind, items, subtotal, discount = 0, pay, client, extra = {} }) {
  const seq = store.nextSeq(b, 'inv');
  const number = fmtSeq(store.settings.invoicePrefix || 'F', seq, 6);
  const ref = store.newRef('sales');
  const total = round2(subtotal - discount);
  const sale = {
    number, seq, kind, date: nowISO(), dayKey: todayKey(), items, subtotal: round2(subtotal), discount: round2(discount), total,
    cost: round2(items.reduce((a, i) => a + (Number(i.cost) || 0) * (Number(i.qty) || 0), 0)),
    ...paymentFields(pay), ...clientFields(client), status: 'completed', by: by(), ...extra
  };
  b.set(ref, sale);
  addToShift(b, pay);
  return { id: ref.id, ...sale };
}

// ======================================================================
// TARJETA DEL CLIENTE (colección pública cards/{código}: datos mínimos)
// ======================================================================
export function cardData(c, extra = {}) {
  const first = String(c.name || '').trim().split(/\s+/);
  const L = store.loyalty;
  const owed = Object.entries(c.empties || {}).filter(([, n]) => Number(n) > 0).map(([id, n]) => ({ name: store.container(id)?.short || store.container(id)?.name || 'Envase', n: Math.round(Number(n)) }));
  return {
    tenantId: store.tenantId, shop: store.businessName, shopPhone: store.settings.whatsapp || store.settings.phone || '', shopAddress: store.settings.address || '',
    instagram: store.settings.instagram || '', country: store.settings.country || '', shopSlug: store.settings.shop?.enabled ? store.settings.shop.slug || '' : '',
    name: first.length > 1 ? `${first[0]} ${first[first.length - 1]}` : first[0] || 'Cliente', number: c.number || '', active: c.active !== false,
    points: L?.enabled ? Math.max(0, Math.floor(Number(c.points) || 0)) : null, pointValue: L?.enabled ? Number(L.pointValue) || 0 : 0, sym: loc().sym, dec: loc().dec,
    mayor: c.type === 'mayor', empties: owed.slice(0, 6), balance: Math.max(0, round2(Number(c.balance) || 0)),
    visits: Number(c.visits) || 0, lastVisitAt: c.lastVisitAt || null, updatedAt: nowISO(), ...extra
  };
}
function putCard(b, c, extra = {}) { if (c?.cardCode) b.set(store.cardRef(c.cardCode), cardData(c, extra), { merge: false }); }
export async function refreshCard(c) { if (!c?.cardCode) return; const b = store.batch(); putCard(b, c); await store.commit(b); }

// ======================================================================
// CLIENTES
// ======================================================================
const CLIENT_FIELDS = ['name', 'phone', 'email', 'idDoc', 'birthDate', 'sex', 'address', 'notes', 'type', 'business', 'tags', 'favorite'];
export function cleanClient(data) {
  const out = {};
  for (const k of CLIENT_FIELDS) {
    if (data[k] === undefined) continue;
    out[k] = Array.isArray(data[k]) ? data[k].map((x) => String(x).trim()).filter(Boolean) : String(data[k] ?? '').trim();
  }
  if (data.creditLimit !== undefined) out.creditLimit = Math.max(0, round2(Number(data.creditLimit) || 0));
  if (out.name) out.name = out.name.replace(/\s+/g, ' ');
  if (out.idDoc) out.idDoc = out.idDoc.toUpperCase().replace(/\s+/g, '');
  if (out.type && !['detal', 'mayor'].includes(out.type)) out.type = 'detal';
  return out;
}
function newClientDoc(b, data) {
  const clean = cleanClient(data);
  if (!clean.name) throw new Error('Escribe el nombre del cliente.');
  const dup = clean.phone && store.findByPhone(clean.phone);
  if (dup) throw new Error(`Ya existe un cliente con ese teléfono: ${dup.name} (${dup.number}).`);
  const ref = store.newRef('clients');
  const seq = store.nextSeq(b, 'cli');
  const date = nowISO();
  const c = { type: 'detal', creditLimit: 0, ...clean, number: fmtSeq('C', seq, 4), seq, cardCode: genCode(8), active: true, visits: 0, totalSpent: 0, balance: 0, points: 0, empties: {}, lastVisitAt: null, createdAt: date, updatedAt: date, by: by() };
  b.set(ref, c);
  const out = { id: ref.id, ...c };
  putCard(b, out);
  return out;
}
export async function saveClient(data, id = null) {
  const b = store.batch();
  if (!id) { const c = newClientDoc(b, data); await store.commit(b); return c; }
  const clean = cleanClient(data);
  const dup = clean.phone && store.findByPhone(clean.phone, id);
  if (dup) throw new Error(`Ya existe un cliente con ese teléfono: ${dup.name} (${dup.number}).`);
  b.set(store.ref('clients', id), { ...clean, updatedAt: nowISO() }, { merge: true });
  const c = { ...(store.client(id) || {}), ...clean, id };
  putCard(b, c);
  await store.commit(b);
  return c;
}
export async function setClientActive(c, active) {
  const b = store.batch();
  b.set(store.ref('clients', c.id), { active, updatedAt: nowISO() }, { merge: true });
  putCard(b, { ...c, active });
  await store.commit(b);
}
export async function renewCardCode(c) {
  const b = store.batch(); const code = genCode(8);
  if (c.cardCode) b.delete(store.cardRef(c.cardCode));
  b.set(store.ref('clients', c.id), { cardCode: code, updatedAt: nowISO() }, { merge: true });
  putCard(b, { ...c, cardCode: code });
  await store.commit(b);
  return code;
}
function resolveClient(b, client) {
  if (!client) return null;
  if (client.id) return store.client(client.id) || client;
  const dup = client.phone && store.findByPhone(client.phone);
  if (dup) return dup;
  if (!String(client.name || '').trim()) return null;
  return newClientDoc(b, client);
}
export async function markNotified(c, what) {
  await store.save('clients', c.id, { notified: { [what]: nowISO() } });
}

// ======================================================================
// VENTA
// ======================================================================
export function cartTotals(lines, discount = 0) {
  const subtotal = round2((lines || []).reduce((a, l) => a + (Number(l.price) || 0) * (Number(l.qty) || 0), 0));
  const disc = round2(Math.min(subtotal, Math.max(0, Number(discount) || 0)));
  return { subtotal, discount: disc, total: round2(subtotal - disc) };
}
export const pointsValue = (pts) => round2(Math.max(0, Number(pts) || 0) * (Number(store.loyalty?.pointValue) || 0));

/** Unidades del carrito por producto (los combos se convierten en sus componentes) */
export function unitsByProduct(lines) {
  const m = new Map();
  const add = (id, u) => m.set(id, (m.get(id) || 0) + u);
  for (const l of lines || []) {
    if (!l.productId) continue;
    const units = (Number(l.qty) || 0) * (Number(l.factor) || 1);
    const combo = Array.isArray(l.combo) && l.combo.length ? l.combo : isCombo(store.product(l.productId)) ? store.product(l.productId).combo : null;
    if (combo) for (const c of combo) add(c.productId, units * Math.max(1, Number(c.units) || 1));
    else add(l.productId, units);
  }
  return m;
}
export function checkStock(lines) {
  for (const [id, units] of unitsByProduct(lines)) {
    const p = store.product(id);
    if (p && p.trackStock !== false && (Number(p.stock) || 0) < units - 1e-9) throw new Error(`No hay suficiente ${p.name}: quedan ${stockText(p)}.`);
  }
}

/** Líneas de depósito por los envases que el cliente no trae (y no se le prestan) */
export function depositLines(empties) {
  const out = [];
  for (const e of empties || []) {
    const c = store.container(e.id);
    const miss = Math.max(0, Math.round(Number(e.need) || 0) - Math.round(Number(e.brought) || 0));
    if (!c || !miss || e.mode === 'prestar') continue;
    out.push({ productId: null, name: `Envase: ${c.name}`, pack: 'envase', factor: 1, qty: miss, price: round2(c.deposit), listPrice: round2(c.deposit), cost: 0, kind: 'envase', containerId: c.id, detail: 'Depósito (se devuelve al traer el vacío)' });
  }
  return out;
}

/**
 * Cobra una venta de mostrador.
 * lines: [{ productId, name, pack ('unidad'|'pack'|'caja'), factor, qty, price (por presentación), cost (por presentación), cold, kind }]
 * empties: [{ id (envase), need, brought, mode ('cobrar' | 'prestar') }] — envases retornables de la venta
 * mayor: precios al mayor · credit: parte que queda fiada · pointsUsed: puntos canjeados
 */
export async function chargeSale({ lines, client = null, discount = 0, payments = [], note = '', credit = 0, pointsUsed = 0, sellerId = null, orderId = null, delivery = 0, empties = [], mayor = false }) {
  const clean = (lines || []).filter((l) => l && l.name && Number(l.qty) > 0 && l.kind !== 'envase').map((l) => {
    const p = l.productId ? store.product(l.productId) : null;
    const it = {
      productId: l.productId || null, name: String(l.name), pack: l.pack || 'unidad', factor: Math.max(1, Number(l.factor) || 1), qty: round4(Number(l.qty)),
      price: round2(Number(l.price) || 0), listPrice: round2(Number(l.listPrice ?? l.price) || 0), cost: round4(Number(l.cost) || 0), kind: l.kind || (l.productId ? 'producto' : 'servicio'),
      cold: !!l.cold, detail: l.detail || ''
    };
    if (p && isCombo(p)) { it.combo = p.combo.map((c) => ({ productId: c.productId, units: Math.max(1, Number(c.units) || 1) })); it.kind = 'combo'; }
    return it;
  });
  const emp = (empties || []).map((e) => ({ id: e.id, need: Math.max(0, Math.round(Number(e.need) || 0)), brought: Math.max(0, Math.round(Number(e.brought) || 0)), mode: e.mode === 'prestar' ? 'prestar' : 'cobrar' }))
    .map((e) => ({ ...e, brought: Math.min(e.brought, e.need) })).filter((e) => e.need > 0 && store.container(e.id));
  clean.push(...depositLines(emp));
  if (Number(delivery) > 0) clean.push({ productId: null, name: 'Delivery', pack: 'servicio', factor: 1, qty: 1, price: round2(delivery), listPrice: round2(delivery), cost: 0, kind: 'servicio', cold: false, detail: '' });
  if (!clean.length) throw new Error('No hay nada para cobrar.');
  checkStock(clean);

  const b = store.batch();
  const cl = resolveClient(b, client);
  const lent = emp.filter((e) => e.mode === 'prestar' && e.need > e.brought);
  if (lent.length && !cl) throw new Error('Para prestar envases elige o registra al cliente.');
  const t = cartTotals(clean, 0);
  const ptsUsed = Math.max(0, Math.floor(Number(pointsUsed) || 0));
  if (ptsUsed && !(cl && Number(cl.points) >= ptsUsed)) throw new Error('El cliente no tiene esos puntos.');
  const ptsDisc = pointsValue(ptsUsed);
  const disc = round2(Math.min(t.subtotal, (Number(discount) || 0) + ptsDisc));
  const total = round2(t.subtotal - disc);
  const owe = round2(Math.min(total, Math.max(0, Number(credit) || 0)));
  if (owe > 0 && !cl) throw new Error('Para fiar elige o registra al cliente.');
  if (owe > 0 && Number(cl.creditLimit) > 0 && (Number(cl.balance) || 0) + owe > Number(cl.creditLimit) + 0.009) throw new Error(`Supera el límite de fiado de ${cl.name} (${usd(cl.creditLimit)}; ya debe ${usd(cl.balance || 0)}).`);
  const toPay = round2(total - owe);
  const pay = toPay > 0.004 ? preparePayment({ amount: toPay, payments }) : NO_PAY();

  // Inventario: salida por lotes (FEFO); los combos descuentan sus componentes
  const date = nowISO();
  const low = [];
  const usedBy = {};
  const units = unitsByProduct(clean);
  for (const [id, u] of units) {
    const p = store.product(id);
    if (!p || p.trackStock === false) continue;
    const r = consumeLots(p.lots || [], u);
    usedBy[id] = r.used;
    const left = (Number(p.stock) || 0) - u;
    b.update(store.ref('products', id), { stock: store.inc(-u), sold: store.inc(u), lots: r.lots, expiresAt: nextExpiry({ lots: r.lots }) || '', updatedAt: date });
    if (left <= (Number(p.minStock) || 0)) low.push({ ...p, stock: left });
  }
  for (const l of clean) if (l.combo) b.update(store.ref('products', l.productId), { sold: store.inc(l.qty), updatedAt: date });
  const items = clean.map((l) => {
    const it = { ...l, total: round2(l.price * l.qty) };
    if (l.productId && !l.combo && usedBy[l.productId]?.length) it.lots = usedBy[l.productId].map((x) => `${x.lot || 's/l'}${x.exp ? ' ' + x.exp.slice(5, 7) + '/' + x.exp.slice(2, 4) : ''}`).join(', ');
    return it;
  });
  const extra = {
    note, credit: owe, pointsUsed: ptsUsed, pointsDiscount: ptsDisc, manualDiscount: round2(Number(discount) || 0), mayor: !!mayor,
    sellerId: sellerId || null, sellerName: store.seller(sellerId)?.name || '', orderId: orderId || null, usedLots: usedBy,
    empties: emp.map((e) => ({ ...e, lent: e.mode === 'prestar' ? e.need - e.brought : 0, charged: e.mode === 'cobrar' ? e.need - e.brought : 0 }))
  };
  const sale = newSaleDoc(b, { kind: 'venta', items, subtotal: t.subtotal, discount: disc, pay, client: cl, extra });

  for (const [id, used] of Object.entries(usedBy)) {
    const p = store.product(id);
    b.set(store.newRef('inventory_logs'), { productId: id, name: p.name, date, dayKey: todayKey(), type: 'venta', qty: -(units.get(id) || 0), cost: unitCost(p), lots: used, reason: `Venta ${sale.number}`, by: by() });
  }

  // Envases: los vacíos que trae entran al depósito; los prestados quedan en la cuenta del cliente
  const brought = {}; const lentMap = {};
  for (const e of sale.empties) {
    if (e.brought) brought[e.id] = store.inc(e.brought);
    if (e.lent) lentMap[e.id] = store.inc(e.lent);
    if (e.brought || e.lent || e.charged) b.set(store.newRef('empties_logs'), { date, dayKey: todayKey(), type: 'venta', containerId: e.id, qty: e.brought, lent: e.lent, charged: e.charged, deposit: round2((store.container(e.id)?.deposit || 0) * e.charged), clientId: cl?.id || null, clientName: cl?.name || '', ref: sale.number, refId: sale.id, by: by() });
  }
  if (Object.keys(brought).length) b.set(store.ref('config', 'empties'), { stock: brought, updatedAt: date }, { merge: true });

  // Cliente: gasto, fiado, puntos y envases prestados
  let after = cl ? { ...cl } : null;
  if (cl) {
    const L = store.loyalty;
    const earned = L?.enabled && Number(L.per) > 0 ? Math.floor((toPay + owe) / Number(L.per)) : 0;
    const points = Math.max(0, (Number(cl.points) || 0) - ptsUsed + earned);
    const patch = { totalSpent: store.inc(toPay), visits: store.inc(1), lastVisitAt: date, points, updatedAt: date };
    if (owe > 0) { patch.balance = store.inc(owe); after.balance = (Number(cl.balance) || 0) + owe; }
    if (Object.keys(lentMap).length) {
      patch.empties = lentMap;
      after.empties = { ...(cl.empties || {}) };
      for (const e of sale.empties) if (e.lent) after.empties[e.id] = (Number(after.empties[e.id]) || 0) + e.lent;
    }
    Object.assign(after, { points, visits: (Number(cl.visits) || 0) + 1, lastVisitAt: date });
    b.set(store.ref('clients', cl.id), patch, { merge: true });
    putCard(b, after);
    sale.pointsEarned = earned;
    b.update(store.ref('sales', sale.id), { pointsEarned: earned });
  }
  if (orderId) b.update(store.orderRef(orderId), { status: 'entregada', saleId: sale.id, saleNumber: sale.number, deliveredAt: date });
  await store.commit(b);
  return { sale, low, client: after };
}

/** Cobra lo fiado (abono a la cuenta del cliente) */
export async function payBalance(c, { amount, payments, note = '' }) {
  const bal = round2(Number(c.balance) || 0);
  const amt = round2(Math.min(bal, Number(amount) || 0));
  if (!(amt > 0)) throw new Error('Indica el monto a abonar.');
  const b = store.batch();
  const p = preparePayment({ amount: amt, payments });
  const sale = newSaleDoc(b, { kind: 'abono', items: [{ productId: null, name: 'Abono a cuenta (fiado)', pack: 'servicio', factor: 1, qty: 1, price: amt, cost: 0, kind: 'abono', total: amt }], subtotal: amt, pay: p, client: c, extra: { note } });
  b.set(store.ref('clients', c.id), { balance: store.inc(-amt), totalSpent: store.inc(amt), updatedAt: nowISO() }, { merge: true });
  putCard(b, { ...c, balance: bal - amt });
  await store.commit(b);
  return { sale };
}
export async function adjustPoints(c, points, reason = '') {
  const b = store.batch();
  const v = Math.max(0, Math.round(Number(points) || 0));
  b.set(store.ref('clients', c.id), { points: v, pointsLog: [...(c.pointsLog || []), { at: nowISO(), by: by(), from: c.points || 0, to: v, reason }].slice(-20), updatedAt: nowISO() }, { merge: true });
  putCard(b, { ...c, points: v });
  await store.commit(b);
}

/** Anula un recibo: devuelve el inventario a sus lotes y revierte caja, fiado, puntos y envases. */
export async function voidSale(sale, reason = '') {
  if (sale.status === 'voided') throw new Error('El documento ya está anulado.');
  const b = store.batch();
  const date = nowISO();
  b.update(store.ref('sales', sale.id), { status: 'voided', voidedAt: date, voidReason: reason || '', voidedBy: by() });
  if (sale.kind === 'venta') {
    const units = unitsByProduct(sale.items);
    for (const [id, u] of units) {
      const p = store.product(id);
      if (!p || p.trackStock === false) continue;
      const used = sale.usedLots?.[id]?.length ? sale.usedLots[id] : [{ lot: '', exp: '', qty: u }];
      const lots = sale.usedLots?.[id]?.length ? restoreLots(p.lots || [], used) : (p.lots || []);
      b.update(store.ref('products', id), { stock: store.inc(u), sold: store.inc(-u), lots, expiresAt: nextExpiry({ lots }) || '', updatedAt: date });
      b.set(store.newRef('inventory_logs'), { productId: id, name: p.name, date, dayKey: todayKey(), type: 'devolucion', qty: u, cost: unitCost(p), lots: used, reason: `Anulación ${sale.number}`, by: by() });
    }
    for (const l of sale.items || []) if (l.combo && store.product(l.productId)) b.update(store.ref('products', l.productId), { sold: store.inc(-l.qty), updatedAt: date });
    const back = {};
    for (const e of sale.empties || []) {
      if (e.brought) back[e.id] = store.inc(-e.brought);
      if (e.brought || e.lent) b.set(store.newRef('empties_logs'), { date, dayKey: todayKey(), type: 'anulacion', containerId: e.id, qty: -(e.brought || 0), lent: -(e.lent || 0), charged: 0, deposit: 0, clientId: sale.memberId || null, clientName: sale.memberName || '', ref: sale.number, refId: sale.id, by: by() });
    }
    if (Object.keys(back).length) b.set(store.ref('config', 'empties'), { stock: back, updatedAt: date }, { merge: true });
  }
  const c = sale.memberId ? store.client(sale.memberId) : null;
  if (c) {
    const patch = { totalSpent: store.inc(-(sale.received || 0)), updatedAt: date };
    const after = { ...c };
    if (sale.kind === 'abono') { patch.balance = store.inc(sale.total || 0); patch.totalSpent = store.inc(-(sale.total || 0)); after.balance = (Number(c.balance) || 0) + (sale.total || 0); }
    if (sale.credit > 0) { patch.balance = store.inc(-sale.credit); after.balance = (Number(c.balance) || 0) - sale.credit; }
    if (sale.kind === 'venta') {
      patch.visits = store.inc(-1);
      const pts = Math.max(0, (Number(c.points) || 0) + (Number(sale.pointsUsed) || 0) - (Number(sale.pointsEarned) || 0));
      patch.points = pts; after.points = pts;
      const lent = (sale.empties || []).filter((e) => e.lent > 0);
      if (lent.length) {
        after.empties = { ...(c.empties || {}) };
        for (const e of lent) after.empties[e.id] = Math.max(0, (Number(after.empties[e.id]) || 0) - e.lent);
        // valor absoluto: si el cliente ya devolvió esos envases, su cuenta no queda en negativo
        patch.empties = Object.fromEntries(lent.map((e) => [e.id, after.empties[e.id]]));
      }
    }
    b.set(store.ref('clients', c.id), patch, { merge: true });
    putCard(b, after);
  }
  const shift = store.openShift;
  const f = sale.cashFlow || FLOW0();
  const reverse = { inUSD: f.outUSD || 0, inBs: f.outBs || 0, outUSD: f.inUSD || 0, outBs: f.inBs || 0 };
  let cashReverted = false;
  if (shift && (sale.received || 0) > 0) {
    const extra = {};
    if (sale.shiftId === shift.id) { extra.salesCount = -1; extra.salesTotal = -(sale.received || 0); for (const [k, v] of Object.entries(methodNet(sale))) extra[`byMethod.${k}`] = -v; }
    b.update(store.ref('cash_shifts', shift.id), shiftIncrements(reverse, extra));
    if (reverse.inUSD || reverse.outUSD) b.set(store.newRef('cash_movements'), { shiftId: shift.id, date, dayKey: todayKey(), type: 'void', direction: 'out', currency: 'USD', amount: 0, flow: reverse, concept: `Anulación ${sale.number}`, category: 'Anulaciones', refId: sale.id, by: by() });
    cashReverted = true;
  }
  await store.commit(b);
  return { cashReverted };
}

// ======================================================================
// ENVASES RETORNABLES (vacíos y gaveras)
// ======================================================================
/**
 * El cliente trae vacíos fuera de una venta.
 * mode 'prestados': salda envases que se le prestaron · 'deposito': se le devuelve el depósito en efectivo (sale de la caja)
 * items: { idEnvase: cantidad }
 */
export async function receiveEmpties({ client = null, items = {}, mode = 'prestados', note = '' }) {
  const list = Object.entries(items).map(([id, n]) => [id, Math.max(0, Math.round(Number(n) || 0))]).filter(([id, n]) => n > 0 && store.container(id));
  if (!list.length) throw new Error('Indica cuántos envases trae.');
  if (mode === 'prestados') {
    if (!client) throw new Error('Elige el cliente que devuelve los envases.');
    for (const [id, n] of list) if (n > (Number(client.empties?.[id]) || 0)) throw new Error(`${client.name} solo debe ${Number(client.empties?.[id]) || 0} de ${store.container(id).name}.`);
  }
  const date = nowISO();
  const b = store.batch();
  const refund = mode === 'deposito' ? round2(list.reduce((a, [id, n]) => a + n * (Number(store.container(id).deposit) || 0), 0)) : 0;
  if (refund > 0) {
    const shift = store.openShift;
    if (!shift) throw new Error('Abre la caja para devolver el depósito en efectivo.');
    const flow = FLOW0(); flow.outUSD = refund;
    b.set(store.newRef('cash_movements'), { shiftId: shift.id, date, dayKey: todayKey(), type: 'expense', direction: 'out', currency: 'USD', amount: refund, rate: 1, flow, concept: `Devolución de depósito de envases${client ? ' · ' + client.name : ''}`, category: 'Depósito de envases', note, by: by() });
    b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, { expensesUSD: refund }));
  }
  b.set(store.ref('config', 'empties'), { stock: Object.fromEntries(list.map(([id, n]) => [id, store.inc(n)])), updatedAt: date }, { merge: true });
  for (const [id, n] of list) b.set(store.newRef('empties_logs'), { date, dayKey: todayKey(), type: mode === 'deposito' ? 'deposito' : 'devuelto', containerId: id, qty: n, lent: mode === 'prestados' ? -n : 0, charged: 0, deposit: mode === 'deposito' ? round2(n * (Number(store.container(id).deposit) || 0)) : 0, clientId: client?.id || null, clientName: client?.name || '', ref: note || '', by: by() });
  if (client && mode === 'prestados') {
    const after = { ...client, empties: { ...(client.empties || {}) } };
    for (const [id, n] of list) after.empties[id] = Math.max(0, (Number(after.empties[id]) || 0) - n);
    b.set(store.ref('clients', client.id), { empties: Object.fromEntries(list.map(([id, n]) => [id, store.inc(-n)])), updatedAt: date }, { merge: true });
    putCard(b, after);
  }
  await store.commit(b);
  return { refund };
}
/** Entrega de vacíos al proveedor (o a la distribuidora) */
export async function emptiesToSupplier({ items = {}, supplierId = null, note = '' }) {
  const list = Object.entries(items).map(([id, n]) => [id, Math.max(0, Math.round(Number(n) || 0))]).filter(([id, n]) => n > 0 && store.container(id));
  if (!list.length) throw new Error('Indica cuántos envases entregas.');
  for (const [id, n] of list) if (n > store.emptiesStock(id)) throw new Error(`Solo hay ${store.emptiesStock(id)} de ${store.container(id).name} en el depósito.`);
  const sup = supplierId ? store.supplier(supplierId) : null;
  const date = nowISO();
  const b = store.batch();
  b.set(store.ref('config', 'empties'), { stock: Object.fromEntries(list.map(([id, n]) => [id, store.inc(-n)])), updatedAt: date }, { merge: true });
  for (const [id, n] of list) b.set(store.newRef('empties_logs'), { date, dayKey: todayKey(), type: 'proveedor', containerId: id, qty: -n, lent: 0, charged: 0, deposit: 0, clientId: null, clientName: sup?.name || '', ref: note || '', by: by() });
  await store.commit(b);
}
/** Conteo físico de vacíos: fija la existencia */
export async function countEmpties(counts = {}) {
  const date = nowISO();
  const b = store.batch();
  const patch = {};
  for (const [id, v] of Object.entries(counts)) {
    const n = Math.max(0, Math.round(Number(v) || 0));
    const d = n - store.emptiesStock(id);
    if (!d || !store.container(id)) continue;
    patch[id] = store.inc(d);
    b.set(store.newRef('empties_logs'), { date, dayKey: todayKey(), type: 'conteo', containerId: id, qty: d, lent: 0, charged: 0, deposit: 0, clientId: null, clientName: '', ref: 'Conteo físico', by: by() });
  }
  if (!Object.keys(patch).length) return 0;
  b.set(store.ref('config', 'empties'), { stock: patch, updatedAt: date }, { merge: true });
  await store.commit(b);
  return Object.keys(patch).length;
}

// ======================================================================
// INVENTARIO
// ======================================================================
const PRODUCT_FIELDS = ['name', 'active', 'strength', 'abv', 'form', 'lab', 'origin', 'barcode', 'sku', 'category', 'location', 'unitsPerBox', 'packUnits', 'fraction', 'price', 'packSale', 'unitPrice', 'wholesale', 'coldExtra', 'cost', 'minStock', 'maxStock', 'trackStock', 'sellable', 'online', 'supplierId', 'notes', 'taxed', 'color', 'returnable', 'containerId', 'crateId', 'combo'];
export function cleanProduct(d) {
  const out = {};
  for (const k of PRODUCT_FIELDS) if (d[k] !== undefined) out[k] = d[k];
  for (const k of ['name', 'active', 'strength', 'form', 'lab', 'origin', 'barcode', 'sku', 'category', 'location', 'notes', 'containerId', 'crateId']) if (out[k] != null) out[k] = String(out[k]).trim();
  for (const k of ['unitsPerBox', 'packUnits']) if (out[k] != null) out[k] = Math.max(k === 'packUnits' ? 0 : 1, Math.round(Number(out[k]) || 0));
  for (const k of ['price', 'packSale', 'unitPrice', 'wholesale', 'coldExtra', 'cost']) if (out[k] != null) out[k] = round2(Number(out[k]) || 0);
  if (out.abv != null) out.abv = Math.max(0, Math.min(100, Math.round((Number(out.abv) || 0) * 10) / 10));
  for (const k of ['minStock', 'maxStock']) if (out[k] != null) out[k] = Math.max(0, Math.round(Number(out[k]) || 0));
  if (out.combo != null) out.combo = (Array.isArray(out.combo) ? out.combo : []).filter((c) => c && c.productId).map((c) => ({ productId: String(c.productId), units: Math.max(1, Math.round(Number(c.units) || 1)) })).slice(0, 12);
  if (out.returnable != null) out.returnable = !!out.returnable;
  return out;
}
/** Crea o edita un producto. Al crear: stock inicial (unidades) con su lote y vencimiento. */
export async function saveProduct(data, id = null, initial = null) {
  const clean = cleanProduct(data);
  if (!clean.name) throw new Error('Escribe el nombre del producto.');
  if (clean.barcode) { const dup = store.byBarcode(clean.barcode); if (dup && dup.id !== id) throw new Error(`Ese código de barras ya es de ${dup.name}.`); }
  if (clean.combo?.some((c) => c.productId === id)) throw new Error('Un combo no puede contenerse a sí mismo.');
  const b = store.batch();
  const ref = id ? store.ref('products', id) : store.newRef('products');
  const date = nowISO();
  if (!id) {
    const units = Math.max(0, Math.round(Number(initial?.units) || 0));
    const lots = units ? addLot([], { lot: initial?.lot || '', exp: initial?.exp || '', qty: units, cost: clean.cost || 0 }) : [];
    b.set(ref, { unitsPerBox: 1, packUnits: 0, fraction: true, trackStock: true, sellable: true, online: true, returnable: false, ...clean, stock: units, lots, expiresAt: nextExpiry({ lots }), sold: 0, createdAt: date, updatedAt: date, by: by() });
    if (units) b.set(store.newRef('inventory_logs'), { productId: ref.id, name: clean.name, date, dayKey: todayKey(), type: 'entrada', qty: units, cost: (clean.cost || 0) / (clean.unitsPerBox || 1), lots: [{ lot: initial?.lot || '', exp: initial?.exp || '', qty: units }], reason: 'Existencia inicial', by: by() });
  } else b.set(ref, { ...clean, updatedAt: date }, { merge: true });
  await store.commit(b);
  return { id: ref.id, ...(store.product(ref.id) || {}), ...clean };
}

/**
 * Movimiento manual de inventario (en UNIDADES).
 * mode: 'entrada' (ajuste positivo con lote) | 'rotura' | 'merma' | 'vencido' | 'cortesia' | 'devolucion_prov' | 'conteo' (fija la existencia) | 'uso'
 */
export async function moveProduct(p, { mode, units, lot = '', exp = '', reason = '', unitCostV = null }) {
  const cur = store.product(p.id) || p;
  if (isCombo(cur)) throw new Error('Los combos no tienen existencia propia: ajusta sus productos.');
  const current = Number(cur.stock) || 0;
  const q = Math.max(0, Math.round(Number(units) || 0));
  let lots = cur.lots || [];
  let delta = 0; let used = [];
  if (mode === 'entrada') { delta = q; lots = addLot(lots, { lot, exp, qty: q, cost: unitCostV ?? unitCost(cur) * upb(cur) }); used = [{ lot, exp, qty: q }]; }
  else if (mode === 'conteo') {
    delta = q - current;
    if (delta > 0) { lots = addLot(lots, { lot, exp, qty: delta }); used = [{ lot, exp, qty: delta }]; }
    else if (delta < 0) { const r = consumeLots(lots, -delta); lots = r.lots; used = r.used; }
  } else {
    if (q > current) throw new Error(`Solo hay ${stockText(cur)}.`);
    delta = -q;
    if (lot || exp) {
      const list = lots.map((l) => ({ ...l }));
      const hit = list.find((l) => (l.lot || '') === lot && (l.exp || '') === exp);
      if (!hit || hit.qty < q) throw new Error('Ese lote no tiene esa cantidad.');
      hit.qty -= q; lots = list.filter((l) => l.qty > 0); used = [{ lot, exp, qty: q }];
    } else { const r = consumeLots(lots, q); lots = r.lots; used = r.used; }
  }
  const date = nowISO();
  const b = store.batch();
  b.update(store.ref('products', p.id), { stock: store.inc(delta), lots, expiresAt: nextExpiry({ lots }) || '', updatedAt: date });
  b.set(store.newRef('inventory_logs'), { productId: p.id, name: cur.name, date, dayKey: todayKey(), type: mode, qty: delta, cost: unitCost(cur), lots: used, reason, by: by() });
  await store.commit(b);
  return delta;
}

// ======================================================================
// PROVEEDORES Y COMPRAS
// ======================================================================
export async function saveSupplier(data, id = null) {
  const name = String(data.name || '').trim();
  if (!name) throw new Error('Escribe el nombre del proveedor.');
  const clean = { name, rif: String(data.rif || '').trim(), contact: String(data.contact || '').trim(), phone: String(data.phone || '').trim(), email: String(data.email || '').trim(), days: Math.max(0, Math.round(Number(data.days) || 0)), visitDay: String(data.visitDay || '').trim(), notes: String(data.notes || '').trim(), active: data.active !== false, updatedAt: nowISO() };
  const ref = id ? store.ref('suppliers', id) : store.newRef('suppliers');
  await store.save('suppliers', ref.id, id ? clean : { ...clean, createdAt: nowISO() }, !!id);
  return { id: ref.id, ...clean };
}
/** Sugerido de compra: lo que está en o bajo el mínimo, hasta llegar al máximo (o 2× el mínimo). En cajas. */
export function suggestedOrder(supplierId = null) {
  return store.lowProducts.filter((p) => !isCombo(p)).filter((p) => !supplierId || p.supplierId === supplierId).map((p) => {
    const k = upb(p); const st = Math.max(0, Number(p.stock) || 0);
    const target = Number(p.maxStock) > 0 ? Number(p.maxStock) : Math.max(Number(p.minStock) * 2, k);
    const boxes = Math.max(1, Math.ceil((target - st) / k));
    return { p, boxes, cost: Number(p.lastCost || p.cost) || 0 };
  });
}
/** Orden de compra (pedido al proveedor, aún no recibida) */
export async function createPurchaseOrder({ supplierId, items, note = '' }) {
  const sup = store.supplier(supplierId);
  const list = (items || []).filter((i) => i.productId && Number(i.boxes) > 0).map((i) => ({ productId: i.productId, name: i.name || store.product(i.productId)?.name || '', boxes: Math.round(Number(i.boxes)), cost: round2(Number(i.cost) || 0) }));
  if (!list.length) throw new Error('Agrega al menos un producto.');
  const b = store.batch();
  const seq = store.nextSeq(b, 'po');
  const ref = store.newRef('purchases');
  const total = round2(list.reduce((a, i) => a + i.boxes * i.cost, 0));
  const doc0 = { number: fmtSeq('OC', seq, 5), seq, status: 'pedido', supplierId: supplierId || null, supplierName: sup?.name || 'Sin proveedor', items: list, total, paid: 0, balance: 0, note, date: nowISO(), dayKey: todayKey(), by: by() };
  b.set(ref, doc0);
  await store.commit(b);
  return { id: ref.id, ...doc0 };
}
/**
 * Recepción de mercancía (con o sin orden previa): entra al inventario por lote y vencimiento.
 * items: [{ productId, boxes, cost (por caja), lot, exp, price? (nuevo precio de venta por caja) }]
 * paid: lo que se paga ahora · payFromCash: el pago sale de la caja · dueDate: vencimiento de la factura (crédito)
 */
export async function receivePurchase({ order = null, supplierId, invoiceNo = '', items, paid = 0, payFromCash = false, dueDate = '', note = '' }) {
  const sup = store.supplier(supplierId || order?.supplierId);
  const list = (items || []).filter((i) => i.productId && Number(i.boxes) > 0 && !isCombo(store.product(i.productId)));
  if (!list.length) throw new Error('Indica las cantidades recibidas.');
  const total = round2(list.reduce((a, i) => a + Math.round(Number(i.boxes)) * (Number(i.cost) || 0), 0));
  const pay = round2(Math.min(total, Math.max(0, Number(paid) || 0)));
  const b = store.batch();
  const date = nowISO();
  const ref = order ? store.ref('purchases', order.id) : store.newRef('purchases');
  const seq = order?.seq || store.nextSeq(b, 'po');
  const lines = [];
  for (const i of list) {
    const p = store.product(i.productId);
    if (!p) continue;
    const k = upb(p); const boxes = Math.round(Number(i.boxes)); const units = boxes * k; const cost = round2(Number(i.cost) || 0);
    const stockNow = Math.max(0, Number(p.stock) || 0);
    const avg = cost > 0 ? round2(((stockNow / k) * (Number(p.cost) || 0) + boxes * cost) / (stockNow / k + boxes)) : Number(p.cost) || 0;
    const lots = addLot(p.lots || [], { lot: String(i.lot || '').trim(), exp: i.exp || '', qty: units, cost });
    const patch = { stock: store.inc(units), lots, expiresAt: nextExpiry({ lots }) || '', cost: avg, lastCost: cost, lastPurchaseAt: date, updatedAt: date };
    if (sup) patch.supplierId = sup.id;
    if (Number(i.price) > 0) patch.price = round2(i.price);
    b.update(store.ref('products', p.id), patch);
    b.set(store.newRef('inventory_logs'), { productId: p.id, name: p.name, date, dayKey: todayKey(), type: 'compra', qty: units, cost: cost / k, lots: [{ lot: String(i.lot || '').trim(), exp: i.exp || '', qty: units }], reason: `Compra ${fmtSeq('OC', seq, 5)}${invoiceNo ? ' · Fact. ' + invoiceNo : ''}${sup ? ' · ' + sup.name : ''}`, by: by() });
    lines.push({ productId: p.id, name: p.name, boxes, units, cost, lot: String(i.lot || '').trim(), exp: i.exp || '' });
  }
  const payments = [];
  if (pay > 0) {
    if (payFromCash) {
      const shift = store.openShift;
      if (!shift) throw new Error('Abre la caja para pagar con dinero de la caja.');
      const flow = FLOW0(); flow.outUSD = pay;
      b.set(store.newRef('cash_movements'), { shiftId: shift.id, date, dayKey: todayKey(), type: 'expense', direction: 'out', currency: 'USD', amount: pay, rate: 1, flow, concept: `Pago compra ${fmtSeq('OC', seq, 5)} · ${sup?.name || ''}`, category: 'Compra de mercancía', refId: ref.id, by: by() });
      b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, { expensesUSD: pay }));
    }
    payments.push({ date, amount: pay, fromCash: !!payFromCash, by: by() });
  }
  const data = {
    number: fmtSeq('OC', seq, 5), seq, status: 'recibida', supplierId: sup?.id || null, supplierName: sup?.name || 'Sin proveedor', invoiceNo: String(invoiceNo || '').trim(),
    items: lines, total, paid: pay, balance: round2(total - pay), payments, dueDate: total - pay > 0.004 ? (dueDate || dayKey(addDays(new Date(), Number(sup?.days) || 30))) : '',
    receivedAt: date, date: order?.date || date, dayKey: order?.dayKey || todayKey(), note: note || order?.note || '', by: by()
  };
  b.set(ref, data, { merge: true });
  await store.commit(b);
  return { id: ref.id, ...data };
}
/** Abono a una factura de proveedor (cuentas por pagar) */
export async function payPurchase(pu, { amount, fromCash = false, note = '' }) {
  const amt = round2(Math.min(Number(pu.balance) || 0, Number(amount) || 0));
  if (!(amt > 0)) throw new Error('Indica el monto.');
  const b = store.batch();
  const date = nowISO();
  if (fromCash) {
    const shift = store.openShift;
    if (!shift) throw new Error('Abre la caja para pagar con dinero de la caja.');
    const flow = FLOW0(); flow.outUSD = amt;
    b.set(store.newRef('cash_movements'), { shiftId: shift.id, date, dayKey: todayKey(), type: 'expense', direction: 'out', currency: 'USD', amount: amt, rate: 1, flow, concept: `Abono ${pu.number} · ${pu.supplierName}`, category: 'Pago a proveedores', refId: pu.id, by: by() });
    b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, { expensesUSD: amt }));
  }
  b.update(store.ref('purchases', pu.id), { paid: store.inc(amt), balance: round2((Number(pu.balance) || 0) - amt), payments: [...(pu.payments || []), { date, amount: amt, fromCash, note, by: by() }], updatedAt: date });
  await store.commit(b);
}
export async function cancelPurchaseOrder(pu) {
  if (pu.status !== 'pedido') throw new Error('Solo se anulan órdenes que aún no se reciben.');
  await store.save('purchases', pu.id, { status: 'anulada', cancelledAt: nowISO() });
}

// ======================================================================
// PEDIDOS EN LÍNEA (catálogo público shops/{slug} + orders/{id})
// ======================================================================
export function shopDoc() {
  const s = store.settings; const S = s.shop; const L = loc();
  const mk = { markup: s.fractionMarkup };
  const items = store.sellable.filter((p) => p.online !== false).slice(0, 1500).map((p) => {
    const combo = isCombo(p);
    const have = combo ? comboStock(p) : Number(p.stock) || 0;
    const tracked = !combo && p.trackStock === false ? false : true;
    const unit = !combo && fractionable(p);
    return {
      id: p.id, n: p.name, a: p.active || '', s: p.strength || '', g: Number(p.abv) || 0, c: p.category || '', b: p.lab || '', u: combo ? 1 : upb(p),
      p: round2(Number(p.price) || 0), pu: unit ? packPrice(p, 'unidad', mk) : 0, k: combo ? 1 : 0, f: Number(p.coldExtra) > 0 ? round2(p.coldExtra) : 0,
      ok: !tracked ? 1 : unit ? (have >= upb(p) ? 1 : have > 0 ? 2 : 0) : (have >= 3 ? 1 : have > 0 ? 2 : 0)
    };
  });
  return {
    tenantId: store.tenantId, enabled: S.enabled !== false, shop: store.businessName, phone: s.whatsapp || s.phone || '', address: s.address || '', instagram: s.instagram || '',
    schedule: s.schedule || '', country: s.country || '', sym: L.sym, dec: L.dec, dial: L.dial || '', fx: s.fx?.enabled && Number(s.fx.rate) > 0 ? { sym: s.fx.sym, rate: Number(s.fx.rate) } : null,
    delivery: S.delivery !== false, deliveryFee: Number(S.deliveryFee) || 0, minOrder: Number(S.minOrder) || 0, note: S.note || '', showStock: S.showStock !== false,
    items, demo: store.isDemo, updatedAt: nowISO()
  };
}
let lastPublished = '';
export async function publishShop({ force = false } = {}) {
  const S = store.settings.shop;
  if (!S?.slug || !store.tenantId) return false;
  const d = shopDoc();
  const key = JSON.stringify({ ...d, updatedAt: '' });
  if (!force && key === lastPublished) return false;
  lastPublished = key;
  const b = store.batch();
  b.set(store.shopRef(S.slug), d);
  await store.commit(b);
  return true;
}
export function resetPublished() { lastPublished = ''; }
export async function setOrderStatus(o, status, extra = {}) {
  const b = store.batch();
  b.update(store.orderRef(o.id), { status, [`${status}At`]: nowISO(), ...extra });
  await store.commit(b);
}
export async function deleteOrder(o) { const b = store.batch(); b.delete(store.orderRef(o.id)); await store.commit(b); }
/** Convierte un pedido en líneas del punto de venta */
export function orderLines(o) {
  const mk = store.settings.fractionMarkup;
  return (o.items || []).map((i) => {
    const p = store.product(i.id);
    if (!p) return null;
    const pack = i.k === 'caja' || !fractionable(p) ? 'caja' : 'unidad';
    const cold = !!o.cold && Number(p.coldExtra) > 0;
    const price = packPrice(p, pack, { markup: mk, cold });
    return { productId: p.id, name: p.name, pack, factor: packFactor(p, pack), qty: Math.max(1, Math.round(Number(i.q) || 1)), price, listPrice: price, cost: round4(unitCost(p) * packFactor(p, pack)), kind: isCombo(p) ? 'combo' : 'producto', cold, detail: packLabel(p, pack) };
  }).filter(Boolean);
}

// ======================================================================
// CAJA
// ======================================================================
export async function cashMovement({ direction, currency, amount, concept, category, note = '' }) {
  const shift = store.openShift;
  if (!shift) throw new Error('No hay caja abierta.');
  const b = store.batch();
  const flow = FLOW0();
  flow[direction === 'in' ? 'inUSD' : 'outUSD'] = round2(amount);
  const date = nowISO();
  b.set(store.newRef('cash_movements'), { shiftId: shift.id, date, dayKey: todayKey(), type: direction === 'in' ? 'income' : 'expense', direction, currency, amount: round2(amount), rate: 1, flow, concept, category, note, by: by() });
  b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, direction === 'out' ? { expensesUSD: amount } : { incomeUSD: amount }));
  await store.commit(b);
}
export async function openShift({ openingUSD, openingBs = 0, note = '' }) {
  if (store.openShift) throw new Error('Ya hay una caja abierta.');
  const ref = store.newRef('cash_shifts');
  const b = store.batch();
  const seq = store.nextSeq(b, 'shift');
  b.set(ref, { status: 'open', openedAt: nowISO(), openedBy: by(), dayKey: todayKey(), number: fmtSeq('T', seq, 4), openingUSD: round2(openingUSD), openingBs: round2(openingBs), rateAtOpen: 1, inUSD: 0, inBs: 0, outUSD: 0, outBs: 0, salesCount: 0, salesTotal: 0, note });
  await store.commit(b);
  return ref.id;
}
export function shiftExpected(shift) {
  return { usd: round2((shift.openingUSD || 0) + (shift.inUSD || 0) - (shift.outUSD || 0)), bs: round2((shift.openingBs || 0) + (shift.inBs || 0) - (shift.outBs || 0)) };
}
export async function closeShift(shift, { countedUSD, countedBs = 0, note = '' }) {
  const exp = shiftExpected(shift);
  const b = store.batch();
  b.update(store.ref('cash_shifts', shift.id), { status: 'closed', closedAt: nowISO(), closedBy: by(), rateAtClose: 1, expectedUSD: exp.usd, expectedBs: exp.bs, countedUSD: round2(countedUSD), countedBs: round2(countedBs), diffUSD: round2(countedUSD - exp.usd), diffBs: round2(countedBs - exp.bs), closeNote: note });
  await store.commit(b);
}

export { addDays, dayKey, fmtDate, normalize, defaultPack };
