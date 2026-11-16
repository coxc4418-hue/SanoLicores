// SanoLicores — Conocimiento de licorería: presentaciones (unidad, pack, caja), precio frío y al mayor, combos,
// envases retornables, lotes con vencimiento (FEFO) y alternativas del mismo tipo y tamaño
import { round2, normalize, todayKey, dayKey, addDays, fromKey, qtyFmt } from './utils.js';

export const CATEGORIES = ['Cervezas', 'Rones', 'Whisky', 'Vodka', 'Ginebra', 'Tequila y mezcal', 'Anís y aguardientes', 'Vinos', 'Espumantes', 'Sangrías y cócteles listos', 'Licores y cremas', 'Refrescos y jugos', 'Agua y energizantes', 'Hielo', 'Snacks y pasapalos', 'Cigarrillos', 'Combos', 'Otros'];

/** Envase del producto */
export const FORMS = ['Botella', 'Botella retornable', 'Lata', 'Tetra pak', 'Garrafa', 'Petaca', 'Barril', 'Bolsa', 'Paquete', 'Otro'];

/** Contenidos más comunes (ayuda al cargar productos) */
export const SIZES = ['222 ml', '250 ml', '330 ml', '355 ml', '473 ml', '500 ml', '700 ml', '750 ml', '1 L', '1,5 L', '1,75 L', '2 L', '5 kg'];

export const LOYALTY_DEFAULT = { enabled: true, per: 1, pointValue: 0.05, minRedeem: 100 };

/** Envases retornables que se manejan por defecto (el depósito se ajusta en Configuración → Envases) */
export const CONTAINERS_DEFAULT = [
  { id: 'b13', name: 'Botella 1/3 retornable', short: 'Botella 1/3', deposit: 0.15, active: true },
  { id: 'b1l', name: 'Botella 1 L retornable', short: 'Botella 1 L', deposit: 0.3, active: true },
  { id: 'gav', name: 'Gavera / caja plástica', short: 'Gavera', deposit: 3, active: true }
];

/** Tipo de cliente */
export const CLIENT_TYPES = {
  detal: { label: 'Detal', tone: 'neutral' },
  mayor: { label: 'Al mayor', tone: 'violet', hint: 'Bodegas, bares, restaurantes, eventos: paga el precio al mayor' }
};

// ======================================================================
// PRESENTACIONES: el stock se guarda en UNIDADES (botellas, latas…)
// ======================================================================
export const PACKS = { unidad: 'Unidad', pack: 'Pack', caja: 'Caja' };
/** Unidades por caja (1 = se vende solo por unidad) */
export const upb = (p) => Math.max(1, Math.round(Number(p?.unitsPerBox) || 1));
export const isBoxed = (p) => upb(p) > 1;
/** Se puede vender suelto (por unidad) */
export const fractionable = (p) => isBoxed(p) && p?.fraction !== false;
/** Tiene pack intermedio (six-pack, 12-pack…) */
export const hasPack = (p) => fractionable(p) && Number(p?.packUnits) > 1 && Number(p.packUnits) < upb(p);
export const packName = (p) => (hasPack(p) ? (Number(p.packUnits) === 6 ? 'Six-pack' : `Pack x${Math.round(p.packUnits)}`) : 'Pack');
/** Cuántas unidades trae cada presentación */
export function packFactor(p, pack) {
  if (pack === 'unidad') return 1;
  if (pack === 'pack') return hasPack(p) ? Math.round(Number(p.packUnits)) : upb(p);
  return upb(p);
}
/** Presentaciones que se pueden vender de este producto (la primera es la que se usa al escanear) */
export function packsOf(p) {
  if (!isBoxed(p)) return ['caja'];
  const out = [];
  if (fractionable(p)) out.push('unidad');
  if (hasPack(p)) out.push('pack');
  out.push('caja');
  return out;
}
/** Presentación por defecto al escanear: la unidad (el código de barras va en la botella o lata) */
export const defaultPack = (p) => packsOf(p)[0];
/**
 * Precio de venta de una presentación.
 * price = precio de la CAJA (o de la unidad si el producto no viene en caja).
 * unitPrice / packSale = precios propios de la unidad y el pack (si no, se calculan con el recargo por vender suelto).
 * wholesale = precio de la caja al mayor · coldExtra = recargo por unidad fría.
 */
