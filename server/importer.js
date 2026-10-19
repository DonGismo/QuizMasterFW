// Import/Export von Fragen (CSV und JSON) sowie CSV-Export der Ergebnisse.
// Format ist in README.md beschrieben; Vorlage: public/vorlage-fragen.csv

const MIN_ZEIT = 5;
const MAX_ZEIT = 120;
const MAX_ANTWORTEN = 4;
const BUCHSTABEN = ['A', 'B', 'C', 'D'];
const RANGLISTE_INTERVALLE = [1, 3, 5]; // Rangliste nach jeder / jeder 3. / jeder 5. Frage

function normalizeIntervall(wert) {
  const n = Number(wert);
  return RANGLISTE_INTERVALLE.includes(n) ? n : 1;
}

// ---------- CSV-Grundfunktionen ----------

// Ermittelt das Trennzeichen anhand der ersten Zeile (Excel-DE nutzt ";").
function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = [';', ',', '\t'].map(d => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

// RFC-4180-artiger Parser: Anführungszeichen, "" als Escape, Zeilenumbrüche in Feldern.
// Liefert Zeilen als { zeile: <Zeilennummer in der Datei>, felder: [...] }.
function parseCsv(text, delimiter) {
  text = text.replace(/^﻿/, '');
  delimiter = delimiter || detectDelimiter(text);
  const rows = [];
  let felder = [];
  let feld = '';
  let inQuotes = false;
  let zeile = 1;
  let startZeile = 1;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { feld += '"'; i++; }
        else inQuotes = false;
      } else {
        if (c === '\n') zeile++;
        feld += c;
      }
    } else if (c === '"' && feld === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      felder.push(feld); feld = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      felder.push(feld);
      rows.push({ zeile: startZeile, felder });
      felder = []; feld = '';
      zeile++; startZeile = zeile;
    } else {
      feld += c;
    }
  }
  if (feld !== '' || felder.length) {
    felder.push(feld);
    rows.push({ zeile: startZeile, felder });
  }
  // Komplett leere Zeilen ignorieren
  return rows.filter(r => r.felder.some(f => f.trim() !== ''));
}

