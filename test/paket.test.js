const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const paket = require('../server/paket');

// Minimal gültige Dateianfänge, damit die Typerkennung greift
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d', 'hex'), Buffer.from('bild-daten')]);
const MP4 = Buffer.concat([Buffer.from('00000018', 'hex'), Buffer.from('ftypmp42'), Buffer.from('video-daten')]);

function quizMitFolie() {
  return {
    titel: 'Atemschutz', beschreibung: 'B', ranglisteIntervall: 3,
    fragen: [
      {
        frage: 'F1', antworten: ['a', 'b'], richtig: 1, zeit: 20,
        info: {
          aktiv: true, hintergrund: 'rot',
          elemente: [
            { id: 't', typ: 'text', x: 5, y: 5, w: 90, h: 10, z: 1, stil: 'titel', groesse: 'xl', ausrichtung: 'links', text: 'Überschrift' },
            { id: 'b', typ: 'bild', x: 10, y: 20, w: 30, h: 30, z: 2, src: '/medien/aaaaaaaaaaaa.png' },
            { id: 'v', typ: 'video', x: 50, y: 20, w: 40, h: 40, z: 3, src: '/medien/bbbbbbbbbbbb.mp4', youtube: null },
          ],
        },
      },
      { frage: 'F2', antworten: ['x', 'y', 'z'], richtig: 0, zeit: 15,
        info: { aktiv: true, hintergrund: 'weiss', elemente: [{ id: 'b2', typ: 'bild', x: 0, y: 0, w: 50, h: 50, z: 1, src: '/medien/aaaaaaaaaaaa.png' }] } },
    ],
  };
}

test('ZIP: Schreiben und Lesen, auch mit Umlauten im Namen und deflate', () => {
  const zip = paket.erstelleZip([{ name: 'a.txt', daten: Buffer.from('hallo') }, { name: 'medien/ä.bin', daten: Buffer.from([0, 1, 2]) }]);
  const d = paket.leseZip(zip);
  assert.strictEqual(d.get('a.txt').toString(), 'hallo');
  assert.deepStrictEqual([...d.get('medien/ä.bin')], [0, 1, 2]);

  // Eintrag mit Methode 8 (deflate) von Hand bauen und einlesen
  const roh = Buffer.from('komprimierter Text '.repeat(20));
  const gepackt = zlib.deflateRawSync(roh);
  const z = paket.erstelleZip([{ name: 'x.txt', daten: gepackt }]);
  z.writeUInt16LE(8, 8); // lokale Kopfzeile: Methode
  const zentral = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  z.writeUInt16LE(8, zentral + 10);
  z.writeUInt32LE(zlib.crc32(roh), zentral + 16);
  z.writeUInt32LE(roh.length, zentral + 24); // entpackte Größe
  assert.strictEqual(paket.leseZip(z).get('x.txt').toString(), roh.toString());

  assert.throws(() => paket.leseZip(Buffer.from('kein zip')), /ZIP/);
});

test('Paket: Export → Import übernimmt Fragen, Einstellungen, Folien und Medien', () => {
  const medien = { 'aaaaaaaaaaaa.png': PNG, 'bbbbbbbbbbbb.mp4': MP4 };
  const zip = paket.erstellePaket(quizMitFolie(), name => medien[name] || null);
  const inhalt = paket.leseZip(zip);
  assert.ok(inhalt.has('quiz.json') && inhalt.has('medien/aaaaaaaaaaaa.png') && inhalt.has('medien/bbbbbbbbbbbb.mp4'));
  assert.strictEqual([...inhalt.keys()].filter(n => n.startsWith('medien/')).length, 2); // doppelt genutztes Bild nur einmal

  const gespeichert = [];
  const r = paket.lesePaket(zip, {
    speichereMedium: (daten, ext) => { gespeichert.push({ daten, ext }); return `/medien/${'c'.repeat(11)}${gespeichert.length}.${ext}`; },
  });
  assert.deepStrictEqual(r.fehler, []);
  assert.strictEqual(r.titel, 'Atemschutz');
  assert.strictEqual(r.ranglisteIntervall, 3);
  assert.strictEqual(r.fragen.length, 2);
  assert.deepStrictEqual(gespeichert.map(g => g.ext).sort(), ['mp4', 'png']);
  assert.ok(gespeichert.find(g => g.ext === 'png').daten.equals(PNG));
  const el = r.fragen[0].info.elemente;
  assert.strictEqual(el[0].text, 'Überschrift');
  assert.strictEqual(r.fragen[0].info.hintergrund, 'rot');
  assert.match(el[1].src, /^\/medien\/c+\d\.png$/);
  assert.strictEqual(r.fragen[1].info.elemente[0].src, el[1].src); // gleiche Datei → gleicher neuer Pfad
  assert.match(r.hinweise[0], /2 Bild-\/Videodatei/);
});

test('Paket: fehlende Medien werden von der Folie entfernt und gemeldet', () => {
  const zip = paket.erstellePaket(quizMitFolie(), name => (name.endsWith('.png') ? PNG : null));
  const r = paket.lesePaket(zip, { speichereMedium: (d, ext) => '/medien/dddddddddddd.' + ext });
  assert.deepStrictEqual(r.fragen[0].info.elemente.map(e => e.typ), ['text', 'bild']);
  assert.ok(r.hinweise.some(h => /Video .*fehlt/.test(h)));
});

test('Paket: ZIP ohne quiz.json wird abgelehnt', () => {
  const r = paket.lesePaket(paket.erstelleZip([{ name: 'x.txt', daten: Buffer.from('x') }]), { speichereMedium: () => '' });
  assert.match(r.fehler[0].meldung, /quiz\.json/);
});

test('JSON-Import: Verweise auf nicht vorhandene Medien werden entfernt, YouTube bleibt', () => {
  const q = quizMitFolie();
  q.fragen[0].info.elemente[2].youtube = 'dQw4w9WgXcQ';
  const hinweise = paket.entferneFehlendeMedien(q.fragen, () => false);
  assert.deepStrictEqual(q.fragen[0].info.elemente.map(e => e.typ), ['text', 'video']);
  assert.strictEqual(q.fragen[0].info.elemente[1].src, null);
  assert.strictEqual(q.fragen[1].info.elemente.length, 0);
  assert.strictEqual(hinweise.length, 2);
});

// Baut ein ZIP mit einem deflate-Eintrag; angegebeneGroesse = Größe laut ZIP-Verzeichnis
function deflateZip(roh, angegebeneGroesse) {
  const z = paket.erstelleZip([{ name: 'x.bin', daten: zlib.deflateRawSync(roh) }]);
  z.writeUInt16LE(8, 8);
  const zentral = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  z.writeUInt16LE(8, zentral + 10);
  z.writeUInt32LE(zlib.crc32(roh), zentral + 16);
  z.writeUInt32LE(angegebeneGroesse, zentral + 24);
  return z;
}

test('ZIP-Bombe: mehr entpacken als angegeben wird abgelehnt', () => {
  const roh = Buffer.alloc(5 * 1024 * 1024); // 5 MB Nullen, gepackt nur wenige KB
  assert.throws(() => paket.leseZip(deflateZip(roh, 1000)), /größer als angegeben/);
});

test('ZIP-Bombe: zu große Gesamtgröße wird vor dem Entpacken abgelehnt', () => {
  const roh = Buffer.alloc(1024);
  assert.throws(() => paket.leseZip(deflateZip(roh, 1024), { maxEntpackt: 512 }), /zu groß/);
  assert.strictEqual(paket.leseZip(deflateZip(roh, 1024), { maxEntpackt: 2048 }).get('x.bin').length, 1024);
});