export function packPrice(p, pack, { markup = 0, cold = false, mayor = false } = {}) {
  const box = Number(p?.price) || 0;
  let v;
  if (pack === 'caja' || !isBoxed(p)) v = mayor && Number(p?.wholesale) > 0 ? Number(p.wholesale) : box;
  else if (pack === 'unidad' && Number(p.unitPrice) > 0) v = Number(p.unitPrice);
  else if (pack === 'pack' && Number(p.packSale) > 0) v = Number(p.packSale);
  else {
    const base = mayor && Number(p?.wholesale) > 0 ? Number(p.wholesale) : box;
    v = (base / upb(p)) * packFactor(p, pack) * (1 + (Number(markup) || 0) / 100);
  }
  if (cold && canCold(p)) v += (Number(p.coldExtra) || 0) * packFactor(p, pack);
  return round2(v);
}
/** Se vende fría con recargo */
export const canCold = (p) => Number(p?.coldExtra) > 0;
export const unitCost = (p) => (isCombo(p) ? comboCost(p) : (Number(p?.cost) || 0) / upb(p));
export const packLabel = (p, pack) => {
  if (!isBoxed(p)) return isCombo(p) ? 'Combo' : 'Unidad';
  if (pack === 'caja') return `Caja x${upb(p)}`;
  if (pack === 'pack') return hasPack(p) ? `${packName(p)} x${packFactor(p, 'pack')}` : `Caja x${upb(p)}`;
  return 'Unidad';
};
/** "3 cajas + 5 und" */
export function stockText(p, units = p?.stock) {
  const u = Math.max(0, Math.round(Number(units) || 0));
  const k = upb(p);
  if (k <= 1) return `${qtyFmt(u)} und`;
  const b = Math.floor(u / k); const r = u % k;
  if (!b) return `${r} und`;
  return `${b} caja${b === 1 ? '' : 's'}${r ? ` + ${r} und` : ''}`;
}
export const boxesOf = (p, units = p?.stock) => (Number(units) || 0) / upb(p);

// ======================================================================
// COMBOS: un producto que se arma con otros (ej. ron + 2 refrescos + hielo)
// ======================================================================
export const isCombo = (p) => Array.isArray(p?.combo) && p.combo.length > 0;
let _lookup = () => null;
/** La capa de datos registra cómo buscar productos (evita importar store aquí) */
export function setProductLookup(fn) { _lookup = fn; }
export function comboCost(p) {
  return round2((p.combo || []).reduce((a, c) => { const x = _lookup(c.productId); return a + (x ? (Number(x.cost) || 0) / upb(x) : 0) * (Number(c.units) || 0); }, 0) * 10000) / 10000;
}
/** Cuántos combos se pueden armar con el inventario (o con `availFn`) */
export function comboStock(p, availFn = null) {
  let n = Infinity;
  for (const c of p.combo || []) {
    const x = _lookup(c.productId);
    if (!x || x.trackStock === false) continue;
    const have = availFn ? availFn(x) : Number(x.stock) || 0;
    n = Math.min(n, Math.floor(have / Math.max(1, Number(c.units) || 1)));
  }
  return n === Infinity ? 99 : Math.max(0, n);
}
export const comboLine = (p) => (p.combo || []).map((c) => { const x = _lookup(c.productId); return `${c.units > 1 ? c.units + ' × ' : ''}${x ? x.name : '¿?'}`; }).join(' + ');

// ======================================================================
// ENVASES RETORNABLES
// ======================================================================
/** Envases que lleva una línea del carrito: botellas por unidad + gavera por caja */
export function emptiesOfLine(p, pack, qty, containers) {
  const out = {};
  if (!p || p.returnable !== true) return out;
  const units = packFactor(p, pack) * (Number(qty) || 0);
  if (p.containerId && containers.find((c) => c.id === p.containerId && c.active !== false)) out[p.containerId] = units;
  if (pack === 'caja' && p.crateId && containers.find((c) => c.id === p.crateId && c.active !== false)) out[p.crateId] = (out[p.crateId] || 0) + (Number(qty) || 0);
  return out;
}
export function emptiesOfCart(lines, products, containers) {
  const out = {};
  for (const l of lines || []) {
    const p = l.productId ? products(l.productId) : null;
    for (const [k, v] of Object.entries(emptiesOfLine(p, l.pack, l.qty, containers))) out[k] = (out[k] || 0) + v;
  }
  return out;
}

