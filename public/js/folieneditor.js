// Folien-Editor für Info-Seiten: Elemente per Maus verschieben, Größe ändern, Texte direkt schreiben.
// Aufruf: oeffneFolienEditor({ info, titel, vorschlag: { frage, antwort }, fertig(info), abbrechen() })

let fe = null; // { info, auswahl, start, textNode, fertig, abbrechen, anfang }
const feFlaeche = $('#fe-flaeche');
const GRIFFE = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const EINRASTEN = 1; // Prozent

function feId() {
  return Math.random().toString(36).slice(2, 10);
}

function feElement(id) {
  return fe.info.elemente.find(e => e.id === id);
}

function feNode(id) {
  return feFlaeche.querySelector(`.folie-el[data-id="${CSS.escape(id)}"]`);
}

function feGeaendert() {
  return JSON.stringify(fe.info) !== fe.anfang;
}

// ---------- Öffnen / Schließen ----------

function oeffneFolienEditor({ info, titel, vorschlag, fertig, abbrechen }) {
  const kopie = info && info.elemente ? JSON.parse(JSON.stringify(info)) : leereInfo();
  // Neue, leere Seite mit sinnvollem Startinhalt: richtige Antwort als Titel
  if (!kopie.elemente.length && vorschlag) {
    kopie.elemente.push(
      { id: feId(), typ: 'text', x: 5, y: 6, w: 90, h: 14, z: 1, stil: 'titel', groesse: 'xl', ausrichtung: 'links', text: vorschlag.antwort },
      { id: feId(), typ: 'text', x: 5, y: 24, w: 55, h: 40, z: 2, stil: 'text', groesse: 'm', ausrichtung: 'links', text: '' },
    );
  }
  fe = { info: kopie, auswahl: null, start: null, textNode: null, fertig, abbrechen, anfang: JSON.stringify(kopie) };
  $('#fe-titel').textContent = titel || 'Info-Seite';
  $('#fe-hintergrund').innerHTML = Object.entries(FOLIE_HINTERGRUENDE)
    .map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#fe-hintergrund').value = kopie.hintergrund || 'weiss';
  $('#fe-upload').textContent = '';
  ansicht('folie');
  feZeichnen();
}

function feSchliessen() {
  feTextEnde();
  stoppeFolie(feFlaeche);
  fe = null;
}

$('#fe-fertig').addEventListener('click', () => {
  feTextEnde();
  const info = JSON.parse(JSON.stringify(fe.info));
  const fertig = fe.fertig;
  feSchliessen();
  fertig(info);
});

$('#fe-abbrechen').addEventListener('click', () => {
  feTextEnde();
  if (feGeaendert() && !confirm('Änderungen an der Info-Seite verwerfen?')) return;
  const abbrechen = fe.abbrechen;
  feSchliessen();
  abbrechen();
});

$('#fe-hintergrund').addEventListener('change', e => {
  fe.info.hintergrund = e.target.value;
  feZeichnen();
});

// ---------- Zeichnen ----------

function feZeichnen() {
  zeichneFolie(feFlaeche, fe.info, { bearbeiten: true });
  feFlaeche.classList.add('folien-flaeche');
  feMarkiere();
}

function feMarkiere() {
  feFlaeche.querySelectorAll('.gewaehlt').forEach(n => n.classList.remove('gewaehlt'));
  feFlaeche.querySelectorAll('.griff').forEach(n => n.remove());
  const node = fe.auswahl && feNode(fe.auswahl);
  if (node) {
    node.classList.add('gewaehlt');
    for (const g of GRIFFE) {
      const d = document.createElement('div');
      d.className = 'griff g-' + g;
      d.dataset.griff = g;
      node.appendChild(d);
    }
  }
  feEigenschaften();
}

function feWaehle(id) {
  if (fe.auswahl === id) return;
  feTextEnde();
  fe.auswahl = id;
  feMarkiere();
}

// Ein Element neu aufbauen (nach Stil-/Inhaltsänderung), Auswahl bleibt
function feErsetze(e) {
  const alt = feNode(e.id);
  if (alt) alt.replaceWith(baueFolienElement(e, { bearbeiten: true }));
  feMarkiere();
}

