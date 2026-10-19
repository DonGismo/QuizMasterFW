const test = require('node:test');
const assert = require('node:assert');
const imp = require('../server/importer');
const { berechnePunkte } = require('../server/game');

test('CSV mit Kopfzeile, Umlauten und Anführungszeichen', () => {
  const csv = '﻿Frage;Antwort A;Antwort B;Antwort C;Antwort D;Richtig;Zeit\r\n'
    + 'Womit löscht man einen Fettbrand?;Wasser;Löschdecke;Schaum;CO2;B;20\r\n'
    + '"Was ist ""ABC""; kurz?";Atemschutz;"Zeile1\nZeile2";;;a;\r\n';
  const { fragen, fehler } = imp.importCsv(csv, 25);
  assert.deepStrictEqual(fehler, []);
  assert.strictEqual(fragen.length, 2);
  assert.deepStrictEqual(fragen[0], { frage: 'Womit löscht man einen Fettbrand?', antworten: ['Wasser', 'Löschdecke', 'Schaum', 'CO2'], richtig: 1, zeit: 20 });
  assert.strictEqual(fragen[1].frage, 'Was ist "ABC"; kurz?');
  assert.deepStrictEqual(fragen[1].antworten, ['Atemschutz', 'Zeile1\nZeile2']);
  assert.strictEqual(fragen[1].zeit, 25);
});

test('CSV-Fehler werden mit Zeilennummer gemeldet', () => {
  const csv = 'Frage;Antwort A;Antwort B;Antwort C;Antwort D;Richtig;Zeit\n'
    + 'Gut;Ja;Nein;;;1;10\n'
    + 'Ohne Lösung;Ja;Nein;;;;10\n'
    + 'Nur eine;Ja;;;;A;10\n'
    + 'Zu lang;Ja;Nein;;;A;500\n'
    + 'Falsch zeigt;Ja;Nein;;;D;10\n';
  const { fragen, fehler } = imp.importCsv(csv);
  assert.strictEqual(fragen.length, 1);
  assert.deepStrictEqual(fehler.map(f => f.zeile), [3, 4, 5, 6]);
  assert.match(fehler[0].meldung, /Richtig/);
  assert.match(fehler[1].meldung, /Mindestens 2/);
  assert.match(fehler[2].meldung, /Zeit/);
});

test('CSV ohne Kopfzeile und mit Komma', () => {
  const { fragen, fehler } = imp.importCsv('Frage X,A1,A2,,,B,15');
  assert.deepStrictEqual(fehler, []);
  assert.strictEqual(fragen[0].richtig, 1);
});

test('Export → Import ergibt dieselben Fragen (CSV und JSON)', () => {
  const quiz = { titel: 'T', beschreibung: 'B', fragen: [
    { frage: 'F; mit "Zeichen"', antworten: ['a', 'b', 'c'], richtig: 2, zeit: 30 },
    { frage: 'Zwei', antworten: ['x', 'y'], richtig: 0, zeit: 5 },
  ] };
  assert.deepStrictEqual(imp.importCsv(imp.exportQuizCsv(quiz)).fragen, quiz.fragen);
  const j = imp.importJson(imp.exportQuizJson(quiz));
  assert.deepStrictEqual(j.fragen, quiz.fragen);
  assert.strictEqual(j.titel, 'T');
  assert.strictEqual(j.ranglisteIntervall, 1);
  assert.strictEqual(imp.importJson(imp.exportQuizJson({ ...quiz, ranglisteIntervall: 3 })).ranglisteIntervall, 3);
  assert.strictEqual(imp.normalizeIntervall(4), 1);
});

test('JSON-Import erkennt ungültige Fragen', () => {
  const r = imp.importText('{"fragen":[{"frage":"a","antworten":["x","y"],"richtig":5}]}', 'x.json');
  assert.strictEqual(r.fragen.length, 0);
  assert.strictEqual(r.fehler[0].zeile, 1);
});

test('Punkte: 1000 sofort, 500 am Ende, nie darunter', () => {
  assert.strictEqual(berechnePunkte(0, 20), 1000);
  assert.strictEqual(berechnePunkte(10000, 20), 750);
  assert.strictEqual(berechnePunkte(20000, 20), 500);
  assert.strictEqual(berechnePunkte(25000, 20), 500);
});

test('Info-Seite: gültige Folie wird übernommen, auch im JSON-Export', () => {
  const info = {
    aktiv: true, hintergrund: 'rot',
    elemente: [
      { id: 't1', typ: 'text', x: 5, y: 5, w: 90, h: 15, z: 1, stil: 'titel', groesse: 'xl', ausrichtung: 'mitte', text: 'Überschrift\nZeile 2', fremd: 'weg' },
      { id: 'b1', typ: 'bild', x: 50, y: 25, w: 40, h: 60, z: 2, src: '/medien/0123456789abcdef.jpg' },
      { id: 'v1', typ: 'video', x: 5, y: 25, w: 40, h: 60, z: 3, src: null, youtube: 'dQw4w9WgXcQ' },
    ],
  };
  const f = { frage: 'F', antworten: ['a', 'b'], richtig: 0, zeit: 20, info };
  assert.deepStrictEqual(imp.validateFrage(f), []);
  const n = imp.normalizeFrage(f);
  assert.strictEqual(n.info.elemente[0].fremd, undefined);
  assert.strictEqual(n.info.elemente[0].text, 'Überschrift\nZeile 2');
  const zurueck = imp.importJson(imp.exportQuizJson({ titel: 'T', fragen: [n] }));
  assert.deepStrictEqual(zurueck.fragen[0].info, n.info);
});

test('Info-Seite: fremde Dateipfade, falsche YouTube-IDs und Typen werden abgelehnt', () => {
  const basis = { frage: 'F', antworten: ['a', 'b'], richtig: 0, zeit: 20 };
  const mit = e => imp.validateFrage({ ...basis, info: { aktiv: true, elemente: [{ x: 0, y: 0, w: 10, h: 10, ...e }] } });
  assert.match(mit({ typ: 'bild', src: 'https://example.com/x.jpg' }).join(), /Bilddatei/);
  assert.match(mit({ typ: 'bild', src: '/medien/../config.json' }).join(), /Bilddatei/);
  assert.match(mit({ typ: 'video', youtube: 'javascript:alert(1)' }).join(), /Video/);
  assert.match(mit({ typ: 'html', text: '<b>x</b>' }).join(), /Typ/);
  assert.match(mit({ typ: 'text', text: 'x', w: 500 }).join(), /Größe/);
  assert.deepStrictEqual(imp.validateFrage(basis), []); // ohne Info-Seite weiterhin gültig
});
