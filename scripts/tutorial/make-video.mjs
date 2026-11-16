// SanoLicores — Genera el video tutorial narrado (voz es-VE) grabando el sistema real.
// Requisitos: URL de la app (producción o emuladores), ffmpeg en el PATH y `pip install edge-tts`.
// Uso: node make-video.mjs [url=https://sano-licores.web.app]
//   RECORD_ONLY=1 solo graba · ENCODE_ONLY=1 solo monta lo grabado (útil con poca RAM) · UNTIL=08 graba hasta esa escena
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = process.argv[2] || 'https://sano-licores.web.app';
const WORK = path.join(here, 'work');
const OUT_DIR = path.join(here, '..', '..', 'public', 'tutorial');
mkdirSync(WORK, { recursive: true }); mkdirSync(OUT_DIR, { recursive: true });
const FFMPEG = execFileSync('where', ['ffmpeg']).toString().split(/\r?\n/)[0].trim();
const VOICE = 'es-VE-PaolaNeural';
const W = 1280, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAST = '.modal-backdrop:last-child';

// ======================================================================
// Guion: cada escena tiene la narración y las acciones que se graban
// ======================================================================
const SCENES = [
  { id: '01-intro', card: 'intro', text: 'Hola. Bienvenido a SanoLicores, el sistema para administrar tu licorería. En pocos minutos te muestro cómo vender por unidad, six-pack o caja, fría o al tiempo, al detal o al mayor; llevar tus envases retornables, armar combos, controlar el fiado, recibir pedidos en línea y comprar a tus distribuidoras.' },
  { id: '02-login', text: 'Para empezar, entra con el usuario y la contraseña de tu licorería. Si solo quieres probar, toca “Probar demo gratis”: tendrás treinta minutos con una licorería de ejemplo, y el PIN de la demo es uno, dos, tres, cuatro.',
    act: async (v, dur) => { await v.hl('#login-form', 4200); await v.hl('#lg-demo', 4600); await v.move('#lg-demo'); await sleep(Math.max(0, dur * 1000 - 11800)); await v.point('#lg-demo'); }, after: 'country' },
  { id: '03-pais', text: 'La primera vez que entras, el sistema te pregunta en qué país está tu licorería. Así toma sola la moneda, las formas de pago de tu país y el prefijo de WhatsApp. En Venezuela trabaja en dólares y bolívares con la tasa del Banco Central del día.',
    act: async (v) => {
      await v.hl('.country-grid', 4200);
      await v.point(`${LAST} [data-search], ${LAST} input`); await v.page.keyboard.type('Venez', { delay: 110 }); await sleep(900);
      await v.point('.country-grid [data-c="VE"]'); await sleep(1400);
      await v.point(`${LAST} [data-ok]`); await sleep(800);
    }, after: 'demo' },
  { id: '04-inicio', text: 'Esta es tu pantalla de inicio. Arriba, los accesos para vender, recibir vacíos o recibir mercancía. Luego, las ventas y la ganancia de hoy, lo que está por agotarse, los envases en depósito y prestados, el fiado por cobrar y lo que debes a tus distribuidoras. Y aquí abajo, los clientes que te deben envases o que dejaron de venir, con su WhatsApp listo. Si tu licencia de licores está por vencer, también te avisa.',
    act: async (v) => { await v.hl('[data-tour="quick"]', 3800); await v.hl('[data-tour="kpis"]', 7000); await v.hl('[data-tour="follow"]', 5200); await v.hl('[data-tour="low"]', 3200); } },
  { id: '05-vender', text: 'En Vender escaneas el código de barras o buscas por nombre, tipo o marca. Al tocar un producto eliges si lo vendes fría o al tiempo, y por unidad, por six-pack o por caja, cada uno con su precio. Las pestañas te dan lo más vendido, lo que tienes frío y tus combos.',
    act: async (v) => {
      await v.nav('vender'); await sleep(1000);
      await v.hl('#pos-tabs', 2600);
      await v.point('#pos-search'); await v.page.keyboard.type('polar pilsen lata', { delay: 110 }); await sleep(1000);
      await v.point('#pos-grid .prow'); await sleep(1500);
      await v.hl(`${LAST} [data-cold]`, 2600);
      await v.hl(`${LAST} .pack-grid`, 3400);
      await v.point(`${LAST} .pack-btn[data-k="pack"]`); await sleep(1200);
      await v.page.evaluate(() => { const i = document.querySelector('#pos-search'); i.value = ''; i.dispatchEvent(new Event('input')); });
      await v.point('#pos-tabs [data-tab="combo"]'); await sleep(1600);
      await v.point('#pos-grid .prow'); await sleep(1200);
    } },
  { id: '06-envases', text: 'Si vendes cerveza o refresco retornable, el sistema te pregunta cuántos vacíos trae el cliente. Los que faltan los cobras como depósito, o se los prestas y queda debiéndolos. Al elegir un cliente al mayor, los precios cambian solos, y si fías, respeta su límite. Cobras con varias formas de pago a la vez y te calcula el vuelto.',
    act: async (v) => {
      await v.point('#pos-search'); await v.page.keyboard.type('botella 1/3', { delay: 110 }); await sleep(900);
      await v.point('#pos-grid .prow'); await sleep(1300);
      await v.point(`${LAST} .pack-btn[data-k="caja"]`); await sleep(1200);
      await v.hl('[data-tour="pos-empties"]', 5200);
      await v.hl('#c-mayor', 2200);
      await v.hl('[data-tour="pos-client"]', 2600);
      await v.point('#c-pay'); await sleep(1600);
      await v.hl(`${LAST} .pay-methods`, 3000);
      await v.point(`${LAST} [data-ok]`); await sleep(2400);
    }, after: 'closeModal' },
  { id: '07-pedidos', text: 'Tus clientes te piden en línea desde tu catálogo propio, con delivery o para retirar. Los pedidos llegan aquí al instante, y ves si los quieren bien frías. Los aceptas, avisas por WhatsApp cuando están listos y los cobras con un toque. Tu enlace y tu código QR los compartes en Instagram y en el mostrador.',
    act: async (v) => {
      await v.nav('pedidos'); await sleep(1100);
      await v.hl('#o-tabs', 2600);
      await v.hl('#o-list .order-card', 4600);
      await v.point('#o-list [data-a="preparando"]'); await sleep(2200);
      await v.point('#o-share'); await sleep(1600);
      await v.hl(`${LAST} .modal`, 3000);
    }, after: 'closeModal' },
  { id: '08-catalogo', track: 'shop', text: 'Así se ve tu catálogo en el teléfono del cliente: busca su bebida, elige por unidad o por caja, marca si las quiere bien frías y te envía el pedido sin crear ninguna cuenta.' },
  { id: '09-envases', text: 'En Envases retornables ves cuántos vacíos tienes en el depósito, quién te debe envases y todos los movimientos. Cuando el cliente trae sus vacíos los recibes en un toque, y cuando viene el camión registras los que le entregas a la distribuidora.',
    act: async (v) => {
      await v.nav('envases'); await sleep(1100);
      await v.hl('#e-body', 4200);
      await v.point('#e-tabs [data-t="prestados"]'); await sleep(1500);
      await v.hl('#e-body', 3800);
      await v.point('#e-tabs [data-t="movimientos"]'); await sleep(2000);
      await v.hl('#e-sup', 2200);
    } },
  { id: '10-inventario', text: 'En Inventario tienes cada producto en cajas y unidades, con sus lotes y vencimientos: sale primero lo que vence antes. En Por reponer, lo que bajó del mínimo. Registras las roturas y las cortesías, y haces el conteo físico protegido con tu PIN.',
    act: async (v) => {
      await v.nav('inventario'); await sleep(1100);
      await v.hl('#i-body', 3600);
      await v.point('#i-tabs [data-t="bajo"]'); await sleep(2400);
      await v.point('#i-tabs [data-t="vencimientos"]'); await sleep(2400);
      await v.point('#i-tabs [data-t="movimientos"]'); await sleep(2400);
    } },
  { id: '11-compras', text: 'En Compras, el sugerido te arma el pedido con lo que está por agotarse. Se lo envías a tu distribuidora por WhatsApp, y al recibir la mercancía registras el lote, el costo y el nuevo precio. Las facturas a crédito quedan en Por pagar, con su fecha de vencimiento.',
    act: async (v) => {
      await v.nav('compras'); await sleep(1100);
      await v.hl('#p-body', 4400);
      await v.point('#p-tabs [data-t="recibir"]'); await sleep(1500);
      await v.hl('#p-body', 3800);
      await v.point('#p-tabs [data-t="pagar"]'); await sleep(1500);
      await v.hl('#p-body', 3500);
    } },
  { id: '12-clientes', text: 'En Clientes cada ficha guarda si es al detal o al mayor, su límite de fiado, su bebida favorita, sus compras y los envases que debe. Filtras por quién te debe, quién compra al mayor o quién dejó de venir.',
    act: async (v) => {
      await v.nav('clientes'); await sleep(1000);
      await v.hl('[data-tour="filters"]', 3200);
      await v.point('#c-q'); await v.page.keyboard.type('Luis', { delay: 120 }); await sleep(1000);
      await v.point('#c-list [data-id]'); await sleep(1800);
      await v.hl(`${LAST} .modal`, 2600);
      await v.point(`${LAST} [data-tabs] [data-t="compras"]`); await sleep(2200);
      await v.point(`${LAST} [data-tabs] [data-t="envases"]`); await sleep(2600);
      v.card = await v.page.evaluate(async () => { const { store } = await import('/js/store.js'); return store.clients.find((m) => /Luis/.test(m.name))?.cardCode; });
    }, after: 'closeModal' },
  { id: '13-tarjeta', track: 'card', text: 'Y esta es la tarjeta digital que el cliente guarda en su teléfono: sus puntos, lo que tiene fiado, los envases que debe, su código QR y el botón para pedir en línea.' },
  { id: '14-fidelizar', text: 'En Fidelidad y fiados ves a los clientes que dejaron de venir: con un toque les escribes por WhatsApp con una oferta para que vuelvan. También tienes quién te debe fiado, tus clientes al mayor, los cumpleaños y los puntos.',
    act: async (v) => {
      await v.nav('fidelizar'); await sleep(1000);
      await v.hl('#l-body', 4200);
      await v.move('#l-body .btn-whatsapp'); await sleep(1200);
      await v.point('#l-tabs [data-t="fiados"]'); await sleep(1500);
      await v.hl('#l-body', 4000);
    } },
  { id: '15-caja', text: 'En Caja abres el turno con el fondo inicial, registras los gastos, como el hielo o el motorizado, y al cerrar cuentas el efectivo: el sistema te dice si sobra o falta dinero. Y los reportes, protegidos con tu PIN, te muestran la ganancia, lo más vendido y más rentable, lo que vendiste frío y al mayor, los envases y lo que perdiste por roturas.',
    act: async (v) => {
      await v.nav('caja'); await sleep(1000); await v.hl('#k-body', 4200);
      await v.navRaw('reportes'); await sleep(1000);
      if (await v.page.$('.modal [data-pin]')) { await v.point('.modal [data-pin]'); await v.page.keyboard.type('1234', { delay: 160 }); await sleep(300); await v.point('.modal [data-ok]'); }
      await sleep(2200);
      await v.hl('.kpis', 4000);
      await v.page.evaluate(() => (document.querySelector('.main') || document.scrollingElement).scrollBy({ top: 700, behavior: 'smooth' })); await sleep(2600);
      await v.hl('table', 2600);
    } },
  { id: '16-precios', text: 'Con la Consulta de precios pones una tablet o una pantalla en la entrada: el cliente pasa la botella por el lector y ve su precio por unidad, fría y por caja. Para salir se pide tu PIN.',
    act: async (v) => {
      await v.page.evaluate(() => { location.hash = '#/precios'; }); await sleep(1600);
      await v.point('#k-q'); await v.page.keyboard.type('Cacique', { delay: 140 }); await sleep(1400);
      await v.point('.pck-list [data-p]'); await sleep(4200);
    }, after: 'exitKiosk' },
  { id: '17-instalar', card: 'phone', text: 'SanoLicores se instala desde el navegador, en la computadora del mostrador, en una tablet o en tu teléfono, sin descargar nada de una tienda. Funciona incluso si se va el internet, y todo queda conectado en tiempo real.' },
  { id: '18-ayuda', text: 'Si tienes dudas, en “Ayuda y recorridos” encuentras guías que te señalan cada parte de la pantalla, y este mismo video.',
    act: async (v) => { await v.nav('inicio'); await sleep(500); await v.point('#sb-help'); await sleep(1300); await v.hl('.modal .help-list', 3500); }, after: 'closeModal' },
  { id: '19-cierre', card: 'outro', text: '¿Listo para llevar tu licorería al siguiente nivel? Escríbenos por WhatsApp al más cincuenta y ocho, cuatro, dos, dos, uno, nueve, cero, seis, cero, cuatro, cinco, y activa SanoLicores hoy mismo. ¡Salud, y gracias por ver!' }
];