function feNeuNummerieren() {
  [...fe.info.elemente].sort((a, b) => a.z - b.z).forEach((e, i) => {
    e.z = i + 1;
    const n = feNode(e.id);
    if (n) n.style.zIndex = e.z;
  });
}

// ---------- Elemente hinzufügen ----------

const TEXT_VORLAGEN = {
  titel: { x: 5, y: 6, w: 90, h: 14, groesse: 'xl', ausrichtung: 'links', text: 'Titel' },
  text: { x: 5, y: 24, w: 55, h: 40, groesse: 'm', ausrichtung: 'links', text: 'Text' },
  hinweis: { x: 60, y: 24, w: 35, h: 20, groesse: 'm', ausrichtung: 'mitte', text: 'Wichtig!' },
  info: { x: 60, y: 50, w: 35, h: 26, groesse: 's', ausrichtung: 'links', text: 'Info' },
};

function feHinzufuegen(e) {
  // Nicht exakt auf ein vorhandenes Element legen
  while (fe.info.elemente.some(x => Math.abs(x.x - e.x) < 0.5 && Math.abs(x.y - e.y) < 0.5)) {
    e.x = Math.min(e.x + 3, 100 - e.w);
    e.y = Math.min(e.y + 3, 100 - e.h);
  }
  e.id = feId();
  e.z = Math.max(0, ...fe.info.elemente.map(x => x.z || 0)) + 1;
  fe.info.elemente.push(e);
  fe.auswahl = e.id;
  feZeichnen();
  return e;
}

$$('[data-neu]').forEach(b => b.addEventListener('click', () => {
  const stil = b.dataset.neu;
  const e = feHinzufuegen({ typ: 'text', stil, ...TEXT_VORLAGEN[stil] });
  feTextStart(e.id);
}));

// Größe so wählen, dass das Seitenverhältnis des Mediums auf der 16:9-Folie stimmt
function feMediumGroesse(breite, hoehe, zielW = 40) {
  const verh = breite && hoehe ? hoehe / breite : 9 / 16;
  let w = zielW;
  let h = w * (16 / 9) * verh;
  if (h > 80) { w = w * 80 / h; h = 80; }
  return { w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 };
}

function feMasse(src, typ) {
  return new Promise(resolve => {
    if (typ === 'video') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve([v.videoWidth, v.videoHeight]);
      v.onerror = () => resolve([16, 9]);
      v.src = src;
    } else {
      const img = new Image();
      img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
      img.onerror = () => resolve([4, 3]);
      img.src = src;
    }
  });
}

