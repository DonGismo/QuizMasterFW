// Einstieg: Webserver (Express) + Echtzeit (Socket.IO) für QuizMaster FW.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const store = require('./store');
const importer = require('./importer');
const paket = require('./paket');
const { createGameManager } = require('./game');

// Installierte Version: Konfiguration liegt beschreibbar bei den Daten (QMFW_CONFIG, gesetzt vom Startskript);
// beim ersten Start wird die mitgelieferte config.json dorthin kopiert.
const STANDARD_CONFIG = path.join(__dirname, '..', 'config.json');
const CONFIG_FILE = process.env.QMFW_CONFIG || STANDARD_CONFIG;
if (!fs.existsSync(CONFIG_FILE)) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.copyFileSync(STANDARD_CONFIG, CONFIG_FILE);
}
const config = {
  port: 3000,
  adminPin: '112112',
  standardZeit: 20,
  titel: 'QuizMaster FW',
  basisUrl: '',
  maxUploadMB: 200,
  ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')),
};
const PORT = Number(process.env.PORT) || config.port;
const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

// ---------- Netzwerkadresse ermitteln ----------

// Liefert die IPv4-Adressen dieses Rechners im lokalen Netz (private Bereiche zuerst).
function lanAdressen() {
  const liste = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) liste.push({ name, adresse: i.address });
    }
  }
  const privat = a => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  const virtuell = n => /vmware|virtualbox|vethernet|docker|wsl|hyper-v|loopback/i.test(n);
  liste.sort((x, y) =>
    (privat(y.adresse) - privat(x.adresse)) || (virtuell(x.name) - virtuell(y.name)));
  return liste.map(x => x.adresse);
}

function basisUrl() {
  if (config.basisUrl) return config.basisUrl.replace(/\/$/, '');
  const ip = lanAdressen()[0] || 'localhost';
  return `http://${ip}${PORT === 80 ? '' : ':' + PORT}`;
}

function joinInfo(pin) {
  const basis = basisUrl();
  return {
    basisUrl: basis,
    joinUrl: `${basis}/?pin=${pin}`,
    qrUrl: `/api/qr.svg?pin=${pin}`,
  };
}

// ---------- Admin-PIN ----------

// Schutz gegen Durchprobieren: nach MAX_FEHLVERSUCHE falschen PINs ist die Adresse SPERRE_MS lang gesperrt
// (auch für die richtige PIN). Eine richtige Eingabe setzt den Zähler zurück.
const { STANDARD_PIN, pinFehler, speichereConfig } = require('./einstellungen');
const MAX_FEHLVERSUCHE = 10;
const SPERRE_MS = 5 * 60 * 1000;
const fehlversuche = new Map(); // Adresse → { anzahl, gesperrtBis }

const pinHash = pin => crypto.createHash('sha256').update(String(pin || '')).digest();

// Liefert 'ok', 'falsch' oder 'gesperrt'
function pruefePin(pin, adresse = '') {
  const jetzt = Date.now();
  const eintrag = fehlversuche.get(adresse);
  if (eintrag && eintrag.gesperrtBis > jetzt) return 'gesperrt';
  if (crypto.timingSafeEqual(pinHash(pin), pinHash(config.adminPin))) {
    fehlversuche.delete(adresse);
    return 'ok';
  }
  // Nach Ablauf einer Sperre beginnt die Zählung von vorn
  const anzahl = (eintrag && !eintrag.gesperrtBis ? eintrag.anzahl : 0) + 1;
  const gesperrt = anzahl >= MAX_FEHLVERSUCHE;
  fehlversuche.set(adresse, { anzahl, gesperrtBis: gesperrt ? jetzt + SPERRE_MS : 0 });
  if (gesperrt) console.log(`   Achtung: ${anzahl} falsche Admin-PINs von ${adresse} – für ${SPERRE_MS / 60000} Minuten gesperrt.`);
  return 'falsch';
}

const checkPin = (pin, adresse) => pruefePin(pin, adresse) === 'ok';
const SPERR_TEXT = `Zu viele Fehlversuche – bitte in ${SPERRE_MS / 60000} Minuten erneut versuchen`;

// ---------- Express ----------

