// Live-Spiel: Zustandsmaschine, Punktevergabe und Socket.IO-Ereignisse.
//
// Ablauf: lobby → frage → aufloesung → [info] → [rangliste] → (frage … | ende)
// Räume:  "spiel:<pin>" = alle Teilnehmer, "host:<pin>" = Quizleiter-Ansicht(en)

const crypto = require('crypto');

const GRACE_MS = 500;               // Puffer für Netzwerklaufzeit am Fragenende
const MAX_NAME = 20;
const SPIEL_TIMEOUT_MS = 6 * 60 * 60 * 1000; // inaktive Spiele nach 6 h verwerfen

function token() {
  return crypto.randomBytes(16).toString('hex');
}

// Punkte nach Antwortgeschwindigkeit: sofort richtig = 1000, am Zeitende richtig = 500.
function berechnePunkte(zeitMs, zeitSek) {
  const anteil = Math.min(Math.max(zeitMs / (zeitSek * 1000), 0), 1);
  return Math.round(1000 * (1 - anteil / 2));
}

class Spiel {
  constructor(pin, quiz) {
    this.pin = pin;
    this.quiz = JSON.parse(JSON.stringify(quiz)); // Momentaufnahme, Änderungen am Quiz wirken nicht mehr
    this.hostToken = token();
    this.zustand = 'lobby';
    this.aktuell = -1;
    this.frageStart = 0;
    this.timer = null;
    this.spieler = new Map(); // id → { id, name, token, socketId, punkte, antworten[], online }
    this.gestartet = null;
    this.letzteAktivitaet = Date.now();
    this.ergebnisId = null;
  }

  get frage() {
    return this.quiz.fragen[this.aktuell];
  }

  get istLetzteFrage() {
    return this.aktuell >= this.quiz.fragen.length - 1;
  }

  get hatInfo() {
    return !!(this.frage && this.frage.info && this.frage.info.aktiv && this.frage.info.elemente.length);
  }

  // Rangliste nur nach jeder n-ten Frage (Quiz-Einstellung); nach der letzten Frage folgt direkt die Siegerehrung
  get ranglisteFaellig() {
    const n = this.quiz.ranglisteIntervall || 1;
    return !this.istLetzteFrage && (this.aktuell + 1) % n === 0;
  }

  // Nach jeder Änderung an Teilnehmern oder Punkten aufrufen (verwirft die zwischengespeicherte Rangliste)
  geaendert() {
    this.cacheRang = null;
  }

  rangliste() {
    if (this.cacheRang) return this.cacheRang;
    this.cacheRang = [...this.spieler.values()]
      .sort((a, b) => b.punkte - a.punkte || a.name.localeCompare(b.name, 'de'))
      .map((s, i) => ({ platz: i + 1, id: s.id, name: s.name, punkte: s.punkte }));
    this.cachePlatz = new Map(this.cacheRang.map(r => [r.id, r.platz]));
    return this.cacheRang;
  }

  platzVon(id) {
    this.rangliste();
    return this.cachePlatz.get(id) || null;
  }

  spielerListe() {
    return [...this.spieler.values()].map(s => ({ id: s.id, name: s.name, online: s.online }));
  }

  anzahlBeantwortet() {
    let n = 0;
    for (const s of this.spieler.values()) if (s.antworten[this.aktuell]) n++;
    return n;
  }

  restMs() {
    if (this.zustand !== 'frage') return 0;
    return Math.max(0, this.frage.zeit * 1000 - (Date.now() - this.frageStart));
  }

  // Daten für das Ergebnisarchiv
  alsErgebnis() {
    return {
      id: this.ergebnisId || undefined,
      quizId: this.quiz.id,
      quizTitel: this.quiz.titel,
      gestartet: this.gestartet,
      beendet: new Date().toISOString(),
      fragen: this.quiz.fragen.slice(0, this.aktuell + 1),
      spieler: this.rangliste().map(r => {
        const s = this.spieler.get(r.id);
        return {
          name: s.name,
          punkte: s.punkte,
          antworten: this.quiz.fragen.slice(0, this.aktuell + 1)
            .map((_, q) => s.antworten[q] || { index: null, richtig: false, punkte: 0, zeitMs: null }),
        };
      }),
    };
  }
}