// Upload mit Fortschrittsanzeige (fetch kennt keinen Upload-Fortschritt)
function feHochladen(datei) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/medien');
    xhr.setRequestHeader('x-admin-pin', adminPin() || '');
    xhr.setRequestHeader('content-type', datei.type || 'application/octet-stream');
    xhr.upload.onprogress = ev => {
      if (ev.lengthComputable) $('#fe-upload').textContent = `Lade hoch … ${Math.round(100 * ev.loaded / ev.total)} %`;
    };
    xhr.onload = () => {
      let d = {};
      try { d = JSON.parse(xhr.responseText); } catch { /* kein JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(d);
      else reject(new Error(d.fehler || 'Upload fehlgeschlagen (' + xhr.status + ')'));
    };
    xhr.onerror = () => reject(new Error('Upload fehlgeschlagen – Verbindung zum Server?'));
    xhr.send(datei);
  });
}

async function feMediumEinfuegen(datei, pos) {
  if (!fe) return;
  $('#fe-upload').textContent = 'Lade hoch …';
  try {
    const { src, typ } = await feHochladen(datei);
    const [bw, bh] = await feMasse(src, typ);
    const { w, h } = feMediumGroesse(bw, bh, typ === 'video' ? 50 : 40);
    const x = pos ? Math.min(Math.max(pos.x - w / 2, 0), 100 - w) : (100 - w) / 2;
    const y = pos ? Math.min(Math.max(pos.y - h / 2, 0), 100 - h) : (100 - h) / 2 + 5;
    feHinzufuegen(typ === 'video' ? { typ: 'video', src, youtube: null, x, y, w, h } : { typ: 'bild', src, x, y, w, h });
    $('#fe-upload').textContent = '';
  } catch (err) {
    $('#fe-upload').textContent = '';
    alert(err.message);
  }
}

let feDateiArt = 'bild';
$('#fe-bild').addEventListener('click', () => { feDateiArt = 'bild'; $('#fe-datei').accept = 'image/png,image/jpeg,image/gif,image/webp'; $('#fe-datei').click(); });
$('#fe-video').addEventListener('click', () => { feDateiArt = 'video'; $('#fe-datei').accept = 'video/mp4,video/webm'; $('#fe-datei').click(); });
$('#fe-datei').addEventListener('change', e => {
  const d = e.target.files[0];
  e.target.value = '';
  if (d) feMediumEinfuegen(d);
});

$('#fe-youtube').addEventListener('click', () => {
  const link = prompt('YouTube-Link einfügen (z. B. https://www.youtube.com/watch?v=…):');
  if (link == null) return;
  const id = youtubeId(link);
  if (!id) return alert('Das ist kein gültiger YouTube-Link.');
  feHinzufuegen({ typ: 'video', src: null, youtube: id, x: 25, y: 22, w: 50, h: 50 });
});

// Dateien direkt auf die Folie ziehen
feFlaeche.addEventListener('dragover', e => { if (fe) e.preventDefault(); });
feFlaeche.addEventListener('drop', e => {
  if (!fe) return;
  e.preventDefault();
  const datei = e.dataTransfer.files[0];
  if (!datei) return;
  const r = feFlaeche.getBoundingClientRect();
  feMediumEinfuegen(datei, { x: 100 * (e.clientX - r.left) / r.width, y: 100 * (e.clientY - r.top) / r.height });
});

// Bild aus der Zwischenablage einfügen (Strg+V)
document.addEventListener('paste', e => {
  if (!fe || fe.textNode || e.target.closest('input, textarea')) return;
  const datei = [...(e.clipboardData.files || [])].find(f => /^image\//.test(f.type));
  if (datei) {
    e.preventDefault();
    feMediumEinfuegen(datei);
  }
});

// ---------- Verschieben und Größe ändern ----------

const runde = v => Math.round(v * 10) / 10;

function feHilfslinien(xs, ys) {
  feFlaeche.querySelectorAll('.hilfslinie').forEach(n => n.remove());
  for (const x of xs) {
    const d = document.createElement('div');
    d.className = 'hilfslinie v';
    d.style.left = x + '%';
    feFlaeche.appendChild(d);
  }
  for (const y of ys) {
    const d = document.createElement('div');
    d.className = 'hilfslinie h';
    d.style.top = y + '%';
    feFlaeche.appendChild(d);
  }
}

// Sucht den nächsten Einrastpunkt (Folienrand/-mitte, Kanten/Mitten anderer Elemente)
function feEinrasten(werte, ziele) {
  let best = null;
  for (const w of werte) {
    for (const z of ziele) {
      const d = z - w;
      if (Math.abs(d) <= EINRASTEN && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, linie: z };
    }
  }
  return best;
}

feFlaeche.addEventListener('pointerdown', ev => {
  if (!fe || ev.button !== 0) return;
  if (fe.textNode && fe.textNode.contains(ev.target)) return; // Text wird gerade geschrieben
  const node = ev.target.closest('.folie-el');
  if (!node) { feWaehle(null); return; }
  const griff = ev.target.closest('.griff');
  feWaehle(node.dataset.id);
  const e = feElement(node.dataset.id);
  fe.start = {
    px: ev.clientX, py: ev.clientY,
    x: e.x, y: e.y, w: e.w, h: e.h,
    modus: griff ? griff.dataset.griff : 'verschieben',
    rect: feFlaeche.getBoundingClientRect(),
    e, node: feNode(e.id),
    andere: fe.info.elemente.filter(x => x.id !== e.id),
  };
  feFlaeche.setPointerCapture(ev.pointerId);
  ev.preventDefault();
});

feFlaeche.addEventListener('pointermove', ev => {
  const s = fe && fe.start;
  if (!s) return;
  const dx = 100 * (ev.clientX - s.px) / s.rect.width;
  const dy = 100 * (ev.clientY - s.py) / s.rect.height;
  const e = s.e;
  const zieleX = [0, 50, 100, ...s.andere.flatMap(a => [a.x, a.x + a.w / 2, a.x + a.w])];
  const zieleY = [0, 50, 100, ...s.andere.flatMap(a => [a.y, a.y + a.h / 2, a.y + a.h])];
  const linienX = [];
  const linienY = [];

  if (s.modus === 'verschieben') {
    let x = s.x + dx;
    let y = s.y + dy;
    if (!ev.altKey) {
      const sx = feEinrasten([x, x + s.w / 2, x + s.w], zieleX);
      const sy = feEinrasten([y, y + s.h / 2, y + s.h], zieleY);
      if (sx) { x += sx.d; linienX.push(sx.linie); }
      if (sy) { y += sy.d; linienY.push(sy.linie); }
    }
    e.x = runde(Math.min(Math.max(x, -s.w + 3), 97));
    e.y = runde(Math.min(Math.max(y, -s.h + 3), 97));
  } else {
    const m = s.modus;
    let { x, y, w, h } = s;
    if (m.includes('e')) w = s.w + dx;
    if (m.includes('w')) { w = s.w - dx; x = s.x + dx; }
    if (m.includes('s')) h = s.h + dy;
    if (m.includes('n')) { h = s.h - dy; y = s.y + dy; }
    // Bilder/Videos an den Ecken im Seitenverhältnis ändern (Shift = frei)
    if (m.length === 2 && e.typ !== 'text' && !ev.shiftKey) {
      const verh = s.h / s.w;
      h = w * verh;
      if (m.includes('n')) y = s.y + s.h - h;
    }
    if (!ev.altKey) {
      if (m.includes('e')) { const r = feEinrasten([x + w], zieleX); if (r) { w += r.d; linienX.push(r.linie); } }
      if (m.includes('w')) { const r = feEinrasten([x], zieleX); if (r) { x += r.d; w -= r.d; linienX.push(r.linie); } }
      if (m.includes('s') && m.length === 1) { const r = feEinrasten([y + h], zieleY); if (r) { h += r.d; linienY.push(r.linie); } }
      if (m.includes('n') && m.length === 1) { const r = feEinrasten([y], zieleY); if (r) { y += r.d; h -= r.d; linienY.push(r.linie); } }
    }
    if (w < 3) { if (m.includes('w')) x -= 3 - w; w = 3; }
    if (h < 3) { if (m.includes('n')) y -= 3 - h; h = 3; }
    e.x = runde(x); e.y = runde(y); e.w = runde(Math.min(w, 100)); e.h = runde(Math.min(h, 100));
  }
  positioniereElement(s.node, e);
  feHilfslinien(linienX, linienY);
});

function feZiehenEnde() {
  if (!fe || !fe.start) return;
  fe.start = null;
  feHilfslinien([], []);
  feEigenschaften();
}
feFlaeche.addEventListener('pointerup', feZiehenEnde);
feFlaeche.addEventListener('pointercancel', feZiehenEnde);

// ---------- Text direkt auf der Folie schreiben ----------

function feTextStart(id) {
  const e = feElement(id);
  if (!e || e.typ !== 'text') return;
  feWaehle(id);
  const inhalt = feNode(id).querySelector('.folie-inhalt');
  inhalt.contentEditable = 'true';
  fe.textNode = inhalt;
  inhalt.focus();
  const r = document.createRange();
  r.selectNodeContents(inhalt);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

function feTextEnde() {
  if (!fe || !fe.textNode) return;
  const inhalt = fe.textNode;
  fe.textNode = null;
  const node = inhalt.closest('.folie-el');
  const e = node && feElement(node.dataset.id);
  if (e) e.text = inhalt.innerText.replace(/\n$/, '').slice(0, 2000);
  inhalt.contentEditable = 'false';
  if (e) feErsetze(e);
}

feFlaeche.addEventListener('dblclick', ev => {
  // Wegen setPointerCapture ist ev.target die Fläche – das Element über die Position bestimmen
  const unten = document.elementFromPoint(ev.clientX, ev.clientY);
  const node = unten && unten.closest('.folie-text');
  if (node && fe) feTextStart(node.dataset.id);
});

// Nur reinen Text einfügen (keine Formatierungen aus Word & Co.)
feFlaeche.addEventListener('paste', ev => {
  if (!fe || !fe.textNode || !fe.textNode.contains(ev.target)) return;
  ev.preventDefault();
  ev.stopPropagation();
  document.execCommand('insertText', false, ev.clipboardData.getData('text/plain'));
});

feFlaeche.addEventListener('focusout', ev => {
  if (fe && fe.textNode && ev.target === fe.textNode) feTextEnde();
});

// ---------- Tastatur ----------

document.addEventListener('keydown', ev => {
  if (!fe || $('[data-ansicht="folie"]').classList.contains('versteckt')) return;
  if (fe.textNode) {
    if (ev.key === 'Escape') { ev.preventDefault(); feTextEnde(); }
    return;
  }
  if (ev.target.closest('input, select, textarea')) return;
  const e = fe.auswahl && feElement(fe.auswahl);
  if (ev.key === 'Escape') return feWaehle(null);
  if (!e) return;
  const schritt = ev.shiftKey ? 5 : 0.5;
  const pfeile = { ArrowLeft: [-schritt, 0], ArrowRight: [schritt, 0], ArrowUp: [0, -schritt], ArrowDown: [0, schritt] };
  if (pfeile[ev.key]) {
    ev.preventDefault();
    e.x = runde(e.x + pfeile[ev.key][0]);
    e.y = runde(e.y + pfeile[ev.key][1]);
    positioniereElement(feNode(e.id), e);
    feEigenschaften();
  } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
    ev.preventDefault();
    feLoeschen(e);
  } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') {
    ev.preventDefault();
    feDuplizieren(e);
  } else if (ev.key === 'Enter' && e.typ === 'text') {
    ev.preventDefault();
    feTextStart(e.id);
  }
});

function feLoeschen(e) {
  fe.info.elemente = fe.info.elemente.filter(x => x !== e);
  fe.auswahl = null;
  feZeichnen();
}

function feDuplizieren(e) {
  const kopie = JSON.parse(JSON.stringify(e));
  kopie.x = Math.min(e.x + 3, 97);
  kopie.y = Math.min(e.y + 3, 97);
  feHinzufuegen(kopie);
}

// ---------- Eigenschaften des gewählten Elements ----------

function knopfgruppe(feld, optionen, aktuell) {
  return `<div class="knopfgruppe">${Object.entries(optionen).map(([k, v]) =>
    `<button class="btn grau klein${k === aktuell ? ' aktiv' : ''}" data-setze="${feld}" data-wert="${k}">${v}</button>`).join('')}</div>`;
}

function feEigenschaften() {
  const box = $('#fe-eigenschaften');
  if (!fe) return;
  const e = fe.auswahl && feElement(fe.auswahl);
  if (!e) {
    box.innerHTML = `
      <h3>Folie</h3>
      <p>${fe.info.elemente.length} Element(e)</p>
      <p class="gedimmt">Element anklicken, um es zu bearbeiten. Über die Leiste oben kommen Texte, Bilder und Videos dazu.</p>`;
    return;
  }
  const art = { text: FOLIE_STILE[e.stil] || 'Text', bild: 'Bild', video: e.youtube ? 'YouTube-Video' : 'Video' }[e.typ];
  let html = `<h3>${esc(art)}</h3>`;
  if (e.typ === 'text') {
    html += `
      <label>Stil</label>${knopfgruppe('stil', FOLIE_STILE, e.stil)}
      <label>Schriftgröße</label>${knopfgruppe('groesse', FOLIE_GROESSEN, e.groesse)}
      <label>Ausrichtung</label>${knopfgruppe('ausrichtung', FOLIE_AUSRICHTUNGEN, e.ausrichtung)}
      <button class="btn hell klein breit" style="margin-top:12px" data-aktion="schreiben">✎ Text bearbeiten</button>`;
  }
  if (e.typ === 'video' && e.youtube) {
    html += `<p class="gedimmt">YouTube-ID: ${esc(e.youtube)}<br>Braucht Internet am Beamer-Rechner.</p>
      <button class="btn grau klein" data-aktion="youtube">Link ändern</button>`;
  }
  if (e.typ === 'video' && e.src) html += '<p class="gedimmt">Spielt am Beamer automatisch ab, wenn die Seite erscheint.</p>';
  html += `
    <label>Position und Größe (%)</label>
    <div class="zeile" style="flex-wrap:nowrap">
      ${['x', 'y', 'w', 'h'].map(k => `<input type="number" step="0.5" data-mass="${k}" value="${e[k]}" title="${{ x: 'Links', y: 'Oben', w: 'Breite', h: 'Höhe' }[k]}" style="padding:6px">`).join('')}
    </div>
    <label>Anordnen</label>
    <div class="knopfgruppe">
      <button class="btn grau klein" data-aktion="vorne">⬆ Nach vorne</button>
      <button class="btn grau klein" data-aktion="hinten">⬇ Nach hinten</button>
      <button class="btn grau klein" data-aktion="mitte">↔ Waagrecht mittig</button>
    </div>
    <div class="knopfgruppe" style="margin-top:12px">
      <button class="btn grau klein" data-aktion="duplizieren">⧉ Duplizieren</button>
      <button class="btn grau klein" data-aktion="loeschen">🗑 Löschen</button>
    </div>`;
  box.innerHTML = html;
}

$('#fe-eigenschaften').addEventListener('click', ev => {
  const e = fe && fe.auswahl && feElement(fe.auswahl);
  if (!e) return;
  const setze = ev.target.closest('[data-setze]');
  if (setze) {
    e[setze.dataset.setze] = setze.dataset.wert;
    feErsetze(e);
    return;
  }
  const b = ev.target.closest('[data-aktion]');
  if (!b) return;
  switch (b.dataset.aktion) {
    case 'schreiben': feTextStart(e.id); break;
    case 'vorne': e.z = Math.max(...fe.info.elemente.map(x => x.z)) + 1; feNeuNummerieren(); break;
    case 'hinten': e.z = Math.min(...fe.info.elemente.map(x => x.z)) - 1; feNeuNummerieren(); break;
    case 'mitte': e.x = runde((100 - e.w) / 2); positioniereElement(feNode(e.id), e); feEigenschaften(); break;
    case 'duplizieren': feDuplizieren(e); break;
    case 'loeschen': feLoeschen(e); break;
    case 'youtube': {
      const id = youtubeId(prompt('Neuer YouTube-Link:', 'https://www.youtube.com/watch?v=' + e.youtube) || '');
      if (id) { e.youtube = id; feErsetze(e); }
      break;
    }
  }
});

$('#fe-eigenschaften').addEventListener('change', ev => {
  const e = fe && fe.auswahl && feElement(fe.auswahl);
  const k = ev.target.dataset.mass;
  if (!e || !k) return;
  const v = Number(ev.target.value);
  if (!Number.isFinite(v)) return;
  e[k] = runde(k === 'w' || k === 'h' ? Math.min(Math.max(v, 3), 100) : Math.min(Math.max(v, -50), 150));
  positioniereElement(feNode(e.id), e);
  feEigenschaften();
});

// ---------- Vorschau ----------

$('#fe-vorschau').addEventListener('click', () => {
  feTextEnde();
  const huelle = document.createElement('div');
  huelle.className = 'folie-vorschau-voll';
  huelle.title = 'Klicken oder Esc zum Schließen';
  const folie = document.createElement('div');
  zeichneFolie(folie, fe.info, { autoplay: true });
  huelle.appendChild(folie);
  document.body.appendChild(huelle);
  const zu = () => {
    stoppeFolie(folie);
    huelle.remove();
    document.removeEventListener('keydown', taste, true);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  const taste = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); zu(); } };
  document.addEventListener('keydown', taste, true);
  huelle.addEventListener('click', ev => { if (!ev.target.closest('video, iframe')) zu(); });
  huelle.requestFullscreen && huelle.requestFullscreen().catch(() => {});
  document.addEventListener('fullscreenchange', function weg() {
    if (!document.fullscreenElement) { document.removeEventListener('fullscreenchange', weg); if (huelle.isConnected) zu(); }
  });
});
