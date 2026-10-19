// Verwaltung: Anmeldung, Quiz-Liste, Editor, Import, Auswertung.

let info = { standardZeit: 20 };
let bearbeitung = null;   // aktuell bearbeitetes Quiz { id, titel, beschreibung, fragen[] }
let importDaten = null;   // Ergebnis der Importprüfung
let aktuellesErgebnis = null;

function meldung(text, ok = false) {
  const el = $('#meldung');
  el.textContent = text || '';
  el.classList.toggle('ok', ok);
  zeige(el, !!text);
  if (text) window.scrollTo(0, 0);
  clearTimeout(meldung.t);
  if (ok && text) meldung.t = setTimeout(() => zeige(el, false), 4000);
}

async function mitMeldung(fn) {
  try { return await fn(); } catch (e) { meldung(e.message); }
}

// ---------- Navigation (über #hash, damit Zurück-Taste funktioniert) ----------

function tab(name) {
  $$('.tabs button').forEach(b => b.classList.toggle('aktiv', b.dataset.tab === name));
  $$('[data-tabinhalt]').forEach(el => zeige(el, el.dataset.tabinhalt === name));
  ansicht('uebersicht');
}

async function route() {
  meldung('');
  if (!adminPin()) { zeige('#btn-abmelden', false); return ansicht('login'); }
  zeige('#btn-abmelden', true);
  const [key, wert] = location.hash.replace(/^#/, '').split('=');
  if (key === 'quiz' || key === 'neu') return oeffneEditor(wert);
  if (key === 'ergebnis') return oeffneErgebnis(wert);
  if (key === 'import') { tab('import'); return ladeImportZiele(); }
  if (key === 'ergebnisse') { tab('ergebnisse'); return ladeErgebnisse(); }
  tab('quizze');
  return ladeQuizze();
}
window.addEventListener('hashchange', route);

$$('.tabs button').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.tab; }));
document.addEventListener('click', e => {
  const z = e.target.closest('[data-zurueck]');
  if (z) location.hash = z.dataset.zurueck || 'quizze';
});

// ---------- Anmeldung ----------

$('#form-login').addEventListener('submit', async e => {
  e.preventDefault();
  const pin = $('#admin-pin').value.trim();
  try {
    const antwort = await api('/login', { methode: 'POST', daten: { pin } });
    adminSpeicher.set('adminPin', pin);
    $('#admin-pin').value = '';
    await route();
    if (antwort.standardPin) {
      meldung('Achtung: Es wird noch die Standard-PIN 112112 verwendet. Bitte in der config.json eine eigene Admin-PIN eintragen und den Server neu starten.');
    }
  } catch (err) {
    meldung(err.message);
  }
});

$('#btn-abmelden').addEventListener('click', () => {
  adminSpeicher.del('adminPin');
  location.hash = '';
  route();
});

// ---------- Quiz-Liste ----------

function intervallText(n) {
  return n > 1 ? `nach jeder ${n}. Frage` : 'nach jeder Frage';
}

async function ladeQuizze() {
  const liste = await mitMeldung(() => api('/quizze'));
  if (!liste) return;
  $('#quiz-liste').innerHTML = liste.length ? liste.map(q => `
    <div class="listeneintrag">
      <div>
        <div class="titel">${esc(q.titel)}</div>
        <div class="gedimmt">${q.anzahlFragen} Fragen · Rangliste ${intervallText(q.ranglisteIntervall)}${q.beschreibung ? ' · ' + esc(q.beschreibung) : ''}</div>
      </div>
      <div class="aktionen">
        <a class="btn" href="/host.html?quiz=${q.id}" ${q.anzahlFragen ? '' : 'aria-disabled="true" onclick="return false" style="opacity:.5"'}>▶ Spiel starten</a>
        <button class="btn hell klein" data-aktion="bearbeiten" data-id="${q.id}">Bearbeiten</button>
        <button class="btn grau klein" data-aktion="duplizieren" data-id="${q.id}">Kopieren</button>
        <button class="btn grau klein" data-aktion="csv" data-id="${q.id}">Export CSV</button>
        <button class="btn grau klein" data-aktion="json" data-id="${q.id}">Export JSON</button>
        <button class="btn hell klein" data-aktion="paket" data-id="${q.id}" title="ZIP mit Fragen, Einstellungen, Info-Folien und allen Bildern/Videos">📦 Export komplett</button>
        <button class="btn grau klein" data-aktion="loeschen" data-id="${q.id}" data-titel="${esc(q.titel)}">Löschen</button>
      </div>
    </div>`).join('')
    : '<div class="karte zentriert">Noch keine Quizze vorhanden. Lege ein neues an oder importiere Fragen.</div>';
}