const app = express();
app.use(express.json({ limit: '5mb' }));
// no-cache: Browser fragt immer nach (304 wenn unverändert) – nach Updates gibt es keine veralteten Skripte
app.use(express.static(path.join(__dirname, '..', 'public'), { setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));
app.use('/medien', express.static(store.MEDIEN_DIR, { maxAge: '7d', immutable: true }));

// Öffentlich
app.get('/api/info', (req, res) => {
  res.json({ titel: config.titel, version: VERSION, basisUrl: basisUrl(), standardZeit: config.standardZeit });
});

app.get('/api/qr.svg', async (req, res) => {
  const pin = String(req.query.pin || '').replace(/\D/g, '');
  const ziel = pin ? joinInfo(pin).joinUrl : basisUrl();
  const svg = await QRCode.toString(ziel, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
  res.type('image/svg+xml').send(svg);
});

app.post('/api/login', (req, res) => {
  const ergebnis = pruefePin(req.body && req.body.pin, req.ip);
  if (ergebnis === 'ok') res.json({ ok: true, standardPin: String(config.adminPin) === STANDARD_PIN });
  else if (ergebnis === 'gesperrt') res.status(429).json({ fehler: SPERR_TEXT });
  else res.status(401).json({ fehler: 'Falsche PIN' });
});

// Ab hier nur mit Admin-PIN (Header x-admin-pin)
const admin = express.Router();
admin.use((req, res, next) => {
  const ergebnis = pruefePin(req.get('x-admin-pin'), req.ip);
  if (ergebnis === 'ok') return next();
  if (ergebnis === 'gesperrt') return res.status(429).json({ fehler: SPERR_TEXT });
  res.status(401).json({ fehler: 'Admin-PIN fehlt oder ist falsch' });
});

// Admin-PIN ändern: aktuelle PIN muss zusätzlich eingegeben werden (zählt bei Fehlern als Fehlversuch).
// Falsche aktuelle PIN → 403 (nicht 401, sonst meldet die Oberfläche den Benutzer ab).
admin.post('/pin', (req, res) => {
  const { aktuellePin, neuePin } = req.body || {};
  const ergebnis = pruefePin(aktuellePin, req.ip);
  if (ergebnis === 'gesperrt') return res.status(429).json({ fehler: SPERR_TEXT });
  if (ergebnis !== 'ok') return res.status(403).json({ fehler: 'Die aktuelle PIN ist falsch' });
  const fehler = pinFehler(neuePin);
  if (fehler) return res.status(400).json({ fehler });
  if (neuePin === String(config.adminPin)) return res.status(400).json({ fehler: 'Die neue PIN ist dieselbe wie die bisherige' });
  try {
    speichereConfig(CONFIG_FILE, { adminPin: neuePin });
  } catch (e) {
    return res.status(500).json({ fehler: 'Die PIN konnte nicht gespeichert werden: ' + e.message });
  }
  config.adminPin = neuePin; // gilt sofort, ohne Neustart
  console.log('   Admin-PIN wurde in der Verwaltung geändert.');
  res.json({ ok: true });
});

function pruefeQuiz(body) {
  const fehler = [];
  const titel = String((body && body.titel) || '').trim();
  if (!titel) fehler.push('Titel fehlt');
  const fragen = Array.isArray(body && body.fragen) ? body.fragen : [];
  fragen.forEach((f, i) => {
    const m = importer.validateFrage(f);
    if (m.length) fehler.push(`Frage ${i + 1}: ${m.join(', ')}`);
  });
  return {
    fehler,
    quiz: {
      titel,
      beschreibung: String((body && body.beschreibung) || '').trim(),
      ranglisteIntervall: importer.normalizeIntervall(body && body.ranglisteIntervall),
      fragen: fehler.length ? [] : fragen.map(importer.normalizeFrage),
    },
  };
}

admin.get('/quizze', (req, res) => {
  res.json(store.listQuizzes().map(q => ({
    id: q.id, titel: q.titel, beschreibung: q.beschreibung,
    anzahlFragen: q.fragen.length, geaendert: q.geaendert,
    ranglisteIntervall: q.ranglisteIntervall || 1,
  })));
});

admin.get('/quizze/:id', (req, res) => {
  const q = store.getQuiz(req.params.id);
  q ? res.json(q) : res.status(404).json({ fehler: 'Quiz nicht gefunden' });
});

admin.post('/quizze', (req, res) => {
  const { fehler, quiz } = pruefeQuiz(req.body);
  if (fehler.length) return res.status(400).json({ fehler: fehler.join('\n') });
  res.status(201).json(store.saveQuiz(quiz));
});

admin.put('/quizze/:id', (req, res) => {
  if (!store.getQuiz(req.params.id)) return res.status(404).json({ fehler: 'Quiz nicht gefunden' });
  const { fehler, quiz } = pruefeQuiz(req.body);
  if (fehler.length) return res.status(400).json({ fehler: fehler.join('\n') });
  res.json(store.saveQuiz({ ...quiz, id: req.params.id }));
});

admin.delete('/quizze/:id', (req, res) => {
  store.deleteQuiz(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ fehler: 'Quiz nicht gefunden' });
});

admin.post('/quizze/:id/duplizieren', (req, res) => {
  const q = store.getQuiz(req.params.id);
  if (!q) return res.status(404).json({ fehler: 'Quiz nicht gefunden' });
  res.status(201).json(store.saveQuiz({ titel: q.titel + ' (Kopie)', beschreibung: q.beschreibung, ranglisteIntervall: q.ranglisteIntervall, fragen: q.fragen }));
});

function dateiname(text) {
  return (text || 'quiz').replace(/[^\wäöüÄÖÜß\- ]+/g, '').trim().replace(/\s+/g, '_') || 'quiz';
}

// Mediendatei aus data/medien lesen (nur einfache Namen, kein Pfad)
function leseMedium(name) {
  if (!/^[a-f0-9]+\.[a-z0-9]+$/.test(name)) return null;
  try { return fs.readFileSync(path.join(store.MEDIEN_DIR, name)); } catch { return null; }
}
const mediumExistiert = name => /^[a-f0-9]+\.[a-z0-9]+$/.test(name) && fs.existsSync(path.join(store.MEDIEN_DIR, name));

// Export: format=csv (Standard) | json (Fragen + Folien, ohne Mediendateien) | paket (ZIP inkl. Medien)
admin.get('/quizze/:id/export', (req, res) => {
  const q = store.getQuiz(req.params.id);
  if (!q) return res.status(404).json({ fehler: 'Quiz nicht gefunden' });
  if (req.query.format === 'paket') {
    res.attachment(dateiname(q.titel) + '.quizpaket.zip');
    return res.type('application/zip').send(paket.erstellePaket(q, leseMedium));
  }
  const json = req.query.format === 'json';
  const name = dateiname(q.titel) + (json ? '.json' : '.csv');
  res.attachment(name);
  res.type(json ? 'application/json' : 'text/csv; charset=utf-8');
  res.send(json ? importer.exportQuizJson(q) : importer.exportQuizCsv(q));
});

// Import prüfen: liefert Vorschau + Fehler; gespeichert wird danach per POST/PUT /quizze
admin.post('/import/pruefen', (req, res) => {
  const { text, dateiname: name } = req.body || {};
  if (typeof text !== 'string') return res.status(400).json({ fehler: 'Kein Dateiinhalt übermittelt' });
  const ergebnis = importer.importText(text, name, config.standardZeit);
  // JSON kann auf Medien verweisen, die es auf diesem Rechner nicht gibt
  ergebnis.hinweise = paket.entferneFehlendeMedien(ergebnis.fragen, mediumExistiert);
  res.json(ergebnis);
});

// Quiz-Paket (ZIP) prüfen: Medien werden dabei schon abgelegt, Fragen/Folien kommen als Vorschau zurück
const PAKET_LIMIT_MB = Math.max(500, config.maxUploadMB * 5);
admin.post('/import/paket', express.raw({ type: () => true, limit: PAKET_LIMIT_MB + 'mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ fehler: 'Keine Datei übermittelt' });
  res.json(paket.lesePaket(req.body, { standardZeit: config.standardZeit, speichereMedium: store.saveMedium }));
});

// Medien-Upload für Info-Seiten: Rohdaten im Body, Dateityp wird am Inhalt erkannt
admin.post('/medien', express.raw({ type: () => true, limit: config.maxUploadMB + 'mb' }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ fehler: 'Keine Datei übermittelt' });
  const ext = paket.erkenneMedientyp(req.body);
  if (!ext) return res.status(415).json({ fehler: 'Dateityp nicht unterstützt (erlaubt: PNG, JPG, GIF, WebP, MP4, WebM)' });
  res.status(201).json({ src: store.saveMedium(req.body, ext), typ: ['mp4', 'webm'].includes(ext) ? 'video' : 'bild' });
});

