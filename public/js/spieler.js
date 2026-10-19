// Teilnehmer-Ansicht: beitreten, antworten, Ergebnisse sehen.

const socket = io();
const lokal = speicher('local');
let sitzung = lokal.get('sitzung'); // { pin, token, name }
let countdown = null;

// PIN aus Link/QR-Code übernehmen
const urlPin = new URLSearchParams(location.search).get('pin');
if (urlPin) $('#pin').value = urlPin;
if (lokal.get('letzterName')) $('#name').value = lokal.get('letzterName');
if (urlPin && sitzung && sitzung.pin !== urlPin) sitzung = null; // anderes Spiel → neu beitreten

function setzeName(name) {
  $('#kopf-name').textContent = name;
  $('#kopf-name').className = 'name-plakette';
  $('#warten-name').textContent = name;
}

function fehler(text) {
  const el = $('#fehler-beitreten');
  el.textContent = text;
  zeige(el, !!text);
}

function sitzungBeenden() {
  sitzung = null;
  lokal.del('sitzung');
  zeige('#kopf-name', false);
  stopCountdown();
  ansicht('beitreten');
}

// ---------- Darstellung ----------

function stopCountdown() {
  clearInterval(countdown);
  countdown = null;
}

function zeigeFrage(f, schonBeantwortet) {
  stopCountdown();
  if (schonBeantwortet) return ansicht('abgegeben');

  $('#frage-nr').textContent = `Frage ${f.index + 1} von ${f.gesamt}`;
  $('#frage-text').textContent = f.frage;
  const box = $('#kacheln');
  box.innerHTML = f.antworten.map((a, i) => `
    <button class="kachel k${i}" data-index="${i}">
      <span class="symbol">${SYMBOLE[i]}</span><span>${esc(a)}</span>
    </button>`).join('');
  box.style.gridTemplateRows = f.antworten.length > 2 ? '1fr 1fr' : '1fr';

  const ende = Date.now() + f.restMs;
  const tick = () => {
    const rest = Math.max(0, ende - Date.now());
    $('#frage-zeit').textContent = Math.ceil(rest / 1000) + ' s';
    $('#zeitbalken').style.width = (100 * rest / (f.zeit * 1000)) + '%';
    if (rest <= 0) stopCountdown();
  };
  tick();
  countdown = setInterval(tick, 200);
  ansicht('frage');
}

$('#kacheln').addEventListener('click', e => {
  const btn = e.target.closest('.kachel');
  if (!btn || btn.disabled) return;
  const index = Number(btn.dataset.index);
  $$('#kacheln .kachel').forEach(k => { k.disabled = true; k.classList.toggle('aus', k !== btn); });
  if (navigator.vibrate) navigator.vibrate(30);
  socket.emit('spieler:antwort', { index }, res => {
    if (res && res.ok) {
      stopCountdown();
      ansicht('abgegeben');
    } else {
      $$('#kacheln .kachel').forEach(k => { k.disabled = false; k.classList.remove('aus'); });
      alert((res && res.fehler) || 'Antwort konnte nicht gesendet werden');
    }
  });
});

function zeigeErgebnis(r) {
  stopCountdown();
  const box = $('#ergebnis-box');
  box.className = 'status-bild ' + (r.richtig ? 'gut' : 'schlecht');
  $('#ergebnis-symbol').textContent = r.richtig ? '✔' : (r.beantwortet ? '✖' : '⏱');
  $('#ergebnis-titel').textContent = r.richtig ? 'Richtig!' : (r.beantwortet ? 'Leider falsch' : 'Zeit abgelaufen');
  $('#ergebnis-punkte').textContent = r.richtig ? `+ ${r.punkteFrage} Punkte` : '+ 0 Punkte';
  $('#ergebnis-loesung').textContent = r.richtig ? '' : `Richtig wäre: ${SYMBOLE[r.richtigIndex]} ${r.richtigeAntwort}`;
  zeige('#ergebnis-info', false);
  $('#ergebnis-platz').textContent = `Gesamt: ${r.punkte} Punkte · Platz ${r.platz}`;
  ansicht('ergebnis');
}

// Spielende: erst „Siegerehrung läuft“, den eigenen Platz erst nach der Enthüllung des Siegers am Beamer
let endeDaten = null;

function spielEnde(e) {
  stopCountdown();
  endeDaten = e;
  if (e.siegerehrungFertig) zeigeEnde(e);
  else ansicht('siegerehrung');
}

function zeigeEnde(e) {
  stopCountdown();
  const medaille = { 1: '🥇', 2: '🥈', 3: '🥉' }[e.platz] || '🚒';
  $('#ende-symbol').textContent = medaille;
  $('#ende-titel').textContent = `Platz ${e.platz} von ${e.anzahl}`;
  $('#ende-punkte').textContent = `${e.punkte} Punkte`;
  ansicht('ende');
  lokal.del('sitzung');
  sitzung = null;
}

function zeigeZustand(z) {
  setzeName(z.name);
  if (z.zustand === 'lobby') ansicht('warten');
  else if (z.zustand === 'frage') zeigeFrage(z.frage, z.beantwortet);
  else if (z.ergebnis) {
    zeigeErgebnis(z.ergebnis);
    zeige('#ergebnis-info', !!z.infoAmBildschirm);
  }
  else if (z.ende) spielEnde(z.ende);
}

// ---------- Beitreten ----------

$('#form-beitreten').addEventListener('submit', e => {
  e.preventDefault();
  fehler('');
  const pin = $('#pin').value.trim();
  const name = $('#name').value.trim();
  if (!/^\d{6}$/.test(pin)) return fehler('Die Spiel-PIN hat 6 Ziffern.');
  if (!name) return fehler('Bitte gib deinen Namen ein – er wird für die Auswertung gebraucht.');
  socket.emit('spieler:beitreten', { pin, name }, res => {
    if (!res || !res.ok) return fehler((res && res.fehler) || 'Beitritt fehlgeschlagen');
    sitzung = { pin, token: res.token, name: res.zustand.name };
    lokal.set('sitzung', sitzung);
    lokal.set('letzterName', res.zustand.name);
    zeigeZustand(res.zustand);
  });
});

$('#btn-neu').addEventListener('click', () => {
  history.replaceState(null, '', '/');
  $('#pin').value = '';
  sitzungBeenden();
});

// ---------- Server-Ereignisse ----------

socket.on('connect', () => {
  if (!sitzung) return ansicht('beitreten');
  socket.emit('spieler:wiederverbinden', { pin: sitzung.pin, token: sitzung.token }, res => {
    if (res && res.ok) zeigeZustand(res.zustand);
    else sitzungBeenden();
  });
});

socket.on('frage:start', f => zeigeFrage(f, false));
socket.on('frage:ende', zeigeErgebnis);
socket.on('info:start', () => zeige('#ergebnis-info', true));
socket.on('spiel:ende', spielEnde);
socket.on('siegerehrung:ende', () => { if (endeDaten) zeigeEnde(endeDaten); });
$('#btn-ergebnis-zeigen').addEventListener('click', () => { if (endeDaten) zeigeEnde(endeDaten); });
socket.on('spieler:entfernt', () => {
  sitzungBeenden();
  fehler('Du wurdest vom Quizleiter aus dem Spiel entfernt.');
});
