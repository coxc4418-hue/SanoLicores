// SanoLicores — Vender: lector de código de barras, unidad / pack / caja, fría o al tiempo, precio al mayor,
// combos, envases retornables (vacíos, depósito o préstamo), fiado y puntos
import { store } from '../store.js';
import { chargeSale, cartTotals, pointsValue, orderLines, unitsByProduct, depositLines } from '../ops.js';
import { esc, usd, bs, num, toast, normalize, debounce, emptyState, parseNum, round2, promptDialog, openModal } from '../utils.js';
import { icon } from '../icons.js';
import { printReceipt, notifyLowStock, waClient } from '../shared.js';
import { openPay, showPaid } from '../pay.js';
import { pickClient, avatar, clientLine, alertsHTML, pointsHTML, clientForm } from '../client.js';
import { PACKS, packsOf, packFactor, packPrice, packLabel, unitCost, stockText, upb, equivalents, searchText, productLine, nextExpiry, expBadge, lotsOf, isCombo, comboStock, canCold, defaultPack, emptiesOfCart, catIcon, fractionable } from '../licor.js';
import { requirePin } from '../auth.js';

export function mount(el, { params = {}, navigate }) {
  let tab = 'todos'; let search = '';
  let cart = []; let client = null; let pointsUsed = 0; let order = null; let delivery = 0; let mayor = false;
  let emptyIn = {}; let emptyMode = {};
  let sellerId = store.activeSellers[0]?.id || null;

  el.innerHTML = `<div class="pos">
    <div class="pos-main">
      <div class="pos-head">
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <label class="search search-scan" style="flex:1;min-width:220px" data-tour="pos-search">${icon('barcode')}<input id="pos-search" placeholder="Escanea el código o busca por nombre, tipo o marca…" autocomplete="off" autofocus></label>
          <button class="btn btn-secondary" id="pos-ms" title="Otros cargos (hielo a granel, bolsa, delivery…)">${icon('plus')}<span class="hide-sm"> Otro cargo</span></button>
        </div>
        <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center" id="pos-seller"></div>
        <div class="chips" id="pos-tabs"></div>
      </div>
      <div class="pos-grid-wrap"><div class="plist" id="pos-grid"></div></div>
    </div>
    <div class="cart-backdrop" id="cart-bd"></div>
    <aside class="cart" id="cart">
      <div class="cart-head"><div class="between"><b style="font-size:16px">Venta</b><button class="btn btn-ghost btn-sm" id="c-clear">${icon('trash')} Vaciar</button></div>
        <div class="cart-ctx" id="c-ctx" data-tour="pos-client"></div></div>
      <div class="cart-list" id="c-list"></div>
      <div class="cart-foot">
        <div class="cart-extra" id="c-extra"></div>
        <div class="cart-grand"><span class="lbl">Total</span><div class="val"><b id="c-total">${usd(0)}</b><small id="c-fx" class="pay-fx"></small></div></div>
        <button class="btn btn-success btn-xl btn-block" id="c-pay" data-tour="pos-pay">${icon('check')} Cobrar <kbd class="hide-sm">F9</kbd></button>
      </div>
    </aside>
    <button class="cart-fab" id="cart-fab"><span><span class="cnt" id="fab-n">0</span>Ver venta</span><b id="fab-t">$ 0,00</b></button>
  </div>`;
  const $ = (s) => el.querySelector(s);
  const mk = () => Number(store.settings.fractionMarkup) || 0;
  const priceOf = (p, pack, cold) => packPrice(p, pack, { markup: mk(), cold, mayor });
  const unitsInCart = (id) => unitsByProduct(cart).get(id) || 0;
  /** Disponible (en unidades) de un producto; para combos, cuántos se pueden armar */
  const avail = (p) => {
    if (isCombo(p)) return comboStock(p, (x) => (Number(x.stock) || 0) - unitsInCart(x.id));
    return p.trackStock === false ? Infinity : (Number(p.stock) || 0) - unitsInCart(p.id);
  };

  function renderSeller() {
    const s = store.activeSellers;
    $('#pos-seller').innerHTML = s.length ? `<span class="small muted">Atiende:</span>${s.map((x) => `<button class="chip ${sellerId === x.id ? 'on' : ''}" data-sl="${x.id}">${esc(x.name.split(' ')[0])}</button>`).join('')}` : '';
    el.querySelectorAll('[data-sl]').forEach((b) => b.onclick = () => { sellerId = b.dataset.sl; renderSeller(); });
  }
  function renderTabs() {
    const cats = [...new Set(store.sellable.map((p) => p.category).filter((c) => c && c !== 'Combos'))].sort();
    const hasCombos = store.sellable.some(isCombo); const hasCold = store.sellable.some(canCold);
    $('#pos-tabs').innerHTML = [['todos', 'Todos'], ['top', '★ Más vendidos'], ...(hasCold ? [['fria', '❄ Frías']] : []), ...(hasCombos ? [['combo', '🎁 Combos']] : []), ...cats.map((c) => ['c:' + c, c])]
      .map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" data-tab="${esc(k)}">${esc(l)}</button>`).join('');
    el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; renderTabs(); renderGrid(); });
  }

  function renderGrid() {
    const t = normalize(search);
    let list = store.sellable;
    if (t) list = list.filter((p) => searchText(p).includes(t));
    else if (tab === 'top') list = [...list].sort((a, b) => (Number(b.sold) || 0) - (Number(a.sold) || 0)).slice(0, 40);
    else if (tab === 'fria') list = list.filter(canCold);
    else if (tab === 'combo') list = list.filter(isCombo);
    else if (tab.startsWith('c:')) list = list.filter((p) => p.category === tab.slice(2));
    list = list.slice(0, 120);
    $('#pos-grid').innerHTML = list.length ? list.map((p) => {
      const combo = isCombo(p);
      const st = Number(p.stock) || 0; const tracked = combo || p.trackStock !== false;
      const n = combo ? cart.filter((l) => l.productId === p.id).reduce((a, l) => a + l.qty, 0) : unitsInCart(p.id); const out = tracked && avail(p) <= 0;
      const exp = combo ? '' : nextExpiry(p);
      const unit = fractionable(p);
      return `<button class="prow ${out ? 'is-out' : ''}" data-p="${p.id}" ${out ? 'aria-disabled="true"' : ''}>
        <span class="prow-ic">${icon(catIcon(p.category))}</span>
        <span class="prow-body"><b class="prow-name">${esc(p.name)}</b><span class="prow-sub">${esc(productLine(p))}</span>
          <span class="prow-tags">${combo ? `<span class="badge badge-violet">Combo</span><span class="badge ${avail(p) <= 0 ? 'badge-danger' : 'badge-neutral'}">${avail(p) <= 0 ? 'Agotado' : `arma ${avail(p)}`}</span>` : ''}${canCold(p) ? `<span class="badge badge-info">${icon('snow')} fría</span>` : ''}${p.returnable ? `<span class="badge badge-neutral">${icon('rotate')} retornable</span>` : ''}${!combo && tracked ? `<span class="badge ${st <= 0 ? 'badge-danger' : st <= (p.minStock || 0) ? 'badge-warning' : 'badge-neutral'}">${st <= 0 ? 'Agotado' : stockText(p)}</span>` : ''}${exp ? expBadge(exp) : ''}${p.location ? `<span class="badge badge-neutral">${icon('pin')} ${esc(p.location)}</span>` : ''}</span></span>
        <span class="prow-price">${unit ? `<b>${usd(priceOf(p, 'unidad', false))}</b><small>caja ${usd(priceOf(p, 'caja', false))}</small>` : `<b>${usd(priceOf(p, 'caja', false))}</b>`}${n ? `<span class="pcard-qty">${combo ? n : stockText(p, n)}</span>` : ''}</span>
      </button>`;
    }).join('') : emptyState('bottle', t ? 'Sin resultados' : 'Sin productos para vender', t ? 'Prueba con el tipo (ej. “ron añejo”), la marca o el código de barras.' : 'Carga tus productos en Inventario.');
    el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { const p = store.product(b.dataset.p); if (p) choose(p); });
  }

  /** Elegir presentación (unidad, pack o caja), fría o al tiempo, y ver alternativas */
  function choose(p, { quick = false } = {}) {
    const packs = packsOf(p);
    if (avail(p) <= 0) {
      const eq = equivalents(p, store.products).filter((x) => avail(x) > 0);
      if (eq.length) return showEquivalents(p, eq, true);
      toast(`${p.name} está agotado.`, 'warning'); return;
    }
    if (quick || (packs.length === 1 && !canCold(p))) { add(p, defaultPack(p), 1, false); return; }
    let cold = canCold(p);
    const eq = equivalents(p, store.products).filter((x) => avail(x) > 0).slice(0, 4);
    const lots = lotsOf(p).slice(0, 4);
    const m = openModal({
      title: esc(p.name), sub: esc(productLine(p)), size: 'md',
      body: `<div class="stack">
        ${canCold(p) ? `<div class="seg seg-block" data-cold><button type="button" data-v="0">Al tiempo</button><button type="button" data-v="1">${icon('snow')} Fría (+${usd(p.coldExtra)} c/u)</button></div>` : ''}
        <div class="pack-grid" data-packs></div>
        <div class="small muted">Disponible: <b>${isCombo(p) ? `${avail(p)} combo(s)` : stockText(p, avail(p))}</b>${p.location ? ` · Ubicación: <b>${esc(p.location)}</b>` : ''}${mayor ? ' · <b class="text-violet">precio al mayor</b>' : ''}</div>
        ${lots.length ? `<div><div class="section-title">${icon('layers')} Lotes (sale primero el que vence antes)</div><div class="lot-list">${lots.map((l) => `<span class="lot-chip">${esc(l.lot || 's/l')} · ${stockText(p, l.qty)} ${expBadge(l.exp)}</span>`).join('')}</div></div>` : ''}
        ${eq.length ? `<div><div class="section-title">${icon('refresh')} Alternativas (mismo tipo y tamaño)</div><div class="list">${eq.map((x) => `<button class="list-item" data-eq="${x.id}"><div class="grow" style="min-width:0"><b class="ellipsis">${esc(x.name)}</b><div class="t-sub">${esc(x.lab || '')} · ${stockText(x)}</div></div><b class="num ${Number(x.price) / upb(x) < Number(p.price) / upb(p) ? 'text-success' : ''}">${usd(x.price)}</b></button>`).join('')}</div></div>` : ''}
      </div>`,
      footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
    });
    const paint = () => {
      m.el.querySelectorAll('[data-cold] [data-v]').forEach((b) => b.classList.toggle('on', (b.dataset.v === '1') === cold));
      m.el.querySelector('[data-packs]').innerHTML = packs.map((k) => { const f = isCombo(p) ? 1 : packFactor(p, k); const can = avail(p) >= f; return `<button class="pack-btn" data-k="${k}" ${can ? '' : 'disabled'}><span>${esc(k === 'pack' ? packLabel(p, k).split(' x')[0] : PACKS[k])}</span><small>${esc(packLabel(p, k))}</small><b>${usd(priceOf(p, k, cold))}</b></button>`; }).join('');
      m.el.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => { add(p, b.dataset.k, 1, cold); m.close(); });
    };
    m.el.querySelectorAll('[data-cold] [data-v]').forEach((b) => b.onclick = () => { cold = b.dataset.v === '1'; paint(); });
    paint();
    m.el.querySelectorAll('[data-eq]').forEach((b) => b.onclick = () => { m.close(); choose(store.product(b.dataset.eq)); });
  }
  function showEquivalents(p, eq, outMsg = false) {
    const m = openModal({
      title: outMsg ? `${esc(p.name)} está agotado` : 'Alternativas', sub: outMsg ? 'Ofrece otra marca del mismo tipo y tamaño:' : esc(productLine(p)), size: 'md',
      body: `<div class="list">${eq.map((x) => `<button class="list-item" data-eq="${x.id}"><span class="prow-ic">${icon(catIcon(x.category))}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(x.name)}</b><div class="t-sub">${esc(productLine(x))} · ${stockText(x)}</div></div><b class="num">${usd(x.price)}</b></button>`).join('')}</div>`,
      footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
    });
    m.el.querySelectorAll('[data-eq]').forEach((b) => b.onclick = () => { m.close(); choose(store.product(b.dataset.eq)); });
  }

  function lineFor(p, pack, qty, cold) {
    const f = isCombo(p) ? 1 : packFactor(p, pack);
    const price = priceOf(p, pack, cold);
    return { key: `${p.id}:${pack}:${cold ? 1 : 0}`, productId: p.id, name: p.name, pack, factor: f, qty, price, listPrice: price, cost: round2(unitCost(p) * f * 10000) / 10000, kind: isCombo(p) ? 'combo' : 'producto', cold: !!cold && canCold(p), detail: packLabel(p, pack), manual: false };
  }
  function add(p, pack = 'unidad', qty = 1, cold = false) {
    const f = isCombo(p) ? 1 : packFactor(p, pack);
    if (avail(p) < f * qty) { toast(`Solo quedan ${isCombo(p) ? avail(p) + ' combo(s)' : stockText(p, Math.max(0, avail(p)))} de ${p.name}`, 'warning'); return; }
    const key = `${p.id}:${pack}:${cold ? 1 : 0}`;
    const line = cart.find((l) => l.key === key);
    if (line) line.qty += qty; else cart.push(lineFor(p, pack, qty, cold));
    renderAll();
  }
  function addService({ name, price }) {
    cart.push({ key: 'sv:' + Date.now(), productId: null, name, pack: 'servicio', factor: 1, qty: 1, price: round2(price), listPrice: round2(price), cost: 0, kind: 'servicio', detail: 'Otro cargo', manual: true });
    renderAll();
  }
  /** Recalcula precios al cambiar entre detal y al mayor (respeta los precios editados a mano) */
  function reprice() {
    for (const l of cart) {
      const p = l.productId ? store.product(l.productId) : null;
      if (!p || l.manual) continue;
      l.price = l.listPrice = priceOf(p, l.pack, l.cold);
    }
  }

  // ---------- Envases retornables ----------
  function emptiesNeeded() { return emptiesOfCart(cart, (id) => store.product(id), store.containers); }
  function emptiesList() {
    const need = emptiesNeeded();
    for (const k of Object.keys(emptyIn)) if (!need[k]) { delete emptyIn[k]; delete emptyMode[k]; }
    return Object.entries(need).map(([id, n]) => ({ id, need: n, brought: Math.min(n, emptyIn[id] ?? n), mode: emptyMode[id] || 'cobrar' }));
  }

  function totals() {
    const emp = emptiesList();
    const dep = depositLines(emp);
    const t = cartTotals([...cart, ...dep]);
    const pts = pointsValue(pointsUsed);
    const total = round2(Math.max(0, t.subtotal - pts) + delivery);
    return { ...t, pts, total, emp, dep, deposit: round2(dep.reduce((a, l) => a + l.price * l.qty, 0)) };
  }

  function renderCtx() {
    const c = client;
    const L = store.loyalty;
    $('#c-ctx').innerHTML = (c ? `<div class="cart-client">${avatar(c)}<div class="grow" style="min-width:0"><b class="ellipsis">${esc(c.name)}</b><div class="t-sub ellipsis">${esc(c.number)} · ${clientLine(c)}</div></div><button class="btn btn-ghost btn-icon btn-sm" id="c-unpick" title="Quitar cliente">${icon('x')}</button></div>
      ${alertsHTML(c)}
      <div class="row" style="gap:4px;flex-wrap:wrap">${pointsHTML(c)}</div>`
      : `<div class="row" style="gap:6px"><button class="btn btn-secondary btn-sm grow" id="c-pt" title="Para sumar puntos, fiar o prestar envases">${icon('user')} Elegir cliente</button><button class="btn btn-ghost btn-icon btn-sm" id="c-new" title="Cliente nuevo">${icon('userPlus')}</button></div>`)
      + (order ? `<div class="badge badge-info mt-xs">${icon('bag')} Pedido en línea de ${esc(order.name)}${order.delivery ? ' · delivery' : ''}${order.cold ? ' · frío' : ''}</div>` : '')
      + (store.products.some((p) => Number(p.wholesale) > 0) || c?.type === 'mayor' ? `<label class="check mt-xs"><input type="checkbox" id="c-mayor" ${mayor ? 'checked' : ''}> <span>${icon('crate')} Precio al mayor</span></label>` : '')
      + (c && L.enabled && Number(c.points) >= (Number(L.minRedeem) || 0) && Number(c.points) > 0 ? `<label class="check mt-xs"><input type="checkbox" id="c-pts" ${pointsUsed ? 'checked' : ''}> <span>Canjear ${Math.floor(c.points)} pts (−${usd(pointsValue(Math.floor(c.points)))})</span></label>` : '');
    $('#c-pt')?.addEventListener('click', pick);
    $('#c-new')?.addEventListener('click', async () => { const n = await clientForm(); if (n) setClient(n); });
    $('#c-unpick')?.addEventListener('click', () => { client = null; pointsUsed = 0; if (mayor) { mayor = false; reprice(); } for (const k in emptyMode) emptyMode[k] = 'cobrar'; renderAll(); });
    $('#c-mayor')?.addEventListener('change', (e) => { mayor = e.target.checked; reprice(); renderAll(); });
    $('#c-pts')?.addEventListener('change', (e) => { pointsUsed = e.target.checked ? Math.floor(Number(client.points) || 0) : 0; renderCart(); });
  }

  function renderCart() {
    renderCtx();
    const T = totals();
    $('#c-list').innerHTML = cart.length ? cart.map((l, i) => {
      const p = l.productId ? store.product(l.productId) : null;
      const packs = p && !isCombo(p) ? packsOf(p) : [];
      return `<div class="cline">
        <div class="cline-name">${esc(l.name)} ${l.cold ? `<span class="badge badge-info">${icon('snow')} fría</span>` : ''}</div><div class="cline-total">${usd(l.price * l.qty)}</div>
        <div class="cline-meta"><button class="linkish" data-price="${i}">${usd(l.price)} c/u ${icon('edit')}</button>
          ${packs.length > 1 ? `<select class="select select-xs" data-pk="${i}">${packs.map((k) => `<option value="${k}" ${l.pack === k ? 'selected' : ''}>${esc(packLabel(p, k))}</option>`).join('')}</select>` : `<span class="t-sub">${esc(l.detail || '')}</span>`}</div>
        <div class="cline-actions"><div class="stepper"><button data-dec="${i}" aria-label="Menos">${icon('minus')}</button><span>${num(l.qty, 0)}</span><button data-inc="${i}" aria-label="Más">${icon('plus')}</button></div>
          ${p && canCold(p) ? `<button class="btn btn-ghost btn-icon btn-sm ${l.cold ? 'on' : ''}" data-cold="${i}" title="${l.cold ? 'Pasar a al tiempo' : 'Fría'}">${icon('snow')}</button>` : ''}
          ${p && equivalents(p, store.products).length ? `<button class="btn btn-ghost btn-icon btn-sm" data-eq="${i}" title="Alternativas">${icon('refresh')}</button>` : ''}
          <button class="btn btn-ghost btn-icon btn-sm" data-del="${i}" aria-label="Quitar">${icon('x')}</button></div>
      </div>`;
    }).join('') : `<div class="empty">${icon('barcode')}<b>Escanea o busca un producto</b><span>Pasa el lector por el código de la botella o lata, o escribe el nombre. Vende por unidad, pack o caja, fría o al tiempo.</span></div>`;

    const emp = T.emp;
    $('#c-extra').innerHTML = cart.length ? `
      ${emp.length ? `<div class="box small empties-box" data-tour="pos-empties"><div class="between"><b>${icon('rotate')} Envases retornables</b><span class="t-sub">¿cuántos vacíos trae?</span></div>${emp.map((e) => { const c = store.container(e.id); const miss = e.need - e.brought; return `<div class="emp-row"><div class="grow" style="min-width:0"><b class="ellipsis">${esc(c?.short || c?.name || e.id)}</b><div class="t-sub">lleva ${e.need}${miss ? ` · faltan ${miss}` : ' · trae todos'}</div></div><input class="input input-sm r" style="width:64px" inputmode="numeric" data-emp="${e.id}" value="${e.brought}" aria-label="Vacíos que trae">${miss ? `<div class="seg seg-sm"><button type="button" data-em="${e.id}" data-v="cobrar" class="${e.mode === 'cobrar' ? 'on' : ''}">Cobrar ${usd(miss * (c?.deposit || 0))}</button><button type="button" data-em="${e.id}" data-v="prestar" class="${e.mode === 'prestar' ? 'on' : ''}">Prestar</button></div>` : ''}</div>`; }).join('')}</div>` : ''}
      <div class="between small"><span class="muted">Subtotal</span><b>${usd(T.subtotal - T.deposit)}</b></div>
      ${T.deposit ? `<div class="between small"><span class="muted">Depósito de envases</span><b>${usd(T.deposit)}</b></div>` : ''}
      ${mayor ? `<div class="small text-violet">${icon('crate')} Precios al mayor</div>` : ''}
      ${T.pts ? `<div class="between small"><span class="muted">Puntos canjeados</span><b class="text-success">−${usd(T.pts)}</b></div>` : ''}
      ${delivery ? `<div class="between small"><span class="muted">Delivery</span><b>${usd(delivery)}</b></div>` : ''}` : '';
    $('#c-total').textContent = usd(T.total);
    $('#c-fx').textContent = bs(T.total);
    $('#fab-n').textContent = cart.length; $('#fab-t').textContent = usd(T.total);
    $('#c-pay').disabled = !cart.length;

    const L = (i) => cart[+i];
    el.querySelectorAll('[data-inc]').forEach((b) => b.onclick = () => { const l = L(b.dataset.inc); const p = store.product(l.productId); if (p && avail(p) < (isCombo(p) ? 1 : l.factor)) { toast(`Solo quedan ${isCombo(p) ? avail(p) + ' combo(s)' : stockText(p, Math.max(0, avail(p)))}`, 'warning'); return; } l.qty += 1; renderAll(); });
    el.querySelectorAll('[data-dec]').forEach((b) => b.onclick = () => { const l = L(b.dataset.dec); l.qty -= 1; if (l.qty <= 0) cart.splice(+b.dataset.dec, 1); renderAll(); });
    el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { cart.splice(+b.dataset.del, 1); renderAll(); });
    el.querySelectorAll('[data-cold]').forEach((b) => b.onclick = () => {
      const l = L(b.dataset.cold); const p = store.product(l.productId);
      l.cold = !l.cold; l.key = `${p.id}:${l.pack}:${l.cold ? 1 : 0}`; if (!l.manual) l.price = l.listPrice = priceOf(p, l.pack, l.cold);
      renderAll();
    });
    el.querySelectorAll('[data-pk]').forEach((s) => s.onchange = () => {
      const l = L(s.dataset.pk); const p = store.product(l.productId);
      const f = packFactor(p, s.value);
      if (avail(p) + l.factor * l.qty < f * l.qty) { toast('No alcanza el inventario para esa presentación', 'warning'); s.value = l.pack; return; }
      Object.assign(l, { pack: s.value, factor: f, key: `${p.id}:${s.value}:${l.cold ? 1 : 0}`, price: priceOf(p, s.value, l.cold), listPrice: priceOf(p, s.value, l.cold), cost: unitCost(p) * f, detail: packLabel(p, s.value), manual: false });
      renderAll();
    });
    el.querySelectorAll('[data-eq]').forEach((b) => b.onclick = () => { const p = store.product(L(b.dataset.eq).productId); showEquivalents(p, equivalents(p, store.products)); });
    el.querySelectorAll('[data-price]').forEach((b) => b.onclick = async () => {
      const l = L(b.dataset.price);
      if (!(await requirePin('Cambiar un precio'))) return;
      const v = await promptDialog({ title: 'Precio', label: `${l.name} · ${l.detail || ''}`, value: num(l.price), confirmText: 'Aplicar' });
      if (v != null && parseNum(v) >= 0) { l.price = round2(parseNum(v)); l.manual = true; renderCart(); }
    });
    el.querySelectorAll('[data-emp]').forEach((i) => i.onchange = () => { emptyIn[i.dataset.emp] = Math.max(0, Math.round(parseNum(i.value) || 0)); renderCart(); });
    el.querySelectorAll('[data-em]').forEach((b) => b.onclick = async () => {
      if (b.dataset.v === 'prestar' && !client) { toast('Para prestar envases elige al cliente', 'warning'); await pick(); if (!client) return; }
      emptyMode[b.dataset.em] = b.dataset.v; renderCart();
    });
  }
  const renderAll = () => { renderCart(); renderGrid(); };

  async function pick() { const c = await pickClient({ title: '¿Para qué cliente es?' }); if (c) setClient(c); }
  function setClient(c) {
    client = c;
    if (c.type === 'mayor' && !mayor) { mayor = true; reprice(); toast(`${c.name.split(' ')[0]} compra al mayor: precios al mayor aplicados`, 'info'); }
    renderAll();
  }

  function askCredit(total) {
    return new Promise((resolve) => {
      let out = null;
      const lim = Number(client.creditLimit) || 0; const bal = Number(client.balance) || 0;
      const room = lim > 0 ? Math.max(0, round2(lim - bal)) : null;
      const m = openModal({
        title: 'Forma de cobro', sub: `${esc(client.name)} · ${usd(total)}`, size: 'sm',
        body: `<div class="stack"><button class="btn btn-primary btn-lg btn-block" data-full>${icon('cash')} Paga completo ahora</button>
          <div class="box"><div class="field"><label>Queda fiado</label><input class="input" inputmode="decimal" data-amt placeholder="Monto que queda debiendo" value="${room != null && room < total ? num(room) : ''}"></div><button class="btn btn-secondary btn-block" data-part ${room === 0 ? 'disabled' : ''}>${icon('wallet')} Fiar ${room != null ? `(disponible ${usd(room)})` : ''}</button><div class="hint">${bal > 0.009 ? `Ya debe ${usd(bal)}. ` : ''}Queda en su cuenta para cobrarlo después.</div></div></div>`,
        footer: '<button class="btn btn-secondary" data-close>Cancelar</button>',
        onClose: () => resolve(out)
      });
      m.el.querySelector('[data-full]').onclick = () => { out = 0; m.close(); };
      m.el.querySelector('[data-part]').onclick = () => {
        const v = round2(parseNum(m.el.querySelector('[data-amt]').value) || 0);
        if (!(v > 0)) { toast('Indica el monto que queda fiado', 'warning'); return; }
        if (room != null && v > room + 0.009) { toast(`Supera su límite de fiado: disponible ${usd(room)}`, 'warning'); return; }
        out = Math.min(v, total); m.close();
      };
    });
  }

  async function pay() {
    if (!cart.length) return;
    const lines = cart.map(({ key, manual, ...l }) => l);
    const T = totals();
    let credit = 0;
    if (client && T.total > 0.004) { const c = await askCredit(T.total); if (c == null) return; credit = c; }
    const amount = round2(T.total - credit);
    const empties = T.emp;
    const run = async (res = { payments: [], discount: 0, print: false }) => {
      const out = await chargeSale({ lines, client, discount: res.discount, payments: res.payments, credit, pointsUsed, sellerId, orderId: order?.id || null, delivery, empties, mayor });
      if (res.print) printReceipt(out.sale);
      return out;
    };
    let out;
    try {
      out = amount > 0.004
        ? await openPay({ title: 'Cobrar', sub: esc(client?.name || 'Cliente de mostrador'), amount, baseTotal: amount, discount: true, printLabel: 'Imprimir factura / ticket', onConfirm: async (r) => { if (r.discount > 0 && !(await requirePin('Aplicar un descuento'))) throw new Error('Descuento no autorizado.'); return run(r); } })
        : await run();
    } catch (e) { toast(e.message, 'danger', 5000); return; }
    if (!out) return;
    notifyLowStock(out.low);
    showPaid(out.sale, { title: 'Venta registrada', onPrint: () => printReceipt(out.sale) });
    const cl = out.client;
    if (cl?.phone) setTimeout(() => offerThanks(cl, out.sale), 300);
    reset();
    if (params.orderId || params.clientId) navigate('vender', { replace: true, force: true });
  }

  function offerThanks(cl, sale) {
    const lent = (sale.empties || []).filter((e) => e.lent > 0);
    const m = openModal({
      title: 'Mensaje al cliente', sub: esc(cl.name), size: 'sm',
      body: `<p class="small">Envíale su comprobante${store.loyalty.enabled ? ' y sus puntos' : ''}${lent.length ? ', con los envases que se le prestaron' : ''} por WhatsApp.</p>${pointsHTML(cl)}${lent.map((e) => `<div class="small mt-xs">${icon('rotate')} Prestados: ${e.lent} ${esc(store.container(e.id)?.name || '')}</div>`).join('')}`,
      footer: `<button class="btn btn-secondary" data-close>Ahora no</button><button class="btn btn-whatsapp" data-wa>${icon('whatsapp')} Enviar</button>`
    });
    m.el.querySelector('[data-wa]').onclick = () => { waClient('gracias', { client: cl, sale }); m.close(); };
  }

  function serviceModal() {
    const opts = [['Hielo a granel', 1], ['Bolsa', 0.1], ['Delivery', 2], ['Alquiler de cava / cooler', 5], ['Otro cargo', 0]];
    const m = openModal({
      title: 'Otro cargo', sub: 'Se cobra junto con la venta', size: 'sm',
      body: `<div class="list">${opts.map(([n, pr], i) => `<button class="list-item" data-i="${i}">${icon(n.startsWith('Hielo') ? 'snow' : n === 'Delivery' ? 'truck' : 'plus')}<div class="grow"><b>${n}</b></div>${pr ? `<b class="num">${usd(pr)}</b>` : ''}</button>`).join('')}</div>`,
      footer: '<button class="btn btn-secondary" data-close>Cerrar</button>'
    });
    m.el.querySelectorAll('[data-i]').forEach((b) => b.onclick = async () => {
      const [n, pr] = opts[+b.dataset.i]; m.close();
      const v = await promptDialog({ title: n, label: 'Precio', value: num(pr), confirmText: 'Agregar' });
      if (v == null) return;
      addService({ name: n === 'Otro cargo' ? (await promptDialog({ title: 'Cargo', label: 'Descripción', value: '' })) || n : n, price: parseNum(v) });
    });
  }

  function reset() { cart = []; client = null; pointsUsed = 0; order = null; delivery = 0; mayor = false; emptyIn = {}; emptyMode = {}; closeCart(); renderAll(); setTimeout(() => $('#pos-search')?.focus(), 50); }
  const openCart = () => { $('#cart').classList.add('open'); $('#cart-bd').classList.add('open'); };
  const closeCart = () => { $('#cart').classList.remove('open'); $('#cart-bd').classList.remove('open'); };
  $('#cart-fab').onclick = openCart; $('#cart-bd').onclick = closeCart;
  $('#c-pay').onclick = pay;
  $('#c-clear').onclick = reset;
  $('#pos-ms').onclick = serviceModal;
  const sInp = $('#pos-search');
  sInp.oninput = debounce((e) => { search = e.target.value; renderGrid(); }, 90);
  sInp.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const v = sInp.value.trim(); if (!v) return;
    const exact = store.byBarcode(v);
    if (exact) { choose(exact, { quick: true }); sInp.value = ''; search = ''; renderGrid(); return; }
    const c = store.findClient(v);
    if (c && /\/tarjeta\/|^[A-Z0-9]{8}$|^C-?\d+$/i.test(v)) { setClient(c); sInp.value = ''; search = ''; renderGrid(); toast(`Cliente: ${c.name}`, 'info'); return; }
    const list = store.sellable.filter((p) => searchText(p).includes(normalize(v)));
    if (list.length === 1) { choose(list[0]); sInp.value = ''; search = ''; renderGrid(); }
  };
  const onKey = (e) => { if (e.key === 'F9') { e.preventDefault(); pay(); } };
  window.addEventListener('keydown', onKey);

  // ---------- Viene desde un pedido en línea o desde la ficha del cliente ----------
  if (params.orderId) {
    const o = store.orders.find((x) => x.id === params.orderId);
    if (o) {
      order = o;
      client = (o.clientId && store.client(o.clientId)) || store.findByPhone(o.phone) || null;
      mayor = client?.type === 'mayor';
      cart = orderLines(o).map((l) => { const p = store.product(l.productId); const price = mayor ? priceOf(p, l.pack, l.cold) : l.price; return { ...l, price, listPrice: price, key: `${l.productId}:${l.pack}:${l.cold ? 1 : 0}`, manual: false }; });
      delivery = o.mode === 'delivery' ? round2(Number(o.deliveryFee) || 0) : 0;
      const missing = (o.items || []).length - cart.length;
      if (missing > 0) toast(`${missing} producto(s) del pedido ya no están en el catálogo.`, 'warning');
    }
  } else if (params.clientId) {
    const c = store.client(params.clientId);
    if (c) setClient(c);
  }
  renderSeller(); renderTabs(); renderAll();
  const off = store.on('*', (evt) => {
    if (evt === 'products') { renderTabs(); renderAll(); }
    if (evt === 'settings') { renderSeller(); renderTabs(); renderAll(); }
    if (evt === 'clients' && client?.id) { const fresh = store.client(client.id); if (fresh) { client = fresh; renderCtx(); } }
  });
  return () => { off(); window.removeEventListener('keydown', onKey); };
}