admin.get('/ergebnisse', (req, res) => res.json(store.listResults()));

admin.get('/ergebnisse/:id', (req, res) => {
  const r = store.getResult(req.params.id);
  r ? res.json(r) : res.status(404).json({ fehler: 'Ergebnis nicht gefunden' });
});

admin.get('/ergebnisse/:id/csv', (req, res) => {
  const r = store.getResult(req.params.id);
  if (!r) return res.status(404).json({ fehler: 'Ergebnis nicht gefunden' });
  const datum = (r.beendet || '').slice(0, 10);
  res.attachment(`Ergebnis_${dateiname(r.quizTitel)}_${datum}.csv`);
  res.type('text/csv; charset=utf-8').send(importer.exportResultCsv(r));
});

admin.delete('/ergebnisse/:id', (req, res) => {
  store.deleteResult(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ fehler: 'Ergebnis nicht gefunden' });
});

app.use('/api', admin);

// Fehler (z. B. zu große Datei) als JSON melden, damit die Oberfläche sie anzeigen kann
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const zuGross = err.type === 'entity.too.large';
  res.status(err.status || 500).json({ fehler: zuGross ? `Datei zu groß (max. ${req.path.endsWith('/paket') ? PAKET_LIMIT_MB : config.maxUploadMB} MB)` : 'Serverfehler: ' + err.message });
});

