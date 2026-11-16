// SanoLicores — Configuración de la licorería
import { store, updateTenant, getShop } from '../store.js';
import { requirePin, changePassword, authErrorMessage, session } from '../auth.js';
import { esc, num, toast, parseNum, setBusy, toggleTheme, download, nowISO, round2, openModal, shortId, confirmDialog, emptyState, loc, flagImg, usd } from '../utils.js';
import { icon } from '../icons.js';
import { fxSectionHTML, bindFxSection } from '../bcv.js';
import { openCountryPicker, salesWa, SALES_PHONE_FMT, qrDataURL } from '../shared.js';
import { isStandalone, bindInstallButtons } from '../install.js';
import { CATEGORIES } from '../licor.js';
import { slugify, publishShop, resetPublished, shopUrl } from '../ops.js';

const SECTIONS = { negocio: 'Licorería', moneda: 'Moneda', envases: 'Envases', vendedores: 'Vendedores', pedidos: 'Pedidos', fidelidad: 'Fidelidad', recibos: 'Facturas', seguridad: 'Seguridad', apps: 'Instalar y respaldo' };
const sw = (name, on, title, sub) => `<label class="check box box-white"><span class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span></span></span><span><b>${title}</b><br><small class="muted">${sub}</small></span></label>`;
const save = (t) => `<div class="row" style="justify-content:flex-end"><button class="btn btn-primary">${icon('check')} ${t || 'Guardar'}</button></div>`;