$('#quiz-liste').addEventListener('click', e => {
  const b = e.target.closest('button[data-aktion]');
  if (!b) return;
  const id = b.dataset.id;
  mitMeldung(async () => {
    switch (b.dataset.aktion) {
      case 'bearbeiten': location.hash = 'quiz=' + id; break;
      case 'duplizieren': await api(`/quizze/${id}/duplizieren`, { methode: 'POST' }); meldung('Kopie angelegt', true); ladeQuizze(); break;
      case 'csv': await herunterladen(`/quizze/${id}/export?format=csv`); break;
      case 'json': await herunterladen(`/quizze/${id}/export?format=json`); break;
      case 'paket': await herunterladen(`/quizze/${id}/export?format=paket`); break;
      case 'loeschen':
        if (!confirm(`Quiz „${b.dataset.titel}“ wirklich löschen?`)) return;
        await api('/quizze/' + id, { methode: 'DELETE' });
        meldung('Quiz gelöscht', true);
        ladeQuizze();
        break;
    }
  });
});

$('#btn-neues-quiz').addEventListener('click', () => { location.hash = 'neu'; });

// ---------- Editor ----------

function leereFrage() {
  return { frage: '', antworten: ['', '', '', ''], richtig: 0, zeit: info.standardZeit };
}

async function oeffneEditor(id) {
  if (id) {
    const q = await mitMeldung(() => api('/quizze/' + id));
    if (!q) return;
    bearbeitung = { id: q.id, titel: q.titel, beschreibung: q.beschreibung || '', ranglisteIntervall: q.ranglisteIntervall || 1, fragen: q.fragen.map(f => ({ ...f, antworten: [...f.antworten] })) };
  } else {
    bearbeitung = { id: null, titel: '', beschreibung: '', ranglisteIntervall: 1, fragen: [leereFrage()] };
  }
  $('#editor-ueberschrift').textContent = id ? 'Quiz bearbeiten' : 'Neues Quiz';
  $('#quiz-titel').value = bearbeitung.titel;
  $('#quiz-beschreibung').value = bearbeitung.beschreibung;
  $('#quiz-intervall').value = String(bearbeitung.ranglisteIntervall);
  zeichneFragen();
  ansicht('editor');
}

function zeichneFragen() {
  const n = bearbeitung.fragen.length;
  $('#fragen-editor').innerHTML = bearbeitung.fragen.map((f, q) => {
    const antworten = [...f.antworten, '', '', '', ''].slice(0, 4);
    return `
    <div class="frage-editor" data-q="${q}">
      <div class="kopfzeile">
        <strong>Frage ${q + 1}</strong>
        <div class="zeile">
          <label style="margin:0;font-weight:400">Zeit (s)</label>
          <input class="zeit-feld" type="number" min="5" max="120" step="1" data-feld="zeit" value="${f.zeit}">
          <button class="btn grau klein" data-aktion="hoch" ${q === 0 ? 'disabled' : ''} title="Nach oben">↑</button>
          <button class="btn grau klein" data-aktion="runter" ${q === n - 1 ? 'disabled' : ''} title="Nach unten">↓</button>
          <button class="btn grau klein" data-aktion="entfernen" title="Frage löschen">🗑</button>
        </div>
      </div>
      <textarea rows="2" data-feld="frage" placeholder="Fragetext">${esc(f.frage)}</textarea>
      <p class="gedimmt" style="margin:8px 0">Antworten (mind. 2) – richtige Antwort per Kreis markieren:</p>
      ${antworten.map((a, i) => `
        <div class="antwort-zeile">
          <input type="radio" name="richtig-${q}" value="${i}" ${f.richtig === i ? 'checked' : ''} title="Richtige Antwort">
          <span class="farbe" style="background:var(--a${i})">${SYMBOLE[i]}</span>
          <input type="text" data-antwort="${i}" maxlength="120" value="${esc(a)}" placeholder="Antwort ${BUCHSTABEN[i]}${i > 1 ? ' (optional)' : ''}">
        </div>`).join('')}
      ${infoZeileHtml(f)}
    </div>`;
  }).join('');
  // Miniatur-Vorschau der Info-Seiten
  $$('#fragen-editor .folie-mini').forEach(el => {
    const f = bearbeitung.fragen[Number(el.closest('[data-q]').dataset.q)];
    zeichneFolie(el, f.info, { miniatur: true });
    el.classList.add('folie-mini');
  });
}