// ======================================================================
// Voz
// ======================================================================
function tts(scene) {
  const h = createHash('md5').update(VOICE + scene.text).digest('hex').slice(0, 10);
  const mp3 = path.join(WORK, `${scene.id}-${h}.mp3`), srt = path.join(WORK, `${scene.id}-${h}.srt`);
  if (!existsSync(mp3)) execFileSync('python', ['-m', 'edge_tts', '--voice', VOICE, '--rate=+3%', '--text', scene.text, '--write-media', mp3, '--write-subtitles', srt]);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).toString());
  return { mp3, srt, dur };
}

// ======================================================================
// Ayudas visuales: cursor animado, clic y resaltado
// ======================================================================
const OVERLAY = () => {
  const add = () => {
    if (document.getElementById('vcur')) return;
    const st = document.createElement('style');
    st.textContent = `#vcur{position:fixed;left:640px;top:360px;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:left .7s cubic-bezier(.2,.8,.2,1),top .7s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}
      .vrip{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #fbbf24;z-index:2147483646;pointer-events:none;animation:vrip .6s ease-out forwards}
      @keyframes vrip{to{transform:scale(3.6);opacity:0}}
      .vhl{position:fixed;z-index:2147483645;pointer-events:none;border-radius:14px;border:3px solid #fbbf24;box-shadow:0 0 0 4px rgba(251,191,36,.25),0 0 28px 6px rgba(251,191,36,.45);transition:opacity .3s;animation:vhl 1.4s ease-in-out infinite}
      @keyframes vhl{50%{box-shadow:0 0 0 7px rgba(251,191,36,.18),0 0 34px 10px rgba(251,191,36,.3)}}
      .toasts{top:auto!important;bottom:18px!important}`;
    document.head.appendChild(st);
    const c = document.createElement('div');
    c.id = 'vcur';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 9.5-6.6 1.4L16 20.5l-3 1.4-3.6-7.6L4 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
};

function helpers(page) {
  const rectOf = async (sel, text = null, pick = null) => {
    const r = await page.evaluate((sel, text, pickSrc) => {
      const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2; };
      let el = [...document.querySelectorAll(sel)].find((e) => vis(e) && (!text || e.textContent.replace(/\s+/g, ' ').includes(text)));
      if (!el) return null;
      if (pickSrc) el = (0, eval)(pickSrc)(el) || el;
      const b0 = el.getBoundingClientRect();
      if (b0.top < 0 || b0.bottom > innerHeight) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      else el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    }, sel, text, pick ? pick.toString() : null);
    if (!r) console.warn('   (no encontré', sel, text || '', ')');
    return r;
  };
  const moveXY = async (x, y) => { await page.evaluate((x, y) => { const c = document.getElementById('vcur'); if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; } }, x, y); await sleep(760); };
  const v = {
    page,
    async move(sel, text) { const r = await rectOf(sel, text); if (r) await moveXY(r.x + r.w / 2, r.y + r.h / 2); return r; },
    async point(sel, text) {
      const r = await v.move(sel, text);
      if (!r) return;
      const x = r.x + r.w / 2, y = r.y + r.h / 2;
      await page.evaluate((x, y) => { const d = document.createElement('div'); d.className = 'vrip'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 700); }, x, y);
      // Si algo cambió de lugar mientras se movía el cursor, se pulsa el elemento directamente
      const hit = await page.evaluate((sel, text, x, y) => {
        const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2; };
        const el = [...document.querySelectorAll(sel)].find((e) => vis(e) && (!text || e.textContent.replace(/\s+/g, ' ').includes(text)));
        if (!el) return 'sin elemento';
        const at = document.elementFromPoint(x, y);
        if (at && (at === el || el.contains(at))) return 'ok';
        if (typeof el.click === 'function') el.click(); else el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return 'directo: ' + (at ? at.tagName + '.' + at.className : 'nada');
      }, sel, text || null, x, y);
      if (hit === 'ok') await page.mouse.click(x, y);
      else console.warn('   clic', sel, '→', hit);
      await sleep(250);
    },
    pointText(sel, text) { return v.point(sel, text); },
    async pointRow(rowSel, text, btnSel) {
      const r = await rectOf(rowSel, text, (el) => el.querySelector('[data-ed]'));
      if (!r) return;
      await moveXY(r.x + r.w / 2, r.y + r.h / 2);
      await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    },
    async hl(sel, ms = 2500, pick = null, text = null) {
      const r = await rectOf(sel, text, pick);
      if (!r) { await sleep(ms); return; }
      await page.evaluate((r) => { const d = document.createElement('div'); d.className = 'vhl'; d.id = 'vhl-cur'; Object.assign(d.style, { left: r.x - 6 + 'px', top: r.y - 6 + 'px', width: r.w + 12 + 'px', height: r.h + 12 + 'px' }); document.body.appendChild(d); }, r);
      await sleep(ms);
      await page.evaluate(() => document.querySelectorAll('.vhl').forEach((d) => d.remove()));
    },
    hlText(sel, text, ms) { return v.hl(sel, ms, null, text); },
    hlRow(sel, text, ms) { return v.hl(sel, ms, null, text); },
    async scrollModalTo(sel) { await page.evaluate((sel) => document.querySelector('.modal ' + sel)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), sel); await sleep(700); },
    async nav(id) { await v.point(`.sb-nav [data-nav="${id}"]`); await sleep(500); },
    async navRaw(id) { await v.point(`.sb-nav [data-nav="${id}"]`); }
  };
  return v;
}

