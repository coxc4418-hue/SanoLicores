// SanoLicores — Modo demo (sesión anónima de 30 minutos) con una licorería de ejemplo llena de vida
import { auth, db, doc, collection, writeBatch, getDoc, getDocs, query, where, Timestamp, signInAnonymously, signOut } from './firebase.js';
import { store, DEFAULT_SETTINGS } from './store.js';
import { fmtSeq, genCode, cardData, clientFields, openShift, chargeSale, cashMovement, receivePurchase, createPurchaseOrder, setOrderStatus, cartTotals, slugify, receiveEmpties } from './ops.js';
import { round2, nowISO, todayKey, dayKey, addDays, sha256, scaleUSD, PAY_METHODS } from './utils.js';
import { addLot, nextExpiry, packFactor, packPrice, unitCost, upb, packLabel, isCombo, emptiesOfCart, LOYALTY_DEFAULT, CONTAINERS_DEFAULT } from './licor.js';

/** PIN de administrador de todas las demos (se muestra en pantalla) */
export const DEMO_PIN = '1234';
export const DEMO_MINUTES = 30;
const DATA_COLLECTIONS = ['clients', 'products', 'sales', 'empties_logs', 'purchases', 'suppliers', 'cash_shifts', 'cash_movements', 'inventory_logs', 'config'];
const BIZ = 'Licorería La Gran Pausa (demo)';

export async function startDemo() { await signInAnonymously(auth); }

export function demoRemainingMs(tenant) {
  const exp = tenant?.expiresAt;
  if (!exp) return 0;
  const ms = typeof exp.toMillis === 'function' ? exp.toMillis() : new Date(exp).getTime();
  return ms - Date.now();
}

const SELLERS = [
  { id: 's1', name: 'Yusmary Pérez', role: 'Encargada', active: true },
  { id: 's2', name: 'Kelvin Rojas', role: 'Despachador', active: true },
  { id: 's3', name: 'Daniela Rivas', role: 'Cajera', active: true }
];

export async function createDemoTenant(uid) {
  const expiresAt = Timestamp.fromMillis(Date.now() + DEMO_MINUTES * 60 * 1000);
  const b1 = writeBatch(db);
  b1.set(doc(db, 'tenants', uid), { name: BIZ, code: 'demo', ownerUid: uid, ownerEmail: '', active: true, demo: true, createdAt: nowISO(), expiresAt });
  await b1.commit();
  const ref = (name, id) => doc(db, 'tenants', uid, name, id);
  const b = writeBatch(db);
  b.set(ref('config', 'settings'), {
    ...DEFAULT_SETTINGS, businessName: BIZ, rif: 'J-50000000-0', phone: '0212-5550000', whatsapp: '0414-5550000', email: 'demo@sanolicores.app',
    address: 'Av. Principal de La Pastora, local 7', instagram: '@lagranpausa', schedule: 'Lun a jue 10:00 a 22:00 · Vie y sáb hasta 00:00 · Dom 11:00 a 18:00',
    liquorLicense: 'Licencia de expendio N° 0871', licenseExpires: dayKey(addDays(new Date(), 24)),
    sellers: SELLERS, loyalty: { ...LOYALTY_DEFAULT }, containers: CONTAINERS_DEFAULT, comebackOffer: '10% de descuento en tu próxima caja de cerveza',
    shop: { ...DEFAULT_SETTINGS.shop, enabled: true, slug: `${slugify('La Gran Pausa')}-${uid.slice(0, 4).toLowerCase()}`, minOrder: 5, note: 'Delivery en 40 min · Te lo llevamos frío · Pago al recibir' },
    receiptFooter: '¡Gracias por su compra! Disfrute con responsabilidad. 🥂'
  });
  b.set(ref('config', 'security'), { pinHash: await sha256(`${uid}:${DEMO_PIN}`), updatedAt: nowISO() });
  await b.commit();
}