function infoZeileHtml(f) {
  const info = f.info;
  const anzahl = info ? info.elemente.length : 0;
  const status = !info || !info.aktiv ? '' : anzahl ? `${anzahl} Element(e)` : 'noch leer – wird erst mit Inhalt angezeigt';
  return `
      <div class="info-zeile">
        <label><input type="checkbox" data-feld="info-aktiv" ${info && info.aktiv ? 'checked' : ''}> Info-Seite nach dieser Frage</label>
        <button class="btn hell klein" data-aktion="info">${anzahl ? '✎ Info-Seite bearbeiten' : '+ Info-Seite gestalten'}</button>
        <span class="gedimmt">${status}</span>
        ${anzahl ? '<div class="folie-mini" data-aktion-mini="info" title="Info-Seite bearbeiten"></div>' : ''}
      </div>`;
}

function oeffneInfoSeite(q) {
  const f = bearbeitung.fragen[q];
  const scroll = window.scrollY;
  oeffneFolienEditor({
    info: f.info,
    titel: `Info-Seite zu Frage ${q + 1}: ${f.frage.slice(0, 60)}${f.frage.length > 60 ? ' …' : ''}`,
    vorschlag: { frage: f.frage, antwort: (f.antworten[f.richtig] || '').trim() },
    fertig: info => {
      // Mit Inhalt fertig gestaltet → Seite automatisch einschalten
      if (info.elemente.length && (!f.info || !f.info.elemente.length)) info.aktiv = true;
      f.info = info;
      zeigeEditorWieder(scroll);
    },
    abbrechen: () => zeigeEditorWieder(scroll),
  });
}

// Zurück in den Quiz-Editor, ohne ihn neu vom Server zu laden (ungespeicherte Änderungen bleiben)
function zeigeEditorWieder(scroll) {
  zeichneFragen();
  ansicht('editor');
  window.scrollTo(0, scroll);
}

// Eingaben direkt in den Zustand übernehmen
$('#fragen-editor').addEventListener('input', e => {
  const box = e.target.closest('[data-q]');
  if (!box) return;
  const f = bearbeitung.fragen[Number(box.dataset.q)];
  if (e.target.dataset.feld === 'frage') f.frage = e.target.value;
  else if (e.target.dataset.feld === 'zeit') f.zeit = Number(e.target.value);
  else if (e.target.dataset.antwort != null) {
    while (f.antworten.length < 4) f.antworten.push('');
    f.antworten[Number(e.target.dataset.antwort)] = e.target.value;
  } else if (e.target.type === 'radio') f.richtig = Number(e.target.value);
  else if (e.target.dataset.feld === 'info-aktiv') {
    if (!f.info) f.info = leereInfo();
    f.info.aktiv = e.target.checked;
    if (f.info.aktiv && !f.info.elemente.length) return oeffneInfoSeite(Number(box.dataset.q));
    zeichneFragen();
  }
});

$('#fragen-editor').addEventListener('click', e => {
  const b = e.target.closest('button[data-aktion], [data-aktion-mini]');
  if (!b) return;
  const q = Number(b.closest('[data-q]').dataset.q);
  const fragen = bearbeitung.fragen;
  if (b.dataset.aktion === 'info' || b.dataset.aktionMini === 'info') return oeffneInfoSeite(q);
  if (b.dataset.aktion === 'hoch') [fragen[q - 1], fragen[q]] = [fragen[q], fragen[q - 1]];
  if (b.dataset.aktion === 'runter') [fragen[q + 1], fragen[q]] = [fragen[q], fragen[q + 1]];
  if (b.dataset.aktion === 'entfernen') {
    if (fragen[q].frage && !confirm('Diese Frage löschen?')) return;
    fragen.splice(q, 1);
  }
  zeichneFragen();
});

