// Quizleiter-/Beamer-Ansicht: Lobby, Fragen, Auflösung, Rangliste, Siegerehrung.

const socket = io();
const sitzung = speicher('session');
const params = new URLSearchParams(location.search);
let countdown = null;
let anzahlSpieler = 0;

if (!adminPin()) location.href = '/admin.html';

function fehler(text) {
  $('#fehler').textContent = text || '';
  zeige('#fehler', !!text);
}

// Beim Ansichtswechsel: Countdown anhalten und Videos der Info-Seite stoppen
function stopCountdown() {
  clearInterval(countdown);
  countdown = null;
  stoppeFolie($('#info-folie'));
}

function kachelnHtml(antworten, richtig) {
  return antworten.map((a, i) => `
    <div class="kachel k${i}${richtig != null && i !== richtig ? ' aus' : ''}${i === richtig ? ' richtig' : ''}">
      <span class="symbol">${SYMBOLE[i]}</span><span>${esc(a)}${i === richtig ? ' ✔' : ''}</span>
    </div>`).join('');
}

// ---------- Ansichten ----------

function zeigeLobby(z) {
  $('#qr').src = z.qrUrl;
  $('#basis-url').textContent = z.basisUrl.replace(/^https?:\/\//, '');
  $('#spiel-pin').textContent = z.pin;
  aktualisiereLobby(z.spieler);
  ansicht('lobby');
}

function aktualisiereLobby(spieler) {
  anzahlSpieler = spieler.length;
  $('#anzahl-spieler').textContent = spieler.length === 1 ? '1 Teilnehmer' : `${spieler.length} Teilnehmer`;
  $('#btn-start').disabled = spieler.length === 0;
  $('#namen').innerHTML = spieler.map(s => `
    <span class="name${s.online ? '' : ' offline'}" title="${s.online ? 'verbunden' : 'Verbindung unterbrochen'}">
      ${esc(s.name)} <button data-id="${esc(s.id)}" title="Entfernen" aria-label="${esc(s.name)} entfernen">×</button>
    </span>`).join('');
}

function zeigeFrage(f) {
  stopCountdown();
  $('#frage-nr').textContent = `Frage ${f.index + 1} von ${f.gesamt}`;
  $('#frage-text').textContent = f.frage;
  $('#kacheln').innerHTML = kachelnHtml(f.antworten);
  $('#beantwortet').textContent = `${f.beantwortet || 0} / ${f.anzahlSpieler || anzahlSpieler}`;

  const umfang = 2 * Math.PI * 52;
  const ende = Date.now() + f.restMs;
  const tick = () => {
    const rest = Math.max(0, ende - Date.now());
    $('#countdown-zahl').textContent = Math.ceil(rest / 1000);
    $('#ring').style.strokeDashoffset = umfang * (1 - rest / (f.zeit * 1000));
    if (rest <= 0) stopCountdown();
  };
  tick();
  countdown = setInterval(tick, 100);
  ansicht('frage');
}

function zeigeAufloesung(a) {
  stopCountdown();
  $('#aufl-nr').textContent = `Frage ${a.index + 1} von ${a.gesamt}`;
  $('#aufl-text').textContent = a.frage;
  const max = Math.max(1, ...a.verteilung);
  $('#balken').style.gridTemplateColumns = `repeat(${a.antworten.length}, 1fr)`;
  $('#balken').innerHTML = a.verteilung.map((n, i) => `
    <div class="b"><span>${SYMBOLE[i]} ${n}</span>
      <div style="height:0;background:var(--a${i});${i !== a.richtig ? 'opacity:.35' : ''}" data-h="${(80 * n / max).toFixed(0)}%"></div>
    </div>`).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('#balken [data-h]').forEach(el => { el.style.height = el.dataset.h; });
  }));
  $('#aufl-kacheln').innerHTML = kachelnHtml(a.antworten, a.richtig);
  $('#btn-zur-rangliste').textContent = a.info ? 'Infos ▶' : a.letzte ? 'Siegerehrung 🏆' : a.rangliste ? 'Rangliste ▶' : 'Nächste Frage ▶';
  ansicht('aufloesung');
}

