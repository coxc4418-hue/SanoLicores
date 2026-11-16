// SanoLicores — Tarjeta digital pública del cliente: /tarjeta/CODIGO (sin sesión)
import { getCard } from '../store.js';
import { esc, fmtDate, waLink, applyLocale, usd } from '../utils.js';
import { icon } from '../icons.js';
import { qrDataURL } from '../shared.js';

export async function mount(root) {
  document.title = 'Mi tarjeta · SanoLicores';
  const code = (/\/tarjeta\/([A-Z0-9]+)/i.exec(location.pathname)?.[1] || '').toUpperCase();
  root.innerHTML = '<div class="pcard-page"><div class="empty"><div class="spinner"></div></div></div>';
  let c = null;
  try { c = code ? await getCard(code) : null; } catch (e) { console.error(e); }
  if (!c) {
    root.innerHTML = `<div class="pcard-page"><div class="mcard mcard-err"><img src="/assets/logo.svg" alt="" width="64"><h1>Tarjeta no encontrada</h1><p>El código <b>${esc(code || '—')}</b> no existe o fue renovado. Pide tu tarjeta actualizada en tu licorería.</p><a class="btn btn-primary" href="/">Ir a SanoLicores</a></div></div>`;
    return;
  }
  try { applyLocale(c.country || 'VE'); } catch (_) {}
  const qr = await qrDataURL(location.origin + '/tarjeta/' + code, 6);
  const emp = Array.isArray(c.empties) ? c.empties : [];
  const shop = c.shopSlug ? `/pedido/${encodeURIComponent(c.shopSlug)}` : '';
  const wa = c.shopPhone ? waLink(c.shopPhone, `Hola, soy ${c.name} (${c.number}). Quiero hacer un pedido.`) : '';
  const pts = c.points;

  root.innerHTML = `<div class="pcard-page">
    <div class="mcard">
      <div class="mcard-top"><img src="/assets/logo.svg" alt=""><div class="grow"><b>${esc(c.shop || 'Mi licorería')}</b><small>Tarjeta de cliente</small></div>${c.active ? (c.mayor ? `<span class="mcard-badge tone-violet">${icon('crate')} Cliente al mayor</span>` : '') : '<span class="mcard-badge tone-neutral">Inactiva</span>'}</div>
      <div class="mcard-name">${esc(c.name)}</div>
      <div class="mcard-num">${esc(c.number)} · ${esc(code)}</div>
      ${pts != null ? `<div class="mcard-points"><div><small>Tus puntos</small><b>${pts}</b></div>${c.pointValue ? `<div><small>Equivalen a</small><b>${usd(pts * c.pointValue)}</b></div>` : ''}<span>${icon('star')}</span></div>` : ''}
      ${emp.length || c.balance > 0.009 ? `<div class="mcard-meds"><b>${icon('rotate')} Tu cuenta</b>${c.balance > 0.009 ? `<div class="mcard-med due"><div class="grow"><b>Fiado pendiente</b><small>Puedes abonar cuando pases</small></div><span>${usd(c.balance)}</span></div>` : ''}${emp.map((x) => `<div class="mcard-med"><div class="grow"><b>${esc(x.name)}</b><small>Envases prestados: tráelos en tu próxima compra</small></div><span>${x.n}</span></div>`).join('')}</div>` : ''}
      <div class="mcard-stats"><div><b>${c.visits || 0}</b><small>compras</small></div><div><b>${c.lastVisitAt ? fmtDate(c.lastVisitAt.slice(0, 10)) : '—'}</b><small>última compra</small></div></div>
      <div class="mcard-qr"><img src="${qr}" alt="QR de la tarjeta"></div>
      <p class="mcard-hint">Muestra este código al pagar para sumar tus puntos.</p>
      <div class="mcard-foot">${shop ? `<a class="btn btn-primary btn-sm" href="${shop}">${icon('bag')} Pedir en línea</a>` : ''}${wa ? `<a class="btn btn-whatsapp btn-sm" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp')} Pedir por WhatsApp</a>` : ''}${c.instagram ? `<a class="btn btn-secondary btn-sm" href="https://instagram.com/${esc(c.instagram.replace('@', ''))}" target="_blank" rel="noopener">${esc(c.instagram)}</a>` : ''}${c.shopAddress ? `<small>${icon('pin')} ${esc(c.shopAddress)}</small>` : ''}</div>
    </div>
    <p class="pcard-by">Hecho con <b>SanoLicores</b> · Agrega esta página a tu pantalla de inicio para tenerla siempre a mano.</p>
  </div>`;
}
