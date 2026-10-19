// Gemeinsame Hilfsfunktionen für alle Seiten.

const SYMBOLE = ['▲', '◆', '●', '■'];
const BUCHSTABEN = ['A', 'B', 'C', 'D'];

// Schlichtes Flammen-Symbol im roten Kreis (eigene Grafik, kein Wappen).
const LOGO_SVG = `
<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="32" r="30" fill="#fff"/>
  <circle cx="32" cy="32" r="26" fill="#c8102e"/>
  <path fill="#fff" d="M33 10c2 8-6 12-6 20 0 3 2 5 4 6-1-4 2-7 4-9 0 5 5 7 5 12 0 5-4 9-9 9-6 0-11-5-11-11 0-9 8-14 13-27z"/>
  <path fill="#ffd34d" d="M32 34c1 3-2 4-2 7 0 2 1 3 3 3 2 0 4-2 4-4 0-3-3-4-5-6z"/>
</svg>`;

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function esc(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function zeige(el, sichtbar = true) {
  (typeof el === 'string' ? $(el) : el).classList.toggle('versteckt', !sichtbar);
}

// Nur eine "Ansicht" (section[data-ansicht]) gleichzeitig sichtbar
function ansicht(name) {
  $$('[data-ansicht]').forEach(el => zeige(el, el.dataset.ansicht === name));
  window.scrollTo(0, 0);
}

function speicher(art) {
  // localStorage kann in privaten Fenstern fehlen – dann eben ohne Merken
  const s = art === 'session' ? window.sessionStorage : window.localStorage;
  return {
    get(k) { try { return JSON.parse(s.getItem(k)); } catch { return null; } },
    set(k, v) { try { s.setItem(k, JSON.stringify(v)); } catch { /* egal */ } },
    del(k) { try { s.removeItem(k); } catch { /* egal */ } },
  };
}

// Admin-PIN gilt für die Browser-Sitzung
const adminSpeicher = speicher('session');
function adminPin() { return adminSpeicher.get('adminPin'); }

async function api(pfad, { methode = 'GET', daten, roh = false } = {}) {
  const res = await fetch('/api' + pfad, {
    method: methode,
    headers: {
      'x-admin-pin': adminPin() || '',
      ...(daten !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: daten !== undefined ? JSON.stringify(daten) : undefined,
  });
  if (res.status === 401 && pfad !== '/login') {
    adminSpeicher.del('adminPin');
    location.href = '/admin.html';
    throw new Error('Nicht angemeldet');
  }
  if (!res.ok) {
    let msg = 'Fehler ' + res.status;
    try { msg = (await res.json()).fehler || msg; } catch { /* kein JSON */ }
    throw new Error(msg);
  }
  return roh ? res : res.json();
}

async function herunterladen(pfad) {
  const res = await api(pfad, { roh: true });
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : 'download';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function datum(iso) {
  return iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

document.addEventListener('DOMContentLoaded', () => {
  $$('[data-logo]').forEach(el => { el.innerHTML = LOGO_SVG; });
});