$('#btn-frage-neu').addEventListener('click', () => {
  bearbeitung.fragen.push(leereFrage());
  zeichneFragen();
  const letzte = $$('#fragen-editor [data-q]').pop();
  letzte.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('textarea', letzte).focus();
});

$('#btn-quiz-speichern').addEventListener('click', () => mitMeldung(async () => {
  // Leere Antworten entfernen; die markierte richtige Antwort muss dabei erhalten bleiben
  const fragen = [];
  for (const [q, f] of bearbeitung.fragen.entries()) {
    const belegt = f.antworten.map((a, i) => ({ a: a.trim(), i })).filter(x => x.a);
    const richtig = belegt.findIndex(x => x.i === f.richtig);
    if (!f.frage.trim() && !belegt.length) continue; // komplett leere Frage ignorieren
    if (richtig < 0) throw new Error(`Frage ${q + 1}: Die als richtig markierte Antwort ist leer.`);
    const neu = { frage: f.frage.trim(), antworten: belegt.map(x => x.a), richtig, zeit: Math.round(f.zeit) };
    if (f.info && (f.info.aktiv || f.info.elemente.length)) neu.info = f.info; // ausgeschaltete Seite bleibt erhalten
    fragen.push(neu);
  }
  const daten = {
    titel: $('#quiz-titel').value,
    beschreibung: $('#quiz-beschreibung').value,
    ranglisteIntervall: Number($('#quiz-intervall').value),
    fragen,
  };
  if (bearbeitung.id) await api('/quizze/' + bearbeitung.id, { methode: 'PUT', daten });
  else await api('/quizze', { methode: 'POST', daten });
  location.hash = 'quizze';
  setTimeout(() => meldung('Quiz gespeichert', true), 50);
}));

// ---------- Import ----------

async function ladeImportZiele() {
  const liste = await mitMeldung(() => api('/quizze'));
  if (!liste) return;
  $('#import-ziel').innerHTML = '<option value="">Neues Quiz anlegen</option>'
    + liste.map(q => `<option value="${q.id}">An „${esc(q.titel)}“ anhängen</option>`).join('');
  zeige('#import-neu-felder', true);
}

$('#import-ziel').addEventListener('change', e => zeige('#import-neu-felder', !e.target.value));

// Excel speichert „CSV (Trennzeichen-getrennt)“ in Windows-1252 – dann Umlaute retten
async function leseDatei(datei) {
  const puffer = await datei.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(puffer);
  } catch {
    return new TextDecoder('windows-1252').decode(puffer);
  }
}

// Quiz-Paket (ZIP mit Fragen, Info-Folien und Medien) als Rohdaten an den Server
async function pruefePaket(datei) {
  const res = await fetch('/api/import/paket', {
    method: 'POST',
    headers: { 'x-admin-pin': adminPin() || '', 'content-type': 'application/zip' },
    body: datei,
  });
  let d = {};
  try { d = await res.json(); } catch { /* kein JSON */ }
  if (!res.ok) throw new Error(d.fehler || 'Paket konnte nicht gelesen werden (' + res.status + ')');
  return d;
}

async function istZip(datei) {
  if (/\.zip$/i.test(datei.name)) return true;
  const kopf = new Uint8Array(await datei.slice(0, 4).arrayBuffer());
  return kopf[0] === 0x50 && kopf[1] === 0x4b && kopf[2] === 3 && kopf[3] === 4; // "PK\3\4"
}

