// Quiz-Paket: ein ZIP mit quiz.json (Fragen, Einstellungen, Info-Folien) und allen Bildern/Videos
// der Info-Folien unter medien/. So lassen sich komplette Quizze zwischen Rechnern/Wehren austauschen.
// Eigenes kleines ZIP-Format (ohne Zusatzpakete): Schreiben unkomprimiert („stored“), Lesen auch
// „deflate“, damit auch mit dem Windows-Explorer neu gepackte Pakete funktionieren.

const zlib = require('zlib');
const importer = require('./importer');

const PAKET_FORMAT = 'quizmaster-fw-paket';
const PAKET_VERSION = 1;

// ---------- ZIP ----------

function dosZeit(d) {
  return {
    zeit: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    datum: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// dateien: [{ name, daten: Buffer }] → ZIP-Buffer
function erstelleZip(dateien) {
  const { zeit, datum } = dosZeit(new Date());
  const lokal = [];
  const zentral = [];
  let offset = 0;
  for (const { name, daten } of dateien) {
    const n = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(daten);
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0);
    kopf.writeUInt16LE(20, 4);
    kopf.writeUInt16LE(0x0800, 6); // Dateinamen in UTF-8
    kopf.writeUInt16LE(0, 8); // stored
    kopf.writeUInt16LE(zeit, 10);
    kopf.writeUInt16LE(datum, 12);
    kopf.writeUInt32LE(crc, 14);
    kopf.writeUInt32LE(daten.length, 18);
    kopf.writeUInt32LE(daten.length, 22);
    kopf.writeUInt16LE(n.length, 26);
    lokal.push(kopf, n, daten);

    const z = Buffer.alloc(46);
    z.writeUInt32LE(0x02014b50, 0);
    z.writeUInt16LE(20, 4);
    z.writeUInt16LE(20, 6);
    z.writeUInt16LE(0x0800, 8);
    z.writeUInt16LE(0, 10);
    z.writeUInt16LE(zeit, 12);
    z.writeUInt16LE(datum, 14);
    z.writeUInt32LE(crc, 16);
    z.writeUInt32LE(daten.length, 20);
    z.writeUInt32LE(daten.length, 24);
    z.writeUInt16LE(n.length, 28);
    z.writeUInt32LE(offset, 42);
    zentral.push(z, n);
    offset += 30 + n.length + daten.length;
  }
  const zentralLaenge = zentral.reduce((s, b) => s + b.length, 0);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0);
  ende.writeUInt16LE(dateien.length, 8);
  ende.writeUInt16LE(dateien.length, 10);
  ende.writeUInt32LE(zentralLaenge, 12);
  ende.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokal, ...zentral, ende]);
}

// ZIP-Buffer → Map(name → Buffer). Wirft bei kaputten oder nicht unterstützten Dateien.
function leseZip(buf) {
  let ende = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { ende = i; break; }
  }
  if (ende < 0) throw new Error('Keine gültige ZIP-Datei');
  const anzahl = buf.readUInt16LE(ende + 10);
  let p = buf.readUInt32LE(ende + 16);
  const dateien = new Map();
  for (let i = 0; i < anzahl; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP-Verzeichnis beschädigt');
    const methode = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const gepackt = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), kl = buf.readUInt16LE(p + 32);
    const lokalOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8').replace(/\\/g, '/');
    p += 46 + nl + el + kl;
    if (name.endsWith('/')) continue; // Ordner
    if (lokalOffset + 30 > buf.length || buf.readUInt32LE(lokalOffset) !== 0x04034b50) throw new Error('ZIP-Eintrag beschädigt: ' + name);
    const start = lokalOffset + 30 + buf.readUInt16LE(lokalOffset + 26) + buf.readUInt16LE(lokalOffset + 28);
    const roh = buf.subarray(start, start + gepackt);
    let daten;
    if (methode === 0) daten = roh;
    else if (methode === 8) daten = zlib.inflateRawSync(roh);
    else throw new Error(`Komprimierungsart ${methode} wird nicht unterstützt (${name})`);
    if (zlib.crc32(daten) !== crc) throw new Error('Prüfsumme falsch – Datei beschädigt: ' + name);
    dateien.set(name, daten);
  }
  return dateien;
}

// ---------- Medien ----------