function csvFeld(wert, delimiter = ';') {
  const s = wert == null ? '' : String(wert);
  return /["\r\n]/.test(s) || s.includes(delimiter) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows) {
  // BOM, damit Excel UTF-8 (Umlaute) korrekt erkennt
  return '﻿' + rows.map(r => r.map(f => csvFeld(f)).join(';')).join('\r\n') + '\r\n';
}

// ---------- Validierung ----------

// Prüft eine Frage im internen Format { frage, antworten[], richtig (0-basiert), zeit }.
// Gibt eine Liste von Fehlermeldungen zurück (leer = gültig).
function validateFrage(f) {
  const fehler = [];
  if (!f || typeof f !== 'object') return ['Ungültiger Eintrag'];
  if (typeof f.frage !== 'string' || !f.frage.trim()) fehler.push('Fragetext fehlt');
  if (!Array.isArray(f.antworten)) {
    fehler.push('Antworten fehlen');
    return fehler;
  }
  if (f.antworten.length < 2) fehler.push('Mindestens 2 Antworten nötig');
  if (f.antworten.length > MAX_ANTWORTEN) fehler.push(`Höchstens ${MAX_ANTWORTEN} Antworten erlaubt`);
  if (f.antworten.some(a => typeof a !== 'string' || !a.trim())) fehler.push('Leere Antwort');
  if (!Number.isInteger(f.richtig) || f.richtig < 0 || f.richtig >= f.antworten.length) {
    fehler.push('Richtige Antwort fehlt oder zeigt auf keine vorhandene Antwort');
  }
  if (!Number.isInteger(f.zeit) || f.zeit < MIN_ZEIT || f.zeit > MAX_ZEIT) {
    fehler.push(`Zeit muss zwischen ${MIN_ZEIT} und ${MAX_ZEIT} Sekunden liegen`);
  }
  if (f.info != null) fehler.push(...validateInfo(f.info).map(m => 'Info-Seite: ' + m));
  return fehler;
}

function normalizeFrage(f) {
  const n = {
    frage: String(f.frage).trim(),
    antworten: f.antworten.map(a => String(a).trim()),
    richtig: f.richtig,
    zeit: f.zeit,
  };
  if (f.info != null) n.info = normalizeInfo(f.info);
  return n;
}

// ---------- Info-Seite (Folie nach der Frage) ----------
// Positionen/Größen in Prozent einer 16:9-Fläche; Gestaltung nur über feste Stile.

const INFO = {
  maxElemente: 30,
  maxText: 2000,
  hintergruende: ['weiss', 'grau', 'rot'],
  typen: ['text', 'bild', 'video'],
  stile: ['titel', 'text', 'hinweis', 'info'],
  groessen: ['s', 'm', 'l', 'xl'],
  ausrichtungen: ['links', 'mitte', 'rechts'],
  medienPfad: /^\/medien\/[a-f0-9]{8,64}\.(png|jpe?g|gif|webp|mp4|webm)$/,
  youtubeId: /^[\w-]{11}$/,
};

const istZahl = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

function validateInfo(info) {
  if (typeof info !== 'object' || Array.isArray(info)) return ['Ungültiges Format'];
  const fehler = [];
  if (typeof info.aktiv !== 'boolean') fehler.push('"aktiv" fehlt');
  if (info.hintergrund != null && !INFO.hintergruende.includes(info.hintergrund)) fehler.push('Unbekannter Hintergrund');
  if (!Array.isArray(info.elemente)) return [...fehler, 'Elemente fehlen'];
  if (info.elemente.length > INFO.maxElemente) fehler.push(`Höchstens ${INFO.maxElemente} Elemente`);
  info.elemente.forEach((e, i) => {
    const nr = `Element ${i + 1}`;
    if (!e || typeof e !== 'object') return fehler.push(`${nr}: ungültig`);
    if (!INFO.typen.includes(e.typ)) fehler.push(`${nr}: unbekannter Typ`);
    if (!istZahl(e.x, -50, 150) || !istZahl(e.y, -50, 150)) fehler.push(`${nr}: Position ungültig`);
    if (!istZahl(e.w, 1, 100) || !istZahl(e.h, 1, 100)) fehler.push(`${nr}: Größe ungültig`);
    if (e.typ === 'text') {
      if (typeof e.text !== 'string' || e.text.length > INFO.maxText) fehler.push(`${nr}: Text fehlt oder ist zu lang`);
      if (e.stil != null && !INFO.stile.includes(e.stil)) fehler.push(`${nr}: unbekannter Stil`);
      if (e.groesse != null && !INFO.groessen.includes(e.groesse)) fehler.push(`${nr}: unbekannte Größe`);
      if (e.ausrichtung != null && !INFO.ausrichtungen.includes(e.ausrichtung)) fehler.push(`${nr}: unbekannte Ausrichtung`);
    }
    if (e.typ === 'bild' && !(typeof e.src === 'string' && INFO.medienPfad.test(e.src))) fehler.push(`${nr}: Bilddatei ungültig`);
    if (e.typ === 'video') {
      const datei = typeof e.src === 'string' && INFO.medienPfad.test(e.src);
      const yt = typeof e.youtube === 'string' && INFO.youtubeId.test(e.youtube);
      if (!datei && !yt) fehler.push(`${nr}: Videodatei oder YouTube-Link fehlt`);
    }
  });
  return fehler;
}

// Nur bekannte Felder übernehmen (Eingabe vorher mit validateInfo geprüft)
function normalizeInfo(info) {
  const runde = v => Math.round(v * 100) / 100;
  return {
    aktiv: info.aktiv,
    hintergrund: info.hintergrund || 'weiss',
    elemente: info.elemente.map((e, i) => {
      const basis = {
        id: typeof e.id === 'string' && /^[\w-]{1,20}$/.test(e.id) ? e.id : 'e' + i,
        typ: e.typ,
        x: runde(e.x), y: runde(e.y), w: runde(e.w), h: runde(e.h),
        z: Number.isInteger(e.z) ? e.z : i + 1,
      };
      if (e.typ === 'text') {
        return { ...basis, stil: e.stil || 'text', groesse: e.groesse || 'm', ausrichtung: e.ausrichtung || 'links', text: e.text };
      }
      if (e.typ === 'bild') return { ...basis, src: e.src };
      return { ...basis, src: INFO.medienPfad.test(e.src || '') ? e.src : null, youtube: INFO.youtubeId.test(e.youtube || '') ? e.youtube : null };
    }),
  };
}

function parseRichtig(wert) {
  const s = String(wert || '').trim().toUpperCase();
  if (!s) return null;
  const b = BUCHSTABEN.indexOf(s);
  if (b >= 0) return b;
  if (/^[1-4]$/.test(s)) return Number(s) - 1;
  return NaN;
}

function parseZeit(wert, standardZeit) {
  const s = String(wert || '').trim();
  if (!s) return standardZeit;
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

// ---------- CSV-Import ----------

const SPALTEN = {
  frage: /^frage(text)?$/,
  a: /^antwort\s*a$|^antwort\s*1$/,
  b: /^antwort\s*b$|^antwort\s*2$/,
  c: /^antwort\s*c$|^antwort\s*3$/,
  d: /^antwort\s*d$|^antwort\s*4$/,
  richtig: /^(richtig(e antwort)?|korrekt|lösung|loesung)$/,
  zeit: /^zeit(\s*\(.*\))?$/,
};
const STANDARD_REIHENFOLGE = ['frage', 'a', 'b', 'c', 'd', 'richtig', 'zeit'];

function importCsv(text, standardZeit = 20) {
  const rows = parseCsv(text);
  const fragen = [];
  const fehler = [];
  if (!rows.length) return { fragen, fehler: [{ zeile: 0, meldung: 'Datei ist leer' }] };

  // Kopfzeile erkennen und Spalten zuordnen (Reihenfolge ist dann egal)
  let index = {};
  STANDARD_REIHENFOLGE.forEach((k, i) => { index[k] = i; });
  const kopf = rows[0].felder.map(f => f.trim().toLowerCase());
  if (SPALTEN.frage.test(kopf[0] || '') || kopf.some(k => SPALTEN.richtig.test(k))) {
    index = {};
    for (const [key, re] of Object.entries(SPALTEN)) {
      const pos = kopf.findIndex(k => re.test(k));
      if (pos >= 0) index[key] = pos;
    }
    rows.shift();
    if (index.frage == null || index.richtig == null) {
      return { fragen, fehler: [{ zeile: 1, meldung: 'Kopfzeile braucht mindestens die Spalten "Frage" und "Richtig"' }] };
    }
  }

  for (const { zeile, felder } of rows) {
    const get = k => (index[k] != null ? (felder[index[k]] || '').trim() : '');
    const roh = ['a', 'b', 'c', 'd'].map(get);
    // Leere Antworten am Ende entfernen; Lücken in der Mitte sind Fehler
    let letzte = roh.length;
    while (letzte > 0 && !roh[letzte - 1]) letzte--;
    const antworten = roh.slice(0, letzte);

    const richtigRoh = get('richtig');
    const richtig = parseRichtig(richtigRoh);
    const f = {
      frage: get('frage'),
      antworten,
      richtig,
      zeit: parseZeit(get('zeit'), standardZeit),
    };
    const meldungen = validateFrage(f);
    if (richtig === null) {
      meldungen.splice(meldungen.findIndex(m => m.startsWith('Richtige')), 1, 'Spalte "Richtig" ist leer (A–D angeben)');
    } else if (Number.isNaN(richtig)) {
      meldungen.splice(meldungen.findIndex(m => m.startsWith('Richtige')), 1, `"${richtigRoh}" ist keine gültige Angabe für "Richtig" (A–D oder 1–4)`);
    }
    if (meldungen.length) fehler.push({ zeile, meldung: meldungen.join('; '), frage: f.frage });
    else fragen.push(normalizeFrage(f));
  }
  return { fragen, fehler };
}

// ---------- JSON-Import ----------

function importJson(text, standardZeit = 20) {
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    return { fragen: [], fehler: [{ zeile: 0, meldung: 'Keine gültige JSON-Datei: ' + e.message }] };
  }
  const liste = Array.isArray(data) ? data : data.fragen;
  if (!Array.isArray(liste)) {
    return { fragen: [], fehler: [{ zeile: 0, meldung: 'JSON enthält kein Feld "fragen"' }] };
  }
  const fragen = [];
  const fehler = [];
  liste.forEach((f, i) => {
    const kandidat = f && typeof f === 'object' ? { ...f, zeit: f.zeit == null ? standardZeit : f.zeit } : f;
    const meldungen = validateFrage(kandidat);
    if (meldungen.length) fehler.push({ zeile: i + 1, meldung: meldungen.join('; '), frage: f && f.frage });
    else fragen.push(normalizeFrage(kandidat));
  });
  return {
    titel: !Array.isArray(data) && typeof data.titel === 'string' ? data.titel : undefined,
    beschreibung: !Array.isArray(data) && typeof data.beschreibung === 'string' ? data.beschreibung : undefined,
    ranglisteIntervall: !Array.isArray(data) && data.ranglisteIntervall != null ? normalizeIntervall(data.ranglisteIntervall) : undefined,
    fragen,
    fehler,
  };
}

// Wählt das Format anhand Dateiname/Inhalt.
function importText(text, dateiname = '', standardZeit = 20) {
  const trimmed = text.replace(/^﻿/, '').trimStart();
  const istJson = /\.json$/i.test(dateiname) || trimmed.startsWith('{') || trimmed.startsWith('[');
  return istJson ? importJson(text, standardZeit) : importCsv(text, standardZeit);
}

// ---------- Export ----------

function exportQuizCsv(quiz) {
  const rows = [['Frage', 'Antwort A', 'Antwort B', 'Antwort C', 'Antwort D', 'Richtig', 'Zeit']];
  for (const f of quiz.fragen) {
    const a = [...f.antworten, '', '', '', ''].slice(0, 4);
    rows.push([f.frage, ...a, BUCHSTABEN[f.richtig], f.zeit]);
  }
  return toCsv(rows);
}

function exportQuizJson(quiz) {
  return JSON.stringify({
    titel: quiz.titel,
    beschreibung: quiz.beschreibung || '',
    ranglisteIntervall: normalizeIntervall(quiz.ranglisteIntervall),
    fragen: quiz.fragen.map(normalizeFrage),
  }, null, 2);
}

function exportResultCsv(result) {
  const datum = new Date(result.beendet || result.gestartet).toLocaleString('de-DE');
  const rows = [
    ['Quiz', result.quizTitel],
    ['Datum', datum],
    [],
    ['Platz', 'Name', 'Punkte', 'Richtig', 'Fragen', 'Quote %',
      ...result.fragen.map((f, i) => `F${i + 1}: ${f.frage}`)],
  ];
  result.spieler.forEach((s, i) => {
    const richtige = s.antworten.filter(a => a && a.richtig).length;
    rows.push([
      i + 1, s.name, s.punkte, richtige, result.fragen.length,
      result.fragen.length ? Math.round(100 * richtige / result.fragen.length) : 0,
      ...result.fragen.map((_, q) => {
        const a = s.antworten[q];
        if (!a || a.index == null) return 'keine Antwort';
        return a.richtig ? `richtig (${a.punkte})` : `falsch (${BUCHSTABEN[a.index]})`;
      }),
    ]);
  });
  rows.push([]);
  rows.push(['Frage', 'Richtige Antwort', 'Quote richtig %']);
  result.fragen.forEach((f, q) => {
    const n = result.spieler.length;
    const r = result.spieler.filter(s => s.antworten[q] && s.antworten[q].richtig).length;
    rows.push([`F${q + 1}: ${f.frage}`, f.antworten[f.richtig], n ? Math.round(100 * r / n) : 0]);
  });
  return toCsv(rows);
}

module.exports = {
  MIN_ZEIT, MAX_ZEIT, MAX_ANTWORTEN, RANGLISTE_INTERVALLE,
  parseCsv, validateFrage, normalizeFrage, normalizeIntervall, validateInfo, normalizeInfo,
  importCsv, importJson, importText,
  exportQuizCsv, exportQuizJson, exportResultCsv,
};
