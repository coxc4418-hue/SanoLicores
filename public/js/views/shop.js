// SanoLicores — Catálogo público para pedir en línea: /pedido/SLUG (sin sesión)
// El cliente elige por unidad o por caja, frío o al tiempo, combos, y envía el pedido para retirar o delivery.
import { getShop } from '../store.js';
import { db, collection, addDoc } from '../firebase.js';
import { esc, num, normalize, debounce, waLink, applyLocale, toast, openModal } from '../utils.js';
import { icon } from '../icons.js';

const CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const code = (n = 5) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => CODE[x % CODE.length]).join('');
const r2 = (v) => Math.round(v * 100) / 100;
const CAT_IC = (c = '') => (/cerve/i.test(c) ? 'beer' : /vino|espum|sangr/i.test(c) ? 'wine' : /hielo/i.test(c) ? 'snow' : /combo/i.test(c) ? 'gift' : /refres|jugo|agua|energ/i.test(c) ? 'glass' : /snack|pasapal|cigarr|otro/i.test(c) ? 'bag' : 'bottle');

export async function mount(root) {
  const slug = (/\/pedido\/([a-z0-9-]+)/i.exec(location.pathname)?.[1] || '').toLowerCase();
  root.innerHTML = '<div class="shop-page"><div class="empty"><div class="spinner"></div></div></div>';
  let S = null;
  try { S = slug ? await getShop(slug) : null; } catch (e) { console.error(e); }
  if (!S || S.enabled === false) {
    root.innerHTML = `<div class="pcard-page"><div class="mcard mcard-err"><img src="/assets/logo.svg" alt="" width="64"><h1>Catálogo no disponible</h1><p>Este enlace de pedidos no existe o la licorería lo desactivó por ahora. Escríbele directamente por WhatsApp.</p><a class="btn btn-primary" href="/">Ir a SanoLicores</a></div></div>`;
    return;
  }
  try { applyLocale(S.country || 'VE'); } catch (_) {}
  document.title = `${S.shop} · Pedidos en línea`;
  const money = (v) => `${S.sym} ${num(v, S.dec ?? 2)}`;
  const fxm = (v) => (S.fx ? `${S.fx.sym} ${num(v * S.fx.rate, 2)}` : '');
  const KEY = 'sl_cart2_' + slug;
  const items = S.items || [];
  const byId = new Map(items.map((i) => [i.id, i]));
  // carrito: { "id:k": cantidad }  k = 'unidad' | 'caja'
  let cart = {}; let cold = false;
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; cart = saved.cart || {}; cold = !!saved.cold; } catch (_) { cart = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ cart, cold })); } catch (_) {} };
  Object.keys(cart).forEach((k) => { const [id, kind] = k.split(':'); const i = byId.get(id); if (!i || (kind === 'unidad' && !i.pu)) delete cart[k]; });
  const hasCold = items.some((i) => i.f > 0);
  const cats = [...new Set(items.map((i) => i.c).filter(Boolean))].sort((a, b) => (a === 'Combos' ? -1 : b === 'Combos' ? 1 : a.localeCompare(b, 'es')));
  let q = ''; let cat = '';

  /** Precio de una presentación, con frío si aplica */
  const priceOf = (i, k, withCold = cold) => {
    const base = k === 'unidad' ? i.pu : i.p;
    const units = k === 'unidad' ? 1 : (i.k ? 1 : i.u || 1);
    return r2(base + (withCold && i.f ? i.f * units : 0));
  };
  const packTxt = (i, k) => (i.k ? 'combo' : k === 'unidad' ? 'unidad' : i.u > 1 ? `caja x${i.u}` : 'unidad');

  root.innerHTML = `<div class="shop-page">
    <header class="shop-head">
      <div class="shop-brand"><img src="/assets/logo.svg" alt=""><div class="grow" style="min-width:0"><b class="ellipsis">${esc(S.shop)}</b><small>${S.address ? `${icon('pin')} ${esc(S.address)}` : 'Pedidos en línea'}</small></div>${S.phone ? `<a class="btn btn-whatsapp btn-icon btn-sm" href="${waLink(S.phone, 'Hola, tengo una consulta sobre un pedido.')}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp')}</a>` : ''}</div>
      <div class="shop-hero"><h1>Pide tus bebidas sin salir de casa</h1><p>Elige por unidad o por caja${hasCold ? ', frías o al tiempo' : ''}, y te lo tenemos listo${S.delivery ? ' o te lo llevamos' : ''}. Pagas al retirar o al recibir.${S.schedule ? `<br><small>${icon('clock')} ${esc(S.schedule)}</small>` : ''}</p></div>
      <label class="search search-big">${icon('search')}<input id="s-q" placeholder="Busca por marca o tipo (ej. ron añejo, cerveza lata)…" autocomplete="off"></label>
      ${hasCold ? `<div class="seg seg-block shop-cold" id="s-cold"><button type="button" data-v="0">Al tiempo</button><button type="button" data-v="1">${icon('snow')} Bien frías</button></div>` : ''}
      <div class="chips" id="s-cats"></div>
    </header>
    ${S.note ? `<div class="shop-note">${icon('info')} ${esc(S.note)}</div>` : ''}
    <main class="shop-grid" id="s-grid"></main>
    <button class="shop-cartbar" id="s-bar" hidden><span><b id="s-n">0</b> producto(s)</span><b id="s-t"></b><span>Ver pedido ${icon('arrowRight')}</span></button>
    <p class="pcard-by">Precios referenciales sujetos a disponibilidad · Disfruta con responsabilidad · Hecho con <b>SanoLicores</b></p>
  </div>`;
  const $ = (s) => root.querySelector(s);

  function drawCold() {
    root.querySelectorAll('#s-cold [data-v]').forEach((b) => b.classList.toggle('on', (b.dataset.v === '1') === cold));
  }
  root.querySelectorAll('#s-cold [data-v]').forEach((b) => b.onclick = () => { cold = b.dataset.v === '1'; save(); drawCold(); drawGrid(); bar(); });

  function drawCats() {
    $('#s-cats').innerHTML = [['', 'Todo'], ...cats.map((c) => [c, c])].map(([k, l]) => `<button class="chip ${cat === k ? 'on' : ''}" data-c="${esc(k)}">${esc(l)}</button>`).join('');
    root.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cat = b.dataset.c; drawCats(); drawGrid(); });
  }
  function buyBtn(i, k) {
    const key = `${i.id}:${k}`; const n = cart[key] || 0;
    const label = i.k ? 'Combo' : k === 'unidad' ? 'Unidad' : i.u > 1 ? `Caja x${i.u}` : 'Unidad';
    return `<div class="shop-opt"><div><small>${label}</small><b>${money(priceOf(i, k))}</b>${S.fx ? `<small>${fxm(priceOf(i, k))}</small>` : ''}</div>
      ${n ? `<div class="stepper"><button data-dec="${key}" aria-label="Menos">${icon('minus')}</button><span>${n}</span><button data-inc="${key}" aria-label="Más">${icon('plus')}</button></div>` : `<button class="btn btn-primary btn-sm" data-inc="${key}" aria-label="Agregar ${esc(label)}">${icon('plus')}</button>`}</div>`;
  }
  function drawGrid() {
    const t = normalize(q);
    const list = items.filter((i) => (!cat || i.c === cat) && (!t || normalize(`${i.n} ${i.a} ${i.s} ${i.b} ${i.c}`).includes(t))).slice(0, 250);
    $('#s-grid').innerHTML = list.length ? list.map((i) => {
      const out = !i.ok && S.showStock;
      const sub = [i.a && !normalize(i.n).includes(normalize(i.a)) ? i.a : '', i.s, i.g ? `${num(i.g, i.g % 1 ? 1 : 0)}% alc.` : '', i.b].filter(Boolean).join(' · ');
      return `<div class="shop-item ${i.ok ? '' : 'is-out'}">
        <div class="shop-ic">${icon(CAT_IC(i.c))}</div>
        <div class="grow" style="min-width:0"><b class="shop-name">${esc(i.n)}</b>${sub ? `<div class="t-sub">${esc(sub)}</div>` : ''}
          <div class="row row-wrap" style="gap:4px;margin-top:4px">${i.k ? '<span class="badge badge-violet">Combo</span>' : ''}${i.f ? `<span class="badge badge-info">${icon('snow')} la tenemos fría</span>` : ''}${S.showStock ? (i.ok === 1 ? '<span class="badge badge-success">Disponible</span>' : i.ok === 2 ? '<span class="badge badge-warning">Quedan pocas</span>' : '<span class="badge badge-danger">Agotado</span>') : ''}</div></div>
        <div class="shop-buy">${out ? `<b>${money(priceOf(i, 'caja'))}</b>` : `${i.pu ? buyBtn(i, 'unidad') : ''}${buyBtn(i, 'caja')}`}</div>
      </div>`;
    }).join('') : `<div class="empty">${icon('search')}<b>No encontramos ese producto</b><span>Prueba con la marca o el tipo, o escríbenos por WhatsApp: te conseguimos otra marca parecida.</span></div>`;
    root.querySelectorAll('[data-inc]').forEach((b) => b.onclick = () => { const k = b.dataset.inc; if ((cart[k] || 0) >= 50) return; cart[k] = (cart[k] || 0) + 1; save(); drawGrid(); bar(); });
    root.querySelectorAll('[data-dec]').forEach((b) => b.onclick = () => { const k = b.dataset.dec; cart[k] = (cart[k] || 0) - 1; if (cart[k] <= 0) delete cart[k]; save(); drawGrid(); bar(); });
  }
  const lines = () => Object.entries(cart).map(([key, n]) => { const [id, k] = key.split(':'); return { i: byId.get(id), k, n }; }).filter((x) => x.i);
  const subtotal = () => r2(lines().reduce((a, x) => a + priceOf(x.i, x.k) * x.n, 0));
  function bar() {
    const L = lines();
    $('#s-bar').hidden = !L.length;
    $('#s-n').textContent = L.reduce((a, x) => a + x.n, 0);
    $('#s-t').textContent = money(subtotal());
  }

  function checkout() {
    const L = lines(); if (!L.length) return;
    const min = Number(S.minOrder) || 0;
    if (min > 0 && subtotal() < min) { toast(`El pedido mínimo es ${money(min)}. Te faltan ${money(min - subtotal())}.`, 'warning', 5000); return; }
    const anyCold = cold && L.some((x) => x.i.f > 0);
    const mm = openModal({ title: 'Tu pedido', sub: esc(S.shop), size: 'md', body: `<form class="stack" id="o-f">
        <div class="summary-box">${L.map((x) => `<div class="summary-row"><span>${x.n} × ${esc(x.i.n)} <span class="t-sub">· ${esc(packTxt(x.i, x.k))}${cold && x.i.f ? ' · ❄ fría' : ''}</span></span><b>${money(priceOf(x.i, x.k) * x.n)}</b></div>`).join('')}<div class="summary-row total"><span>Total aproximado</span><span id="o-tot">${money(subtotal())}</span></div></div>
        ${L.some((x) => x.i.f > 0) ? `<div class="small muted">${icon('snow')} ${anyCold ? 'Lo preparamos <b>frío</b>.' : 'Lo pediste <b>al tiempo</b>. Puedes cambiarlo arriba en “Bien frías”.'}</div>` : ''}
        <div class="small muted">${icon('rotate')} Si llevas cerveza o refresco en envase retornable, trae tus vacíos: si no, se cobra el depósito del envase.</div>
        <div class="form-grid">
          <div class="field full"><label>Nombre y apellido *</label><input class="input" name="name" autocomplete="name" required minlength="2" maxlength="60"></div>
          <div class="field full"><label>Teléfono / WhatsApp *</label><input class="input" name="phone" inputmode="tel" autocomplete="tel" required placeholder="${esc(S.dial ? '+' + S.dial + ' ' : '')}…"></div>
        </div>
        <div class="chips">${['retiro', ...(S.delivery ? ['delivery'] : [])].map((k, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-mode="${k}">${k === 'retiro' ? `${icon('bag')} Retiro en la licorería` : `${icon('truck')} Delivery${S.deliveryFee ? ` (+${money(S.deliveryFee)})` : ''}`}</button>`).join('')}</div>
        <div class="field" id="o-addr" hidden><label>Dirección de entrega *</label><input class="input" name="address" maxlength="200" placeholder="Calle, casa / edificio, punto de referencia"></div>
        <div class="field"><label>¿Cómo vas a pagar?</label><select class="select" name="pay"><option>Efectivo</option><option>Pago móvil / transferencia</option><option>Tarjeta (punto de venta)</option><option>Otro</option></select></div>
        <div class="field"><label>Nota para la licorería</label><input class="input" name="note" maxlength="300" placeholder="Ej.: si no hay Polar Pilsen, me sirve Solera; traigo 12 vacíos"></div>
        <div class="error-msg" id="o-err"></div>
      </form>`, footer: `<button class="btn btn-secondary" data-close>Seguir comprando</button><button class="btn btn-primary" id="o-send">${icon('check')} Enviar pedido</button>` });
    const ov = mm.el;
    let mode = 'retiro';
    const F = ov.querySelector('#o-f').elements;
    ov.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
      mode = b.dataset.mode; ov.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
      ov.querySelector('#o-addr').hidden = mode !== 'delivery';
      ov.querySelector('#o-tot').textContent = money(subtotal() + (mode === 'delivery' ? S.deliveryFee || 0 : 0));
    });
    ov.querySelector('#o-send').onclick = async (e) => {
      const err = ov.querySelector('#o-err'); err.textContent = '';
      const name = F.name.value.trim(); const phone = F.phone.value.trim(); const address = F.address.value.trim();
      if (name.length < 2) { err.textContent = 'Escribe tu nombre.'; return; }
      if (phone.replace(/\D/g, '').length < 7) { err.textContent = 'Escribe un teléfono válido.'; return; }
      if (mode === 'delivery' && address.length < 5) { err.textContent = 'Escribe la dirección de entrega.'; return; }
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Enviando…';
      const fee = mode === 'delivery' ? Number(S.deliveryFee) || 0 : 0;
      const order = {
        tenantId: S.tenantId, slug, number: 'W-' + code(5), name: name.slice(0, 60), phone: phone.slice(0, 20), address: mode === 'delivery' ? address.slice(0, 200) : '', mode, deliveryFee: fee,
        note: F.note.value.trim().slice(0, 300), payMethod: F.pay.value, cold: anyCold,
        items: L.slice(0, 40).map((x) => ({ id: x.i.id, n: x.i.n, q: x.n, p: priceOf(x.i, x.k), k: x.i.k ? 'caja' : x.k })),
        total: r2(subtotal() + fee), status: 'nueva', createdAt: new Date().toISOString()
      };
      try {
        await addDoc(collection(db, 'orders'), order);
        cart = {}; save(); mm.close(); done(order);
      } catch (ex) {
        console.error(ex);
        err.textContent = 'No se pudo enviar el pedido. Intenta de nuevo o escríbenos por WhatsApp.';
        btn.disabled = false; btn.innerHTML = `${icon('check')} Enviar pedido`;
      }
    };
  }

  function done(o) {
    const txt = `Hola, acabo de hacer el pedido *${o.number}* en línea a nombre de ${o.name} (${o.items.length} producto/s, ${money(o.total)})${o.cold ? ', frío' : ''}.`;
    root.querySelector('.shop-page').innerHTML = `<div class="pcard-page"><div class="mcard center">
      <div class="kpi-icon tone-success" style="width:64px;height:64px;border-radius:20px;margin:0 auto">${icon('check')}</div>
      <h1 style="margin:12px 0 4px">¡Pedido enviado!</h1><p class="muted">Tu número de pedido es <b>${esc(o.number)}</b>. ${esc(S.shop)} lo está revisando y te escribirá por WhatsApp cuando esté listo${o.mode === 'delivery' ? ' para enviarlo' : ' para retirar'}.</p>
      <div class="summary-box" style="text-align:left">${o.items.map((i) => `<div class="summary-row"><span>${i.q} × ${esc(i.n)}</span><b>${money(i.p * i.q)}</b></div>`).join('')}<div class="summary-row total"><span>Total aproximado</span><span>${money(o.total)}</span></div></div>
      ${S.phone ? `<a class="btn btn-whatsapp btn-block mt" href="${waLink(S.phone, txt)}" target="_blank" rel="noopener">${icon('whatsapp')} Avisar por WhatsApp (opcional)</a>` : ''}
      <a class="btn btn-secondary btn-block mt" href="${location.pathname}">Hacer otro pedido</a></div></div>`;
    toast('Pedido enviado');
  }

  $('#s-q').oninput = debounce((e) => { q = e.target.value; drawGrid(); }, 120);
  $('#s-bar').onclick = checkout;
  drawCold(); drawCats(); drawGrid(); bar();
}