function ranglisteHtml(liste) {
  return liste.map((e, i) => `
    <li style="animation-delay:${i * 0.08}s">
      <span class="platz">${e.platz}</span><span>${esc(e.name)}</span><span class="p">${e.punkte}</span>
    </li>`).join('');
}

function zeigeInfo(i) {
  stopCountdown();
  $('#info-nr').textContent = `Frage ${i.index + 1} von ${i.gesamt}`;
  $('#info-loesung').textContent = `✔ ${SYMBOLE[i.richtigIndex]} ${i.richtigeAntwort}`;
  $('#btn-info-weiter').textContent = i.letzte ? 'Siegerehrung 🏆' : i.rangliste ? 'Rangliste ▶' : 'Nächste Frage ▶';
  ansicht('info');
  zeichneFolie($('#info-folie'), i.info, { autoplay: true });
}

function zeigeRangliste(r) {
  stopCountdown();
  $('#rangliste').innerHTML = ranglisteHtml(r.top) || '<li>Keine Teilnehmer</li>';
  $('#btn-naechste').textContent = r.letzte ? 'Zur Siegerehrung 🏆' : 'Nächste Frage ▶';
  ansicht('rangliste');
}

// ---------- Siegerehrung ----------
// Vom letzten Platz zum Sieger: Blöcke à 100 Plätze → bis Platz 21 → Platz 20–4 → Podest 3, 2, 1

const se = { schritte: [], schritt: -1, rangliste: [] };

function siegerehrungSchritte(rangliste) {
  const schritte = [];
  const block = (von, bis) => schritte.push({ art: 'liste', von, bis, eintraege: rangliste.filter(e => e.platz >= von && e.platz <= bis).reverse() });
  let oben = rangliste.length;
  while (oben > 100) {
    const unten = Math.floor((oben - 1) / 100) * 100 + 1;
    block(unten, oben);
    oben = unten - 1;
  }
  if (oben > 20) { block(21, oben); oben = 20; }
  if (oben >= 4) { block(4, oben); oben = 3; }
  for (let p = oben; p >= 1; p--) schritte.push({ art: 'podest', platz: p });
  return schritte;
}

function zeigeEnde(e, direkt) {
  stopCountdown();
  $('#ende-liste').innerHTML = ranglisteHtml(e.rangliste) || '<li>Keine Teilnehmer</li>';
  $('#btn-auswertung').href = e.ergebnisId ? `/admin.html#ergebnis=${e.ergebnisId}` : '/admin.html#ergebnisse';
  zeige('#btn-abbrechen', false);
  ansicht('ende');
  se.rangliste = e.rangliste;
  se.schritte = siegerehrungSchritte(e.rangliste);
  se.schritt = -1;
  $('#se-buehne').innerHTML = '';
  // Nach Neuladen der Seite oder ohne Teilnehmer gleich die vollständige Liste
  if (direkt || !se.schritte.length) return zeigeGesamtergebnis();
  zeige('#se', true);
  zeige('#ende-ergebnis', false);
  siegerehrungWeiter();
}

function zeigeGesamtergebnis() {
  zeige('#se', false);
  zeige('#ende-ergebnis', true);
  socket.emit('host:siegerehrungFertig');
}