function createGameManager(io, store, checkPin, getJoinInfo) {
  const spiele = new Map(); // pin → Spiel

  function neuePin() {
    let pin;
    do { pin = String(Math.floor(100000 + Math.random() * 900000)); } while (spiele.has(pin));
    return pin;
  }

  // Abgelaufene Spiele aufräumen
  setInterval(() => {
    const jetzt = Date.now();
    for (const [pin, spiel] of spiele) {
      if (jetzt - spiel.letzteAktivitaet > SPIEL_TIMEOUT_MS) {
        clearTimeout(spiel.timer);
        spiele.delete(pin);
      }
    }
  }, 10 * 60 * 1000).unref();

  // ---------- Senden ----------

  const hostRaum = spiel => 'host:' + spiel.pin;
  const spielRaum = spiel => 'spiel:' + spiel.pin;

  function sendeLobby(spiel) {
    io.to(hostRaum(spiel)).emit('lobby:update', { spieler: spiel.spielerListe() });
  }

  function frageFuerSpieler(spiel) {
    const f = spiel.frage;
    return {
      index: spiel.aktuell,
      gesamt: spiel.quiz.fragen.length,
      frage: f.frage,
      antworten: f.antworten,
      zeit: f.zeit,
      restMs: spiel.restMs(),
    };
  }

  // Gesamtzustand für (Wieder-)Verbindung des Hosts
  function hostZustand(spiel) {
    const basis = {
      pin: spiel.pin,
      quizTitel: spiel.quiz.titel,
      zustand: spiel.zustand,
      spieler: spiel.spielerListe(),
      ...getJoinInfo(spiel.pin),
    };
    if (spiel.zustand === 'frage') {
      basis.frage = { ...frageFuerSpieler(spiel), beantwortet: spiel.anzahlBeantwortet(), anzahlSpieler: spiel.spieler.size };
    } else if (spiel.zustand === 'aufloesung') {
      basis.aufloesung = aufloesungFuerHost(spiel);
    } else if (spiel.zustand === 'info') {
      basis.info = infoFuerHost(spiel);
    } else if (spiel.zustand === 'rangliste') {
      basis.rangliste = ranglisteFuerHost(spiel);
    } else if (spiel.zustand === 'ende') {
      basis.ende = endeFuerHost(spiel);
    }
    return basis;
  }

  // Zustand für (Wieder-)Verbindung eines Teilnehmers
  function spielerZustand(spiel, s) {
    const basis = {
      pin: spiel.pin,
      quizTitel: spiel.quiz.titel,
      zustand: spiel.zustand,
      name: s.name,
      punkte: s.punkte,
      platz: spiel.platzVon(s.id),
    };
    if (spiel.zustand === 'frage') {
      basis.frage = frageFuerSpieler(spiel);
      basis.beantwortet = !!s.antworten[spiel.aktuell];
    } else if (spiel.zustand === 'aufloesung' || spiel.zustand === 'info' || spiel.zustand === 'rangliste') {
      basis.ergebnis = ergebnisFuerSpieler(spiel, s);
      basis.infoAmBildschirm = spiel.zustand === 'info';
    } else if (spiel.zustand === 'ende') {
      basis.ende = { platz: spiel.platzVon(s.id), punkte: s.punkte, anzahl: spiel.spieler.size, siegerehrungFertig: !!spiel.siegerehrungFertig };
    }
    return basis;
  }

  function aufloesungFuerHost(spiel) {
    const f = spiel.frage;
    const verteilung = f.antworten.map(() => 0);
    for (const s of spiel.spieler.values()) {
      const a = s.antworten[spiel.aktuell];
      if (a && a.index != null) verteilung[a.index]++;
    }
    return {
      index: spiel.aktuell,
      gesamt: spiel.quiz.fragen.length,
      frage: f.frage,
      antworten: f.antworten,
      richtig: f.richtig,
      verteilung,
      letzte: spiel.istLetzteFrage,
      rangliste: spiel.ranglisteFaellig,
      info: spiel.hatInfo,
    };
  }

  function infoFuerHost(spiel) {
    const f = spiel.frage;
    return {
      index: spiel.aktuell,
      gesamt: spiel.quiz.fragen.length,
      frage: f.frage,
      richtigIndex: f.richtig,
      richtigeAntwort: f.antworten[f.richtig],
      info: f.info,
      rangliste: spiel.ranglisteFaellig,
      letzte: spiel.istLetzteFrage,
    };
  }

  function zeigeInfo(spiel) {
    spiel.zustand = 'info';
    io.to(hostRaum(spiel)).emit('info:start', infoFuerHost(spiel));
    io.to(spielRaum(spiel)).emit('info:start');
  }

  function ergebnisFuerSpieler(spiel, s) {
    const a = s.antworten[spiel.aktuell];
    return {
      beantwortet: !!(a && a.index != null),
      richtig: !!(a && a.richtig),
      punkteFrage: a ? a.punkte : 0,
      punkte: s.punkte,
      platz: spiel.platzVon(s.id),
      richtigeAntwort: spiel.frage.antworten[spiel.frage.richtig],
      richtigIndex: spiel.frage.richtig,
    };
  }

  function ranglisteFuerHost(spiel) {
    return { top: spiel.rangliste().slice(0, 5), letzte: spiel.istLetzteFrage };
  }

  function endeFuerHost(spiel) {
    return { rangliste: spiel.rangliste(), ergebnisId: spiel.ergebnisId };
  }

  // ---------- Zustandswechsel ----------

  function starteFrage(spiel) {
    spiel.aktuell++;
    spiel.zustand = 'frage';
    spiel.frageStart = Date.now();
    const daten = frageFuerSpieler(spiel);
    io.to(hostRaum(spiel)).emit('frage:start', { ...daten, beantwortet: 0, anzahlSpieler: spiel.spieler.size });
    io.to(spielRaum(spiel)).emit('frage:start', daten);
    clearTimeout(spiel.timer);
    spiel.timer = setTimeout(() => beendeFrage(spiel), spiel.frage.zeit * 1000 + GRACE_MS);
  }

  function beendeFrage(spiel) {
    if (spiel.zustand !== 'frage') return;
    clearTimeout(spiel.timer);
    spiel.zustand = 'aufloesung';
    for (const s of spiel.spieler.values()) {
      if (!s.antworten[spiel.aktuell]) {
        s.antworten[spiel.aktuell] = { index: null, richtig: false, punkte: 0, zeitMs: null };
      }
    }
    io.to(hostRaum(spiel)).emit('frage:ende', aufloesungFuerHost(spiel));
    for (const s of spiel.spieler.values()) {
      if (s.socketId) io.to(s.socketId).emit('frage:ende', ergebnisFuerSpieler(spiel, s));
    }
  }

  function zeigeRangliste(spiel) {
    spiel.zustand = 'rangliste';
    io.to(hostRaum(spiel)).emit('rangliste', ranglisteFuerHost(spiel));
  }

  function beendeSpiel(spiel) {
    clearTimeout(spiel.timer);
    if (spiel.zustand === 'frage') beendeFrage(spiel);
    spiel.zustand = 'ende';
    if (spiel.aktuell >= 0 && spiel.spieler.size > 0) {
      const gespeichert = store.saveResult(spiel.alsErgebnis());
      spiel.ergebnisId = gespeichert.id;
    }
    io.to(hostRaum(spiel)).emit('spiel:ende', endeFuerHost(spiel));
    for (const s of spiel.spieler.values()) {
      if (s.socketId) {
        io.to(s.socketId).emit('spiel:ende', { platz: spiel.platzVon(s.id), punkte: s.punkte, anzahl: spiel.spieler.size });
      }
    }
  }

  // ---------- Socket-Handler ----------

  io.on('connection', socket => {
    const ack = cb => (typeof cb === 'function' ? cb : () => {});

    function hostSpiel() {
      const spiel = spiele.get(socket.data.hostPin);
      if (spiel) spiel.letzteAktivitaet = Date.now();
      return spiel;
    }

    // ----- Quizleiter -----

    socket.on('host:erstellen', ({ quizId, adminPin } = {}, cb) => {
      cb = ack(cb);
      if (!checkPin(adminPin)) return cb({ fehler: 'Falsche Admin-PIN' });
      const quiz = store.getQuiz(quizId);
      if (!quiz) return cb({ fehler: 'Quiz nicht gefunden' });
      if (!quiz.fragen || !quiz.fragen.length) return cb({ fehler: 'Das Quiz enthält keine Fragen' });
      const spiel = new Spiel(neuePin(), quiz);
      spiele.set(spiel.pin, spiel);
      socket.data.hostPin = spiel.pin;
      socket.join(hostRaum(spiel));
      cb({ ok: true, hostToken: spiel.hostToken, zustand: hostZustand(spiel) });
    });

    socket.on('host:wiederverbinden', ({ pin, hostToken } = {}, cb) => {
      cb = ack(cb);
      const spiel = spiele.get(String(pin));
      if (!spiel || spiel.hostToken !== hostToken) return cb({ fehler: 'Spiel nicht mehr vorhanden' });
      socket.data.hostPin = spiel.pin;
      socket.join(hostRaum(spiel));
      cb({ ok: true, zustand: hostZustand(spiel) });
    });

    // Ein Knopf für "weiter" – was als Nächstes kommt, ergibt sich aus dem Zustand.
    socket.on('host:weiter', (_, cb) => {
      cb = ack(cb);
      const spiel = hostSpiel();
      if (!spiel) return cb({ fehler: 'Kein Spiel' });
      switch (spiel.zustand) {
        case 'lobby':
          if (!spiel.spieler.size) return cb({ fehler: 'Noch keine Teilnehmer' });
          spiel.gestartet = new Date().toISOString();
          starteFrage(spiel);
          break;
        case 'frage':
          beendeFrage(spiel);
          break;
        case 'aufloesung':
          if (spiel.hatInfo) zeigeInfo(spiel);
          else if (spiel.istLetzteFrage) beendeSpiel(spiel);
          else if (spiel.ranglisteFaellig) zeigeRangliste(spiel);
          else starteFrage(spiel);
          break;
        case 'info':
          if (spiel.istLetzteFrage) beendeSpiel(spiel);
          else if (spiel.ranglisteFaellig) zeigeRangliste(spiel);
          else starteFrage(spiel);
          break;
        case 'rangliste':
          if (spiel.istLetzteFrage) beendeSpiel(spiel);
          else starteFrage(spiel);
          break;
        default:
          return cb({ fehler: 'Spiel ist beendet' });
      }
      cb({ ok: true });
    });

    // Beamer hat den Sieger enthüllt → Handys dürfen jetzt den eigenen Platz zeigen
    socket.on('host:siegerehrungFertig', (_, cb) => {
      cb = ack(cb);
      const spiel = hostSpiel();
      if (!spiel || spiel.zustand !== 'ende') return cb({ fehler: 'Kein beendetes Spiel' });
      spiel.siegerehrungFertig = true;
      io.to(spielRaum(spiel)).emit('siegerehrung:ende');
      cb({ ok: true });
    });

    socket.on('host:abbrechen', (_, cb) => {
      cb = ack(cb);
      const spiel = hostSpiel();
      if (!spiel) return cb({ fehler: 'Kein Spiel' });
      if (spiel.zustand !== 'ende') beendeSpiel(spiel);
      cb({ ok: true });
    });

    socket.on('host:entfernen', ({ spielerId } = {}, cb) => {
      cb = ack(cb);
      const spiel = hostSpiel();
      const s = spiel && spiel.spieler.get(spielerId);
      if (!s) return cb({ fehler: 'Teilnehmer nicht gefunden' });
      spiel.spieler.delete(spielerId);
      spiel.geaendert();
      if (s.socketId) {
        io.to(s.socketId).emit('spieler:entfernt');
        const sock = io.sockets.sockets.get(s.socketId);
        if (sock) sock.leave(spielRaum(spiel));
      }
      sendeLobby(spiel);
      cb({ ok: true });
    });

    // ----- Teilnehmer -----

    socket.on('spieler:beitreten', ({ pin, name } = {}, cb) => {
      cb = ack(cb);
      const spiel = spiele.get(String(pin || '').trim());
      if (!spiel) return cb({ fehler: 'Kein Spiel mit dieser PIN gefunden' });
      if (spiel.zustand === 'ende') return cb({ fehler: 'Dieses Spiel ist bereits beendet' });
      name = String(name || '').replace(/\s+/g, ' ').trim();
      if (!name) return cb({ fehler: 'Bitte einen Namen eingeben' });
      if (name.length > MAX_NAME) return cb({ fehler: `Name darf höchstens ${MAX_NAME} Zeichen haben` });
      const vergeben = [...spiel.spieler.values()].some(s => s.name.toLowerCase() === name.toLowerCase());
      if (vergeben) return cb({ fehler: 'Dieser Name ist schon vergeben' });

      const s = {
        id: token().slice(0, 12),
        name,
        token: token(),
        socketId: socket.id,
        punkte: 0,
        antworten: [],
        online: true,
      };
      spiel.spieler.set(s.id, s);
      spiel.geaendert();
      spiel.letzteAktivitaet = Date.now();
      socket.data.spiel = { pin: spiel.pin, id: s.id };
      socket.join(spielRaum(spiel));
      sendeLobby(spiel);
      cb({ ok: true, token: s.token, zustand: spielerZustand(spiel, s) });
    });

    socket.on('spieler:wiederverbinden', ({ pin, token: t } = {}, cb) => {
      cb = ack(cb);
      const spiel = spiele.get(String(pin || ''));
      const s = spiel && [...spiel.spieler.values()].find(x => x.token === t);
      if (!s) return cb({ fehler: 'Sitzung nicht mehr vorhanden' });
      s.socketId = socket.id;
      s.online = true;
      socket.data.spiel = { pin: spiel.pin, id: s.id };
      socket.join(spielRaum(spiel));
      sendeLobby(spiel);
      cb({ ok: true, zustand: spielerZustand(spiel, s) });
    });

    socket.on('spieler:antwort', ({ index } = {}, cb) => {
      cb = ack(cb);
      const ref = socket.data.spiel;
      const spiel = ref && spiele.get(ref.pin);
      const s = spiel && spiel.spieler.get(ref.id);
      if (!s) return cb({ fehler: 'Nicht im Spiel' });
      if (spiel.zustand !== 'frage') return cb({ fehler: 'Zeit ist abgelaufen' });
      if (s.antworten[spiel.aktuell]) return cb({ fehler: 'Bereits geantwortet' });
      const f = spiel.frage;
      if (!Number.isInteger(index) || index < 0 || index >= f.antworten.length) return cb({ fehler: 'Ungültige Antwort' });

      const zeitMs = Date.now() - spiel.frageStart;
      const richtig = index === f.richtig;
      const punkte = richtig ? berechnePunkte(zeitMs, f.zeit) : 0;
      s.antworten[spiel.aktuell] = { index, richtig, punkte, zeitMs };
      s.punkte += punkte;
      spiel.geaendert();
      spiel.letzteAktivitaet = Date.now();
      cb({ ok: true });

      const beantwortet = spiel.anzahlBeantwortet();
      io.to(hostRaum(spiel)).emit('frage:antworten', { beantwortet, anzahlSpieler: spiel.spieler.size });
      if (beantwortet >= spiel.spieler.size) beendeFrage(spiel);
    });

    socket.on('disconnect', () => {
      const ref = socket.data.spiel;
      const spiel = ref && spiele.get(ref.pin);
      const s = spiel && spiel.spieler.get(ref.id);
      if (s && s.socketId === socket.id) {
        s.online = false;
        s.socketId = null;
        sendeLobby(spiel);
      }
    });
  });

  return { spiele };
}

module.exports = { createGameManager, berechnePunkte, Spiel };
