// SanoLicores — Inventario: productos (unidad, pack, caja), combos, envases retornables, lotes y vencimientos, movimientos, conteo e importación
import { store } from '../store.js';
import { saveProduct, moveProduct } from '../ops.js';
import { esc, usd, num, normalize, debounce, emptyState, fmtDate, fmtDateTime, toast, download, toCSV, parseCSV, openModal, setBusy, todayKey, parseNum, confirmDialog, addDays, startOfDay, endOfDay } from '../utils.js';
import { icon } from '../icons.js';
import { FORMS, SIZES, upb, stockText, lotsOf, expBadge, daysToExpiry, nextExpiry, searchText, productLine, packPrice, fractionable, hasPack, packName, equivalents, isCombo, comboStock, comboLine, comboCost, canCold, catIcon } from '../licor.js';
import { requirePin } from '../auth.js';
import { printDoc } from '../shared.js';
import { pickProduct } from '../client.js';

const TABS = { productos: 'Productos', bajo: 'Por reponer', vencimientos: 'Vencimientos', movimientos: 'Movimientos', conteo: 'Conteo físico' };
export const MOVE = { entrada: ['Entrada / ajuste +', 'success'], rotura: ['Rotura / botella rota', 'danger'], merma: ['Merma / daño', 'danger'], vencido: ['Retiro por vencimiento', 'danger'], devolucion_prov: ['Devolución a proveedor', 'warning'], cortesia: ['Cortesía / degustación', 'violet'], conteo: ['Conteo físico', 'info'], uso: ['Consumo interno', 'neutral'], venta: ['Venta', 'brand'], compra: ['Compra', 'success'], devolucion: ['Anulación', 'warning'] };
const KINDS = { combo: 'Combos', retornable: 'Retornables', fria: 'Se venden frías', sinlote: 'Sin código de barras' };

/** Badges de presentación de un producto */
export function productBadges(p) {
  return [isCombo(p) ? `<span class="badge badge-violet">${icon('gift')} Combo</span>` : '', p.returnable ? `<span class="badge badge-info">${icon('rotate')} Retornable</span>` : '', canCold(p) ? `<span class="badge badge-info">${icon('snow')} Fría</span>` : '', Number(p.wholesale) > 0 ? '<span class="badge badge-neutral">Al mayor</span>' : ''].join('');
}