function siegerehrungWeiter() {
  if ($('#se-weiter').disabled) return;
  if (se.schritt >= se.schritte.length - 1) return zeigeGesamtergebnis();
  se.schritt++;
  const s = se.schritte[se.schritt];
  const naechster = se.schritte[se.schritt + 1];
  const buehne = $('#se-buehne');
  $('#se-fortschritt').innerHTML = se.schritte.map((_, i) => `<span class="${i <= se.schritt ? 'fertig' : ''}"></span>`).join('');
  $('#se-weiter').textContent = !naechster ? 'Alle Ergebnisse' : naechster.art === 'podest' ? `Platz ${naechster.platz} ▶` : 'Weiter ▶';

  if (s.art === 'liste') {
    $('#se-titel').textContent = s.von === s.bis ? `Platz ${s.von}` : `Platz ${s.bis} bis ${s.von}`;
    $('#se-unter').textContent = s.eintraege.length === 1 ? '1 Teilnehmer' : `${s.eintraege.length} Teilnehmer`;
    const k = s.eintraege.length;
    const spalten = k > 80 ? 7 : k > 60 ? 6 : k > 30 ? 4 : k > 12 ? 3 : k > 6 ? 2 : 1;
    // Große Blöcke: nur Platz + Name, damit es lesbar bleibt
    const klasse = k > 40 ? 'dicht ohne-punkte' : k > 12 ? 'mittel' : 'gross';
    const verzoegerung = Math.min(0.12, 2.2 / k); // alle Karten in etwa 2 Sekunden
    const zeilen = Math.ceil(k / spalten);
    buehne.innerHTML = `<div class="se-raster ${klasse}" style="grid-template-columns:repeat(${spalten},minmax(0,1fr));grid-template-rows:repeat(${zeilen},auto);grid-auto-flow:column">` +
      s.eintraege.map((e, i) => `<div class="se-karte" style="animation-delay:${(i * verzoegerung).toFixed(2)}s">
        <span class="nr">${e.platz}</span><span class="n">${esc(e.name)}</span><span class="p">${e.punkte}</span></div>`).join('') + '</div>';
    passeSiegerehrungAn(buehne.firstElementChild, buehne);
    return;
  }

  // Podest beim ersten Podest-Schritt aufbauen (Namen noch verdeckt), dann Stufe für Stufe enthüllen
  if (!buehne.querySelector('.se-podest')) {
    const plaetze = [2, 1, 3].filter(p => p <= se.rangliste.length);
    buehne.innerHTML = '<div class="se-podest">' + plaetze.map(p => {
      const e = se.rangliste[p - 1];
      return `<div class="se-stufe s${p}" data-platz="${p}">
        <div class="wer"><div class="medaille">${{ 1: '🥇', 2: '🥈', 3: '🥉' }[p]}</div>
          <div class="name">${esc(e.name)}</div><div class="pkt">${e.punkte} Punkte</div></div>
        <div class="block">${p}</div></div>`;
    }).join('') + '</div>';
  }
  $('#se-titel').textContent = s.platz === 1 ? 'Der Sieger' : `Platz ${s.platz}`;
  $('#se-unter').textContent = '';
  const stufe = buehne.querySelector(`.se-stufe[data-platz="${s.platz}"]`);
  if (s.platz === 1) {
    const t = document.createElement('div');
    t.className = 'se-trommel';
    t.innerHTML = '<div class="t">🥁</div><div>Und gewonnen hat …</div>';
    buehne.appendChild(t);
    $('#se-weiter').disabled = true;
    setTimeout(() => {
      t.remove();
      stufe.classList.add('da');
      konfetti();
      $('#se-weiter').disabled = false;
      socket.emit('host:siegerehrungFertig'); // jetzt dürfen die Handys den eigenen Platz zeigen
    }, 2200);
  } else {
    requestAnimationFrame(() => stufe.classList.add('da'));
  }
}

// Schrift verkleinern, bis alle Karten auf die Bühne passen
function passeSiegerehrungAn(raster, buehne) {
  let groesse = raster.classList.contains('gross') ? 1.7 : raster.classList.contains('mittel') ? 1.35 : 1.1;
  raster.style.fontSize = groesse + 'rem';
  while (raster.scrollHeight > buehne.clientHeight && groesse > 0.55) {
    groesse -= 0.05;
    raster.style.fontSize = groesse.toFixed(2) + 'rem';
  }
}

function konfetti() {
  const farben = ['#c8102e', '#ffffff', '#ffd34d', '#8b0a1e', '#1368ce'];
  for (let i = 0; i < 140; i++) {
    const k = document.createElement('div');
    k.className = 'konfetti';
    k.style.left = Math.random() * 100 + 'vw';
    k.style.background = farben[i % farben.length];
    if (i % farben.length === 1) k.style.outline = '1px solid #ddd';
    k.style.animationDuration = (2.5 + Math.random() * 2.5) + 's';
    k.style.animationDelay = (Math.random() * 0.8) + 's';
    document.body.appendChild(k);
    setTimeout(() => k.remove(), 6500);
  }
}