// ======================================================================
// Tarjetas (portada, instalación en teléfono, cierre)
// ======================================================================
const logo = readFileSync(path.join(here, '..', '..', 'public', 'assets', 'logo.svg'), 'utf8');
const CARD_CSS = `body{margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;color:#fff;
  background:radial-gradient(900px 500px at -10% -20%,#9f1239 0%,transparent 55%),radial-gradient(800px 500px at 110% 120%,#7c2d12 0%,transparent 55%),linear-gradient(150deg,#140609,#2a0a12 50%,#0b0405)}
  .c{height:100%;display:flex;align-items:center;justify-content:center;gap:60px;text-align:left}
  .logo svg{width:150px;height:150px;border-radius:40px;box-shadow:0 30px 60px -20px rgba(0,0,0,.7);animation:pop .9s cubic-bezier(.2,.8,.2,1)}
  h1{font-size:64px;margin:0;letter-spacing:-2px;animation:up .9s .15s both} h1 em{font-style:normal;background:linear-gradient(90deg,#fef3c7,#fbbf24);-webkit-background-clip:text;color:transparent}
  p{font-size:26px;margin:14px 0 0;opacity:.82;animation:up .9s .35s both} .tag{display:inline-block;margin-top:26px;padding:10px 18px;border-radius:999px;background:rgba(255,255,255,.12);font-size:20px;animation:up .9s .55s both}
  @keyframes pop{from{transform:scale(.6);opacity:0}} @keyframes up{from{transform:translateY(22px);opacity:0}}`;