async function waitFor(cond, ms = 6000) {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 120));
}
const at = (daysAgo, h, m = 0) => { const d = addDays(new Date(), -daysAgo); d.setHours(h, m, 0, 0); return d; };
const inDays = (n) => dayKey(addDays(new Date(), n));
const birth = (age, mOff, d) => { const t = new Date(); return `${t.getFullYear() - age}-${String(((t.getMonth() + mOff) % 12) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
const birthdayIn = (age, days) => { const t = addDays(new Date(), days); return `${new Date().getFullYear() - age}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
/** Generador pseudoaleatorio con semilla (la demo sale igual cada vez) */
function rng(seed = 7) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

/**
 * k, nombre, tipo, contenido, % alc., envase, marca, origen, categoría, und/caja, und/pack, precio caja, costo caja, precio unidad, precio caja al mayor,
 * recargo frío por unidad, retornable [envase unidad, envase caja], cajas en existencia, mínimo (cajas), lotes [[lote, vence en días, cajas]] | null, ubicación
 */
const PRODUCTS = [
  ['pils13', 'Polar Pilsen botella 1/3', 'Cerveza', '222 ml', 5, 'Botella retornable', 'Polar', 'Venezuela', 'Cervezas', 36, 0, 18, 13.2, 0.6, 16.6, 0.05, ['b13', 'gav'], 14, 5, [['PP2605', 20, 3], ['PP2611', 150, 11]], 'Depósito'],
  ['zulia13', 'Zulia botella 1/3', 'Cerveza', '222 ml', 5, 'Botella retornable', 'Zulia', 'Venezuela', 'Cervezas', 36, 0, 19.8, 14.6, 0.65, 18.2, 0.05, ['b13', 'gav'], 6, 3, null, 'Depósito'],
  ['pils1l', 'Polar Pilsen botella 1 L', 'Cerveza', '1 L', 5, 'Botella retornable', 'Polar', 'Venezuela', 'Cervezas', 12, 0, 21.6, 15.8, 2, 19.8, 0.15, ['b1l', 'gav'], 5, 3, null, 'Depósito'],
  ['pilslata', 'Polar Pilsen lata 355 ml', 'Cerveza', '355 ml', 5, 'Lata', 'Polar', 'Venezuela', 'Cervezas', 24, 6, 26.4, 19.2, 1.2, 24.2, 0.1, null, 12, 4, [['PL2609', 95, 4], ['PL2612', 190, 8]], 'Nevera 1'],
  ['solera', 'Solera Verde lata 355 ml', 'Cerveza', '355 ml', 6, 'Lata', 'Polar', 'Venezuela', 'Cervezas', 24, 6, 28.8, 21, 1.3, 26.4, 0.1, null, 8, 3, null, 'Nevera 1'],
  ['light', 'Polar Light lata 355 ml', 'Cerveza', '355 ml', 4, 'Lata', 'Polar', 'Venezuela', 'Cervezas', 24, 6, 26.4, 19.2, 1.2, 24.2, 0.1, null, 2, 3, null, 'Nevera 1'],
  ['heineken', 'Heineken botella 330 ml', 'Cerveza importada', '330 ml', 5, 'Botella', 'Heineken', 'Países Bajos', 'Cervezas', 24, 6, 38.4, 28.5, 1.75, 35, 0.1, null, 4, 2, null, 'Nevera 2'],
  ['cacique', 'Ron Cacique Añejo 750 ml', 'Ron añejo', '750 ml', 40, 'Botella', 'Cacique', 'Venezuela', 'Rones', 12, 0, 102, 78, 9.5, 96, 0, null, 6, 2, null, 'Estante A'],
  ['steresa', 'Ron Santa Teresa Gran Reserva 750 ml', 'Ron añejo', '750 ml', 40, 'Botella', 'Santa Teresa', 'Venezuela', 'Rones', 12, 0, 120, 91, 11, 112, 0, null, 4, 2, null, 'Estante A'],
  ['diplo', 'Ron Diplomático Reserva Exclusiva 750 ml', 'Ron premium', '750 ml', 40, 'Botella', 'Diplomático', 'Venezuela', 'Rones', 6, 0, 210, 165, 38, 198, 0, null, 0, 1, null, 'Vitrina'],
  ['oldparr', 'Whisky Old Parr 12 años 750 ml', 'Whisky escocés 12 años', '750 ml', 40, 'Botella', 'Old Parr', 'Escocia', 'Whisky', 12, 0, 300, 238, 27, 285, 0, null, 1, 2, null, 'Vitrina'],
  ['buchanans', "Whisky Buchanan's 12 años 750 ml", 'Whisky escocés 12 años', '750 ml', 40, 'Botella', "Buchanan's", 'Escocia', 'Whisky', 12, 0, 336, 268, 30, 318, 0, null, 3, 1, null, 'Vitrina'],
  ['bw', 'Whisky Black & White 750 ml', 'Whisky escocés', '750 ml', 40, 'Botella', 'Black & White', 'Escocia', 'Whisky', 12, 0, 150, 114, 14, 140, 0, null, 4, 2, null, 'Estante B'],
  ['smirnoff', 'Vodka Smirnoff 750 ml', 'Vodka', '750 ml', 37.5, 'Botella', 'Smirnoff', 'Reino Unido', 'Vodka', 12, 0, 96, 72, 9, 90, 0, null, 3, 1, null, 'Estante B'],
  ['absolut', 'Vodka Absolut 750 ml', 'Vodka', '750 ml', 40, 'Botella', 'Absolut', 'Suecia', 'Vodka', 12, 0, 168, 130, 15.5, 158, 0, null, 2, 1, null, 'Estante B'],
  ['gordons', "Ginebra Gordon's 750 ml", 'Ginebra', '750 ml', 37.5, 'Botella', "Gordon's", 'Reino Unido', 'Ginebra', 12, 0, 108, 82, 10, 101, 0, null, 2, 1, null, 'Estante B'],
  ['cuervo', 'Tequila José Cuervo Especial 750 ml', 'Tequila', '750 ml', 38, 'Botella', 'José Cuervo', 'México', 'Tequila y mezcal', 12, 0, 180, 138, 16.5, 170, 0, null, 2, 1, null, 'Estante C'],
  ['cartujo', 'Anís Cartujo 750 ml', 'Anís', '750 ml', 40, 'Botella', 'Cartujo', 'Venezuela', 'Anís y aguardientes', 12, 0, 78, 58, 7.2, 73, 0, null, 3, 1, null, 'Estante C'],
  ['pomar', 'Vino tinto Pomar Cabernet Sauvignon 750 ml', 'Vino tinto', '750 ml', 12.5, 'Botella', 'Pomar', 'Venezuela', 'Vinos', 12, 0, 96, 72, 9, 90, 0, null, 3, 1, null, 'Estante D'],
  ['casillero', 'Vino tinto Casillero del Diablo Cabernet 750 ml', 'Vino tinto', '750 ml', 13.5, 'Botella', 'Concha y Toro', 'Chile', 'Vinos', 12, 0, 144, 110, 13, 136, 0, null, 2, 1, null, 'Estante D'],
  ['brut', 'Espumante Pomar Brut 750 ml', 'Espumante', '750 ml', 12, 'Botella', 'Pomar', 'Venezuela', 'Espumantes', 6, 0, 72, 52, 13, 68, 0.5, null, 3, 1, null, 'Nevera 2'],
  ['sangria', 'Sangría Caroreña 1,5 L', 'Sangría', '1,5 L', 7, 'Botella', 'Caroreña', 'Venezuela', 'Sangrías y cócteles listos', 6, 0, 33, 24, 6, 31, 0.3, null, 4, 2, [['SC118', -3, 1], ['SC140', 210, 3]], 'Nevera 2'],
  ['baileys', 'Crema Baileys Original 750 ml', 'Crema de whisky', '750 ml', 17, 'Botella', 'Baileys', 'Irlanda', 'Licores y cremas', 12, 0, 216, 168, 19.5, 205, 0, null, 1, 1, null, 'Vitrina'],
  ['coca2l', 'Coca-Cola 2 L', 'Refresco cola', '2 L', 0, 'Botella', 'Coca-Cola', 'Venezuela', 'Refrescos y jugos', 6, 0, 13.2, 9.6, 2.4, 12.2, 0.1, null, 10, 4, [['CC0912', 45, 4], ['CC1102', 160, 6]], 'Nevera 3'],
  ['pepsi2l', 'Pepsi 2 L', 'Refresco cola', '2 L', 0, 'Botella', 'Pepsi', 'Venezuela', 'Refrescos y jugos', 6, 0, 12, 8.7, 2.2, 11.1, 0.1, null, 6, 3, null, 'Nevera 3'],
  ['soda', 'Soda (agua con gas) 1,5 L', 'Soda', '1,5 L', 0, 'Botella', 'Glup', 'Venezuela', 'Refrescos y jugos', 6, 0, 8.4, 5.9, 1.5, 7.8, 0.1, null, 5, 2, null, 'Nevera 3'],
  ['agua', 'Agua mineral 600 ml', 'Agua', '600 ml', 0, 'Botella', 'Minalba', 'Venezuela', 'Agua y energizantes', 24, 0, 9.6, 6.2, 0.6, 8.8, 0.05, null, 5, 2, null, 'Nevera 3'],
  ['redbull', 'Energizante Red Bull 250 ml', 'Energizante', '250 ml', 0, 'Lata', 'Red Bull', 'Austria', 'Agua y energizantes', 24, 0, 43.2, 32, 2.2, 40.8, 0.1, null, 1, 2, [['RB2608', 200, 1]], 'Nevera 1'],
  ['hielo', 'Hielo bolsa 5 kg', 'Hielo', '5 kg', 0, 'Bolsa', 'Hielo Polar', 'Venezuela', 'Hielo', 1, 0, 2, 0.8, 0, 1.8, 0, null, 40, 15, null, 'Congelador'],
  ['papas', 'Papas fritas 150 g', 'Papas fritas', '150 g', 0, 'Paquete', 'Frito Lay', 'Venezuela', 'Snacks y pasapalos', 12, 0, 18, 12.5, 1.8, 16.8, 0, null, 4, 2, [['PF0302', 70, 4]], 'Mostrador'],
  ['mani', 'Maní salado 100 g', 'Maní', '100 g', 0, 'Paquete', 'Jack’s', 'Venezuela', 'Snacks y pasapalos', 24, 0, 19.2, 12.8, 1, 18, 0, null, 2, 1, [['MS0412', 14, 1], ['MS0520', 120, 1]], 'Mostrador']
];
/** Combos: k, nombre, precio, [[producto, unidades]] */
const COMBOS = [
  ['combo_rumba', 'Combo Rumba: Ron Cacique + 2 Coca-Cola 2 L + hielo', 16.5, [['cacique', 1], ['coca2l', 2], ['hielo', 1]]],
  ['combo_12', 'Combo Playa: 12 Polar lata + 2 hielos', 16, [['pilslata', 12], ['hielo', 2]]],
  ['combo_whisky', 'Combo Brindis: Old Parr 12 + 2 sodas + hielo', 32, [['oldparr', 1], ['soda', 2], ['hielo', 1]]]
];
const SUPPLIERS = [
  ['sup1', 'Cervecería Polar (distribución)', 'J-00006372-9', 'Vendedor de ruta: Jesús', '0212-5553300', 7, 'martes'],
  ['sup2', 'Distribuidora de Licores del Centro', 'J-40987654-3', 'Rubén Sosa', '0241-5554411', 15, 'jueves'],
  ['sup3', 'Refrescos y Snacks Express', 'J-29876543-1', 'Lorena Paz', '0212-5559900', 7, 'lunes']
];
/** k, nombre, teléfono, cédula, sexo, edad, tipo, negocio, última compra (días atrás), cada cuántos días compra, fiado, límite, envases que debe, lo que suele llevar [[producto, presentación, cantidad, fría]], extras */
const CLIENTS = [
  ['carlos', 'Carlos Gutiérrez', '0414-1112233', 'V-12345678', 'M', 41, 'detal', '', 1, 4, 0, 30, {}, [['pils13', 'caja', 1, true]], 'Caja de Polar 1/3 fría los viernes', {}],
  ['bodega', 'Luis Fernández', '0424-2223344', 'V-9234567', 'M', 52, 'mayor', 'Bodega La Esquina', 2, 5, 48, 150, { b13: 36, gav: 1 }, [['pils13', 'caja', 2, false], ['coca2l', 'caja', 2, false], ['cacique', 'caja', 1, false]], 'Lleva para revender: 2 cajas de 1/3 y refrescos', {}],
  ['bar', 'Marisela Torres', '0412-3334455', 'V-14345678', 'F', 39, 'mayor', 'Bar El Tambor', 3, 6, 0, 300, { gav: 2 }, [['pilslata', 'caja', 3, false], ['steresa', 'caja', 1, false], ['hielo', 'caja', 10, false]], 'Pide por WhatsApp los jueves', {}],
  ['jose', 'José Luis Martínez', '0416-4445566', 'V-7234567', 'M', 58, 'detal', '', 26, 6, 12.5, 40, {}, [['cacique', 'unidad', 1, false], ['coca2l', 'unidad', 2, true]], 'Su Cacique con Coca-Cola', {}],
  ['andrea', 'Andrea Salazar', '0414-5556677', 'V-20567890', 'F', 31, 'detal', '', 4, 7, 0, 0, {}, [['brut', 'unidad', 1, true], ['sangria', 'unidad', 1, true]], 'Espumante bien frío', { birthday: 0 }],
  ['pedro', 'Pedro Castillo', '0424-6667788', 'V-5678901', 'M', 66, 'detal', '', 30, 5, 0, 0, {}, [['oldparr', 'unidad', 1, false], ['soda', 'unidad', 2, true]], 'Old Parr y soda', {}],
  ['rosa', 'Rosa Elena Díaz', '0412-7778899', 'V-8789012', 'F', 54, 'detal', '', 9, 8, 8, 20, { b13: 12 }, [['pils13', 'caja', 1, true]], 'Se lleva la caja y trae los vacíos el lunes', { birthday: 3 }],
  ['miguel', 'Miguel Ángel Rojas', '0416-8889900', 'V-24890123', 'M', 29, 'detal', '', 2, 3, 0, 0, {}, [['pilslata', 'pack', 2, true], ['papas', 'unidad', 2, false]], 'Six-pack frío y papitas', {}],
  ['yolanda', 'Yolanda Herrera', '0414-9990011', 'V-10901234', 'F', 49, 'detal', '', 33, 5, 0, 0, {}, [['pomar', 'unidad', 2, false]], 'Vino tinto para la casa', {}],
  ['eventos', 'Jorge Medina', '0424-1013141', 'V-17012345', 'M', 38, 'mayor', 'Eventos JM (fiestas y bodas)', 11, 12, 0, 500, {}, [['pilslata', 'caja', 6, false], ['cacique', 'caja', 1, false], ['hielo', 'caja', 20, false]], 'Fiestas de fin de semana: pide con 2 días', {}],
  ['ramon', 'Ramón Gutiérrez', '0416-1617181', 'V-3123987', 'M', 70, 'detal', '', 28, 7, 15, 20, {}, [['cartujo', 'unidad', 1, false]], 'Su anís de siempre', {}],
  ['gabriela', 'Gabriela Paredes', '0414-1819202', 'V-26234098', 'F', 27, 'detal', '', 6, 9, 0, 0, {}, [['smirnoff', 'unidad', 1, false], ['redbull', 'unidad', 4, true]], 'Vodka con energizante', {}],
  ['andres', 'Andrés Villalobos', '0424-2021222', 'V-11345109', 'M', 45, 'detal', '', 3, 7, 0, 0, {}, [['buchanans', 'unidad', 1, false]], "Buchanan's para regalar", {}],
  ['lucia', 'Lucía Fernández', '0412-2223242', 'V-14456210', 'F', 44, 'detal', '', 150, 30, 0, 0, {}, [['casillero', 'unidad', 1, false]], '', {}],
  ['kevin', 'Kevin Morales', '0416-2425262', 'V-27567321', 'M', 24, 'detal', '', 2, 4, 0, 10, { b1l: 2 }, [['pils1l', 'unidad', 2, true]], 'Dos de litro frías', {}]
];
const WALKIN = [['pilslata', 'unidad', [2, 6], true], ['pilslata', 'pack', [1, 2], true], ['pils13', 'unidad', [3, 12], true], ['solera', 'unidad', [2, 6], true], ['cacique', 'unidad', [1, 1], false], ['coca2l', 'unidad', [1, 2], true], ['hielo', 'caja', [1, 2], false], ['agua', 'unidad', [1, 3], true], ['papas', 'unidad', [1, 2], false], ['mani', 'unidad', [1, 3], false], ['redbull', 'unidad', [1, 2], true], ['smirnoff', 'unidad', [1, 1], false], ['pomar', 'unidad', [1, 1], false], ['cartujo', 'unidad', [1, 1], false], ['sangria', 'unidad', [1, 1], true], ['bw', 'unidad', [1, 1], false], ['heineken', 'pack', [1, 1], true], ['combo_rumba', 'caja', [1, 1], false], ['combo_12', 'caja', [1, 1], false]];
const COLORS = ['#b45309', '#881337', '#d97706', '#7c2d12', '#0e7490', '#4d7c0f', '#6d28d9', '#be123c'];

/** Licorería de ejemplo: inventario con cajas, packs, frías y combos; envases retornables; clientes al detal y al mayor con fiado; compras, pedidos y caja del día. */
export async function seedDemoActivity() {
  const money = (v) => scaleUSD(v);
  const R = rng(11);
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const methods = Object.keys(PAY_METHODS).filter((k) => k !== 'credito').slice(0, 6);
  const mk = () => Number(store.settings.fractionMarkup) || 0;

  // 1) Proveedores
  let b = store.batch();
  SUPPLIERS.forEach(([id, name, rif, contact, phone, days, visitDay]) => b.set(store.ref('suppliers', 'demo_' + id), { name, rif, contact, phone, email: '', days, visitDay, notes: '', active: true, createdAt: nowISO(), updatedAt: nowISO() }));

  // 2) Productos (stock en unidades, con lotes donde vence)
  const P = {};
  PRODUCTS.forEach(([k, name, active, strength, abv, form, lab, origin, category, units, packUnits, price, cost, unitPrice, wholesale, coldExtra, ret, boxes, minBoxes, lotSpec, location], i) => {
    let lots = [];
    for (const [lot, exp, bx] of lotSpec || []) lots = addLot(lots, { lot, exp: inDays(exp), qty: bx * units, cost: money(cost) });
    const stock = lotSpec ? lots.reduce((a, l) => a + l.qty, 0) : boxes * units;
    const sup = /Cervezas/.test(category) && lab === 'Polar' ? 'sup1' : /Refrescos|Agua|Snacks|Hielo/.test(category) ? 'sup3' : 'sup2';
    P[k] = {
      id: 'demo_' + k, name, active, strength, abv, form, lab, origin, category, location, unitsPerBox: units, packUnits, fraction: units > 1,
      price: money(price), unitPrice: unitPrice ? money(unitPrice) : 0, packSale: 0, wholesale: money(wholesale), coldExtra: coldExtra ? money(coldExtra) : 0, cost: money(cost), lastCost: money(cost),
      returnable: !!ret, containerId: ret?.[0] || '', crateId: ret?.[1] || '',
      minStock: minBoxes * units, maxStock: minBoxes * units * 3, trackStock: true, sellable: true, online: true, supplierId: 'demo_' + sup, taxed: false, color: COLORS[i % COLORS.length],
      barcode: `759${String(1000000000 + i * 7919331).slice(0, 10)}`, sku: `${category.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(3, '0')}`, notes: '',
      stock, lots, expiresAt: nextExpiry({ lots }) || '', sold: 0, createdAt: at(60, 9).toISOString(), updatedAt: nowISO(), by: 'demo'
    };
  });
  COMBOS.forEach(([k, name, price, parts]) => {
    P[k] = {
      id: 'demo_' + k, name, active: 'Combo', strength: '', abv: 0, form: 'Otro', lab: '', origin: '', category: 'Combos', location: 'Mostrador', unitsPerBox: 1, packUnits: 0, fraction: false,
      price: money(price), unitPrice: 0, packSale: 0, wholesale: 0, coldExtra: 0, cost: 0, returnable: false, containerId: '', crateId: '',
      combo: parts.map(([pk, units]) => ({ productId: 'demo_' + pk, units })), minStock: 0, maxStock: 0, trackStock: false, sellable: true, online: true, supplierId: null, taxed: false, color: '#881337',
      barcode: '', sku: k.toUpperCase(), notes: '', stock: 0, lots: [], expiresAt: '', sold: 0, createdAt: at(60, 9).toISOString(), updatedAt: nowISO(), by: 'demo'
    };
  });
  const costOf = (p) => (isCombo(p) ? round2(p.combo.reduce((a, c) => { const x = Object.values(P).find((y) => y.id === c.productId); return a + (x ? x.cost / upb(x) : 0) * c.units; }, 0) * 10000) / 10000 : unitCost(p));

  // 3) Clientes
  const clients = {};
  CLIENTS.forEach(([k, name, phone, idDoc, sex, age, type, business, last, every, debt, limit, empties, fav, favorite, x], idx) => {
    clients[k] = {
      id: 'demo_' + k, name, phone, email: '', idDoc, sex, type, business, birthDate: x.birthday != null ? birthdayIn(age, x.birthday) : birth(age, idx % 11 + 1, (idx * 5) % 27 + 1),
      address: type === 'mayor' || idx % 3 === 0 ? `Calle ${idx + 2}, La Pastora` : '', notes: '', favorite, creditLimit: limit ? money(limit) : 0,
      cardCode: genCode(8), active: true, visits: 0, totalSpent: 0, balance: debt ? money(debt) : 0, points: 0, empties: { ...empties }, notified: {},
      lastVisitAt: null, createdAt: at(Math.max(60, last + 20), 10).toISOString(), updatedAt: nowISO(), by: 'demo', _last: last, _every: every, _fav: fav
    };
  });
  Object.values(clients).sort((a, c) => a.createdAt.localeCompare(c.createdAt)).forEach((c) => { const seq = store.nextSeq(b, 'cli'); c.number = fmtSeq('C', seq, 4); c.seq = seq; });

  // 4) Historial de 45 días
  const line = (p, pack, qty, cold = false, mayor = false) => {
    const f = isCombo(p) ? 1 : packFactor(p, pack);
    const price = packPrice(p, pack, { markup: mk(), cold, mayor });
    const l = { productId: p.id, name: p.name, pack, factor: f, qty, price, listPrice: price, cost: round2(costOf(p) * f * 10000) / 10000, kind: isCombo(p) ? 'combo' : 'producto', cold: cold && p.coldExtra > 0, detail: packLabel(p, pack) };
    if (isCombo(p)) l.combo = p.combo;
    return l;
  };
  const hist = [];
  for (const c of Object.values(clients)) {
    for (let d = c._last; d <= 45; d += c._every) {
      const lines = c._fav.map(([pk, pack, q, cold]) => line(P[pk], pack, q, cold, c.type === 'mayor'));
      if (R() < 0.3) { const [pk, pack, [a, z], cold] = pick(WALKIN); lines.push(line(P[pk], pack, a + Math.floor(R() * (z - a + 1)), cold, c.type === 'mayor')); }
      hist.push({ date: at(d, 11 + Math.floor(R() * 11), Math.floor(R() * 4) * 15), lines, client: c });
    }
  }
  for (let d = 45; d >= 1; d--) {
    const weekend = [5, 6].includes(at(d, 12).getDay());
    const n = 6 + Math.floor(R() * 8) + (weekend ? 8 : 0);
    for (let j = 0; j < n; j++) {
      const lines = [];
      const items = 1 + Math.floor(R() * 3);
      for (let q = 0; q < items; q++) {
        const [pk, pack, [a, z], cold] = pick(WALKIN);
        if (lines.some((l) => l.productId === P[pk].id && l.pack === pack)) continue;
        lines.push(line(P[pk], pack, a + Math.floor(R() * (z - a + 1)), cold && R() < 0.8));
      }
      const hour = weekend ? 15 + Math.floor(R() * 9) : 11 + Math.floor(R() * 11);
      hist.push({ date: at(d, Math.min(23, hour), Math.floor(R() * 60)), lines, client: null });
    }
  }
  hist.sort((a, c) => a.date - c.date);
  const docs = [];
  for (const h of hist) {
    const c = h.client;
    const t = cartTotals(h.lines, 0);
    const total = t.subtotal;
    const method = pick(methods);
    const seq = store.nextSeq(b, 'inv');
    const number = fmtSeq(store.settings.invoicePrefix || 'F', seq, 6);
    const saleId = 'demo_s' + seq;
    const items = h.lines.map((l) => ({ ...l, total: round2(l.price * l.qty) }));
    const seller = SELLERS[Math.floor(R() * SELLERS.length)];
    const sale = {
      number, seq, kind: 'venta', date: h.date.toISOString(), dayKey: dayKey(h.date), items, subtotal: t.subtotal, discount: 0, total,
      cost: round2(items.reduce((a, i) => a + i.cost * i.qty, 0)), rate: 1,
      payments: [{ method, currency: 'USD', amount: total, usd: total }], paidUSD: total, changeUSD: 0, changeCurrency: 'USD', method, received: total, shiftId: null, cashFlow: null,
      ...(c ? clientFields({ ...c }) : clientFields(null)), status: 'completed', by: 'demo', note: '', credit: 0, mayor: c?.type === 'mayor', empties: [],
      pointsUsed: 0, pointsDiscount: 0, manualDiscount: 0, sellerId: seller.id, sellerName: seller.name, orderId: null, pointsEarned: c ? Math.floor(total) : 0
    };
    docs.push(['sales', saleId, sale]);
    for (const l of items) { const p = Object.values(P).find((x) => x.id === l.productId); if (p) p.sold += l.qty * l.factor; }
    if (c) { c.visits++; c.totalSpent = round2(c.totalSpent + total); c.points += Math.floor(total); c.lastVisitAt = sale.date; }
  }
  for (const c of Object.values(clients)) if (!c.lastVisitAt) { c.lastVisitAt = at(c._last, 19).toISOString(); c.visits = 3; c.totalSpent = money(58); c.points = 58; }

  // 5) Envases: vacíos en depósito, préstamos y entrega al proveedor
  docs.push(['config', 'empties', { stock: { b13: 144, b1l: 18, gav: 9 }, updatedAt: nowISO() }]);
  const elog = (i, d, type, containerId, qty, lent, clientK, ref) => docs.push(['empties_logs', 'demo_e' + i, { date: at(d, 18, i).toISOString(), dayKey: dayKey(at(d, 18)), type, containerId, qty, lent, charged: 0, deposit: 0, clientId: clientK ? clients[clientK].id : null, clientName: clientK ? clients[clientK].name : '', ref, by: 'demo' }]);
  elog(1, 6, 'proveedor', 'b13', -360, 0, null, 'Entregados a Cervecería Polar');
  elog(2, 6, 'proveedor', 'gav', -10, 0, null, 'Entregados a Cervecería Polar');
  elog(3, 4, 'venta', 'b13', 0, 36, 'bodega', 'Préstamo a Bodega La Esquina');
  elog(4, 4, 'venta', 'gav', 0, 1, 'bodega', 'Préstamo a Bodega La Esquina');
  elog(5, 9, 'venta', 'b13', 24, 12, 'rosa', 'Trajo 24, se le prestaron 12');
  elog(6, 3, 'venta', 'gav', 0, 2, 'bar', 'Préstamo a Bar El Tambor');
  elog(7, 2, 'venta', 'b1l', 0, 2, 'kevin', 'Préstamo');
  elog(8, 1, 'devuelto', 'b13', 36, 0, 'carlos', 'Devolvió su caja');

  // 6) Roturas, cortesías y vencidos (para el reporte de pérdidas)
  const ilog = (i, k, d, type, qty, reason) => docs.push(['inventory_logs', 'demo_l' + i, { productId: P[k].id, name: P[k].name, date: at(d, 18).toISOString(), dayKey: dayKey(at(d, 18)), type, qty: -qty, cost: unitCost(P[k]), lots: [], reason, by: 'demo' }]);
  ilog(1, 'pils13', 12, 'rotura', 4, 'Se cayó una caja al descargar');
  ilog(2, 'cacique', 7, 'rotura', 1, 'Botella rota en el anaquel');
  ilog(3, 'brut', 15, 'cortesia', 1, 'Degustación para cliente al mayor');
  ilog(4, 'sangria', 2, 'vencido', 2, 'Lote vencido retirado de la nevera');

  // Guardar todo (lotes de 80)
  for (const p of Object.values(P)) { const { id, ...data } = p; docs.push(['products', id, data]); }
  for (const c of Object.values(clients)) { const { id, _last, _every, _fav, ...data } = c; docs.push(['clients', id, data]); }
  await store.commit(b);
  for (let i = 0; i < docs.length; i += 80) {
    const bb = store.batch();
    docs.slice(i, i + 80).forEach(([col, id, data]) => bb.set(store.ref(col, id), data));
    await store.commit(bb);
  }
  b = store.batch();
  for (const c of Object.values(clients)) { const { _last, _every, _fav, ...data } = c; b.set(store.cardRef(c.cardCode), cardData(data)); }
  await store.commit(b);
  await waitFor(() => store.products.length >= PRODUCTS.length + COMBOS.length && store.clients.length >= CLIENTS.length && store.suppliers.length >= SUPPLIERS.length);

  // 7) Caja abierta y ventas de hoy en vivo (fría, al mayor, envases, combo, fiado)
  try {
    if (!store.openShift) { await openShift({ openingUSD: money(60), note: 'Apertura demo' }); await waitFor(() => store.openShift); }
    const pr = (k) => store.product('demo_' + k);
    const cl = (k) => store.client('demo_' + k);
    const L = (k, pack = 'caja', qty = 1, cold = false, mayor = false) => line(pr(k), pack, qty, cold, mayor);
    const sell = async (lines, opts = {}, method = 'efectivo', brought = {}, lend = {}) => {
      const need = emptiesOfCart(lines, (id) => store.product(id), store.containers);
      const empties = Object.entries(need).map(([id, n]) => ({ id, need: n, brought: Math.min(n, brought[id] ?? n), mode: lend[id] ? 'prestar' : 'cobrar' }));
      const dep = empties.reduce((a, e) => a + (e.mode === 'cobrar' ? (e.need - e.brought) * (store.container(e.id)?.deposit || 0) : 0), 0);
      const amount = round2(cartTotals(lines, 0).subtotal + dep - (opts.credit || 0));
      await chargeSale({ lines, payments: amount > 0 ? [{ method, amount }] : [], sellerId: 's3', empties, ...opts });
    };
    // Carlos trae su caja de vacíos y se lleva una fría
    await sell([L('pils13', 'caja', 1, true)], { client: cl('carlos') }, 'debito');
    // Mostrador: six-pack frío y papas
    await sell([L('pilslata', 'pack', 1, true), L('papas', 'unidad', 2)], {}, 'efectivo');
    // Bodega La Esquina compra al mayor: trae 24 vacíos de 36 y se le prestan los 12 que faltan
    await sell([L('pils13', 'caja', 1, false, true), L('coca2l', 'caja', 2, false, true)], { client: cl('bodega'), mayor: true, sellerId: 's1' }, 'transferencia', { b13: 24, gav: 1 }, { b13: true });
    // Combo Rumba
    await sell([L('combo_rumba', 'caja', 1)], { sellerId: 's2' }, methods[3] || 'efectivo');
    // Kevin: 2 litros fríos, no trae vacíos: paga el depósito
    await sell([L('pils1l', 'unidad', 2, true)], { client: cl('kevin') }, 'efectivo', { b1l: 0 });
    // José se lleva su Cacique y queda fiado
    const jose = cl('jose');
    const jl = [L('cacique', 'unidad', 1), L('coca2l', 'unidad', 2, true)];
    await sell(jl, { client: jose, credit: round2(cartTotals(jl, 0).subtotal) }, 'efectivo');
    // Rosa devuelve 12 vacíos que tenía prestados
    await receiveEmpties({ client: cl('rosa'), items: { b13: 12 }, mode: 'prestados', note: 'Devolvió los vacíos' });
    await cashMovement({ direction: 'out', currency: 'USD', amount: money(6), concept: 'Bolsas de hielo extra', category: 'Insumos (bolsas, papel, etiquetas)' });
    await cashMovement({ direction: 'out', currency: 'USD', amount: money(3), concept: 'Pago al motorizado', category: 'Delivery / motorizado' });
  } catch (e) { console.warn('[demo] ventas de hoy', e); }

  // 8) Compras: dos facturas por pagar (una vencida) y una orden pendiente
  try {
    const pr = (k) => store.product('demo_' + k);
    await receivePurchase({ supplierId: 'demo_sup1', invoiceNo: 'FAC-88231', items: [{ productId: pr('pilslata').id, boxes: 10, cost: pr('pilslata').cost, lot: 'PL2701', exp: inDays(200) }, { productId: pr('solera').id, boxes: 6, cost: pr('solera').cost, lot: 'SV2701', exp: inDays(190) }], paid: 0, dueDate: inDays(5), note: 'Crédito a 7 días' });
    await receivePurchase({ supplierId: 'demo_sup2', invoiceNo: 'B-004512', items: [{ productId: pr('cacique').id, boxes: 3, cost: pr('cacique').cost }, { productId: pr('bw').id, boxes: 1, cost: pr('bw').cost }], paid: money(50), dueDate: inDays(-2) });
    await createPurchaseOrder({ supplierId: 'demo_sup2', items: [{ productId: pr('diplo').id, boxes: 2, cost: pr('diplo').cost }, { productId: pr('oldparr').id, boxes: 2, cost: pr('oldparr').cost }], note: 'Pedido por WhatsApp para el fin de semana' });
  } catch (e) { console.warn('[demo] compras', e); }

  // 9) Pedidos en línea (catálogo público)
  try {
    const slug = store.settings.shop?.slug || '';
    await store.saveSettings({ shop: { ...store.settings.shop, deliveryFee: money(2) } });
    const it = (k, q, kind, cold) => { const p = store.product('demo_' + k); return { id: p.id, n: p.name, q, p: packPrice(p, kind, { markup: mk(), cold }), k: kind }; };
    const mkOrder = (name, phone, mode, cold, items, note, minsAgo) => {
      const fee = mode === 'delivery' ? money(2) : 0;
      return { tenantId: store.tenantId, slug, number: 'W-' + genCode(5), name, phone, address: mode === 'delivery' ? 'Res. Los Samanes, torre B, apto 4-2' : '', mode, deliveryFee: fee, note, payMethod: mode === 'delivery' ? 'Efectivo al recibir' : 'Pago móvil', cold, items, total: round2(items.reduce((a, x) => a + x.p * x.q, 0) + fee), status: 'nueva', createdAt: new Date(Date.now() - minsAgo * 60000).toISOString() };
    };
    const ob = store.batch();
    const r1 = doc(collection(db, 'orders')); const r2 = doc(collection(db, 'orders')); const r3 = doc(collection(db, 'orders'));
    ob.set(r1, mkOrder('Patricia Morales', '0414-7654321', 'delivery', true, [it('pilslata', 1, 'caja', true), it('hielo', 2, 'caja', false), it('papas', 3, 'unidad', false)], 'Es para una parrilla, tocar el timbre 2 veces', 8));
    ob.set(r2, mkOrder('Ricardo Fuentes', '0412-9876543', 'retiro', false, [it('steresa', 1, 'unidad', false), it('soda', 2, 'unidad', false)], 'Paso a las 7 pm', 35));
    ob.set(r3, mkOrder('Elena Suárez', '0424-1237890', 'retiro', true, [it('brut', 2, 'unidad', true)], 'Para un brindis', 70));
    await store.commit(ob);
    await waitFor(() => store.orders.length >= 3, 4000);
    await setOrderStatus({ id: r2.id }, 'preparando');
    await setOrderStatus({ id: r3.id }, 'lista');
  } catch (e) { console.warn('[demo] pedidos', e); }
}

/** Borra todos los datos de una sede (sus tarjetas públicas, su catálogo en línea y sus pedidos). */
export async function purgeTenant(tenantId, onlyDemo = true, slug = '') {
  try {
    const snap = await getDocs(collection(db, 'tenants', tenantId, 'clients'));
    const codes = snap.docs.map((d) => d.data().cardCode).filter(Boolean);
    for (let i = 0; i < codes.length; i += 80) {
      const b = writeBatch(db);
      codes.slice(i, i + 80).forEach((c) => b.delete(doc(db, 'cards', c)));
      await b.commit().catch((e) => console.warn('[purge] tarjetas', e?.code || e));
    }
  } catch (e) { console.warn('[purge] tarjetas', e?.code || e); }
  try {
    let s = slug;
    if (!s) { const st = await getDoc(doc(db, 'tenants', tenantId, 'config', 'settings')); s = st.exists() ? st.data().shop?.slug || '' : ''; }
    if (s) { const sh = await getDoc(doc(db, 'shops', s)); if (sh.exists() && sh.data().tenantId === tenantId) { const b = writeBatch(db); b.delete(sh.ref); await b.commit(); } }
  } catch (e) { console.warn('[purge] catálogo', e?.code || e); }
  try {
    const rq = await getDocs(query(collection(db, 'orders'), where('tenantId', '==', tenantId)));
    for (let i = 0; i < rq.docs.length; i += 80) { const b = writeBatch(db); rq.docs.slice(i, i + 80).forEach((d) => b.delete(d.ref)); await b.commit(); }
  } catch (e) { console.warn('[purge] pedidos', e?.code || e); }
  for (const c of DATA_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, 'tenants', tenantId, c));
      for (let i = 0; i < snap.docs.length; i += 80) {
        const b = writeBatch(db);
        snap.docs.slice(i, i + 80).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    } catch (e) { console.warn('[purge]', c, e?.code || e); }
  }
  if (onlyDemo) {
    try {
      const t = await getDoc(doc(db, 'tenants', tenantId));
      if (t.exists() && t.data().demo === true) { const b = writeBatch(db); b.delete(t.ref); await b.commit(); }
    } catch (e) { console.warn('[purge] sede', e?.code || e); }
  }
}

/** Borra la demo actual y la cuenta anónima. */
export async function cleanupDemo(tenantId, slug = '') {
  await purgeTenant(tenantId, true, slug);
  const u = auth.currentUser;
  if (u && u.isAnonymous) {
    try { await u.delete(); } catch (_) { await signOut(auth).catch(() => {}); }
  }
}
