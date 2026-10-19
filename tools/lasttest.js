// Lasttest: simuliert einen Quizleiter und viele Teilnehmer und misst die Reaktionszeiten.
//
//   npm run lasttest                      startet eigenen Testserver (Port 3099, temporäre Daten)
//   npm run lasttest -- --spieler 60      mehr Teilnehmer
//   npm run lasttest -- --url http://192.168.178.20:3000 --pin 112112
//                                         gegen einen laufenden Server (legt dort ein Ergebnis an!)
//
// Gemessen wird jeweils von "Ereignis ausgelöst" bis "beim Empfänger angekommen" – alle
// Clients laufen in diesem Prozess, daher gilt eine gemeinsame Uhr.

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

// ---------- Optionen ----------

const args = process.argv.slice(2);
const opt = (name, std) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : std;
};
const ANZAHL = Number(opt('spieler', 30));
const MAX_DENKZEIT = Number(opt('denkzeit', 3000)); // ms, zufällige Antwortverzögerung
const QUOTE_RICHTIG = 0.7;
const ANZAHL_RECONNECT = Math.min(5, Math.floor(ANZAHL / 6));
let URL = opt('url', null);
const ADMIN_PIN = opt('pin', JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')).adminPin);

// ---------- Hilfen ----------

const jetzt = () => performance.now();
const warte = ms => new Promise(r => setTimeout(r, ms));

function emit(socket, ereignis, daten) {
  const t = jetzt();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout bei ${ereignis}`)), 10000);
    socket.emit(ereignis, daten, res => {
      clearTimeout(timer);
      resolve({ res, ms: jetzt() - t });
    });
  });
}

function einmal(socket, ereignis, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Warte vergeblich auf ${ereignis}`)), timeoutMs);
    socket.once(ereignis, d => { clearTimeout(timer); resolve(d); });
  });
}

function verbinde() {
  const s = io(URL, { reconnection: false, forceNew: true });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

const messungen = {};
const letzteAntwort = []; // je Frage: Zeitpunkt, an dem die letzte Antwort losgeschickt wurde
function miss(name, ms) { (messungen[name] = messungen[name] || []).push(ms); }

function statistik(werte) {
  const s = [...werte].sort((a, b) => a - b);
  const p = q => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return {
    n: s.length,
    min: s[0], mittel: s.reduce((a, b) => a + b, 0) / s.length,
    p50: p(0.5), p95: p(0.95), max: s[s.length - 1],
  };
}

async function api(pfad) {
  const res = await fetch(URL + '/api' + pfad, { headers: { 'x-admin-pin': ADMIN_PIN } });
  if (!res.ok) throw new Error(`${pfad}: HTTP ${res.status}`);
  return res.json();
}

// ---------- Testserver ----------

let server = null;
let tmpDir = null;

async function starteServer() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmfw-lasttest-'));
  const port = 3099;
  URL = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), QMFW_DATA_DIR: tmpDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', d => process.stderr.write('[server] ' + d));
  await new Promise((resolve, reject) => {
    server.stdout.on('data', d => { if (String(d).includes('läuft')) resolve(); });
    server.once('exit', c => reject(new Error('Server beendet mit Code ' + c)));
  });
}