function cardHTML(kind) {
  if (kind === 'intro') return `<style>${CARD_CSS}</style><div class="c"><div class="logo">${logo}</div><div><h1>Sano<em>Licores</em></h1><p>Tutorial: cómo administrar tu licorería</p><span class="tag">Unidad, six-pack o caja · Frías · Envases retornables · Combos · Fiado · Pedidos en línea</span></div></div>`;
  if (kind === 'outro') return `<style>${CARD_CSS} .wa{display:inline-flex;align-items:center;gap:14px;margin-top:28px;padding:18px 28px;border-radius:18px;background:#16a34a;font-size:34px;font-weight:700;animation:up .9s .45s both;box-shadow:0 20px 40px -16px rgba(22,163,74,.8)}</style>
    <div class="c"><div class="logo">${logo}</div><div><h1>¿Listo para <em>tu licorería?</em></h1><p>Instálalo desde sano-licores.web.app</p><div class="wa">WhatsApp +58 422-190 6045</div></div></div>`;
  return `<style>${CARD_CSS} .phone{width:330px;height:640px;border-radius:46px;background:#000;padding:12px;box-shadow:0 40px 80px -24px rgba(0,0,0,.85),0 0 0 2px #333;animation:pop .9s cubic-bezier(.2,.8,.2,1)}
    .phone{position:relative;width:302px;height:648px;padding:12px;overflow:hidden} .phone img{position:absolute;left:12px;top:12px;width:302px;height:648px;object-fit:cover;object-position:top;border-radius:36px}
    .phone .s2{opacity:0;animation:fadein .8s 7s forwards} @keyframes fadein{to{opacity:1}}
    .steps{max-width:520px} .steps h1{font-size:50px} .st{display:flex;gap:16px;align-items:center;margin-top:22px;font-size:24px;animation:up .8s both} .st b{width:44px;height:44px;border-radius:14px;background:#b45309;--x:#047857;display:grid;place-items:center;flex:none}</style>
    <div class="c"><div class="phone"><img src="${PHONE[0]}"><img class="s2" src="${PHONE[1]}"></div><div class="steps"><h1>Instálalo <em>desde la web</em></h1>
    <div class="st" style="animation-delay:.4s"><b>1</b>Abre sano-licores.web.app en Chrome</div>
    <div class="st" style="animation-delay:1.6s"><b>2</b>Toca “Instalar app”</div>
    <div class="st" style="animation-delay:2.8s"><b>3</b>Listo: el ícono queda en tu pantalla</div>
    <div class="st" style="animation-delay:4s"><b>✓</b>Teléfono, tablet o computadora, conectados</div></div></div>`;
}

