// SanoLicores — Captura todas las pantallas, pestañas y ventanas de la demo para revisión visual. Uso: node qa-shots.mjs [carpeta] [ancho] [alto] (emuladores encendidos)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[2] || 'shots/qa';
const W = Number(process.argv[3] || 1366), H = Number(process.argv[4] || 860), MOB = W < 600;
mkdirSync(OUT, { recursive: true });
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
await p.setViewport({ width: W, height: H, isMobile: MOB, hasTouch: MOB, deviceScaleFactor: 1 });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
p.on('dialog', (d) => d.dismiss());
await p.goto('http://127.0.0.1:5161/?emu=1', { waitUntil: 'networkidle2' });
await p.screenshot({ path: `${OUT}/00-login.png` });
await p.click('#lg-demo');
await p.waitForSelector('.country-grid [data-c="VE"]', { timeout: 60000 });
await p.click('.country-grid [data-c="VE"]'); await sleep(250);
await p.evaluate(() => [...document.querySelectorAll('.modal [data-ok]')].pop().click());
await p.waitForFunction(() => document.querySelector('.sb-nav, .bottom-nav') && !document.getElementById('boot'), { timeout: 180000 });
await sleep(2500);
await p.screenshot({ path: `${OUT}/01-tour.png` });
await p.evaluate(async () => (await import('/js/tour.js')).stopTour());
const shot = async (n, full = false) => { await sleep(700); await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: full }); };
const go = async (r) => { await p.evaluate((x) => { location.hash = '#/' + x; }, r); await sleep(1400); };
const close = () => p.evaluate(async () => (await import('/js/utils.js')).closeAllModals());
const pinIf = async () => { if (await p.$('.modal [data-pin]')) { await p.type('.modal [data-pin]', '1234'); await p.evaluate(() => [...document.querySelectorAll('.modal [data-ok]')].pop().click()); await sleep(1500); } };
const tabs = async (base, sel = '#view .tabs button') => {
  const n = await p.$$eval(sel, (x) => x.length).catch(() => 0);
  for (let i = 0; i < n; i++) { await p.evaluate((s, k) => document.querySelectorAll(s)[k]?.click(), sel, i); await pinIf(); await shot(`${base}-t${i}`, true); }
};
for (const v of ['inicio', 'pedidos', 'clientes', 'envases', 'fidelizar', 'inventario', 'compras', 'facturas', 'caja', 'ajustes']) {
  await go(v); await pinIf(); await shot(`10-${v}`, true); await tabs(`10-${v}`);
}
await go('reportes'); await pinIf(); await sleep(1500); await shot('11-reportes', true);
// Vender: modal de producto, carrito con envases, cobro
await go('vender'); await shot('20-vender');
await p.type('#pos-search', 'polar pilsen lata'); await sleep(800);
await p.click('#pos-grid .prow'); await shot('21-producto');
await p.click('.modal .pack-btn[data-k="pack"]'); await sleep(600);
await p.evaluate(() => { const i = document.querySelector('#pos-search'); i.value = ''; i.dispatchEvent(new Event('input')); });
await p.type('#pos-search', 'botella 1/3'); await sleep(800);
await p.click('#pos-grid .prow'); await sleep(800);
await p.click('.modal .pack-btn[data-k="caja"]'); await sleep(800);
if (MOB) { await p.evaluate(() => document.querySelector('#cart-fab')?.click()); await sleep(800); }
await shot('22-carrito');
await p.click('#c-pt').catch(() => {}); await shot('23-elegir-cliente');
await p.evaluate(() => document.querySelector('.modal [data-id]')?.click()); await sleep(900); await shot('24-carrito-cliente');
await p.evaluate(() => document.querySelector('#c-pay')?.click()); await shot('25-cobrar');
await close();
// Ficha de cliente con pestañas
await p.evaluate(async () => { const { store } = await import('/js/store.js'); const c = store.clients.find((x) => x.type === 'mayor' && x.empties && Object.values(x.empties).some((n) => n > 0)) || store.clients[0]; (await import('/js/client.js')).openClient(c.id); });
await sleep(1200); await shot('30-ficha');
await tabs('30-ficha', '.modal [data-tabs] [data-t]');
await close();
// Ventanas de envases y producto
await go('envases');
await p.evaluate(() => document.querySelector('#e-in')?.click()); await shot('40-recibir-vacios'); await close();
await p.evaluate(() => document.querySelector('#e-sup')?.click()); await shot('41-entregar-proveedor'); await close();
await go('inventario');
await p.evaluate(() => document.querySelector('#i-new')?.click()); await shot('42-producto-nuevo', true); await close();
await p.evaluate(() => document.querySelector('#i-combo')?.click()); await shot('43-combo-nuevo', true); await close();
await go('clientes');
await p.evaluate(() => document.querySelector('#c-new')?.click()); await shot('44-cliente-nuevo', true); await close();
await go('precios'); await p.type('#k-q', 'cacique'); await sleep(900); await p.evaluate(() => document.querySelector('.pck-list [data-p]')?.click()); await shot('50-precios');
// Páginas públicas
const info = await p.evaluate(async () => { const { store } = await import('/js/store.js'); const c = store.clients.find((x) => x.balance > 0 && x.empties && Object.values(x.empties).some((n) => n > 0)) || store.clients[0]; return { code: c.cardCode, slug: store.settings.shop?.slug }; });
const q = await b.newPage(); await q.setViewport({ width: Math.min(W, 430), height: 860, isMobile: true, deviceScaleFactor: 1 });
q.on('pageerror', (e) => errs.push('público: ' + e.message));
await q.goto(`http://127.0.0.1:5161/tarjeta/${info.code}?emu=1`, { waitUntil: 'networkidle2' }); await sleep(1800); await q.screenshot({ path: `${OUT}/60-tarjeta.png`, fullPage: true });
await q.goto(`http://127.0.0.1:5161/pedido/${info.slug}?emu=1`, { waitUntil: 'networkidle2' }); await sleep(2500); await q.screenshot({ path: `${OUT}/61-catalogo.png` });
await q.evaluate(() => { document.querySelectorAll('[data-inc]')[0]?.click(); document.querySelectorAll('[data-inc]')[3]?.click(); }); await sleep(400);
await q.evaluate(() => document.querySelector('#s-bar')?.click()); await sleep(900); await q.screenshot({ path: `${OUT}/62-checkout.png` });
console.log('ERRORES:', errs.length ? errs.join(' | ') : 'ninguno');
await b.close();
