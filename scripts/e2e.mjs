// SanoLicores — Prueba de punta a punta contra los emuladores (datos creados por test-emu.sh)
// Uso: node e2e.mjs [url=http://127.0.0.1:5161] [carpeta de capturas]
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = process.argv[2] || 'http://127.0.0.1:5161';
const BASE = ORIGIN + '/?emu=1';
const OUT = path.resolve(here, process.argv[3] || 'shots');
mkdirSync(OUT, { recursive: true });
const acc = JSON.parse(readFileSync(path.join(here, '.accounts-emu.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; let passed = 0;
const ok = (name, cond, extra = '') => { console.log(cond ? '  ✔' : '  ✘', name, extra); if (cond) passed++; else fails++; };
const errs = [];
const logs = [];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
async function newPage(w = 1366, h = 860) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport({ width: w, height: h });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.dismiss());
  p.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) logs.push(m.text()); });
  return { ctx, p };
}
// Ejecuta una función con acceso a los módulos de la app
const run = (p, fn, arg = null) => p.evaluate(async (src, a) => {
  const M = { store: (await import('/js/store.js')).store, ops: await import('/js/ops.js'), utils: await import('/js/utils.js'), ph: await import('/js/licor.js') };
  M.wait = async (f, ms = 6000) => { for (let i = 0; i < ms / 100; i++) { const v = f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return f(); };
  return (0, eval)(src)(M, a);
}, fn.toString(), arg);
const go = async (p, route) => { await p.evaluate((r) => { location.hash = '#/' + r; }, route); await sleep(1100); };
const text = (p) => p.evaluate(() => document.body.innerText);
const pin = async (p, value = null) => {
  await p.waitForSelector('.modal [data-pin]', { timeout: 8000 });
  await p.type('.modal [data-pin]', value || acc.sede01.pin);
  await p.evaluate(() => [...document.querySelectorAll('.modal [data-ok]')].pop().click());
  await sleep(900);
};
const pickCountry = async (p, code) => {
  await p.waitForSelector(`.country-grid [data-c="${code}"]`, { timeout: 60000 });
  await p.click(`.country-grid [data-c="${code}"]`); await sleep(250);
  await p.evaluate(() => [...document.querySelectorAll('.modal [data-ok]')].pop().click());
  await sleep(1500);
};

try {
  // ==================================================================
  console.log('1) Inicio de sesión y país');
  let { ctx, p } = await newPage();
  await p.goto(BASE, { waitUntil: 'networkidle2' });
  await p.waitForSelector('#login-form');
  await p.screenshot({ path: path.join(OUT, '01-login.png') });
  await p.type('#lg-user', 'sede01'); await p.type('#lg-pass', acc.sede01.password); await p.click('#lg-btn');
  await pickCountry(p, 'VE');
  await p.waitForSelector('.sb-nav', { timeout: 30000 });
  ok('sede01 entra y elige país (Venezuela)', (await run(p, ({ store }) => store.settings.country)) === 'VE');
  await p.evaluate(async () => (await import('/js/tour.js')).stopTour());

  // ==================================================================
  console.log('2) Ajustes, productos (unidad / pack / caja, fría, combo) y compra');
  const r1 = await run(p, async ({ store, ops, utils, ph, wait }) => {
    const inD = (n) => utils.dayKey(utils.addDays(new Date(), n));
    await store.saveSettings({
      businessName: 'Licorería Prueba', whatsapp: '04141234567', fractionMarkup: 10,
      sellers: [{ id: 's1', name: 'Vendedor Uno', role: '', active: true }],
      loyalty: { enabled: true, per: 1, pointValue: 0.05, minRedeem: 100 }
    });
    await ops.openShift({ openingUSD: 50 });
    const sup = await ops.saveSupplier({ name: 'Distribuidora Prueba', days: 15 });
    const lata = await ops.saveProduct({ name: 'Polar Pilsen lata 355 ml', active: 'Cerveza', strength: '355 ml', abv: 5, form: 'Lata', lab: 'Polar', category: 'Cervezas', unitsPerBox: 24, packUnits: 6, price: 24, cost: 18, wholesale: 21.6, coldExtra: 0.1, minStock: 30, barcode: '7590000000017', supplierId: sup.id }, null, { units: 48, lot: 'LA', exp: inD(30) });
    const solera = await ops.saveProduct({ name: 'Solera Verde lata 355 ml', active: 'Cerveza', strength: '355 ml', form: 'Lata', lab: 'Polar', category: 'Cervezas', unitsPerBox: 24, packUnits: 6, price: 26.4, cost: 20, coldExtra: 0.1, minStock: 0 }, null, { units: 48, lot: 'S1', exp: inD(200) });
    const tercio = await ops.saveProduct({ name: 'Polar Pilsen botella 1/3', active: 'Cerveza', strength: '222 ml', form: 'Botella retornable', lab: 'Polar', category: 'Cervezas', unitsPerBox: 36, price: 18, cost: 13, wholesale: 16.5, coldExtra: 0.05, returnable: true, containerId: 'b13', crateId: 'gav', minStock: 0 }, null, { units: 108, lot: 'T1', exp: inD(150) });
    const ron = await ops.saveProduct({ name: 'Ron Cacique Añejo 750 ml', active: 'Ron añejo', strength: '750 ml', abv: 40, form: 'Botella', lab: 'Cacique', category: 'Rones', unitsPerBox: 12, price: 102, cost: 78, unitPrice: 9.5, wholesale: 96, minStock: 0 }, null, { units: 24 });
    const coca = await ops.saveProduct({ name: 'Coca-Cola 2 L', active: 'Refresco cola', strength: '2 L', form: 'Botella', category: 'Refrescos y jugos', unitsPerBox: 6, price: 12, cost: 9, unitPrice: 2.2, coldExtra: 0.1, minStock: 40 }, null, { units: 30, lot: 'C1', exp: inD(90) });
    const hielo = await ops.saveProduct({ name: 'Hielo bolsa 5 kg', active: 'Hielo', strength: '5 kg', form: 'Bolsa', category: 'Hielo', unitsPerBox: 1, price: 2, cost: 0.8, minStock: 0 }, null, { units: 20 });
    await wait(() => store.product(ron.id) && store.product(coca.id) && store.product(hielo.id));
    const combo = await ops.saveProduct({ name: 'Combo Rumba', active: 'Combo', category: 'Combos', unitsPerBox: 1, price: 16, trackStock: false, combo: [{ productId: ron.id, units: 1 }, { productId: coca.id, units: 2 }, { productId: hielo.id, units: 1 }] });
    let dupBar = ''; try { await ops.saveProduct({ name: 'Otro', barcode: '7590000000017', price: 1 }); } catch (e) { dupBar = e.message; }
    await wait(() => store.products.length >= 7 && store.product(combo.id));
    await ops.receivePurchase({ supplierId: sup.id, invoiceNo: 'F-1', items: [{ productId: lata.id, boxes: 2, cost: 19.2, lot: 'LB', exp: inD(200) }], paid: 0, dueDate: inD(-1) });
    await wait(() => store.product(lata.id).stock === 96 && store.payables.length === 1);
    const a = store.product(lata.id); const cb = store.product(combo.id);
    return {
      shift: !!store.openShift, stock: a.stock, lots: a.lots.map((l) => `${l.lot}:${l.qty}`).join(','), cost: a.cost, eq: ph.equivalents(a, store.products).map((x) => x.name),
      byBar: store.byBarcode('7590000000017')?.id === a.id, dupBar, payable: store.payables[0]?.balance, packs: ph.packsOf(a).join(','),
      pUnit: ph.packPrice(a, 'unidad', { markup: 10 }), pPack: ph.packPrice(a, 'pack', { markup: 10 }), pCold: ph.packPrice(a, 'unidad', { markup: 10, cold: true }), pMayor: ph.packPrice(a, 'caja', { mayor: true }),
      comboStock: ph.comboStock(cb), comboCost: ph.unitCost(cb),
      ids: { lata: lata.id, solera: solera.id, tercio: tercio.id, ron: ron.id, coca: coca.id, hielo: hielo.id, combo: combo.id }
    };
  });
  ok('Caja abierta', r1.shift);
  ok('Compra entra por lote y ordena por vencimiento (FEFO)', r1.stock === 96 && r1.lots === 'LA:48,LB:48', `${r1.stock} und · ${r1.lots}`);
  ok('Costo promedio ponderado al recibir', Math.abs(r1.cost - 18.6) < 0.01, String(r1.cost));
  ok('Encuentra por código de barras y rechaza duplicado', r1.byBar && /código de barras/.test(r1.dupBar), r1.dupBar);
  ok('Ofrece otra marca del mismo tipo y tamaño', r1.eq.includes('Solera Verde lata 355 ml'), r1.eq.join(','));
  ok('Presentaciones: unidad, six-pack y caja', r1.packs === 'unidad,pack,caja', r1.packs);
  ok('Precios: unidad con recargo, six-pack, fría y al mayor', r1.pUnit === 1.1 && r1.pPack === 6.6 && r1.pCold === 1.2 && r1.pMayor === 21.6, `${r1.pUnit} · ${r1.pPack} · ${r1.pCold} · ${r1.pMayor}`);
  ok('Combo: cuántos se pueden armar y su costo', r1.comboStock === 15 && Math.abs(r1.comboCost - 10.3) < 0.01, `${r1.comboStock} combos · costo ${r1.comboCost}`);
  ok('Factura a crédito queda en cuentas por pagar', r1.payable === 38.4, String(r1.payable));
  const ID = r1.ids;

  // ==================================================================
  console.log('3) Venta por unidad fría, six-pack, caja y combo (lotes FEFO)');
  const r2 = await run(p, async ({ store, ops, ph, wait }, ID) => {
    const line = (id, pack, qty, cold = false, mayor = false) => { const p = store.product(id); const f = ph.isCombo(p) ? 1 : ph.packFactor(p, pack); return { productId: p.id, name: p.name, pack, factor: f, qty, price: ph.packPrice(p, pack, { markup: 10, cold, mayor }), cost: ph.unitCost(p) * f, cold }; };
    const L = () => store.product(ID.lata);
    const s1 = await ops.chargeSale({ lines: [line(ID.lata, 'unidad', 2, true), line(ID.lata, 'pack', 1)], payments: [{ method: 'efectivo', amount: 10 }], sellerId: 's1' });
    await wait(() => L().stock === 88);
    const after1 = L().lots.map((l) => `${l.lot}:${l.qty}`).join(',');
    const s2 = await ops.chargeSale({ lines: [line(ID.lata, 'caja', 2)], payments: [{ method: 'efectivo', amount: 48 }] });
    await wait(() => L().stock === 40);
    let noStock = ''; try { await ops.chargeSale({ lines: [line(ID.lata, 'caja', 5)], payments: [{ method: 'efectivo', amount: 200 }] }); } catch (e) { noStock = e.message; }
    const s3 = await ops.chargeSale({ lines: [line(ID.combo, 'caja', 1)], payments: [{ method: 'efectivo', amount: 16 }] });
    await wait(() => store.product(ID.ron).stock === 23 && store.product(ID.coca).stock === 28 && store.product(ID.hielo).stock === 19);
    return {
      t1: s1.sale.total, ch1: s1.sale.changeUSD, n1: s1.sale.number, cold: s1.sale.items[0].cold, after1, lots: L().lots.map((l) => `${l.lot}:${l.qty}`).join(','), used: s2.sale.items[0].lots, noStock, seller: s1.sale.sellerName,
      combo: s3.sale.items[0].kind, ron: store.product(ID.ron).stock, coca: store.product(ID.coca).stock, hielo: store.product(ID.hielo).stock, comboSold: store.product(ID.combo).sold, s3: s3.sale.id
    };
  }, ID);
  ok('Unidad fría + six-pack con su precio y vuelto', r2.t1 === 9 && r2.ch1 === 1 && r2.cold && /^F-\d{6}$/.test(r2.n1), `total ${r2.t1} · vuelto ${r2.ch1} · ${r2.n1}`);
  ok('Sale primero el lote que vence antes', r2.after1 === 'LA:40,LB:48', r2.after1);
  ok('Venta por caja cruza de un lote al siguiente', r2.lots === 'LB:40' && /LA/.test(r2.used) && /LB/.test(r2.used), `${r2.lots} · ${r2.used}`);
  ok('No deja vender más de lo que hay', /No hay suficiente/.test(r2.noStock), r2.noStock);
  ok('El combo descuenta ron, refrescos y hielo', r2.combo === 'combo' && r2.ron === 23 && r2.coca === 28 && r2.hielo === 19 && r2.comboSold === 1, `ron ${r2.ron} · coca ${r2.coca} · hielo ${r2.hielo}`);
  ok('Registra el vendedor', r2.seller === 'Vendedor Uno');

  // ==================================================================
  console.log('4) Clientes: envases retornables, al mayor y fiado con límite');
  const r3 = await run(p, async ({ store, ops, ph, wait }, ID) => {
    const line = (id, pack, qty, cold = false, mayor = false) => { const p = store.product(id); const f = ph.packFactor(p, pack); return { productId: p.id, name: p.name, pack, factor: f, qty, price: ph.packPrice(p, pack, { markup: 10, cold, mayor }), cost: ph.unitCost(p) * f, cold }; };
    const c = await ops.saveClient({ name: 'Cliente Prueba', phone: '04241112233', idDoc: 'v-12345678', creditLimit: 10 });
    const m = await ops.saveClient({ name: 'Bodega Prueba', phone: '04161234567', type: 'mayor', business: 'Bodega La Prueba' });
    let dup = ''; try { await ops.saveClient({ name: 'Otro', phone: '04241112233' }); } catch (e) { dup = e.message; }
    await wait(() => store.client(c.id) && store.client(m.id));
    // Detal: lleva una caja de 1/3, trae 30 vacíos y la gavera: se cobran 6 de depósito
    const need = ph.emptiesOfCart([line(ID.tercio, 'caja', 1)], (id) => store.product(id), store.containers);
    const s1 = await ops.chargeSale({ lines: [line(ID.tercio, 'caja', 1, true)], client: { id: c.id }, empties: [{ id: 'b13', need: 36, brought: 30, mode: 'cobrar' }, { id: 'gav', need: 1, brought: 1, mode: 'cobrar' }], payments: [{ method: 'efectivo', amount: 20.7 }] });
    await wait(() => store.emptiesStock('b13') === 30);
    // Al mayor: no trae vacíos, se le prestan
    const s2 = await ops.chargeSale({ lines: [line(ID.tercio, 'caja', 1, false, true)], client: { id: m.id }, mayor: true, empties: [{ id: 'b13', need: 36, brought: 0, mode: 'prestar' }, { id: 'gav', need: 1, brought: 0, mode: 'prestar' }], payments: [{ method: 'transferencia', amount: 16.5 }] });
    await wait(() => (store.client(m.id).empties?.b13 || 0) === 36);
    const owed = store.emptiesOwed(store.client(m.id)).map((x) => `${x.id}:${x.n}`).join(',');
    const debtorsIn = store.emptyDebtors.some((x) => x.id === m.id);
    // Devuelve los prestados y se entregan vacíos al proveedor
    await ops.receiveEmpties({ client: store.client(m.id), items: { b13: 36, gav: 1 }, mode: 'prestados' });
    await wait(() => !(store.client(m.id).empties?.b13 > 0) && store.emptiesStock('b13') === 66);
    let tooMany = ''; try { await ops.receiveEmpties({ client: store.client(m.id), items: { b13: 5 }, mode: 'prestados' }); } catch (e) { tooMany = e.message; }
    await ops.emptiesToSupplier({ items: { b13: 60 }, supplierId: store.suppliers[0].id });
    await wait(() => store.emptiesStock('b13') === 6);
    // Fiado con límite
    await ops.chargeSale({ lines: [line(ID.ron, 'unidad', 1)], client: { id: c.id }, credit: 9.5, payments: [] });
    const debt = await wait(() => store.client(c.id).balance > 0 && store.client(c.id).balance);
    let overLimit = ''; try { await ops.chargeSale({ lines: [line(ID.coca, 'unidad', 1)], client: { id: c.id }, credit: 2.2, payments: [] }); } catch (e) { overLimit = e.message; }
    const card1 = await (await import('/js/store.js')).getCard(store.client(c.id).cardCode);
    await ops.payBalance(store.client(c.id), { amount: 9.5, payments: [{ method: 'efectivo', amount: 9.5 }] });
    await wait(() => store.client(c.id).balance < 0.01);
    const card = await (await import('/js/store.js')).getCard(store.client(c.id).cardCode);
    return {
      number: c.number, idDoc: c.idDoc, code: c.cardCode, dup, need: `${need.b13}/${need.gav}`, t1: s1.sale.total, dep: s1.sale.items.filter((i) => i.kind === 'envase').map((i) => `${i.qty}x${i.price}`).join(','),
      t2: s2.sale.total, mayor: s2.sale.mayor, owed, debtorsIn, tooMany, stock: store.emptiesStock('b13'), debt, overLimit, cardBal: card1?.balance, bal: store.client(c.id).balance, card: !!card, cardPts: card?.points, id: c.id, mid: m.id, s2: s2.sale.id
    };
  }, ID);
  ok('Cliente con número C-, cédula normalizada y tarjeta', /^C-\d{4}$/.test(r3.number) && r3.idDoc === 'V-12345678' && !!r3.code, `${r3.number} · ${r3.idDoc}`);
  ok('Rechaza teléfono duplicado', /Ya existe/.test(r3.dup));
  ok('Una caja de 1/3 lleva 36 botellas y 1 gavera', r3.need === '36/1', r3.need);
  ok('Cobra el depósito de los vacíos que faltan', r3.t1 === 20.7 && r3.dep === '6x0.15', `total ${r3.t1} · ${r3.dep}`);
  ok('Cliente al mayor paga precio al mayor y se le prestan los envases', r3.t2 === 16.5 && r3.mayor && r3.owed === 'b13:36,gav:1' && r3.debtorsIn, `${r3.t2} · ${r3.owed}`);
  ok('Devuelve los envases prestados y no acepta de más', /solo debe/.test(r3.tooMany), r3.tooMany);
  ok('Vacíos entregados al proveedor salen del depósito', r3.stock === 6, String(r3.stock));
  ok('Fiado con límite: deja fiar hasta el límite y bloquea lo que pasa', r3.debt === 9.5 && /límite/.test(r3.overLimit), r3.overLimit);
  ok('La tarjeta pública muestra lo fiado y luego se salda', r3.cardBal === 9.5 && r3.bal < 0.01 && r3.card && r3.cardPts >= 1, `${r3.cardBal} → ${r3.bal} · ${r3.cardPts} pts`);

  // ==================================================================
  console.log('5) Compras, pagos a proveedores, roturas y anulación');
  const r4 = await run(p, async ({ store, ops, wait }, { ID, s3, s2 }) => {
    const sug = ops.suggestedOrder();
    const sup = store.suppliers[0];
    const oc = await ops.createPurchaseOrder({ supplierId: sup.id, items: sug.map((x) => ({ productId: x.p.id, boxes: x.boxes, cost: x.cost })) });
    const pu = store.payables[0];
    await ops.payPurchase(pu, { amount: 38.4, fromCash: true });
    await wait(() => !store.payables.length);
    await ops.moveProduct(store.product(ID.solera), { mode: 'rotura', units: 2, reason: 'Se cayeron' });
    await wait(() => store.product(ID.solera).stock === 46);
    const sales = await store.listAll('sales');
    await ops.voidSale(sales.find((s) => s.id === s3), 'prueba');
    await wait(() => store.product(ID.ron).stock === 23 && store.product(ID.coca).stock === 30);
    await ops.voidSale(sales.find((s) => s.id === s2), 'prueba');
    await new Promise((r) => setTimeout(r, 1200));
    const m = store.clients.find((c) => c.type === 'mayor');
    return { sug: sug.map((x) => x.p.name), oc: oc.number, status: oc.status, payables: store.payables.length, solera: store.product(ID.solera).stock, ron: store.product(ID.ron).stock, hielo: store.product(ID.hielo).stock, mEmp: m?.empties?.b13 ?? 0 };
  }, { ID, s3: r2.s3, s2: r3.s2 });
  ok('Sugerido de compra con lo que está bajo el mínimo', r4.sug.includes('Coca-Cola 2 L'), r4.sug.join(', '));
  ok('Orden de compra creada', /^OC-\d{5}$/.test(r4.oc) && r4.status === 'pedido', r4.oc);
  ok('Pago al proveedor desde la caja salda la factura', r4.payables === 0);
  ok('Rotura descuenta unidades', r4.solera === 46, String(r4.solera));
  ok('Anular un combo devuelve sus productos', r4.ron === 23 && r4.hielo === 20, `ron ${r4.ron} · hielo ${r4.hielo}`);
  ok('Anular una venta con envases ya devueltos no deja la cuenta en negativo', r4.mEmp === 0, String(r4.mEmp));

  // ==================================================================
  console.log('6) Catálogo en línea y pedido desde el teléfono');
  const slug = 'licoreria-prueba-e2e';
  const r5 = await run(p, async ({ store, ops }, sl) => {
    await store.saveSettings({ shop: { ...store.settings.shop, enabled: true, slug: sl, delivery: true, deliveryFee: 1 } });
    await ops.publishShop({ force: true });
    const d = await (await import('/js/store.js')).getShop(sl);
    const it = d?.items?.find((i) => /lata 355/.test(i.n) && /Polar/.test(i.n));
    return { ok: !!d, items: d?.items?.length, combo: d?.items?.some((i) => i.k === 1), pu: it?.pu, f: it?.f };
  }, slug);
  ok('Catálogo publicado con unidad, frío y combos', r5.ok && r5.items >= 7 && r5.combo && r5.pu === 1.1 && r5.f === 0.1, JSON.stringify(r5));
  const pubCtx = await browser.createBrowserContext();
  const pub = await pubCtx.newPage();
  await pub.setViewport({ width: 390, height: 844, isMobile: true });
  pub.on('pageerror', (e) => errs.push('público: ' + e.message));
  await pub.goto(`${ORIGIN}/pedido/${slug}?emu=1`, { waitUntil: 'networkidle2' });
  await pub.waitForSelector('[data-inc]', { timeout: 20000 });
  await pub.screenshot({ path: path.join(OUT, '04-catalogo.png') });
  await pub.click('#s-cold [data-v="1"]'); await sleep(200);
  await pub.type('#s-q', 'polar pilsen lata'); await sleep(500);
  await pub.click('[data-inc$=":unidad"]'); await sleep(200); await pub.click('[data-inc$=":unidad"]'); await sleep(200);
  await pub.click('#s-bar'); await sleep(500);
  await pub.click('[data-mode="delivery"]'); await sleep(200);
  await pub.type('input[name="name"]', 'Cliente Web'); await pub.type('input[name="phone"]', '04261234567'); await pub.type('input[name="address"]', 'Calle 1, casa 2');
  await pub.screenshot({ path: path.join(OUT, '04-checkout.png') });
  await pub.click('#o-send'); await sleep(2500);
  ok('Cliente envía el pedido (frío, por unidad) sin cuenta', (await pub.evaluate(() => document.body.innerText)).includes('¡Pedido enviado!'));
  await pub.screenshot({ path: path.join(OUT, '04-pedido-ok.png') });
  await pub.goto(`${ORIGIN}/tarjeta/${r3.code}?emu=1`, { waitUntil: 'networkidle2' });
  await pub.waitForSelector('.mcard', { timeout: 20000 }); await sleep(800);
  const ct = await pub.evaluate(() => document.body.innerText);
  ok('Tarjeta pública con nombre, puntos y QR', ct.includes('Cliente Prueba') && /puntos/i.test(ct) && !!(await pub.$('.mcard-qr img')), ct.replace(/\s+/g, ' ').slice(0, 100));
  await pub.screenshot({ path: path.join(OUT, '05-tarjeta.png'), fullPage: true });
  await pub.goto(`${ORIGIN}/tarjeta/NOEXISTE1?emu=1`, { waitUntil: 'networkidle2' }); await sleep(1500);
  ok('Tarjeta inexistente muestra aviso', (await pub.evaluate(() => document.body.innerText)).includes('Tarjeta no encontrada'));
  await pub.goto(`${ORIGIN}/pedido/no-existe-nada?emu=1`, { waitUntil: 'networkidle2' }); await sleep(1500);
  ok('Catálogo inexistente muestra aviso', (await pub.evaluate(() => document.body.innerText)).includes('Catálogo no'));
  await pubCtx.close();
  const r6 = await run(p, async ({ store, ops, wait }) => {
    const o = await wait(() => store.newOrders.find((x) => x.name === 'Cliente Web'), 10000);
    if (!o) return { got: false };
    await ops.setOrderStatus(o, 'preparando');
    await wait(() => store.orders.find((x) => x.id === o.id)?.status === 'preparando');
    const lines = ops.orderLines(o);
    const total = lines.reduce((a, l) => a + l.price * l.qty, 0) + (o.deliveryFee || 0);
    await ops.chargeSale({ lines, orderId: o.id, delivery: o.deliveryFee, payments: [{ method: 'efectivo', amount: total }] });
    await wait(() => store.orders.find((x) => x.id === o.id)?.status === 'entregada' || !store.pendingOrders.some((x) => x.id === o.id));
    return { got: true, n: lines.length, q: lines[0]?.qty, pack: lines[0]?.pack, cold: lines[0]?.cold, oc: o.cold, total: o.total, status: store.orders.find((x) => x.id === o.id)?.status || 'entregada' };
  });
  ok('La licorería recibe el pedido en vivo', r6.got);
  ok('El pedido llega por unidad y frío, y al cobrarlo queda entregado', r6.status === 'entregada' && r6.q === 2 && r6.pack === 'unidad' && r6.cold && r6.oc && r6.total === 3.4, JSON.stringify(r6));

  // ==================================================================
  console.log('7) Pantallas, pestañas, reportes y consulta de precios');
  const before = errs.length;
  const tabsCount = {};
  for (const v of ['inicio', 'vender', 'pedidos', 'clientes', 'envases', 'fidelizar', 'inventario', 'compras', 'facturas', 'caja', 'ajustes']) {
    await go(p, v);
    await p.screenshot({ path: path.join(OUT, `10-${v}.png`) });
    const n = await p.$$eval('#view .tabs button', (x) => x.length).catch(() => 0);
    tabsCount[v] = n;
    for (let i = 0; i < n; i++) { await p.evaluate((k) => document.querySelectorAll('#view .tabs button')[k]?.click(), i); await sleep(600); }
  }
  await go(p, 'vender');
  await p.type('#pos-search', 'polar pilsen lata'); await sleep(700);
  await p.click('#pos-grid .prow'); await sleep(600);
  await p.screenshot({ path: path.join(OUT, '11-presentacion.png') });
  const packs = await p.$$eval('.modal .pack-btn', (x) => x.length);
  await p.click('.modal .pack-btn[data-k="pack"]'); await sleep(500);
  const cartTxt = await p.evaluate(() => document.querySelector('#c-total')?.textContent || '');
  ok('En Vender elige unidad, six-pack o caja, fría', packs === 3 && /7,20/.test(cartTxt), `${packs} · ${cartTxt}`);
  await p.evaluate(() => { const i = document.querySelector('#pos-search'); i.value = ''; i.dispatchEvent(new Event('input')); });
  await p.type('#pos-search', 'botella 1/3'); await sleep(700);
  await p.click('#pos-grid .prow'); await sleep(600);
  await p.click('.modal .pack-btn[data-k="caja"]'); await sleep(600);
  const emp = await p.$$eval('[data-emp]', (x) => x.map((i) => `${i.dataset.emp}:${i.value}`).join(','));
  ok('La caja pregunta por los vacíos retornables', emp === 'b13:36,gav:1', emp);
  await p.screenshot({ path: path.join(OUT, '11-envases.png') });
  await p.click('#c-clear'); await sleep(300);
  await go(p, 'reportes'); await pin(p); await sleep(2200);
  const rt = await text(p);
  ok('Reportes con PIN muestran ganancia, frío y envases', /ganancia/i.test(rt) && rt.includes('Polar Pilsen') && /Vendido frío/i.test(rt) && /Envases recibidos/i.test(rt));
  await p.screenshot({ path: path.join(OUT, '10-reportes.png'), fullPage: true });
  await p.evaluate(async (id) => (await import('/js/client.js')).openClient(id), r3.mid); await sleep(1500);
  const tabs = await p.$$eval('.modal [data-tabs] [data-t]', (x) => x.map((b) => b.dataset.t));
  for (const t of tabs) { await p.click(`.modal [data-tabs] [data-t="${t}"]`).catch(() => {}); await sleep(800); }
  await p.screenshot({ path: path.join(OUT, '12-ficha.png') });
  await p.evaluate(async () => (await import('/js/utils.js')).closeAllModals());
  ok('Todas las pantallas y pestañas sin errores', errs.length === before && tabsCount.inventario >= 5 && tabsCount.compras >= 4 && tabsCount.envases === 3 && tabs.length === 3, errs.slice(before).join(' | ') + ' · ' + JSON.stringify(tabsCount) + ` · ficha ${tabs.join(',')}`);
  await go(p, 'precios'); await sleep(800);
  await p.type('#k-q', '7590000000017'); await p.keyboard.press('Enter'); await sleep(700);
  const kt = await text(p);
  ok('Consulta de precios por código de barras', kt.includes('Polar Pilsen lata') && /Unidad/.test(kt) && /fría/.test(kt), kt.replace(/\s+/g, ' ').slice(0, 80));
  await p.screenshot({ path: path.join(OUT, '13-precios.png') });
  await p.click('#k-exit'); await pin(p); await sleep(800);
  ok('Salir de la consulta de precios con PIN', (await p.evaluate(() => location.hash)).includes('inicio'));
  const r9 = await run(p, async ({ store, ops, wait }) => { const s = store.openShift; const e = ops.shiftExpected(s); await ops.closeShift(s, { countedUSD: e.usd }); return { closed: !!(await wait(() => !store.openShift)), exp: e.usd }; });
  ok('Cierre de caja', r9.closed, `esperado ${r9.exp}`);
  await ctx.close();

  // ==================================================================
  console.log('8) Demo');
  ({ ctx, p } = await newPage());
  await p.goto(BASE, { waitUntil: 'networkidle2' });
  await p.click('#lg-demo');
  await pickCountry(p, 'CO');
  await p.waitForFunction(() => document.body.innerText.includes('Modo demo') && !document.getElementById('boot'), { timeout: 150000 });
  await sleep(3000);
  const d = await run(p, async ({ store, ph }) => ({
    clients: store.clients.length, products: store.products.length, combos: store.products.filter(ph.isCombo).length, sales: store.recentSales.length, shift: !!store.openShift, cur: store.settings.currency,
    lata: store.product('demo_pilslata')?.price, orders: store.pendingOrders.length, dormant: store.dormantClients.length, debtors: store.debtors.length, empDebt: store.emptyDebtors.length,
    vacios: store.emptiesStock('b13'), expiring: store.expiringProducts.length, expired: store.expiredLots.length, low: store.lowProducts.length, payables: store.payables.length, lic: store.licenseDays, mayor: store.clients.filter((c) => c.type === 'mayor').length
  }));
  ok('Demo con licorería de ejemplo completa', d.clients >= 15 && d.products >= 34 && d.combos === 3 && d.sales >= 30 && d.shift && d.orders >= 3 && d.dormant >= 2 && d.debtors >= 3 && d.empDebt >= 2 && d.vacios > 100 && d.expiring >= 2 && d.expired >= 1 && d.low >= 2 && d.payables >= 2 && d.lic <= 30 && d.mayor === 3, JSON.stringify(d));
  ok('Precios de la demo en pesos colombianos', d.cur === 'COP' && d.lata > 1000, String(d.lata));
  ok('Recorrido guiado abierto al entrar', !!(await p.waitForSelector('.tour-tip', { timeout: 20000 }).catch(() => null)));
  await p.screenshot({ path: path.join(OUT, '20-demo-tour.png') });
  await p.evaluate(async () => (await import('/js/tour.js')).stopTour());
  const b2 = errs.length;
  for (const v of ['inicio', 'vender', 'pedidos', 'clientes', 'envases', 'fidelizar', 'inventario', 'compras', 'facturas', 'caja']) { await go(p, v); await sleep(500); await p.screenshot({ path: path.join(OUT, `21-demo-${v}.png`) }); }
  ok('Pantallas de la demo sin errores', errs.length === b2, errs.slice(b2).join(' | '));
  const codes = await run(p, ({ store }) => store.clients.map((m) => m.cardCode));
  const dslug = await run(p, ({ store }) => store.settings.shop?.slug);
  const uid = await p.evaluate(async () => (await import('/js/firebase.js')).auth.currentUser.uid);
  await p.evaluate(() => document.getElementById('demo-end').click());
  await p.waitForSelector('.modal [data-yes]'); await p.click('.modal [data-yes]');
  await p.waitForSelector('#login-form', { timeout: 60000 }).catch(async (e) => { await p.screenshot({ path: path.join(OUT, '29-demo-fin.png') }); console.log('LOGS', logs.slice(-15).join(' || ')); throw e; });
  ok('Terminar la demo vuelve al login', true);
  await ctx.close();

  // ==================================================================
  console.log('9) Administrador general');
  ({ ctx, p } = await newPage());
  await p.goto(BASE, { waitUntil: 'networkidle2' });
  await p.waitForSelector('#login-form');
  await p.type('#lg-user', 'admin'); await p.type('#lg-pass', acc.admin.password); await p.click('#lg-btn');
  await p.waitForSelector('[data-enter]', { timeout: 30000 }); await sleep(2000);
  ok('Admin ve las sedes', (await p.$$('[data-enter]')).length === 3);
  await p.screenshot({ path: path.join(OUT, '30-admin.png') });
  const gone = await p.evaluate(async (u, cs, sl) => {
    const f = await import('/js/firebase.js');
    const t = await f.getDoc(f.doc(f.db, 'tenants', u)); const c = await f.getDoc(f.doc(f.db, 'cards', cs[0]));
    const b = sl ? await f.getDoc(f.doc(f.db, 'shops', sl)) : null;
    return !t.exists() && !c.exists() && !(b && b.exists());
  }, uid, codes, dslug);
  ok('La demo, sus tarjetas y su catálogo se borraron', gone, String(dslug));
  await ctx.close();
} catch (e) { console.log('ERROR', e.stack || e.message); fails++; }
await browser.close();
console.log('Errores de página:', errs.length ? errs.join(' | ') : 'ninguno');
console.log(`${passed} OK · ${fails} fallas`);
process.exit(fails ? 1 : 0);