function zeigeZustand(z) {
  $('#quiz-titel').textContent = '· ' + z.quizTitel;
  document.title = z.quizTitel + ' – QuizMaster FW';
  zeige('#btn-abbrechen', z.zustand !== 'ende');
  if (z.zustand === 'lobby') zeigeLobby(z);
  else if (z.zustand === 'frage') zeigeFrage(z.frage);
  else if (z.zustand === 'aufloesung') zeigeAufloesung(z.aufloesung);
  else if (z.zustand === 'info') zeigeInfo(z.info);
  else if (z.zustand === 'rangliste') zeigeRangliste(z.rangliste);
  else if (z.zustand === 'ende') zeigeEnde(z.ende, true); // nach Neuladen keine erneute Siegerehrung
  // Lobby-Daten auch für spätere Ansichten merken
  if (z.spieler) anzahlSpieler = z.spieler.length;
}

// ---------- Verbindung ----------

socket.on('connect', () => {
  fehler('');
  const pin = params.get('spiel');
  if (pin) {
    socket.emit('host:wiederverbinden', { pin, hostToken: sitzung.get('host:' + pin) }, res => {
      if (res && res.ok) zeigeZustand(res.zustand);
      else fehler(((res && res.fehler) || 'Verbindung fehlgeschlagen') + ' – bitte über die Übersicht neu starten.');
    });
    return;
  }
  const quizId = params.get('quiz');
  if (!quizId) { location.href = '/admin.html'; return; }
  socket.emit('host:erstellen', { quizId, adminPin: adminPin() }, res => {
    if (!res || !res.ok) return fehler((res && res.fehler) || 'Spiel konnte nicht erstellt werden');
    sitzung.set('host:' + res.zustand.pin, res.hostToken);
    // URL umstellen, damit ein Neuladen dasselbe Spiel wieder öffnet statt ein neues zu erzeugen
    params.delete('quiz');
    params.set('spiel', res.zustand.pin);
    history.replaceState(null, '', '?' + params.toString());
    zeigeZustand(res.zustand);
  });
});

socket.on('disconnect', () => fehler('Verbindung zum Server unterbrochen – versuche neu zu verbinden …'));

socket.on('lobby:update', d => aktualisiereLobby(d.spieler));
socket.on('frage:start', zeigeFrage);
socket.on('frage:antworten', d => {
  $('#beantwortet').textContent = `${d.beantwortet} / ${d.anzahlSpieler}`;
});
socket.on('frage:ende', zeigeAufloesung);
socket.on('info:start', zeigeInfo);
socket.on('rangliste', zeigeRangliste);
socket.on('spiel:ende', zeigeEnde);

// ---------- Bedienung ----------

function weiter() {
  socket.emit('host:weiter', null, res => {
    if (res && !res.ok) fehler(res.fehler);
  });
}

$('#btn-start').addEventListener('click', weiter);
$('#btn-frage-ende').addEventListener('click', weiter);
$('#btn-zur-rangliste').addEventListener('click', weiter);
$('#btn-naechste').addEventListener('click', weiter);
$('#btn-info-weiter').addEventListener('click', weiter);
$('#se-weiter').addEventListener('click', siegerehrungWeiter);

$('#namen').addEventListener('click', e => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  socket.emit('host:entfernen', { spielerId: btn.dataset.id });
});

$('#btn-abbrechen').addEventListener('click', () => {
  if (!confirm('Spiel jetzt beenden? Die bisherigen Ergebnisse werden gespeichert.')) return;
  socket.emit('host:abbrechen');
});

$('#btn-vollbild').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

// Leertaste / Enter = weiter (praktisch mit Presenter-Fernbedienung)
document.addEventListener('keydown', e => {
  if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'PageDown') return;
  if (e.target.closest('input, textarea, button')) return;
  const sichtbar = $$('[data-ansicht]').find(el => !el.classList.contains('versteckt'));
  if (sichtbar && sichtbar.dataset.ansicht === 'ende') {
    if (!$('#se').classList.contains('versteckt')) { e.preventDefault(); siegerehrungWeiter(); }
    return;
  }
  if (sichtbar && ['lobby', 'frage', 'aufloesung', 'info', 'rangliste'].includes(sichtbar.dataset.ansicht)) {
    if (sichtbar.dataset.ansicht === 'lobby' && $('#btn-start').disabled) return;
    e.preventDefault();
    weiter();
  }
});