async function pruefeImport(datei) {
  meldung('');
  let r;
  if (await istZip(datei)) {
    meldung('Quiz-Paket wird geladen …', true);
    r = await mitMeldung(() => pruefePaket(datei));
    if (r) meldung('');
  } else {
    if (datei.size > 4 * 1024 * 1024) return meldung('Datei ist zu groß (max. 4 MB).');
    const text = await leseDatei(datei);
    r = await mitMeldung(() => api('/import/pruefen', { methode: 'POST', daten: { text, dateiname: datei.name } }));
  }
  if (!r) return;
  importDaten = r;
  const hinweise = r.hinweise || [];
  $('#import-hinweise').innerHTML = hinweise.length ? '<ul class="vorschau-fehler">' + hinweise.map(h => `<li>${esc(h)}</li>`).join('') + '</ul>' : '';
  zeige('#import-hinweise', hinweise.length > 0);
  $('#import-zusammenfassung').textContent =
    `${r.fragen.length} Frage(n) erkannt` + (r.fehler.length ? `, ${r.fehler.length} fehlerhaft` : ' – alles in Ordnung');
  const fehlerEl = $('#import-fehler');
  fehlerEl.innerHTML = r.fehler.length
    ? '<b>Diese Zeilen werden nicht übernommen:</b><ul class="vorschau-fehler">'
      + r.fehler.map(f => `<li>${f.zeile ? `Zeile ${f.zeile}` : 'Datei'}${f.frage ? ` („${esc(f.frage.slice(0, 40))}“)` : ''}: ${esc(f.meldung)}</li>`).join('')
      + '</ul>'
    : '';
  zeige(fehlerEl, r.fehler.length > 0);
  $('#import-tabelle').innerHTML = r.fragen.map((f, i) => `
    <tr><td>${i + 1}</td><td>${esc(f.frage)}</td>
      <td>${f.antworten.map((a, j) => j === f.richtig ? `<b>✔ ${esc(a)}</b>` : esc(a)).join('<br>')}</td>
      <td>${f.zeit}s</td>
      <td>${f.info && f.info.elemente.length ? `${f.info.aktiv ? '✔' : '(aus)'} ${f.info.elemente.length} El.` : '–'}</td></tr>`).join('');
  $('#import-titel').value = r.titel || datei.name.replace(/(\.quizpaket)?\.(csv|json|txt|zip)$/i, '').replace(/[_-]+/g, ' ');
  $('#btn-import-uebernehmen').disabled = r.fragen.length === 0;
  zeige('#import-vorschau', true);
}

const dropzone = $('#dropzone');
dropzone.addEventListener('click', () => $('#import-datei').click());
$('#import-datei').addEventListener('change', e => {
  if (e.target.files[0]) pruefeImport(e.target.files[0]);
  e.target.value = '';
});
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drueber'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drueber'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drueber');
  if (e.dataTransfer.files[0]) pruefeImport(e.dataTransfer.files[0]);
});

$('#btn-import-verwerfen').addEventListener('click', () => {
  importDaten = null;
  zeige('#import-vorschau', false);
});

$('#btn-import-uebernehmen').addEventListener('click', () => mitMeldung(async () => {
  if (!importDaten || !importDaten.fragen.length) return;
  const zielId = $('#import-ziel').value;
  if (zielId) {
    const q = await api('/quizze/' + zielId);
    await api('/quizze/' + zielId, { methode: 'PUT', daten: { ...q, fragen: [...q.fragen, ...importDaten.fragen] } });
  } else {
    const titel = $('#import-titel').value.trim();
    if (!titel) throw new Error('Bitte einen Titel für das neue Quiz angeben.');
    await api('/quizze', { methode: 'POST', daten: { titel, beschreibung: importDaten.beschreibung || '', ranglisteIntervall: importDaten.ranglisteIntervall, fragen: importDaten.fragen } });
  }
  const n = importDaten.fragen.length;
  importDaten = null;
  zeige('#import-vorschau', false);
  location.hash = 'quizze';
  setTimeout(() => meldung(`${n} Frage(n) importiert`, true), 50);
}));

// ---------- Auswertung ----------

async function ladeErgebnisse() {
  const liste = await mitMeldung(() => api('/ergebnisse'));
  if (!liste) return;
  $('#ergebnis-liste').innerHTML = liste.length ? liste.map(r => `
    <div class="listeneintrag">
      <div>
        <div class="titel">${esc(r.quizTitel)}</div>
        <div class="gedimmt">${datum(r.beendet)} · ${r.teilnehmer} Teilnehmer · ${r.fragen} Fragen</div>
      </div>
      <div class="aktionen">
        <a class="btn" href="#ergebnis=${r.id}">Ansehen</a>
        <button class="btn grau klein" data-aktion="csv" data-id="${r.id}">CSV</button>
        <button class="btn grau klein" data-aktion="loeschen" data-id="${r.id}">Löschen</button>
      </div>
    </div>`).join('')
    : '<div class="karte zentriert">Noch keine Spiele gespielt.</div>';
}