// ======================================================================
// Grabación
// ======================================================================
const ENCODE_ONLY = !!process.env.ENCODE_ONLY;
const PHONE = [];
let parts = [];
if (!ENCODE_ONLY) {
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', `--window-size=${W},${H}`, '--autoplay-policy=no-user-gesture-required', '--disable-gpu', '--disable-extensions', '--renderer-process-limit=2'] });
const app = await browser.newPage();
await app.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await app.evaluateOnNewDocument(OVERLAY);
await app.evaluateOnNewDocument(() => { window.print = () => {}; Element.prototype.requestFullscreen = function () { return Promise.resolve(); }; try { localStorage.setItem('sf_installed', '1'); localStorage.setItem('sf_theme', 'dark'); localStorage.setItem('sf_kiosk_mode', 'tv'); } catch (_) {} });
const v = helpers(app);

// Capturas del teléfono (Android) para la escena de instalación
// PHONE se declara arriba
{
  const ctx = await browser.createBrowserContext();
  const m = await ctx.newPage();
  await m.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');
  await m.setViewport({ width: 390, height: 836, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.goto(APP, { waitUntil: 'networkidle0' });
  await m.waitForSelector('.install-card'); await sleep(900);
  await m.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(300);
  PHONE.push('data:image/png;base64,' + (await m.screenshot({ encoding: 'base64' })));
  await m.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await m.evaluate(() => document.querySelector('.install-card [data-install]').click());
  await m.waitForSelector('.modal'); await sleep(700);
  await m.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  PHONE.push('data:image/png;base64,' + (await m.screenshot({ encoding: 'base64' })));
  await ctx.close();
}
await app.goto(APP, { waitUntil: 'networkidle0' });
await app.waitForSelector('#login-form');
await sleep(1200);

parts = [];
for (const sc of SCENES.filter((s) => !process.env.UNTIL || s.id <= process.env.UNTIL)) {
  const voice = tts(sc);
  console.log(`● ${sc.id} (${voice.dur.toFixed(1)} s)`);
  const webm = path.join(WORK, `${sc.id}.webm`);
  let page = app, cardPage = null;
  if (sc.card) {
    cardPage = await browser.newPage();
    await cardPage.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await cardPage.setContent(cardHTML(sc.card), { waitUntil: 'load' });
    page = cardPage;
  }
  if (sc.track) {
    cardPage = await browser.newPage();
    await cardPage.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    const u = new URL(APP);
    await cardPage.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    if (sc.track === 'shop') {
      const slug = await app.evaluate(async () => (await import('/js/store.js')).store.settings.shop?.slug);
      await cardPage.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
      await cardPage.goto(`${u.origin}/pedido/${slug}${u.search}`, { waitUntil: 'networkidle2' });
      await cardPage.waitForSelector('[data-inc]', { timeout: 30000 }).catch(() => {});
      await cardPage.evaluateOnNewDocument(OVERLAY); await cardPage.evaluate(OVERLAY);
      v.shop = helpers(cardPage);
    } else {
      await cardPage.goto(`${u.origin}/tarjeta/${v.card}${u.search}`, { waitUntil: 'networkidle2' });
      await cardPage.waitForSelector('.mcard-qr img', { timeout: 30000 }).catch(() => {});
    }
    if (sc.track === 'card') await cardPage.addStyleTag({ content: '.pcard-page{zoom:.8}' });
    if (sc.track === 'card') await cardPage.evaluate(() => {
      setTimeout(() => window.scrollTo({ top: 320, behavior: 'smooth' }), 4500);
      setTimeout(() => window.scrollTo({ top: 900, behavior: 'smooth' }), 9000);
      setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 13500);
    });
    await sleep(800);
    page = cardPage;
  }
  await page.bringToFront();
  await sleep(300);
  const rec = await page.screencast({ path: webm, ffmpegPath: FFMPEG });
  const t0 = Date.now();
  if (sc.track === 'shop' && v.shop) {
    try {
      const s2 = v.shop;
      await s2.point('#s-cold [data-v="1"]'); await sleep(900);
      await s2.point('#s-q'); await cardPage.keyboard.type('polar', { delay: 120 }); await sleep(1200);
      await s2.point('[data-inc]'); await sleep(700); await s2.point('[data-inc]'); await sleep(900);
      await cardPage.evaluate(() => { const q = document.querySelector('#s-q'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(900);
      await s2.point('#s-bar'); await sleep(1500);
      await s2.hl('.modal', 3500);
    } catch (e) { console.warn('   catálogo:', e.message); }
  }
  if (sc.act) { try { await sc.act(v, voice.dur); } catch (e) { console.warn('   acción:', e.message); } }
  const left = voice.dur * 1000 + 700 - (Date.now() - t0);
  if (left > 0) await sleep(left);
  await rec.stop();
  const total = Math.max(voice.dur + 0.7, (Date.now() - t0) / 1000);
  parts.push({ webm, ...voice, total });
  if (cardPage) await cardPage.close();
  // Acciones fuera de cámara
  if (sc.after === 'country') { await app.waitForSelector('.country-grid', { timeout: 90000 }); await sleep(900); }
  if (sc.after === 'demo') {
    await app.waitForSelector('.sb-nav', { timeout: 90000 });
    // la demo termina de cargar sus datos y recién ahí abre el recorrido
    await app.waitForFunction(() => !document.getElementById('boot'), { timeout: 180000 }).catch(() => {});
    await app.waitForSelector('.tour-tip', { timeout: 30000 }).catch(() => {});
    await app.evaluate(async () => (await import('/js/tour.js')).stopTour());
    await sleep(6000);
    await app.evaluate(async () => { (await import('/js/tour.js')).stopTour(); document.querySelectorAll('.tour').forEach((x) => x.remove()); document.querySelectorAll('.toast').forEach((t) => t.remove()); });
  }
  if (sc.after === 'exitKiosk') { await app.click('#k-exit').catch(() => {}); await app.waitForSelector('.modal [data-pin]', { timeout: 8000 }).catch(() => {}); await app.type('.modal [data-pin]', '1234').catch(() => {}); await app.evaluate(() => [...document.querySelectorAll('.modal [data-ok]')].pop()?.click()); await sleep(1500); }
  if (sc.after === 'closeModal') { await app.keyboard.press('Escape'); await sleep(400); await app.keyboard.press('Escape'); await sleep(1500); await app.evaluate(async () => (await import('/js/utils.js')).closeAllModals()).catch(() => {}); await sleep(400); }
}
// Termina la demo usada en la grabación (se borra de la base de datos)
try {
  await app.bringToFront();
  await app.keyboard.press('Escape'); await sleep(300);
  await app.evaluate(() => document.getElementById('demo-end')?.click());
  await app.waitForSelector('.modal [data-yes]', { timeout: 8000 }); await app.click('.modal [data-yes]');
  await app.waitForSelector('#login-form', { timeout: 60000 });
  console.log('Demo de la grabación terminada y borrada');
} catch (e) { console.warn('No se pudo terminar la demo:', e.message); }
await browser.close();
writeFileSync(path.join(WORK, 'parts.json'), JSON.stringify(parts, null, 1));
}
if (ENCODE_ONLY) parts = JSON.parse(readFileSync(path.join(WORK, 'parts.json'), 'utf8'));
if (process.env.RECORD_ONLY) { console.log('Grabación lista:', parts.length, 'escenas'); process.exit(0); }

// ======================================================================
// Montaje con ffmpeg: video + voz + subtítulos por escena, luego unión
// ======================================================================
const subStyle = "FontName=Segoe UI,FontSize=17,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=22,MarginL=60,MarginR=60";
const list = [];
for (const p of parts) {
  const mp4 = p.webm.replace('.webm', '.mp4');
  const srtName = path.basename(p.srt);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', p.webm, '-i', p.mp3,
    '-filter_complex', `[0:v]fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x03120f,tpad=stop_mode=clone:stop_duration=5,subtitles=${srtName}:force_style='${subStyle}',setsar=1[v];[1:a]adelay=250|250,apad[a]`,
    '-map', '[v]', '-map', '[a]', '-t', p.total.toFixed(2), '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', mp4], { cwd: WORK });
  list.push(`file '${mp4.replace(/\\/g, '/')}'`);
}
const listFile = path.join(WORK, 'lista.txt');
writeFileSync(listFile, list.join('\n'));
const final = path.join(OUT_DIR, 'sano-licores-tutorial.mp4');
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', final]);
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', '2.5', '-i', parts[0].webm.replace('.webm', '.mp4'), '-frames:v', '1', '-q:v', '3', path.join(OUT_DIR, 'portada.jpg')]);
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', final]).toString());
console.log(`\n✔ Video listo: ${final} (${(dur / 60).toFixed(1)} min)`);