function stoppeServer() {
  if (server) server.kill();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------- Teilnehmer ----------

class Teilnehmer {
  constructor(nr, quiz) {
    this.nr = nr;
    this.name = `Testperson ${String(nr).padStart(2, '0')}`;
    this.quiz = quiz;
    this.punkteSumme = 0;
    this.ende = null;
    this.frageEmpfangen = [];
    this.endeEmpfangen = [];
    this.fehler = [];
    this.gleichzeitig = false; // Frage 1: alle antworten im selben Moment
  }

  async beitreten(pin) {
    this.pin = pin;
    this.socket = await verbinde();
    this.ereignisse();
    const { res, ms } = await emit(this.socket, 'spieler:beitreten', { pin, name: this.name });
    if (!res.ok) throw new Error(`${this.name}: ${res.fehler}`);
    this.token = res.token;
    miss('Beitreten (Antwort Server)', ms);
  }

  ereignisse() {
    this.socket.on('frage:start', f => {
      this.frageEmpfangen[f.index] = jetzt();
      const denkzeit = this.gleichzeitig ? 0 : 200 + Math.random() * MAX_DENKZEIT;
      const richtig = Math.random() < QUOTE_RICHTIG;
      const frage = this.quiz.fragen[f.index];
      const index = richtig ? frage.richtig : (frage.richtig + 1) % frage.antworten.length;
      setTimeout(async () => {
        while (this.wackelt) await warte(50); // während Verbindungsabbruch erst nach dem Wiederverbinden senden
        letzteAntwort[f.index] = Math.max(letzteAntwort[f.index] || 0, jetzt());
        try {
          const { res, ms } = await emit(this.socket, 'spieler:antwort', { index });
          if (!res.ok) this.fehler.push(`F${f.index + 1}: ${res.fehler}`);
          miss(this.gleichzeitig ? 'Antwort senden (alle gleichzeitig)' : 'Antwort senden', ms);
        } catch (e) { this.fehler.push(e.message); }
      }, denkzeit);
    });
    this.socket.on('frage:ende', e => {
      this.endeEmpfangen.push(jetzt());
      this.punkteSumme += e.punkteFrage;
    });
    this.socket.on('spiel:ende', e => { this.ende = e; });
  }

  // Verbindung abreißen lassen und mit Token wieder einsteigen (wie Handy mit WLAN-Aussetzer)
  async wackeln() {
    this.wackelt = true;
    this.socket.disconnect();
    await warte(300);
    this.socket = await verbinde();
    this.ereignisse();
    const { res, ms } = await emit(this.socket, 'spieler:wiederverbinden', { pin: this.pin, token: this.token });
    if (!res.ok) throw new Error(`${this.name}: Wiederverbinden fehlgeschlagen`);
    miss('Wiederverbinden', ms);
    this.wackelt = false;
  }
}

// ---------- Ablauf ----------

async function main() {
  const t0 = jetzt();
  if (!URL) await starteServer();
  console.log(`\nLasttest gegen ${URL} mit ${ANZAHL} Teilnehmern\n`);

  const liste = await api('/quizze');
  const eintrag = liste.find(q => q.anzahlFragen > 0);
  if (!eintrag) throw new Error('Kein Quiz mit Fragen gefunden');
  const quiz = await api('/quizze/' + eintrag.id);
  console.log(`Quiz: „${quiz.titel}“ (${quiz.fragen.length} Fragen)`);

  // Quizleiter
  const host = await verbinde();
  const { res: erstellt } = await emit(host, 'host:erstellen', { quizId: quiz.id, adminPin: ADMIN_PIN });
  if (!erstellt.ok) throw new Error(erstellt.fehler);
  const pin = erstellt.zustand.pin;
  console.log(`Spiel-PIN: ${pin}`);

  // Alle Teilnehmer treten gleichzeitig bei (wie nach dem Zeigen des QR-Codes)
  const spieler = Array.from({ length: ANZAHL }, (_, i) => new Teilnehmer(i + 1, quiz));
  const lobbyFertig = new Promise(resolve => {
    host.on('lobby:update', d => { if (d.spieler.length === ANZAHL) resolve(jetzt()); });
  });
  const tJoin = jetzt();
  await Promise.all(spieler.map(s => s.beitreten(pin)));
  const tLobby = await lobbyFertig;
  console.log(`${ANZAHL} Teilnehmer beigetreten in ${(tLobby - tJoin).toFixed(0)} ms (inkl. Verbindungsaufbau)`);

  let hostFrageAntworten = 0;
  host.on('frage:antworten', () => { hostFrageAntworten++; });

  for (let q = 0; q < quiz.fragen.length; q++) {
    spieler.forEach(s => { s.gleichzeitig = q === 0; });

    // Frage starten: Zeit bis alle Teilnehmer sie haben
    const hostFrage = einmal(host, 'frage:start');
    const tStart = jetzt();
    await emit(host, 'host:weiter');
    await hostFrage;
    miss('Frage-Start → Quizleiter', jetzt() - tStart);

    // Bei Frage 3 haben einige Teilnehmer einen Verbindungsabbruch
    if (q === 2) {
      await Promise.all(spieler.slice(0, ANZAHL_RECONNECT).map(s => s.wackeln()));
    }

    // Warten, bis die Frage endet (alle haben geantwortet → automatisches Ende)
    const aufl = await einmal(host, 'frage:ende', (quiz.fragen[q].zeit + 5) * 1000);
    const tEnde = jetzt();
    await warte(200);
    spieler.forEach(s => {
      if (s.frageEmpfangen[q] != null) miss('Frage-Start → Teilnehmer', s.frageEmpfangen[q] - tStart);
    });
    miss('Letzte Antwort → Auflösung Quizleiter', tEnde - letzteAntwort[q]);
    spieler.forEach(s => {
      const t = s.endeEmpfangen[q];
      if (t) miss('Letzte Antwort → Auflösung Teilnehmer', t - letzteAntwort[q]);
    });
    const summe = aufl.verteilung.reduce((a, b) => a + b, 0);
    if (summe !== ANZAHL) console.log(`  ! Frage ${q + 1}: nur ${summe}/${ANZAHL} Antworten gezählt`);

    // Info-Seite (falls für diese Frage eingerichtet)
    if (aufl.info) {
      const info = einmal(host, 'info:start');
      const tInfo = jetzt();
      await emit(host, 'host:weiter');
      await info;
      miss('Info-Seite → Quizleiter', jetzt() - tInfo);
    }

    // Rangliste (nur wenn laut Quiz-Einstellung fällig; sonst startet das nächste "weiter" die Frage)
    if (!aufl.rangliste) continue;
    const rang = einmal(host, 'rangliste');
    const tRang = jetzt();
    await emit(host, 'host:weiter');
    await rang;
    miss('Rangliste → Quizleiter', jetzt() - tRang);
  }

  // Spielende
  const endeHost = einmal(host, 'spiel:ende');
  const tSpielEnde = jetzt();
  await emit(host, 'host:weiter');
  const ende = await endeHost;
  miss('Spielende inkl. Speichern → Quizleiter', jetzt() - tSpielEnde);
  await warte(300);

  // ---------- Prüfungen ----------
  const probleme = [];
  const ergebnis = await api('/ergebnisse/' + ende.ergebnisId);
  if (ergebnis.spieler.length !== ANZAHL) probleme.push(`Ergebnis enthält ${ergebnis.spieler.length} statt ${ANZAHL} Teilnehmer`);
  for (const s of spieler) {
    const e = ergebnis.spieler.find(x => x.name === s.name);
    if (!e) { probleme.push(`${s.name} fehlt im Ergebnis`); continue; }
    const beantwortet = e.antworten.filter(a => a.index != null).length;
    if (beantwortet !== quiz.fragen.length) probleme.push(`${s.name}: nur ${beantwortet}/${quiz.fragen.length} Antworten gespeichert`);
    if (!s.ende) probleme.push(`${s.name}: Spielende nicht empfangen`);
    else if (s.ende.punkte !== e.punkte) probleme.push(`${s.name}: Punkte Handy ${s.ende.punkte} ≠ gespeichert ${e.punkte}`);
    if (s.punkteSumme !== e.punkte) probleme.push(`${s.name}: Summe der Einzelpunkte ${s.punkteSumme} ≠ ${e.punkte}`);
    probleme.push(...s.fehler.map(f => `${s.name}: ${f}`));
  }
  const reihenfolge = ergebnis.spieler.every((s, i, a) => i === 0 || a[i - 1].punkte >= s.punkte);
  if (!reihenfolge) probleme.push('Rangliste ist nicht absteigend sortiert');

  // ---------- Bericht ----------
  console.log('\nReaktionszeiten in Millisekunden');
  const zeilen = Object.entries(messungen).map(([name, werte]) => {
    const st = statistik(werte);
    return {
      Messung: name, Anzahl: st.n,
      Min: st.min.toFixed(1), Mittel: st.mittel.toFixed(1), Median: st.p50.toFixed(1),
      P95: st.p95.toFixed(1), Max: st.max.toFixed(1),
    };
  });
  console.table(zeilen);
  console.log(`Antwort-Meldungen an Quizleiter: ${hostFrageAntworten}`);
  console.log(`Wiederverbindungen getestet: ${ANZAHL_RECONNECT} Teilnehmer bei Frage 3`);
  console.log(`Sieger: ${ende.rangliste[0].name} mit ${ende.rangliste[0].punkte} Punkten`);
  console.log(`Gesamtdauer: ${((jetzt() - t0) / 1000).toFixed(1)} s`);
  if (probleme.length) {
    console.log(`\n✖ ${probleme.length} Problem(e):`);
    probleme.slice(0, 30).forEach(p => console.log('  - ' + p));
  } else {
    console.log('\n✔ Alle Prüfungen bestanden: jede Antwort gezählt, Punkte auf Handy = gespeicherte Punkte, Ergebnis vollständig.');
  }

  host.disconnect();
  spieler.forEach(s => s.socket.disconnect());
  return probleme.length ? 1 : 0;
}

main()
  .then(code => { stoppeServer(); process.exit(code); })
  .catch(e => { console.error('\nAbbruch:', e.message); stoppeServer(); process.exit(1); });