export function mount(el, { params = {} }) {
  let tab = TABS[params.tab] ? params.tab : 'productos';
  let q = ''; let cat = ''; let kind = '';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Inventario</h1><p class="view-sub" id="i-sub"></p></div>
      <div class="view-actions"><button class="btn btn-secondary" id="i-imp">${icon('upload')} Importar</button><button class="btn btn-secondary" id="i-exp">${icon('download')} Exportar</button><button class="btn btn-secondary" id="i-combo">${icon('gift')} Nuevo combo</button><button class="btn btn-primary" id="i-new">${icon('plus')} Nuevo producto</button></div></div>
    <div class="tabs" id="i-tabs" data-tour="inv-tabs">${Object.entries(TABS).map(([k, v]) => `<button data-t="${k}">${v}<span class="tab-n" data-n="${k}" hidden></span></button>`).join('')}</div>
    <div id="i-body" class="mt"></div>`;
  const $ = (s) => el.querySelector(s);

  function counts() {
    const low = store.lowProducts.length; const exp = store.expiringProducts.length;
    const val = store.products.reduce((a, p) => a + (isCombo(p) ? 0 : Math.max(0, Number(p.stock) || 0) / upb(p) * (Number(p.cost) || 0)), 0);
    $('#i-sub').textContent = `${store.products.filter((p) => p.sellable !== false).length} producto(s) · inventario valorado al costo ${usd(val)}`;
    const set = (k, n) => { const b = el.querySelector(`[data-n="${k}"]`); if (b) { b.hidden = !n; b.textContent = n; } };
    set('bajo', low); set('vencimientos', exp);
  }

  function draw() {
    el.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    counts();
    ({ productos, bajo: productos, vencimientos, movimientos, conteo })[tab]();
  }

  // ---------------- PRODUCTOS ----------------
  function productos() {
    const isLow = tab === 'bajo';
    const cats = [...new Set(store.products.map((p) => p.category).filter(Boolean))].sort();
    $('#i-body').innerHTML = `<div class="card card-flush">
      <div class="toolbar"><label class="search">${icon('search')}<input id="i-q" value="${esc(q)}" placeholder="Nombre, tipo, marca, tamaño o código…"></label>
        <div class="row" style="gap:6px;flex-wrap:wrap"><select class="select select-sm" id="i-cat" style="width:auto"><option value="">Todas las categorías</option>${cats.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select class="select select-sm" id="i-kind" style="width:auto"><option value="">Todo</option>${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>
      ${isLow ? `<div class="small muted" style="padding:0 16px 10px">Productos en o bajo su mínimo. ¿Listo para pedir? Ve a Compras → Sugerido de compra.</div>` : ''}
      <div id="i-list"></div></div>`;
    const list = () => {
      const t = normalize(q);
      let L = isLow ? store.lowProducts : store.products;
      L = L.filter((p) => (!cat || p.category === cat) && (!kind || (kind === 'combo' ? isCombo(p) : kind === 'retornable' ? p.returnable : kind === 'fria' ? canCold(p) : !p.barcode && !isCombo(p))) && (!t || searchText(p).includes(t)));
      if (isLow) L = [...L].sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0));
      return L;
    };
    const paint = () => {
      const L = list();
      $('#i-list').innerHTML = L.length ? `<div class="table-wrap"><table class="table table-hover table-cards"><thead><tr><th>Producto</th><th class="hide-sm">Categoría</th><th class="c">Tipo</th><th class="r">Existencia</th><th class="hide-sm">Próx. vence</th><th class="r">Precio</th></tr></thead><tbody>
        ${L.slice(0, 400).map((p) => { const st = Number(p.stock) || 0; const ex = nextExpiry(p); const combo = isCombo(p); return `<tr data-id="${p.id}" style="cursor:pointer;${p.sellable === false ? 'opacity:.5' : ''}">
          <td><div class="t-name ellipsis">${esc(p.name)}</div><div class="t-sub ellipsis">${esc(productLine(p))}${p.barcode ? ` · ${esc(p.barcode)}` : ''}</div></td>
          <td class="hide-sm small">${esc(p.category || '—')}${p.location ? `<div class="t-sub">${icon('pin')} ${esc(p.location)}</div>` : ''}</td>
          <td class="c">${productBadges(p) || '<span class="faint">—</span>'}</td>
          <td class="r">${combo ? `<b>${comboStock(p)}</b><div class="t-sub">se pueden armar</div>` : `<b class="${p.trackStock !== false && st <= 0 ? 'text-danger' : p.trackStock !== false && st <= (p.minStock || 0) ? 'text-warning' : ''}">${p.trackStock === false ? '—' : st <= 0 ? 'Agotado' : stockText(p)}</b><div class="t-sub">mín. ${stockText(p, p.minStock || 0)}</div>`}</td>
          <td class="hide-sm">${ex ? expBadge(ex) : '<span class="faint">—</span>'}</td>
          <td class="r num"><b>${usd(p.price)}</b>${fractionable(p) ? `<div class="t-sub">und ${usd(packPrice(p, 'unidad', { markup: store.settings.fractionMarkup }))}</div>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>${L.length > 400 ? `<div class="small muted center" style="padding:10px">Mostrando 400 de ${L.length}.</div>` : ''}`
        : `<div style="padding:8px 16px 20px">${store.products.length ? emptyState('box', isLow ? 'Nada por reponer' : 'Sin resultados') : emptyState('bottle', 'Aún no hay productos', 'Agrégalos uno a uno o impórtalos desde Excel (CSV).')}</div>`;
      el.querySelectorAll('#i-list [data-id]').forEach((r) => r.onclick = () => openProduct(r.dataset.id));
    };
    $('#i-q').oninput = debounce((e) => { q = e.target.value; paint(); }, 100);
    $('#i-q').onkeydown = (e) => { if (e.key === 'Enter') { const p = store.byBarcode(e.target.value); if (p) openProduct(p.id); } };
    $('#i-cat').onchange = (e) => { cat = e.target.value; paint(); };
    $('#i-kind').onchange = (e) => { kind = e.target.value; paint(); };
    paint();
  }

  // ---------------- VENCIMIENTOS ----------------
  function vencimientos() {
    const days = Number(store.settings.expiryAlertDays) || 90;
    const lots = store.expiringLots(Math.max(days, 180));
    const g = { vencido: [], d30: [], d60: [], d90: [], mas: [] };
    for (const l of lots) { const d = daysToExpiry(l.exp); (d < 0 ? g.vencido : d <= 30 ? g.d30 : d <= 60 ? g.d60 : d <= 90 ? g.d90 : g.mas).push(l); }
    const val = (L) => L.reduce((a, l) => a + l.qty * ((Number(l.cost) || Number(l.p.cost) || 0) / upb(l.p)), 0);
    const block = (k, title, tone, L) => L.length ? `<div class="card mt"><div class="card-head"><div class="card-title"><span class="badge badge-${tone}">${L.length}</span> ${title}</div><span class="small muted">al costo ${usd(val(L))}</span></div>
      <div class="table-wrap"><table class="table table-cards"><thead><tr><th>Producto</th><th>Lote</th><th class="r">Cantidad</th><th>Vence</th><th></th></tr></thead><tbody>${L.map((l) => `<tr><td><button class="linkish" data-p="${l.p.id}"><b>${esc(l.p.name)}</b></button><div class="t-sub">${esc(l.p.lab || '')}</div></td><td class="mono small">${esc(l.lot || 's/l')}</td><td class="r">${stockText(l.p, l.qty)}</td><td>${fmtDate(l.exp)} ${expBadge(l.exp)}</td><td class="r">${k === 'vencido' ? `<button class="btn btn-danger btn-sm" data-rm="${l.p.id}" data-lot="${esc(l.lot || '')}" data-exp="${esc(l.exp)}" data-q="${l.qty}">${icon('trash')} Retirar</button>` : `<button class="btn btn-ghost btn-sm" data-dev="${l.p.id}" data-lot="${esc(l.lot || '')}" data-exp="${esc(l.exp)}" data-q="${l.qty}">${icon('truck')} Devolver</button>`}</td></tr>`).join('')}</tbody></table></div></div>` : '';
    $('#i-body').innerHTML = `<div class="kpis kpis-sm">
        <div class="card kpi"><div class="kpi-label">Vencidos</div><div class="kpi-value text-danger">${g.vencido.length}</div><div class="kpi-sub">${usd(val(g.vencido))} al costo</div></div>
        <div class="card kpi"><div class="kpi-label">≤ 30 días</div><div class="kpi-value">${g.d30.length}</div><div class="kpi-sub">véndelos primero</div></div>
        <div class="card kpi"><div class="kpi-label">31–60 días</div><div class="kpi-value">${g.d60.length}</div><div class="kpi-sub">arma un combo o promo</div></div>
        <div class="card kpi"><div class="kpi-label">61–90 días</div><div class="kpi-value">${g.d90.length}</div><div class="kpi-sub">negocia el cambio</div></div>
      </div>
      <div class="row mt"><button class="btn btn-secondary btn-sm" id="v-print">${icon('print')} Imprimir reporte de vencimientos</button></div>
      ${block('vencido', 'Vencidos: retíralos de la venta', 'danger', g.vencido)}${block('d30', 'Vencen en 30 días', 'danger', g.d30)}${block('d60', 'Vencen en 31 a 60 días', 'warning', g.d60)}${block('d90', 'Vencen en 61 a 90 días', 'warning', g.d90)}${block('mas', 'Vencen en 91 a 180 días', 'info', g.mas)}
      ${!lots.length ? emptyState('checkCircle', 'Sin vencimientos en los próximos 6 meses', 'Cervezas, vinos, cremas y refrescos tienen fecha: regístrala al recibir mercancía y aquí verás las alertas.') : ''}`;
    el.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => openProduct(b.dataset.p));
    const mv = (mode) => async (b) => {
      const p = store.product(b.dataset.rm || b.dataset.dev);
      if (!(await confirmDialog({ title: mode === 'vencido' ? 'Retirar lote vencido' : 'Devolver al proveedor', message: `${esc(p.name)} · lote ${esc(b.dataset.lot || 's/l')} · ${stockText(p, +b.dataset.q)} salen del inventario.`, confirmText: 'Confirmar', danger: mode === 'vencido' }))) return;
      try { await moveProduct(p, { mode, units: +b.dataset.q, lot: b.dataset.lot, exp: b.dataset.exp, reason: mode === 'vencido' ? 'Retiro por vencimiento' : 'Devolución por vencimiento próximo' }); toast('Inventario actualizado'); } catch (e) { toast(e.message, 'danger'); }
    };
    el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => mv('vencido')(b));
    el.querySelectorAll('[data-dev]').forEach((b) => b.onclick = () => mv('devolucion_prov')(b));
    $('#v-print').onclick = () => printDoc('Reporte de vencimientos', `<p>${esc(store.businessName)} · ${fmtDateTime(new Date().toISOString())}</p><table><thead><tr><th>Producto</th><th>Marca</th><th>Lote</th><th>Cantidad (und)</th><th>Vence</th><th>Días</th></tr></thead><tbody>${lots.map((l) => `<tr><td>${esc(l.p.name)}</td><td>${esc(l.p.lab || '')}</td><td>${esc(l.lot || 's/l')}</td><td>${l.qty}</td><td>${l.exp}</td><td>${daysToExpiry(l.exp)}</td></tr>`).join('')}</tbody></table>`);
  }

  // ---------------- MOVIMIENTOS ----------------
  async function movimientos() {
    $('#i-body').innerHTML = '<div class="empty"><div class="spinner"></div></div>';
    let rows = [];
    try { rows = (await store.listBetween('inventory_logs', 'date', startOfDay(addDays(new Date(), -30)).toISOString(), endOfDay(new Date()).toISOString())).sort((a, b) => (b.date || '').localeCompare(a.date || '')); } catch (e) { console.error(e); }
    if (tab !== 'movimientos') return;
    const broken = rows.filter((r) => ['rotura', 'merma', 'vencido'].includes(r.type)).reduce((a, r) => a + Math.abs(r.qty) * (Number(r.cost) || 0), 0);
    $('#i-body').innerHTML = `<div class="card card-flush"><div class="small muted" style="padding:14px 16px 6px">Últimos 30 días · ${rows.length} movimiento(s)${broken ? ` · pérdidas por rotura, merma y vencimiento: <b class="text-danger">${usd(broken)}</b> al costo` : ''}</div>${rows.length ? `<div class="table-wrap"><table class="table table-cards"><thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th class="r">Unidades</th><th class="hide-sm">Lote</th><th class="hide-sm">Detalle</th></tr></thead><tbody>${rows.slice(0, 400).map((r) => { const [l, tone] = MOVE[r.type] || [r.type, 'neutral']; return `<tr><td class="small nowrap">${fmtDateTime(r.date)}</td><td><b>${esc(r.name)}</b></td><td><span class="badge badge-${tone}">${l}</span></td><td class="r num ${r.qty < 0 ? 'text-danger' : 'text-success'}"><b>${r.qty > 0 ? '+' : ''}${r.qty}</b></td><td class="hide-sm small mono">${(r.lots || []).map((x) => esc(x.lot || 's/l')).join(', ')}</td><td class="hide-sm small muted">${esc(r.reason || '')} · ${esc(r.by || '')}</td></tr>`; }).join('')}</tbody></table></div>` : `<div style="padding:8px 16px 20px">${emptyState('history', 'Sin movimientos')}</div>`}</div>`;
  }

  // ---------------- CONTEO FÍSICO ----------------
  function conteo() {
    const counted = {};
    let cq = '';
    $('#i-body').innerHTML = `<div class="card"><div class="card-head"><div class="card-title">${icon('clipboard')} Conteo físico</div><button class="btn btn-primary btn-sm" id="k-save" disabled>${icon('check')} Aplicar ajustes</button></div>
      <p class="small muted" style="margin:0">Cuenta lo que hay en el depósito, los anaqueles y las neveras (en unidades: botellas, latas…). Solo se ajustan los productos que cambies; la diferencia queda registrada como movimiento.</p>
      <label class="search mt">${icon('search')}<input id="k-q" placeholder="Buscar o escanear…"></label><div id="k-list" class="mt"></div></div>`;
    const paint = () => {
      const t = normalize(cq);
      const L = store.products.filter((p) => p.sellable !== false && p.trackStock !== false && !isCombo(p) && (!t || searchText(p).includes(t))).slice(0, 150);
      $('#k-list').innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Producto</th><th class="r">Sistema</th><th class="r" style="width:130px">Contado (und)</th><th class="r">Dif.</th></tr></thead><tbody>${L.map((p) => { const c = counted[p.id]; const d = c == null ? null : c - (Number(p.stock) || 0); return `<tr><td><b>${esc(p.name)}</b><div class="t-sub">${esc(productLine(p))}${p.location ? ` · ${esc(p.location)}` : ''}</div></td><td class="r">${Number(p.stock) || 0}<div class="t-sub">${stockText(p)}</div></td><td class="r"><input class="input input-sm r" inputmode="numeric" data-k="${p.id}" value="${c ?? ''}" placeholder="—"></td><td class="r num ${d ? (d < 0 ? 'text-danger' : 'text-success') : ''}" data-d="${p.id}">${d == null ? '' : (d > 0 ? '+' : '') + d}</td></tr>`; }).join('')}</tbody></table></div>`;
      el.querySelectorAll('[data-k]').forEach((i) => i.oninput = () => {
        const v = i.value.trim(); if (v === '') delete counted[i.dataset.k]; else counted[i.dataset.k] = Math.max(0, Math.round(parseNum(v)));
        const p = store.product(i.dataset.k); const d = counted[p.id] == null ? null : counted[p.id] - (Number(p.stock) || 0);
        const cell = el.querySelector(`[data-d="${p.id}"]`); cell.textContent = d == null ? '' : (d > 0 ? '+' : '') + d; cell.className = 'r num ' + (d ? (d < 0 ? 'text-danger' : 'text-success') : '');
        $('#k-save').disabled = !Object.keys(counted).length;
      });
    };
    $('#k-q').oninput = debounce((e) => { cq = e.target.value; paint(); }, 100);
    $('#k-save').onclick = async (e) => {
      if (!(await requirePin('Aplicar ajustes de inventario'))) return;
      const btn = e.currentTarget; setBusy(btn, true, 'Aplicando…');
      let n = 0;
      for (const [id, units] of Object.entries(counted)) { const p = store.product(id); if (!p || units === (Number(p.stock) || 0)) continue; try { await moveProduct(p, { mode: 'conteo', units, reason: 'Conteo físico' }); n++; } catch (ex) { toast(`${p.name}: ${ex.message}`, 'danger'); } }
      toast(`${n} producto(s) ajustado(s)`); Object.keys(counted).forEach((k) => delete counted[k]); setBusy(btn, false); btn.disabled = true; paint();
    };
    paint();
  }

  el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { tab = b.dataset.t; draw(); });
  $('#i-new').onclick = async () => { const p = await productForm(); if (p) openProduct(p.id); };
  $('#i-combo').onclick = async () => { const p = await comboForm(); if (p) openProduct(p.id); };
  $('#i-exp').onclick = exportCSV;
  $('#i-imp').onclick = importCSV;
  draw();
  const off = store.on('products', () => { if (tab !== 'conteo' && tab !== 'movimientos') draw(); else counts(); });
  return () => off();
}

// ======================================================================
// FORMULARIO DEL PRODUCTO
// ======================================================================
export function productForm(p0 = null, preset = {}) {
  if (p0 && isCombo(p0)) return comboForm(p0);
  const p = { unitsPerBox: 1, packUnits: 0, fraction: true, trackStock: true, sellable: true, online: true, minStock: 0, maxStock: 0, returnable: false, ...preset, ...(p0 || {}) };
  const conts = (store.settings.containers || []).filter((c) => c.active !== false);
  return new Promise((resolve) => {
    let saved = null;
    const cats = store.settings.categories || [];
    const m = openModal({
      title: p0 ? 'Editar producto' : 'Nuevo producto', sub: p0 ? esc(p0.name) : 'Si viene en caja, el precio base es el de la caja; la unidad y el pack se calculan solos (o fíjalos tú).', size: 'lg',
      body: `<form data-f autocomplete="off">
        <div class="form-grid">
          <div class="field full"><label>Nombre *</label><input class="input" name="name" value="${esc(p.name || '')}" autofocus placeholder="Ej.: Ron Santa Teresa Gran Reserva 750 ml"></div>
          <div class="field"><label>Tipo / variedad</label><input class="input" name="kind" value="${esc(p.active || '')}" placeholder="Ej.: Ron añejo, Cerveza pilsen, Vino tinto"><span class="hint">Sirve para ofrecer alternativas del mismo tipo.</span></div>
          <div class="field"><label>Contenido</label><input class="input" name="strength" list="sizes-dl" value="${esc(p.strength || '')}" placeholder="Ej.: 750 ml"><datalist id="sizes-dl">${SIZES.map((s) => `<option value="${s}">`).join('')}</datalist></div>
          <div class="field"><label>Grados de alcohol (% vol)</label><input class="input" name="abv" inputmode="decimal" value="${p.abv ? num(p.abv, 1) : ''}" placeholder="Ej.: 40"></div>
          <div class="field"><label>Envase</label><select class="select" name="form"><option value="">—</option>${FORMS.map((f) => `<option ${p.form === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
          <div class="field"><label>Marca / destilería</label><input class="input" name="lab" value="${esc(p.lab || '')}"></div>
          <div class="field"><label>País de origen</label><input class="input" name="origin" value="${esc(p.origin || '')}" placeholder="Ej.: Venezuela, Escocia"></div>
          <div class="field"><label>Código de barras</label><input class="input" name="barcode" value="${esc(p.barcode || '')}" placeholder="Escanéalo aquí (el de la botella o lata)"></div>
          <div class="field"><label>Código interno (SKU)</label><input class="input" name="sku" value="${esc(p.sku || '')}"></div>
          <div class="field"><label>Categoría</label><select class="select" name="category"><option value="">—</option>${[...new Set([...cats, p.category].filter(Boolean))].map((c) => `<option ${p.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="field"><label>Ubicación</label><input class="input" name="location" value="${esc(p.location || '')}" placeholder="Ej.: Anaquel 3, Nevera 1, Depósito"></div>
          <div class="field"><label>Proveedor habitual</label><select class="select" name="supplierId"><option value="">—</option>${store.suppliers.map((s) => `<option value="${s.id}" ${p.supplierId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        </div>
        <div class="section-title mt-lg">${icon('layers')} Presentación y precios</div>
        <div class="form-grid">
          <div class="field"><label>Unidades por caja</label><input class="input" name="unitsPerBox" inputmode="numeric" value="${p.unitsPerBox || 1}"><span class="hint">1 = se vende solo por unidad (botellas sueltas). Cerveza: 24, 36…</span></div>
          <div class="field"><label>Unidades por pack</label><input class="input" name="packUnits" inputmode="numeric" value="${p.packUnits || ''}" placeholder="6 = six-pack · 0 = sin pack"></div>
          <div class="field"><label data-lc>Costo por caja</label><input class="input" name="cost" inputmode="decimal" value="${p.cost ? num(p.cost) : ''}"></div>
          <div class="field"><label data-lp>Precio de venta (caja) *</label><input class="input" name="price" inputmode="decimal" value="${p.price ? num(p.price) : ''}"></div>
          <div class="field" data-boxed><label>Precio del pack</label><input class="input" name="packSale" inputmode="decimal" value="${p.packSale ? num(p.packSale) : ''}" placeholder="Automático"></div>
          <div class="field" data-boxed><label>Precio por unidad</label><input class="input" name="unitPrice" inputmode="decimal" value="${p.unitPrice ? num(p.unitPrice) : ''}" placeholder="Automático"></div>
          <div class="field"><label data-lw>Precio al mayor (caja)</label><input class="input" name="wholesale" inputmode="decimal" value="${p.wholesale ? num(p.wholesale) : ''}" placeholder="Opcional"><span class="hint">Lo paga el cliente “al mayor” (bodegas, bares, eventos).</span></div>
          <div class="field"><label>Recargo si va fría (por unidad)</label><input class="input" name="coldExtra" inputmode="decimal" value="${p.coldExtra ? num(p.coldExtra) : ''}" placeholder="0 = mismo precio"><span class="hint">Cerveza, refrescos y hielo de la nevera.</span></div>
        </div>
        <div class="box small mt-xs" data-calc></div>
        <div class="row row-wrap mt" style="gap:14px">
          <label class="check" data-boxed><input type="checkbox" name="fraction" ${p.fraction !== false ? 'checked' : ''}> <span>Se vende suelto (por unidad)</span></label>
          <label class="check"><input type="checkbox" name="trackStock" ${p.trackStock !== false ? 'checked' : ''}> <span>Controlar existencia</span></label>
          <label class="check"><input type="checkbox" name="online" ${p.online !== false ? 'checked' : ''}> <span>Mostrar en el catálogo en línea</span></label>
          <label class="check"><input type="checkbox" name="sellable" ${p.sellable !== false ? 'checked' : ''}> <span>Activo para vender</span></label>
        </div>
        <div class="section-title mt-lg">${icon('rotate')} Envase retornable</div>
        <label class="check"><input type="checkbox" name="returnable" ${p.returnable ? 'checked' : ''}> <span>Envase retornable: al vender se pide el vacío o se cobra el depósito</span></label>
        <div class="form-grid mt-xs" data-ret>
          <div class="field"><label>Envase por unidad</label><select class="select" name="containerId"><option value="">—</option>${conts.map((c) => `<option value="${c.id}" ${p.containerId === c.id ? 'selected' : ''}>${esc(c.name)} · ${usd(c.deposit)}</option>`).join('')}</select></div>
          <div class="field" data-boxed><label>Envase por caja (gavera)</label><select class="select" name="crateId"><option value="">—</option>${conts.map((c) => `<option value="${c.id}" ${p.crateId === c.id ? 'selected' : ''}>${esc(c.name)} · ${usd(c.deposit)}</option>`).join('')}</select></div>
        </div>
        <div class="section-title mt-lg">${icon('box')} Existencia</div>
        <div class="form-grid">
          <div class="field"><label>Stock mínimo (unidades)</label><input class="input" name="minStock" inputmode="numeric" value="${p.minStock || ''}"><span class="hint">Avisa para reponer.</span></div>
          <div class="field"><label>Stock máximo (unidades)</label><input class="input" name="maxStock" inputmode="numeric" value="${p.maxStock || ''}"><span class="hint">Hasta dónde sugerir la compra.</span></div>
          ${p0 ? '' : `<div class="field" data-boxed><label>Existencia inicial (cajas)</label><input class="input" name="initBoxes" inputmode="decimal" placeholder="0"></div>
          <div class="field"><label data-lu>+ unidades sueltas</label><input class="input" name="initUnits" inputmode="numeric" placeholder="0"></div>
          <div class="field"><label>Lote</label><input class="input" name="lot"></div>
          <div class="field"><label>Vencimiento</label><input class="input" type="date" name="exp"><span class="hint">Opcional (cerveza, vino, cremas…).</span></div>`}
        </div>
        <div class="field mt"><label>Notas</label><input class="input" name="notes" value="${esc(p.notes || '')}" placeholder="Ej.: edición limitada, mantener en nevera"></div>
        <div class="error-msg mt" data-err></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} ${p0 ? 'Guardar' : 'Crear producto'}</button>`,
      onClose: () => resolve(saved)
    });
    const F = m.el.querySelector('[data-f]').elements;
    const q = (s) => m.el.querySelector(s);
    const calc = () => {
      const k = Math.max(1, Math.round(parseNum(F.unitsPerBox.value) || 1)); const pr = parseNum(F.price.value); const c = parseNum(F.cost.value);
      const boxed = k > 1;
      m.el.querySelectorAll('[data-boxed]').forEach((x) => { x.hidden = !boxed; });
      q('[data-ret]').hidden = !F.returnable.checked;
      q('[data-lc]').textContent = boxed ? 'Costo por caja' : 'Costo por unidad';
      q('[data-lp]').textContent = boxed ? 'Precio de venta (caja) *' : 'Precio de venta *';
      q('[data-lw]').textContent = boxed ? 'Precio al mayor (caja)' : 'Precio al mayor';
      if (q('[data-lu]')) q('[data-lu]').textContent = boxed ? '+ unidades sueltas' : 'Existencia inicial (unidades)';
      const tmp = { price: pr, unitsPerBox: k, packUnits: parseNum(F.packUnits.value), fraction: F.fraction.checked, packSale: parseNum(F.packSale.value), unitPrice: parseNum(F.unitPrice.value), coldExtra: parseNum(F.coldExtra.value), wholesale: parseNum(F.wholesale.value) };
      const mk = { markup: store.settings.fractionMarkup };
      q('[data-calc]').innerHTML = pr ? `${boxed ? `Caja x${k} ${usd(pr)}` : `Unidad ${usd(pr)}`}${hasPack(tmp) ? ` · ${packName(tmp)} ${usd(packPrice(tmp, 'pack', mk))}` : ''}${fractionable(tmp) ? ` · unidad ${usd(packPrice(tmp, 'unidad', mk))}` : ''}${tmp.coldExtra ? ` · ${boxed ? 'unidad' : ''} fría ${usd(packPrice(tmp, boxed ? 'unidad' : 'caja', { ...mk, cold: true }))}` : ''}${tmp.wholesale ? ` · al mayor ${usd(tmp.wholesale)}` : ''}${c ? ` · margen <b>${Math.round((pr - c) / pr * 100)}%</b> (${usd(pr - c)})` : ''}` : 'Escribe el precio de venta.';
    };
    ['unitsPerBox', 'packUnits', 'price', 'cost', 'packSale', 'unitPrice', 'fraction', 'coldExtra', 'wholesale', 'returnable'].forEach((k) => F[k].addEventListener('input', calc));
    F.returnable.addEventListener('change', calc);
    calc();
    m.el.querySelector('[data-f]').onsubmit = (e) => { e.preventDefault(); q('[data-ok]').click(); };
    q('[data-ok]').onclick = async (e) => {
      const err = q('[data-err]'); err.textContent = '';
      if (!F.name.value.trim()) { err.textContent = 'Escribe el nombre.'; return; }
      if (!(parseNum(F.price.value) > 0)) { err.textContent = 'Escribe el precio de venta.'; return; }
      if (F.returnable.checked && !F.containerId.value && !F.crateId.value) { err.textContent = 'Elige el envase retornable (o desmarca “Envase retornable”).'; return; }
      const btn = e.currentTarget; setBusy(btn, true, 'Guardando…');
      const k = Math.max(1, Math.round(parseNum(F.unitsPerBox.value) || 1));
      const data = {
        name: F.name.value, active: F.kind.value, strength: F.strength.value, abv: parseNum(F.abv.value), form: F.form.value, lab: F.lab.value, origin: F.origin.value, barcode: F.barcode.value, sku: F.sku.value, category: F.category.value, location: F.location.value, supplierId: F.supplierId.value || null,
        unitsPerBox: k, packUnits: k > 1 ? parseNum(F.packUnits.value) : 0, cost: parseNum(F.cost.value), price: parseNum(F.price.value), packSale: k > 1 ? parseNum(F.packSale.value) : 0, unitPrice: k > 1 ? parseNum(F.unitPrice.value) : 0, wholesale: parseNum(F.wholesale.value), coldExtra: parseNum(F.coldExtra.value),
        returnable: F.returnable.checked, containerId: F.returnable.checked ? F.containerId.value || '' : '', crateId: F.returnable.checked && k > 1 ? F.crateId.value || '' : '',
        fraction: F.fraction.checked, trackStock: F.trackStock.checked, online: F.online.checked, sellable: F.sellable.checked, minStock: parseNum(F.minStock.value), maxStock: parseNum(F.maxStock.value), notes: F.notes.value
      };
      const initial = p0 ? null : { units: Math.round((k > 1 ? (parseNum(F.initBoxes.value) || 0) * k : 0) + (parseNum(F.initUnits.value) || 0)), lot: F.lot.value, exp: F.exp.value };
      try {
        saved = await saveProduct(data, p0?.id || null, initial);
        m.close(); toast(p0 ? 'Producto actualizado' : 'Producto creado');
      } catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
    };
  });
}

// ======================================================================
// COMBOS (ej. "Combo rumba": 1 ron + 2 refrescos + 1 hielo)
// ======================================================================
export function comboForm(p0 = null) {
  const p = { combo: [], online: true, sellable: true, category: 'Combos', ...(p0 || {}) };
  let items = (p.combo || []).map((c) => ({ ...c }));
  return new Promise((resolve) => {
    let saved = null;
    const m = openModal({
      title: p0 ? 'Editar combo' : 'Nuevo combo', sub: 'Se arma con productos del inventario: al venderlo, descuenta cada uno.', size: 'lg',
      body: `<form data-f autocomplete="off" class="stack">
        <div class="form-grid">
          <div class="field full"><label>Nombre del combo *</label><input class="input" name="name" value="${esc(p.name || '')}" autofocus placeholder="Ej.: Combo Rumba: ron + 2 refrescos + hielo"></div>
          <div class="field"><label>Precio del combo *</label><input class="input" name="price" inputmode="decimal" value="${p.price ? num(p.price) : ''}"></div>
          <div class="field"><label>Código de barras / SKU</label><input class="input" name="sku" value="${esc(p.sku || p.barcode || '')}"></div>
        </div>
        <div class="between"><div class="section-title" style="margin:0">${icon('gift')} Contenido del combo</div><button type="button" class="btn btn-secondary btn-sm" data-add>${icon('plus')} Agregar producto</button></div>
        <div data-items></div>
        <div class="box small" data-calc></div>
        <div class="row row-wrap" style="gap:14px">
          <label class="check"><input type="checkbox" name="online" ${p.online !== false ? 'checked' : ''}> <span>Mostrar en el catálogo en línea</span></label>
          <label class="check"><input type="checkbox" name="sellable" ${p.sellable !== false ? 'checked' : ''}> <span>Activo para vender</span></label>
        </div>
        <div class="error-msg" data-err></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} ${p0 ? 'Guardar' : 'Crear combo'}</button>`,
      onClose: () => resolve(saved)
    });
    const F = m.el.querySelector('[data-f]').elements;
    const q = (s) => m.el.querySelector(s);
    const paint = () => {
      q('[data-items]').innerHTML = items.length ? `<div class="list">${items.map((c, i) => { const x = store.product(c.productId); return `<div class="list-item"><span class="kpi-icon tone-brand" style="width:34px;height:34px">${icon(catIcon(x?.category))}</span><div class="grow" style="min-width:0"><b class="ellipsis">${esc(x?.name || '¿Producto eliminado?')}</b><div class="t-sub">${x ? `${usd((Number(x.cost) || 0) / upb(x))} costo c/u · hay ${stockText(x)}` : ''}</div></div><div class="stepper"><button type="button" data-dec="${i}">${icon('minus')}</button><span>${c.units}</span><button type="button" data-inc="${i}">${icon('plus')}</button></div><button type="button" class="btn btn-ghost btn-icon btn-sm" data-del="${i}">${icon('x')}</button></div>`; }).join('')}</div>` : emptyState('gift', 'Agrega los productos que lleva el combo');
      m.el.querySelectorAll('[data-inc]').forEach((b) => b.onclick = () => { items[+b.dataset.inc].units++; paint(); });
      m.el.querySelectorAll('[data-dec]').forEach((b) => b.onclick = () => { const c = items[+b.dataset.dec]; c.units--; if (c.units <= 0) items.splice(+b.dataset.dec, 1); paint(); });
      m.el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { items.splice(+b.dataset.del, 1); paint(); });
      calc();
    };
    const calc = () => {
      const tmp = { combo: items };
      const cost = comboCost(tmp); const pr = parseNum(F.price.value);
      const list = items.reduce((a, c) => { const x = store.product(c.productId); return a + (x ? packPrice(x, upb(x) > 1 ? 'unidad' : 'caja', { markup: store.settings.fractionMarkup }) * c.units : 0); }, 0);
      q('[data-calc]').innerHTML = items.length ? `Por separado: <b>${usd(list)}</b> · costo ${usd(cost)}${pr ? ` · el cliente ahorra <b class="text-success">${usd(Math.max(0, list - pr))}</b> · margen <b>${pr ? Math.round((pr - cost) / pr * 100) : 0}%</b>` : ''} · se pueden armar <b>${comboStock(tmp)}</b>` : 'Agrega productos para ver el costo y el ahorro.';
    };
    F.price.oninput = calc;
    q('[data-add]').onclick = async () => {
      const x = await pickProduct({ title: 'Producto del combo', filter: (y) => !isCombo(y) });
      if (!x) return;
      const hit = items.find((c) => c.productId === x.id);
      if (hit) hit.units++; else items.push({ productId: x.id, units: 1 });
      paint();
    };
    paint();
    q('[data-ok]').onclick = async (e) => {
      const err = q('[data-err]'); err.textContent = '';
      if (!F.name.value.trim()) { err.textContent = 'Escribe el nombre del combo.'; return; }
      if (!(parseNum(F.price.value) > 0)) { err.textContent = 'Escribe el precio del combo.'; return; }
      if (!items.length) { err.textContent = 'Agrega al menos un producto.'; return; }
      setBusy(e.currentTarget, true, 'Guardando…');
      try {
        saved = await saveProduct({ name: F.name.value, price: parseNum(F.price.value), sku: F.sku.value, category: 'Combos', combo: items.map((c) => ({ productId: c.productId, units: Math.max(1, Math.round(c.units)) })), unitsPerBox: 1, trackStock: false, fraction: false, online: F.online.checked, sellable: F.sellable.checked, cost: comboCost({ combo: items }) }, p0?.id || null, null);
        m.close(); toast(p0 ? 'Combo actualizado' : 'Combo creado');
      } catch (ex) { err.textContent = ex.message; setBusy(e.currentTarget, false); }
    };
  });
}

export function openProduct(id) {
  const p = store.product(id);
  if (!p) return;
  const combo = isCombo(p);
  const eq = equivalents(p, store.products);
  const lots = lotsOf(p);
  const cont = (cid) => (store.settings.containers || []).find((c) => c.id === cid);
  const m = openModal({
    title: esc(p.name), sub: esc(productLine(p)), size: 'lg',
    body: `<div class="stack">
      <div class="row row-wrap" style="gap:6px">${productBadges(p)}${p.category ? `<span class="badge badge-neutral">${esc(p.category)}</span>` : ''}${p.origin ? `<span class="badge badge-neutral">${icon('globe')} ${esc(p.origin)}</span>` : ''}${p.location ? `<span class="badge badge-neutral">${icon('pin')} ${esc(p.location)}</span>` : ''}${p.sellable === false ? '<span class="badge badge-danger">Inactivo</span>' : ''}${p.barcode ? `<span class="badge badge-neutral mono">${esc(p.barcode)}</span>` : ''}</div>
      ${combo ? `<div class="card"><div class="card-title">${icon('gift')} Lleva</div><div class="list mt-xs">${p.combo.map((c) => { const x = store.product(c.productId); return `<div class="list-item"><b>${c.units} ×</b><div class="grow">${esc(x?.name || '¿?')}</div><span class="t-sub">${x ? stockText(x) : ''}</span></div>`; }).join('')}</div></div>
      <div class="kpis kpis-sm"><div class="card kpi"><div class="kpi-label">Se pueden armar</div><div class="kpi-value" style="font-size:20px">${comboStock(p)}</div></div><div class="card kpi"><div class="kpi-label">Precio</div><div class="kpi-value" style="font-size:20px">${usd(p.price)}</div></div><div class="card kpi"><div class="kpi-label">Costo</div><div class="kpi-value" style="font-size:20px">${usd(comboCost(p))}</div><div class="kpi-sub">margen ${p.price ? Math.round((p.price - comboCost(p)) / p.price * 100) : 0}%</div></div><div class="card kpi"><div class="kpi-label">Vendidos</div><div class="kpi-value" style="font-size:20px">${Number(p.sold) || 0}</div></div></div>`
      : `<div class="kpis kpis-sm">
        <div class="card kpi"><div class="kpi-label">Existencia</div><div class="kpi-value" style="font-size:20px">${stockText(p)}</div><div class="kpi-sub">${Number(p.stock) || 0} unidades · mín. ${p.minStock || 0}</div></div>
        <div class="card kpi"><div class="kpi-label">${upb(p) > 1 ? `Precio caja x${upb(p)}` : 'Precio'}</div><div class="kpi-value" style="font-size:20px">${usd(p.price)}</div><div class="kpi-sub">${fractionable(p) ? `unidad ${usd(packPrice(p, 'unidad', { markup: store.settings.fractionMarkup }))}${hasPack(p) ? ` · ${packName(p)} ${usd(packPrice(p, 'pack', { markup: store.settings.fractionMarkup }))}` : ''}` : Number(p.wholesale) > 0 ? `al mayor ${usd(p.wholesale)}` : '—'}</div></div>
        <div class="card kpi"><div class="kpi-label">Costo</div><div class="kpi-value" style="font-size:20px">${usd(p.cost || 0)}</div><div class="kpi-sub">${p.price && p.cost ? `margen ${Math.round((p.price - p.cost) / p.price * 100)}%` : '—'}</div></div>
        <div class="card kpi"><div class="kpi-label">Vendidas</div><div class="kpi-value" style="font-size:20px">${Number(p.sold) || 0}</div><div class="kpi-sub">unidades en total</div></div>
      </div>
      ${p.returnable ? `<div class="box small">${icon('rotate')} Retornable: ${[cont(p.containerId) ? `${esc(cont(p.containerId).name)} por unidad (${usd(cont(p.containerId).deposit)})` : '', cont(p.crateId) ? `${esc(cont(p.crateId).name)} por caja (${usd(cont(p.crateId).deposit)})` : ''].filter(Boolean).join(' · ')}</div>` : ''}
      ${canCold(p) ? `<div class="box small">${icon('snow')} Fría: +${usd(p.coldExtra)} por unidad</div>` : ''}
      <div><div class="section-title">${icon('layers')} Lotes en existencia (sale primero el que vence antes)</div>${lots.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Lote</th><th>Vence</th><th class="r">Cantidad</th></tr></thead><tbody>${lots.map((l) => `<tr><td class="mono">${esc(l.lot || 's/l')}</td><td>${l.exp ? `${fmtDate(l.exp)} ${expBadge(l.exp)}` : '—'}</td><td class="r">${stockText(p, l.qty)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="small muted">Sin lotes registrados.</div>'}</div>
      ${eq.length ? `<div><div class="section-title">${icon('refresh')} Alternativas (mismo tipo y tamaño)</div><div class="small">${eq.map((x) => `${esc(x.name)} (${usd(x.price)} · ${stockText(x)})`).join(' · ')}</div></div>` : ''}`}
    </div>`,
    footer: `<button class="btn btn-ghost" data-a="edit">${icon('edit')} Editar</button><span class="grow"></span>${combo ? '' : `<button class="btn btn-secondary" data-a="out">${icon('minus')} Salida</button><button class="btn btn-primary" data-a="in">${icon('plus')} Entrada</button>`}`
  });
  m.el.querySelector('[data-a="edit"]').onclick = async () => { m.close(); if (await productForm(p)) openProduct(id); };
  m.el.querySelector('[data-a="in"]')?.addEventListener('click', () => { m.close(); moveForm(p, 'entrada'); });
  m.el.querySelector('[data-a="out"]')?.addEventListener('click', () => { m.close(); moveForm(p, 'rotura'); });
}

function moveForm(p, mode0) {
  let mode = mode0;
  const lots = lotsOf(p);
  const boxed = upb(p) > 1;
  const m = openModal({
    title: mode0 === 'entrada' ? 'Entrada de inventario' : 'Salida de inventario', sub: `${esc(p.name)} · hay ${stockText(p)}`, size: 'md',
    body: `<div class="stack">
      ${mode0 === 'entrada' ? '<div class="hint">Para compras a proveedores usa Compras → Recibir mercancía (actualiza el costo y la cuenta por pagar).</div>' : `<div class="chips chips-wrap">${['rotura', 'merma', 'vencido', 'cortesia', 'devolucion_prov', 'uso'].map((k) => `<button type="button" class="chip ${k === mode ? 'on' : ''}" data-m="${k}">${MOVE[k][0]}</button>`).join('')}</div>`}
      <div class="form-grid">
        ${boxed ? '<div class="field"><label>Cajas</label><input class="input" data-b inputmode="decimal" placeholder="0"></div>' : ''}
        <div class="field"><label>${boxed ? '+ unidades' : 'Unidades'}</label><input class="input" data-u inputmode="numeric" placeholder="0"></div>
        ${mode0 === 'entrada' ? '<div class="field"><label>Lote</label><input class="input" data-lot></div><div class="field"><label>Vencimiento</label><input class="input" type="date" data-exp></div>'
          : lots.length ? `<div class="field full"><label>Lote</label><select class="select" data-ls><option value="">Automático (el que vence primero)</option>${lots.map((l, i) => `<option value="${i}">${esc(l.lot || 's/l')} · ${l.exp || 'sin fecha'} · ${l.qty} und</option>`).join('')}</select></div>` : ''}
        <div class="field full"><label>Motivo</label><input class="input" data-r placeholder="Ej.: se cayó una botella al acomodar"></div>
      </div><div class="error-msg" data-err></div></div>`,
    footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Registrar</button>`
  });
  const q = (s) => m.el.querySelector(s);
  m.el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { mode = b.dataset.m; m.el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); });
  q('[data-ok]').onclick = async (e) => {
    const units = Math.round((parseNum(q('[data-b]')?.value) || 0) * upb(p) + (parseNum(q('[data-u]').value) || 0));
    if (!(units > 0)) { q('[data-err]').textContent = 'Indica la cantidad.'; return; }
    if (mode !== 'entrada' && !(await requirePin('Registrar una salida de inventario'))) return;
    setBusy(e.currentTarget, true);
    const L = mode !== 'entrada' && q('[data-ls]') && q('[data-ls]').value !== '' ? lots[+q('[data-ls]').value] : null;
    try {
      await moveProduct(p, { mode, units, lot: mode === 'entrada' ? q('[data-lot]').value : (L?.lot || ''), exp: mode === 'entrada' ? q('[data-exp]').value : (L?.exp || ''), reason: q('[data-r]').value || MOVE[mode][0] });
      m.close(); toast('Inventario actualizado');
    } catch (ex) { q('[data-err]').textContent = ex.message; setBusy(e.currentTarget, false); }
  };
}

function exportCSV() {
  const head = ['Nombre', 'Tipo', 'Contenido', 'Grados', 'Envase', 'Marca', 'País', 'Código de barras', 'SKU', 'Categoría', 'Unidades por caja', 'Unidades por pack', 'Costo', 'Precio', 'Precio pack', 'Precio unidad', 'Precio al mayor', 'Recargo fría', 'Retornable', 'Existencia (und)', 'Mínimo', 'Máximo', 'Ubicación', 'Próximo vencimiento', 'Combo'];
  const data = store.products.map((p) => [p.name, p.active || '', p.strength || '', p.abv || '', p.form || '', p.lab || '', p.origin || '', p.barcode || '', p.sku || '', p.category || '', upb(p), p.packUnits || '', p.cost || 0, p.price || 0, p.packSale || '', p.unitPrice || '', p.wholesale || '', p.coldExtra || '', p.returnable ? 'Sí' : '', Number(p.stock) || 0, p.minStock || 0, p.maxStock || 0, p.location || '', nextExpiry(p), isCombo(p) ? comboLine(p) : '']);
  download(`inventario-${todayKey()}.csv`, toCSV([head, ...data]), 'text/csv;charset=utf-8');
  toast(`${data.length} producto(s) exportados`);
}

function importCSV() {
  const m = openModal({
    title: 'Importar productos', sub: 'Desde Excel o Google Sheets guardado como CSV', size: 'md',
    body: `<div class="stack"><p class="small" style="margin:0">Columnas reconocidas: <b>Nombre</b> y <b>Precio</b> (obligatorias), Tipo, Contenido, Grados, Envase, Marca, País, Código de barras, Categoría, Unidades por caja, Unidades por pack, Costo, Precio al mayor, Existencia (unidades), Lote, Vencimiento, Mínimo. Los códigos de barras repetidos se omiten.</p>
      <input type="file" accept=".csv,text/csv" class="input" data-file><div data-prev></div><div class="error-msg" data-err></div></div>`,
    footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok disabled>${icon('upload')} Importar</button>`
  });
  let parsed = [];
  const pick = (h, ...keys) => h.findIndex((x) => keys.some((k) => normalize(x).includes(k)));
  const toDate = (v) => { const s = String(v || '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s); if (d) return `${d[3].length === 2 ? '20' + d[3] : d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`; const my = /^(\d{1,2})[/.-](\d{4})$/.exec(s); return my ? `${my[2]}-${my[1].padStart(2, '0')}-28` : ''; };
  m.el.querySelector('[data-file]').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rows = parseCSV(await f.text()).filter((r) => r.some((x) => String(x).trim()));
    const h = rows.shift() || [];
    const ix = { name: pick(h, 'nombre', 'producto', 'descripcion'), active: pick(h, 'tipo', 'variedad'), strength: pick(h, 'contenido', 'tamano', 'medida'), abv: pick(h, 'grado', 'alcohol'), form: pick(h, 'envase'), lab: pick(h, 'marca', 'destil'), origin: pick(h, 'pais', 'origen'), barcode: pick(h, 'barra', 'ean', 'codigo'), category: pick(h, 'categ', 'familia'), upb: pick(h, 'por caja', 'unidades x caja'), pack: pick(h, 'por pack'), cost: pick(h, 'costo'), price: pick(h, 'precio', 'pvp'), wholesale: pick(h, 'mayor'), stock: pick(h, 'existencia', 'stock', 'cantidad'), lot: pick(h, 'lote'), exp: pick(h, 'venc', 'caduc', 'expir'), min: pick(h, 'minimo') };
    if (ix.price >= 0 && ix.price === ix.wholesale) ix.price = h.findIndex((x, i) => i !== ix.wholesale && /precio|pvp/.test(normalize(x)));
    if (ix.name < 0 || ix.price < 0) { m.el.querySelector('[data-err]').textContent = 'Necesito al menos las columnas “Nombre” y “Precio”.'; return; }
    const seen = new Set();
    parsed = rows.map((r) => { const g = (k) => (ix[k] >= 0 ? String(r[ix[k]] ?? '').trim() : ''); return { name: g('name'), active: g('active'), strength: g('strength'), abv: parseNum(g('abv')), form: g('form'), lab: g('lab'), origin: g('origin'), barcode: g('barcode'), category: g('category'), unitsPerBox: parseNum(g('upb')) || 1, packUnits: parseNum(g('pack')), cost: parseNum(g('cost')), price: parseNum(g('price')), wholesale: parseNum(g('wholesale')), minStock: parseNum(g('min')), _units: parseNum(g('stock')), _lot: g('lot'), _exp: toDate(g('exp')) }; })
      .filter((x) => { if (!x.name || !(x.price > 0)) return false; if (x.barcode) { if (seen.has(x.barcode) || store.byBarcode(x.barcode)) return false; seen.add(x.barcode); } return true; });
    m.el.querySelector('[data-prev]').innerHTML = `<div class="box small"><b>${parsed.length}</b> producto(s) listos${rows.length - parsed.length ? ` · ${rows.length - parsed.length} omitido(s)` : ''}.<div class="t-sub mt-xs">${parsed.slice(0, 4).map((x) => esc(x.name)).join(' · ')}${parsed.length > 4 ? '…' : ''}</div></div>`;
    m.el.querySelector('[data-ok]').disabled = !parsed.length;
  };
  m.el.querySelector('[data-ok]').onclick = async (e) => {
    const btn = e.currentTarget; setBusy(btn, true, 'Importando…');
    let ok = 0;
    for (const x of parsed) {
      const { _units, _lot, _exp, ...d } = x;
      try { await saveProduct(d, null, { units: Math.round(_units || 0), lot: _lot, exp: _exp }); ok++; btn.textContent = `Importando ${ok}/${parsed.length}…`; } catch (err) { console.warn(err.message); }
    }
    m.close(); toast(`${ok} producto(s) importados`);
  };
}