export function mount(el, { params = {} }) {
  let sec = SECTIONS[params.tab || params.sec] ? (params.tab || params.sec) : 'negocio';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Configuración</h1><p class="view-sub">Datos de la licorería, licencia, moneda y tasa, envases retornables, catálogo en línea, fidelidad, facturas y seguridad.</p></div></div>
    <div class="tabs">${Object.entries(SECTIONS).map(([k, v]) => `<button data-s="${k}">${v}</button>`).join('')}</div>
    <div id="s-body" class="mt" style="max-width:980px"></div>`;
  const $ = (q) => el.querySelector(q);
  const s = () => store.settings;

  function render() {
    el.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === sec));
    const body = $('#s-body');

    if (sec === 'negocio') {
      body.innerHTML = `<form class="card stack" id="f-biz">
        <div class="form-grid">
          <div class="field full"><label>Nombre de la licorería</label><input class="input" name="businessName" value="${esc(s().businessName || store.tenant?.name || '')}" placeholder="Ej.: Licorería La Gran Pausa"></div>
          <div class="field"><label>${esc(loc().tax)} (identificación fiscal)</label><input class="input" name="rif" value="${esc(s().rif)}"></div>
          <div class="field"><label>Licencia de expendio de licores</label><input class="input" name="liquorLicense" value="${esc(s().liquorLicense || '')}" placeholder="N° de licencia"><span class="hint">Aparece en la factura.</span></div>
          <div class="field"><label>La licencia vence el</label><input class="input" type="date" name="licenseExpires" value="${esc(s().licenseExpires || '')}"><span class="hint">Te avisamos 30 días antes en Inicio.</span></div>
          <div class="field"><label>Teléfono</label><input class="input" name="phone" value="${esc(s().phone)}"></div>
          <div class="field"><label>WhatsApp de la licorería</label><input class="input" name="whatsapp" value="${esc(s().whatsapp || '')}"><span class="hint">Aparece en el catálogo en línea y en la tarjeta del cliente.</span></div>
          <div class="field"><label>Instagram</label><input class="input" name="instagram" value="${esc(s().instagram)}" placeholder="@tulicoreria"></div>
          <div class="field"><label>Correo</label><input class="input" name="email" value="${esc(s().email || '')}"></div>
          <div class="field full"><label>Dirección</label><input class="input" name="address" value="${esc(s().address)}"></div>
          <div class="field full"><label>Horario de atención</label><input class="input" name="schedule" value="${esc(s().schedule || '')}" placeholder="Ej.: Lunes a jueves 10:00 a 22:00 · Viernes y sábado hasta medianoche"></div>
        </div>
        <div class="section-title">${icon('grid')} Categorías de productos</div>
        <textarea class="textarea" name="categories" style="min-height:90px">${esc((s().categories || CATEGORIES).join('\n'))}</textarea><span class="hint">Una por línea.</span>
        ${save()}
      </form>
      <div class="card mt-lg between row-wrap"><div class="row" style="gap:12px"><span class="flag">${flagImg(loc().code, 30)}</span><div><div class="bold">País: ${esc(loc().name)} · ${esc(loc().curName)} (${esc(loc().sym)})</div><div class="small muted">Moneda, formas de pago y prefijo de WhatsApp.</div></div></div><button class="btn btn-secondary" id="s-rate">${icon('globe')} Cambiar país</button></div>
      <div class="card mt-lg between row-wrap"><div><div class="bold">Tema de la aplicación</div><div class="small muted">Claro u oscuro, según tu preferencia.</div></div><button class="btn btn-secondary" id="s-theme">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')} Cambiar tema</button></div>`;
      $('#f-biz').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        const patch = {}; for (const k of ['businessName', 'rif', 'liquorLicense', 'licenseExpires', 'phone', 'whatsapp', 'instagram', 'email', 'address', 'schedule']) patch[k] = F[k].value.trim();
        patch.categories = F.categories.value.split('\n').map((x) => x.trim()).filter(Boolean);
        await store.saveSettings(patch);
        if (patch.businessName && patch.businessName !== store.tenant?.name && !store.isDemo) updateTenant(store.tenantId, { name: patch.businessName, updatedAt: nowISO() }).catch(() => {});
        toast('Datos de la licorería guardados');
      };
      $('#s-rate').onclick = async () => { if (!(await requirePin('Cambiar el país y la moneda'))) return; if (await openCountryPicker({ force: true })) location.reload(); };
      $('#s-theme').onclick = (e) => { const n = toggleTheme(); e.currentTarget.innerHTML = `${icon(n === 'dark' ? 'sun' : 'moon')} Cambiar tema`; };
    }

    if (sec === 'moneda') {
      const X = s().fx || {};
      body.innerHTML = `${fxSectionHTML()}
      <form class="card stack mt-lg" id="f-pr">
        <div class="card-title">${icon('percent')} Precio por unidad e impuesto</div>
        <div class="form-grid">
          <div class="field"><label>Recargo al vender por unidad o pack (%)</label><input class="input" name="fractionMarkup" inputmode="decimal" value="${num(s().fractionMarkup ?? 10, 0)}"><span class="hint">Ej.: 10% → una caja de 24 cervezas a ${usd(24)}: la lata suelta a ${usd(1.1)}. Si el producto tiene su propio precio por unidad o por pack, se usa ese.</span></div>
          <div class="field"><label>Impuesto incluido en los precios (%)</label><input class="input" name="iva" inputmode="decimal" value="${num(s().iva || 0, 0)}"><span class="hint">Solo para mostrarlo desglosado en la factura. 0 para no mostrarlo.</span></div>
        </div>
        ${save()}
      </form>`;
      bindFxSection(body, render);
      $('#f-pr').onsubmit = async (e) => { e.preventDefault(); const F = e.target.elements; await store.saveSettings({ fractionMarkup: parseNum(F.fractionMarkup.value), iva: parseNum(F.iva.value) }); toast('Guardado'); };
    }


    if (sec === 'envases') {
      const list = s().containers || [];
      body.innerHTML = `<div class="card stack">
        <div class="between row-wrap"><div><div class="card-title">${icon('rotate')} Envases retornables</div><p class="small muted" style="margin:4px 0 0">Botellas y gaveras que el cliente debe devolver. En cada producto retornable eliges qué envase lleva la unidad y cuál la caja. Al vender, lo que el cliente no trae se cobra como depósito o se le presta.</p></div><button class="btn btn-primary btn-sm" id="ct-add">${icon('plus')} Nuevo envase</button></div>
        ${list.length ? `<div class="list">${list.map((c) => `<div class="list-item" style="${c.active === false ? 'opacity:.5' : ''}"><span class="kpi-icon tone-brand" style="width:38px;height:38px">${icon(/gaver|caja/i.test(c.name) ? 'crate' : 'bottle')}</span><div class="grow"><b>${esc(c.name)}</b><div class="t-sub">depósito ${usd(c.deposit || 0)} · en depósito ${store.emptiesStock(c.id)} · ${store.products.filter((p) => p.containerId === c.id || p.crateId === c.id).length} producto(s)</div></div><button class="btn btn-ghost btn-sm" data-ct="${c.id}">${icon('edit')} Editar</button></div>`).join('')}</div>`
          : emptyState('rotate', 'Sin envases', 'Ej.: “Botella 1/3 retornable · depósito 0,15”, “Gavera · depósito 3”.')}
      </div>`;
      $('#ct-add').onclick = () => containerForm();
      body.querySelectorAll('[data-ct]').forEach((b) => b.onclick = () => containerForm(list.find((x) => x.id === b.dataset.ct)));
    }
    if (sec === 'vendedores') {
      const list = s().sellers || [];
      body.innerHTML = `<div class="card stack">
        <div class="between row-wrap"><div><div class="card-title">${icon('users')} Vendedores / turnos de mostrador</div><p class="small muted" style="margin:4px 0 0">Opcional: elige quién atiende en Vender y verás las ventas por vendedor en Reportes.</p></div><button class="btn btn-primary btn-sm" id="sl-add">${icon('plus')} Agregar</button></div>
        ${list.length ? `<div class="list">${list.map((x) => `<div class="list-item" style="${x.active === false ? 'opacity:.5' : ''}"><span class="avatar">${esc(x.name[0] || '?')}</span><div class="grow"><b>${esc(x.name)}</b><div class="t-sub">${esc(x.role || '')}</div></div><button class="btn btn-ghost btn-sm" data-sl="${x.id}">${x.active === false ? 'Activar' : 'Desactivar'}</button><button class="btn btn-ghost btn-icon btn-sm" data-del="${x.id}">${icon('trash')}</button></div>`).join('')}</div>` : emptyState('users', 'Sin vendedores', 'Si trabajas solo, no necesitas agregar ninguno.')}
      </div>`;
      $('#sl-add').onclick = async () => {
        const m = openModal({ title: 'Nuevo vendedor', size: 'sm', body: `<div class="stack"><div class="field"><label>Nombre</label><input class="input" data-n autofocus></div><div class="field"><label>Cargo</label><input class="input" data-r placeholder="Ej.: cajero, despachador"></div></div>`, footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Agregar</button>` });
        m.el.querySelector('[data-ok]').onclick = async () => { const n = m.el.querySelector('[data-n]').value.trim(); if (!n) return; await store.saveSettings({ sellers: [...list, { id: 's' + shortId(6), name: n, role: m.el.querySelector('[data-r]').value.trim(), active: true }] }); m.close(); toast('Vendedor agregado'); };
      };
      body.querySelectorAll('[data-sl]').forEach((b) => b.onclick = () => store.saveSettings({ sellers: list.map((x) => (x.id === b.dataset.sl ? { ...x, active: x.active === false } : x)) }));
      body.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { if (await confirmDialog({ title: 'Quitar vendedor', message: 'Sus ventas anteriores se conservan.', confirmText: 'Quitar', danger: true })) store.saveSettings({ sellers: list.filter((x) => x.id !== b.dataset.del) }); });
    }

    if (sec === 'pedidos') {
      const S = s().shop || {}; const url = S.slug ? shopUrl(S.slug) : '';
      body.innerHTML = `<form class="card stack" id="f-shop">
        <div class="card-title">${icon('bag')} Catálogo en línea</div>
        <p class="small muted" style="margin:0">Una página de tu licorería donde el cliente elige sus bebidas (por unidad o por caja, frías o al tiempo), ve el precio y te hace el pedido para retirar o delivery. Se actualiza sola con tus precios y existencias. Nunca muestra costos ni datos de clientes.</p>
        ${sw('enabled', S.enabled !== false, 'Catálogo activo', 'Recibe pedidos en Pedidos en línea.')}
        <div class="form-grid">
          <div class="field full"><label>Dirección de tu catálogo</label><div class="input-group"><span class="prefix">/pedido/</span><input class="input" name="slug" value="${esc(S.slug || '')}" style="padding-left:78px"></div>${url ? `<span class="hint"><a href="${url}" target="_blank" rel="noopener">${esc(url)}</a></span>` : ''}</div>
          <div class="field"><label>Costo del delivery</label><input class="input" name="deliveryFee" inputmode="decimal" value="${S.deliveryFee ? num(S.deliveryFee) : ''}" placeholder="0 = gratis"></div>
          <div class="field"><label>Pedido mínimo</label><input class="input" name="minOrder" inputmode="decimal" value="${S.minOrder ? num(S.minOrder) : ''}" placeholder="0 = sin mínimo"></div>
          <div class="field full"><label>Aviso para el cliente</label><input class="input" name="note" value="${esc(S.note || '')}" placeholder="Ej.: Delivery gratis en compras mayores a ${usd(30)} · Te lo llevamos frío"></div>
        </div>
        ${sw('delivery', S.delivery !== false, 'Ofrecer delivery', 'El cliente puede pedir que se lo lleves.')}
        ${sw('showStock', S.showStock !== false, 'Mostrar disponibilidad', 'Disponible / pocas unidades / agotado (nunca la cantidad exacta).')}
        <div class="error-msg" data-err></div>
        ${save()}
      </form>
      ${url ? `<div class="card mt-lg row row-wrap" style="gap:16px;align-items:center"><img id="sh-qr" class="qr-img" alt="QR"><div class="grow"><b>Comparte tu catálogo</b><p class="small muted" style="margin:4px 0 8px">Imprime el QR para el mostrador o compártelo por WhatsApp e Instagram.</p><a class="btn btn-primary btn-sm" href="${url}" target="_blank" rel="noopener">${icon('external')} Abrir catálogo</a></div></div>` : ''}`;
      if (url) qrDataURL(url, 4).then((q) => { const i = $('#sh-qr'); if (i) i.src = q; });
      $('#f-shop').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements; const err = e.target.querySelector('[data-err]'); err.textContent = '';
        const btn = e.target.querySelector('button.btn-primary'); setBusy(btn, true);
        const slug = slugify(F.slug.value) || S.slug;
        try {
          if (!/^[a-z0-9-]{4,60}$/.test(slug)) throw new Error('La dirección debe tener de 4 a 60 letras, números o guiones.');
          if (slug !== S.slug) { const taken = await getShop(slug).catch(() => null); if (taken && taken.tenantId !== store.tenantId) throw new Error('Esa dirección ya la usa otra licorería. Prueba con otra.'); }
          const old = S.slug;
          await store.saveSettings({ shop: { ...S, enabled: F.enabled.checked, slug, deliveryFee: parseNum(F.deliveryFee.value), minOrder: parseNum(F.minOrder.value), note: F.note.value.trim(), delivery: F.delivery.checked, showStock: F.showStock.checked } });
          if (old && slug !== old) { const b = store.batch(); b.delete(store.shopRef(old)); await store.commit(b); }
          resetPublished(); await publishShop({ force: true });
          toast('Catálogo actualizado');
        } catch (ex) { err.textContent = ex.message; }
        setBusy(btn, false);
      };
    }

    if (sec === 'fidelidad') {
      const L = s().loyalty || {};
      body.innerHTML = `<form class="card stack" id="f-loy">
        <div class="card-title">${icon('star')} Programa de puntos</div>
        ${sw('enabled', L.enabled !== false, 'Puntos activos', 'Se suman solos al vender a un cliente registrado.')}
        <div class="form-grid">
          <div class="field"><label>1 punto por cada (${esc(loc().sym)})</label><input class="input" name="per" inputmode="decimal" value="${num(L.per ?? 1)}"></div>
          <div class="field"><label>Valor de cada punto (${esc(loc().sym)})</label><input class="input" name="pointValue" inputmode="decimal" value="${num(L.pointValue ?? 0.05, 3)}"></div>
          <div class="field"><label>Canje desde (puntos)</label><input class="input" name="minRedeem" inputmode="numeric" value="${L.minRedeem ?? 100}"></div>
        </div>
        <div class="box small" id="loy-ex"></div>
        <div class="card-title mt">${icon('heart')} Clientes que dejan de venir y alertas</div>
        <div class="form-grid">
          <div class="field"><label>Avisar cuando un buen cliente no viene en (días)</label><input class="input" name="dormantDays" inputmode="numeric" value="${s().dormantDays ?? 21}"></div>
          <div class="field full"><label>Oferta del mensaje “te extrañamos”</label><input class="input" name="comebackOffer" value="${esc(s().comebackOffer || '')}" placeholder="Ej.: 10% de descuento en tu próxima caja de cerveza"></div>
          <div class="field"><label>Alertar vencimientos con (días)</label><select class="select" name="expiryAlertDays">${[30, 60, 90, 120, 180].map((d) => `<option ${Number(s().expiryAlertDays || 90) === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
        </div>
        ${save()}
      </form>`;
      const ex = () => { const F = $('#f-loy').elements; const per = parseNum(F.per.value) || 1; const pv = parseNum(F.pointValue.value) || 0; $('#loy-ex').innerHTML = `Ejemplo: una compra de ${usd(50)} suma <b>${Math.floor(50 / per)} pts</b>. 100 pts = <b>${usd(100 * pv)}</b> de descuento (${num(pv / per * 100, 1)}% de retorno).`; };
      ['per', 'pointValue'].forEach((k) => $('#f-loy').elements[k].addEventListener('input', ex)); ex();
      $('#f-loy').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        await store.saveSettings({ loyalty: { enabled: F.enabled.checked, per: parseNum(F.per.value) || 1, pointValue: parseNum(F.pointValue.value), minRedeem: Math.round(parseNum(F.minRedeem.value)) }, dormantDays: Math.round(parseNum(F.dormantDays.value)) || 21, comebackOffer: F.comebackOffer.value.trim(), expiryAlertDays: Number(F.expiryAlertDays.value) || 90 });
        toast('Guardado');
      };
    }

    if (sec === 'recibos') {
      body.innerHTML = `<form class="card stack" id="f-docs">
        <div class="form-grid">
          <div class="field"><label>Título del documento</label><input class="input" name="docTitle" value="${esc(s().docTitle || 'FACTURA')}"><span class="hint">Ej.: FACTURA, NOTA DE ENTREGA, TICKET.</span></div>
          <div class="field"><label>Formato</label><select class="select" name="receiptFormat">${[['80mm', 'Ticket 80 mm'], ['58mm', 'Ticket 58 mm'], ['carta', 'Hoja carta']].map(([v, l]) => `<option value="${v}" ${s().receiptFormat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label>Prefijo de numeración</label><input class="input" name="invoicePrefix" value="${esc(s().invoicePrefix || 'F')}" maxlength="4"></div>
          <div class="field full"><label>Mensaje al pie</label><input class="input" name="receiptFooter" value="${esc(s().receiptFooter || '')}" placeholder="Ej.: ¡Gracias por su compra! Disfrute con responsabilidad."></div>
        </div>
        ${save()}</form>`;
      $('#f-docs').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        await store.saveSettings({ docTitle: F.docTitle.value.trim().toUpperCase() || 'FACTURA', receiptFormat: F.receiptFormat.value, invoicePrefix: F.invoicePrefix.value.trim().toUpperCase() || 'F', receiptFooter: F.receiptFooter.value.trim() });
        toast('Guardado');
      };
    }

    if (sec === 'seguridad') {
      body.innerHTML = `<div class="grid-2">
        <form class="card stack" id="f-pin"><div class="card-title">${icon('lock')} PIN de administrador</div><p class="small muted" style="margin:0">Protege reportes, anulaciones, cambios de precio y descuentos, salidas y ajustes de inventario, gastos, cierre de caja y salir de la consulta de precios.</p>
          <div class="field"><label>Nuevo PIN (4 a 12 dígitos)</label><input class="input" name="pin" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
          <div class="field"><label>Repetir PIN</label><input class="input" name="pin2" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
          <button class="btn btn-primary">${icon('check')} Cambiar PIN</button></form>
        ${session.user?.isAnonymous ? `<div class="card stack"><div class="card-title">${icon('shield')} Contraseña</div><p class="muted" style="margin:0">En la demo no hay contraseña. Contrata SanoLicores para tener tu propia cuenta.</p><a class="btn btn-whatsapp" href="${salesWa()}" target="_blank" rel="noopener">${icon('whatsapp')} ${SALES_PHONE_FMT}</a></div>`
          : `<form class="card stack" id="f-pass"><div class="card-title">${icon('shield')} Contraseña de acceso</div>
          <div class="field"><label>Contraseña actual</label><input class="input" name="cur" type="password" autocomplete="current-password"></div>
          <div class="field"><label>Nueva contraseña (mínimo 8)</label><input class="input" name="next" type="password" autocomplete="new-password"></div>
          <div class="error-msg" data-err></div>
          <button class="btn btn-primary">${icon('check')} Cambiar contraseña</button></form>`}
      </div>
      <div class="box small mt-lg">${icon('shieldCheck')} Los datos de tus clientes (teléfonos, fiado, envases y compras) solo son visibles con tu usuario. La tarjeta pública muestra solo nombre corto, puntos, fiado y envases prestados; el catálogo en línea solo productos, precio y disponibilidad.</div>`;
      $('#f-pin').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        if (store.isDemo) { toast('En la demo el PIN siempre es 1234.', 'info'); return; }
        if (!/^\d{4,12}$/.test(F.pin.value)) { toast('El PIN debe tener de 4 a 12 dígitos', 'warning'); return; }
        if (F.pin.value !== F.pin2.value) { toast('Los PIN no coinciden', 'warning'); return; }
        if (store.hasPin() && !(await requirePin('Cambiar el PIN', { always: true }))) return;
        await store.setPin(F.pin.value); e.target.reset(); toast('PIN actualizado');
      };
      const fp = $('#f-pass');
      if (fp) fp.onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements; const err = fp.querySelector('[data-err]'); err.textContent = '';
        if (F.next.value.length < 8) { err.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.'; return; }
        const btn = fp.querySelector('button'); setBusy(btn, true);
        try { await changePassword(F.cur.value, F.next.value); e.target.reset(); toast('Contraseña actualizada'); }
        catch (ex) { err.textContent = authErrorMessage(ex); }
        setBusy(btn, false);
      };
    }

    if (sec === 'apps') {
      body.innerHTML = `<div class="grid-2">
        <div class="card stack"><div class="card-title">${icon('install')} Instalar la app</div>
          <p class="small muted" style="margin:0">Instala SanoLicores en la computadora del mostrador, en tu teléfono y en una tablet para la consulta de precios. Todo conectado en tiempo real.</p>
          ${isStandalone() ? `<div class="pay-status ok"><span>${icon('check')} Estás usando la app instalada</span><span></span></div>` : `<button class="btn btn-primary btn-lg" data-install>${icon('install')} Instalar en este equipo</button>`}
          <div class="list">
            <div class="list-item"><span class="kpi-icon tone-success" style="width:34px;height:34px">${icon('phone')}</span><div class="grow"><b>Android</b><div class="t-sub">Chrome › menú ⋮ › Instalar app</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-info" style="width:34px;height:34px">${icon('laptop')}</span><div class="grow"><b>Computadora</b><div class="t-sub">Chrome o Edge › ícono de instalar en la barra de direcciones. Funciona con lector de código de barras USB.</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-violet" style="width:34px;height:34px">${icon('phone')}</span><div class="grow"><b>iPhone / iPad</b><div class="t-sub">Safari › Compartir › Agregar a inicio</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-warning" style="width:34px;height:34px">${icon('tablet')}</span><div class="grow"><b>Consulta de precios</b><div class="t-sub">Una tablet con lector junto a las neveras: menú › Consulta de precios.</div></div></div>
          </div></div>
        <div class="card stack"><div class="card-title">${icon('download')} Respaldo de datos</div>
          <p class="small muted" style="margin:0">Descarga una copia de clientes, productos y lotes, ventas, envases, compras, proveedores, caja y configuración (archivo JSON). Protegido con PIN.</p>
          <button class="btn btn-secondary" id="s-backup">${icon('download')} Descargar respaldo completo</button>
          <div class="divider"></div>
          <div class="card-title">${icon('whatsapp')} Soporte</div>
          <p class="small muted" style="margin:0">¿Dudas o sugerencias? Escríbenos.</p>
          <a class="btn btn-whatsapp" href="${salesWa('Hola, necesito soporte con SanoLicores.')}" target="_blank" rel="noopener">${icon('whatsapp')} ${SALES_PHONE_FMT}</a></div>
      </div>`;
      bindInstallButtons(body);
      $('#s-backup').onclick = async (e) => {
        const btn = e.currentTarget;
        if (!(await requirePin('Descargar el respaldo'))) return;
        setBusy(btn, true, 'Preparando…');
        try {
          const { getDocs } = await import('../firebase.js');
          const all = async (n) => (await getDocs(store.col(n))).docs.map((d) => ({ id: d.id, ...d.data() }));
          const names = ['sales', 'empties_logs', 'purchases', 'suppliers', 'cash_shifts', 'cash_movements', 'inventory_logs'];
          const got = await Promise.all(names.map(all));
          const data = { app: 'SanoLicores', exportedAt: nowISO(), business: store.businessName, settings: store.settings, clients: store.clients, products: store.products, empties: store.empties };
          names.forEach((n, i) => { data[n] = got[i]; });
          download(`respaldo-${slugify(store.businessName || 'sanolicores')}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
          toast('Respaldo descargado');
        } catch (ex) { toast('No se pudo generar el respaldo: ' + ex.message, 'danger'); }
        setBusy(btn, false);
      };
    }
  }


  function containerForm(c = null) {
    const x = c || { id: '', name: '', short: '', deposit: 0, active: true };
    const m = openModal({
      title: c ? 'Editar envase' : 'Nuevo envase', size: 'sm',
      body: `<form class="form-grid" data-f>
        <div class="field full"><label>Nombre *</label><input class="input" name="name" value="${esc(x.name)}" autofocus placeholder="Ej.: Botella 1/3 retornable"></div>
        <div class="field"><label>Nombre corto</label><input class="input" name="short" value="${esc(x.short || '')}" placeholder="Ej.: Botella 1/3"></div>
        <div class="field"><label>Depósito por envase</label><input class="input" name="deposit" inputmode="decimal" value="${num(x.deposit || 0)}"><span class="hint">Lo que se cobra si el cliente no trae el vacío.</span></div>
        <label class="check full"><input type="checkbox" name="active" ${x.active !== false ? 'checked' : ''}> <span>Activo</span></label>
      </form>`,
      footer: `${c ? `<button class="btn btn-ghost text-danger" data-del style="margin-right:auto">${icon('trash')} Eliminar</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`
    });
    const F = m.el.querySelector('[data-f]').elements;
    m.el.querySelector('[data-ok]').onclick = async () => {
      if (!F.name.value.trim()) { toast('Escribe el nombre', 'warning'); return; }
      const item = { ...x, id: x.id || 'e' + shortId(5), name: F.name.value.trim(), short: F.short.value.trim() || F.name.value.trim(), deposit: Math.max(0, round2(parseNum(F.deposit.value))), active: F.active.checked };
      const list = s().containers || store.containers;
      await store.saveSettings({ containers: c ? list.map((y) => (y.id === c.id ? item : y)) : [...list, item] });
      m.close(); toast('Envase guardado');
    };
    m.el.querySelector('[data-del]')?.addEventListener('click', async () => {
      const used = store.products.filter((p) => p.containerId === c.id || p.crateId === c.id).length + store.emptyDebtors.filter((cl) => Number(cl.empties?.[c.id]) > 0).length;
      if (used) { toast('Ese envase está en uso (productos o clientes que lo deben). Desactívalo en lugar de eliminarlo.', 'warning', 5000); return; }
      if (!(await confirmDialog({ title: 'Eliminar envase', message: 'Se quita de la lista.', confirmText: 'Eliminar', danger: true }))) return;
      await store.saveSettings({ containers: (s().containers || store.containers).filter((y) => y.id !== c.id) }); m.close();
    });
  }
  el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { sec = b.dataset.s; render(); });
  render();
  return store.on('*', (evt) => { if ((evt === 'settings' && ['envases', 'vendedores'].includes(sec)) || (evt === 'empties' && sec === 'envases')) render(); });
}