// ======================================================================
// LOTES Y VENCIMIENTOS (FEFO: lo que vence primero, sale primero)
// ======================================================================
export const lotsOf = (p) => (p?.lots || []).filter((l) => (Number(l.qty) || 0) > 0).sort((a, b) => (a.exp || '9999').localeCompare(b.exp || '9999'));
export const nextExpiry = (p) => lotsOf(p).find((l) => l.exp)?.exp || '';
/** Saca `units` de los lotes empezando por el que vence primero. Devuelve los lotes nuevos y lo que salió de cada uno. */
export function consumeLots(lots, units) {
  const list = (lots || []).map((l) => ({ ...l })).sort((a, b) => (a.exp || '9999').localeCompare(b.exp || '9999'));
  let left = Math.max(0, Number(units) || 0);
  const used = [];
  for (const l of list) {
    if (left <= 0) break;
    const q = Math.min(Number(l.qty) || 0, left);
    if (q <= 0) continue;
    l.qty = (Number(l.qty) || 0) - q; left -= q;
    used.push({ lot: l.lot || '', exp: l.exp || '', qty: q });
  }
  return { lots: list.filter((l) => l.qty > 0), used, missing: left };
}
/** Devuelve unidades a sus lotes (anulación o devolución) */
export function restoreLots(lots, used) {
  const list = (lots || []).map((l) => ({ ...l }));
  for (const u of used || []) {
    const hit = list.find((l) => (l.lot || '') === (u.lot || '') && (l.exp || '') === (u.exp || ''));
    if (hit) hit.qty = (Number(hit.qty) || 0) + u.qty; else list.push({ lot: u.lot || '', exp: u.exp || '', qty: u.qty });
  }
  return list.sort((a, b) => (a.exp || '9999').localeCompare(b.exp || '9999'));
}
/** Agrega una entrada a un lote (si ya existe el mismo lote y fecha, suma) */
export function addLot(lots, { lot = '', exp = '', qty = 0, cost = 0 }) {
  const list = (lots || []).map((l) => ({ ...l }));
  const hit = list.find((l) => (l.lot || '') === lot && (l.exp || '') === exp);
  if (hit) hit.qty = (Number(hit.qty) || 0) + qty; else list.push({ lot, exp, qty, cost: round2(cost), in: todayKey() });
  return list.filter((l) => l.qty > 0).sort((a, b) => (a.exp || '9999').localeCompare(b.exp || '9999'));
}
/** Días que faltan para vencer (negativo = vencido) */
export const daysToExpiry = (exp) => (exp ? Math.round((fromKey(exp) - fromKey(todayKey())) / 864e5) : null);
export function expiryTone(exp) {
  const d = daysToExpiry(exp);
  if (d == null) return ['', 'neutral'];
  if (d < 0) return ['Vencido', 'danger'];
  if (d <= 30) return [`Vence en ${d} d`, 'danger'];
  if (d <= 60) return [`Vence en ${d} d`, 'warning'];
  if (d <= 90) return [`Vence en ${d} d`, 'info'];
  return [`Vence ${exp.slice(5, 7)}/${exp.slice(2, 4)}`, 'neutral'];
}
export const expBadge = (exp) => { if (!exp) return ''; const [t, tone] = expiryTone(exp); return `<span class="badge badge-${tone}">${t}</span>`; };
export const limitDay = (days) => dayKey(addDays(new Date(), days));

// ======================================================================
// ALTERNATIVAS (mismo tipo y mismo tamaño, ordenadas por precio por unidad)
// ======================================================================
const key = (s) => normalize(s).replace(/[^a-z0-9]+/g, ' ').trim();
export const kindKey = (p) => key(p?.active || '') || key(p?.category || '');
export const sizeKey = (p) => key(p?.strength || '').replace(/\s+/g, '');
export function equivalents(p, products) {
  const m = kindKey(p);
  if (!m || isCombo(p)) return [];
  const s = sizeKey(p);
  return products.filter((x) => x.id !== p.id && x.active !== false && x.sellable !== false && !isCombo(x) && kindKey(x) === m && (!s || !sizeKey(x) || sizeKey(x) === s))
    .sort((a, b) => (Number(a.price) / upb(a)) - (Number(b.price) / upb(b)));
}
/** Texto de búsqueda de un producto */
export const searchText = (p) => normalize(`${p.name} ${p.active || ''} ${p.strength || ''} ${p.form || ''} ${p.lab || ''} ${p.origin || ''} ${p.barcode || ''} ${p.sku || ''} ${p.category || ''} ${p.location || ''}`);
export const productLine = (p) => (isCombo(p) ? comboLine(p) : [p.active && p.active !== p.name ? p.active : '', p.strength, Number(p.abv) > 0 ? `${String(p.abv).replace('.', ',')}% vol` : '', isBoxed(p) ? `caja x${upb(p)}` : '', p.lab].filter(Boolean).join(' · '));
/** Ícono según categoría */
export const catIcon = (c = '') => /cerve/i.test(c) ? 'beer' : /vino|espum|sangr/i.test(c) ? 'wine' : /refresc|jugo|agua|energ/i.test(c) ? 'droplet' : /hielo/i.test(c) ? 'snow' : /snack|pasapal/i.test(c) ? 'box' : /cigarr/i.test(c) ? 'flame' : /combo/i.test(c) ? 'gift' : 'bottle';