// Dateityp am Inhalt erkennen (nicht am Namen)
function erkenneMedientyp(b) {
  if (!b || b.length < 12) return null;
  const hex = b.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e47')) return 'png';
  if (hex.startsWith('ffd8ff')) return 'jpg';
  if (hex.startsWith('47494638')) return 'gif';
  if (hex.startsWith('52494646') && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  if (hex.startsWith('1a45dfa3')) return 'webm';
  return null;
}

const medienName = src => (typeof src === 'string' && src.startsWith('/medien/') ? src.slice('/medien/'.length) : null);

// Ruft fn(element, frageIndex) für alle Bild-/Video-Elemente mit Datei auf
function medienElemente(fragen, fn) {
  fragen.forEach((f, q) => {
    if (!f.info || !Array.isArray(f.info.elemente)) return;
    f.info.elemente.forEach(e => { if ((e.typ === 'bild' || e.typ === 'video') && e.src) fn(e, q); });
  });
}

// Entfernt Bild-/Video-Elemente, deren Datei es nicht gibt. existiert(name) → bool.
// Videos mit YouTube-Link bleiben (nur die Datei fällt weg). Liefert Hinweise für die Oberfläche.
function entferneFehlendeMedien(fragen, existiert) {
  const hinweise = [];
  fragen.forEach((f, q) => {
    if (!f.info || !Array.isArray(f.info.elemente)) return;
    f.info.elemente = f.info.elemente.filter(e => {
      if ((e.typ !== 'bild' && e.typ !== 'video') || !e.src) return true;
      const name = medienName(e.src);
      if (name && existiert(name)) return true;
      if (e.typ === 'video' && e.youtube) { e.src = null; return true; }
      hinweise.push(`Frage ${q + 1}: ${e.typ === 'bild' ? 'Bild' : 'Video'} „${name || e.src}“ fehlt und wurde von der Info-Folie entfernt`);
      return false;
    });
  });
  return hinweise;
}

// ---------- Paket ----------

// quiz + leseMedium(name) → Buffer|null  →  ZIP-Buffer
function erstellePaket(quiz, leseMedium) {
  const json = JSON.parse(importer.exportQuizJson(quiz));
  const fehlend = [];
  const medien = new Map();
  medienElemente(json.fragen, e => {
    const name = medienName(e.src);
    if (!name || medien.has(name)) return;
    const daten = leseMedium(name);
    if (daten) medien.set(name, daten);
    else fehlend.push(name);
  });
  const inhalt = { format: PAKET_FORMAT, version: PAKET_VERSION, exportiert: new Date().toISOString(), ...json };
  const liesmich = [
    `QuizMaster FW – Quiz-Paket „${quiz.titel}“`,
    '',
    'Import: QuizMaster FW → Verwaltung → Import → diese ZIP-Datei auswählen.',
    'Das Paket enthält Fragen, Antworten, Einstellungen, Info-Folien und deren Bilder/Videos.',
    fehlend.length ? `\nBeim Export fehlten ${fehlend.length} Mediendatei(en) auf dem Server: ${fehlend.join(', ')}` : '',
  ].join('\r\n');
  return erstelleZip([
    { name: 'quiz.json', daten: Buffer.from(JSON.stringify(inhalt, null, 2), 'utf8') },
    ...[...medien].map(([name, daten]) => ({ name: 'medien/' + name, daten })),
    { name: 'LIESMICH.txt', daten: Buffer.from(liesmich, 'utf8') },
  ]);
}

// ZIP-Buffer → Ergebnis wie importJson ({ titel, beschreibung, ranglisteIntervall, fragen, fehler })
// plus hinweise. Medien werden über speichereMedium(buffer, ext) → src neu abgelegt.
function lesePaket(buf, { standardZeit = 20, speichereMedium }) {
  let dateien;
  try {
    dateien = leseZip(buf);
  } catch (e) {
    return { fragen: [], fehler: [{ zeile: 0, meldung: e.message }], hinweise: [] };
  }
  // quiz.json darf auch in einem Unterordner liegen (z. B. nach Entpacken und neu Packen)
  const quizName = [...dateien.keys()].find(n => n === 'quiz.json' || n.endsWith('/quiz.json'));
  if (!quizName) return { fragen: [], fehler: [{ zeile: 0, meldung: 'Das ZIP enthält keine quiz.json – ist es ein QuizMaster-Paket?' }], hinweise: [] };
  const basis = quizName.slice(0, -'quiz.json'.length);

  const ergebnis = importer.importJson(dateien.get(quizName).toString('utf8'), standardZeit);
  const hinweise = [];
  const neu = new Map(); // alter Name → neuer src
  medienElemente(ergebnis.fragen, e => {
    const name = medienName(e.src);
    if (!name || neu.has(name)) return;
    const daten = dateien.get(basis + 'medien/' + name);
    const ext = erkenneMedientyp(daten);
    if (!daten || !ext) return; // wird unten als fehlend gemeldet
    neu.set(name, speichereMedium(daten, ext));
  });
  medienElemente(ergebnis.fragen, e => {
    const name = medienName(e.src);
    if (neu.has(name)) e.src = neu.get(name);
  });
  // Was nicht gespeichert wurde, fehlt im Paket oder ist kein unterstütztes Format
  hinweise.push(...entferneFehlendeMedien(ergebnis.fragen, name => [...neu.values()].includes('/medien/' + name)));
  if (neu.size) hinweise.unshift(`${neu.size} Bild-/Videodatei(en) aus dem Paket übernommen`);
  return { ...ergebnis, hinweise };
}

module.exports = { erstelleZip, leseZip, erkenneMedientyp, entferneFehlendeMedien, erstellePaket, lesePaket, medienName };