$('#ergebnis-liste').addEventListener('click', e => {
  const b = e.target.closest('button[data-aktion]');
  if (!b) return;
  mitMeldung(async () => {
    if (b.dataset.aktion === 'csv') await herunterladen(`/ergebnisse/${b.dataset.id}/csv`);
    if (b.dataset.aktion === 'loeschen') {
      if (!confirm('Dieses Ergebnis endgültig löschen?')) return;
      await api('/ergebnisse/' + b.dataset.id, { methode: 'DELETE' });
      ladeErgebnisse();
    }
  });
});

async function oeffneErgebnis(id) {
  const r = await mitMeldung(() => api('/ergebnisse/' + id));
  if (!r) return;
  aktuellesErgebnis = r;
  $('#erg-titel').textContent = r.quizTitel;
  $('#erg-info').textContent = `${datum(r.beendet)} · ${r.spieler.length} Teilnehmer · ${r.fragen.length} Fragen`;

  const kopf = '<tr><th>Platz</th><th>Name</th><th>Punkte</th><th>Richtig</th>'
    + r.fragen.map((f, i) => `<th title="${esc(f.frage)}">F${i + 1}</th>`).join('') + '</tr>';
  const zeilen = r.spieler.map((s, i) => {
    const richtige = s.antworten.filter(a => a.richtig).length;
    return `<tr><td>${i + 1}</td><td><b>${esc(s.name)}</b></td><td>${s.punkte}</td>
      <td>${richtige}/${r.fragen.length}</td>
      ${s.antworten.map(a => a.index == null
        ? '<td class="gedimmt" title="keine Antwort">–</td>'
        : a.richtig
          ? `<td class="ok" title="${(a.zeitMs / 1000).toFixed(1)} s, ${a.punkte} Punkte">✔</td>`
          : `<td class="nein" title="Antwort ${BUCHSTABEN[a.index]}">✖ ${BUCHSTABEN[a.index]}</td>`).join('')}</tr>`;
  }).join('');
  $('#erg-tabelle').innerHTML = `<thead>${kopf}</thead><tbody>${zeilen}</tbody>`;

  const fragen = r.fragen.map((f, q) => {
    const antw = r.spieler.map(s => s.antworten[q]);
    const richtig = antw.filter(a => a && a.richtig);
    const zeiten = antw.filter(a => a && a.zeitMs != null).map(a => a.zeitMs);
    return {
      nr: q + 1, frage: f.frage, loesung: f.antworten[f.richtig],
      quote: r.spieler.length ? Math.round(100 * richtig.length / r.spieler.length) : 0,
      zeit: zeiten.length ? (zeiten.reduce((x, y) => x + y, 0) / zeiten.length / 1000).toFixed(1) : '–',
    };
  }).sort((a, b) => a.quote - b.quote);
  $('#erg-fragen').innerHTML = '<thead><tr><th>Nr.</th><th>Frage</th><th>Lösung</th><th>Richtig</th><th>Ø Zeit</th></tr></thead><tbody>'
    + fragen.map(f => `<tr><td>F${f.nr}</td><td>${esc(f.frage)}</td><td>${esc(f.loesung)}</td>
      <td class="${f.quote >= 50 ? 'ok' : 'nein'}">${f.quote} %</td><td>${f.zeit === '–' ? '–' : f.zeit + ' s'}</td></tr>`).join('')
    + '</tbody>';
  ansicht('ergebnis');
}

$('#btn-erg-csv').addEventListener('click', () => mitMeldung(() => herunterladen(`/ergebnisse/${aktuellesErgebnis.id}/csv`)));

// ---------- Start ----------

fetch('/api/info').then(r => r.json()).then(d => {
  info = d;
  $('#app-version').textContent = 'Version ' + d.version;
  $('#kopf-version').textContent = '· v' + d.version;
}).catch(() => {});
route();