// ---------- Start ----------

// Beim allerersten Start ein Beispiel-Quiz anlegen
if (!fs.existsSync(path.join(store.DATA_DIR, 'quizzes.json'))) {
  store.saveQuiz(JSON.parse(fs.readFileSync(path.join(__dirname, 'beispiel-quiz.json'), 'utf8')));
}

const server = http.createServer(app);
const io = new Server(server);
createGameManager(io, store, checkPin, joinInfo);

// Verwaltung im Browser öffnen (Startskript der installierten Version setzt QMFW_BROWSER=1)
function oeffneBrowser() {
  if (process.env.QMFW_BROWSER !== '1' || process.platform !== 'win32') return;
  const { spawn } = require('child_process');
  spawn('cmd', ['/c', 'start', '', `http://localhost:${PORT}/admin.html`], { detached: true, stdio: 'ignore' }).unref();
}

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.log('');
    console.log('   QuizMaster FW läuft bereits (Port ' + PORT + ' ist belegt).');
    console.log('   Die Verwaltung wird im Browser geöffnet.');
    oeffneBrowser();
    setTimeout(() => process.exit(0), 1500);
  } else {
    throw err;
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const adressen = lanAdressen();
  console.log('');
  console.log('  ==============================================');
  console.log('   ' + config.titel + ' ' + VERSION + ' läuft');
  console.log('  ==============================================');
  console.log('   Quizleiter (dieser Rechner): http://localhost:' + PORT + '/admin.html');
  adressen.forEach(ip => console.log('   Teilnehmer im WLAN:          http://' + ip + ':' + PORT));
  if (!adressen.length) console.log('   Achtung: keine Netzwerkadresse gefunden – ist der Rechner mit dem WLAN verbunden?');
  console.log('   Admin-PIN und Port stehen in: ' + CONFIG_FILE);
  console.log('   Daten (Quizze, Ergebnisse, Medien): ' + store.DATA_DIR);
  console.log(process.env.QMFW_TRAY === '1'
    ? '   Beenden: Rechtsklick auf das QuizMaster-Symbol im Infobereich der Taskleiste → Beenden'
    : '   Beenden mit Strg+C oder dieses Fenster schließen');
  console.log('');
  oeffneBrowser();
});
