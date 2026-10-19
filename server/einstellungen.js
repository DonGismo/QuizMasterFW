// Einstellungen in der config.json ändern (z. B. Admin-PIN aus der Verwaltung heraus).
const fs = require('fs');

const STANDARD_PIN = '112112';
const PIN_MIN = 4;
const PIN_MAX = 20;

// Prüft eine neue Admin-PIN; liefert eine Fehlermeldung oder null
function pinFehler(pin) {
  if (typeof pin !== 'string' || !pin) return 'Bitte eine neue PIN eingeben';
  if (/\s/.test(pin)) return 'Die PIN darf keine Leerzeichen enthalten';
  if (pin.length < PIN_MIN) return `Die PIN muss mindestens ${PIN_MIN} Zeichen lang sein`;
  if (pin.length > PIN_MAX) return `Die PIN darf höchstens ${PIN_MAX} Zeichen lang sein`;
  if (pin === STANDARD_PIN) return 'Bitte nicht die Standard-PIN 112112 verwenden';
  return null;
}

// Übernimmt Änderungen in die config.json (übrige Einträge bleiben erhalten).
// Erst in eine Temp-Datei schreiben, dann umbenennen: keine halb geschriebene Datei bei Absturz.
function speichereConfig(datei, aenderungen) {
  let inhalt = {};
  try { inhalt = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch { /* fehlt oder kaputt: neu anlegen */ }
  const neu = { ...inhalt, ...aenderungen };
  const tmp = datei + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(neu, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, datei);
  return neu;
}

module.exports = { STANDARD_PIN, PIN_MIN, PIN_MAX, pinFehler, speichereConfig };
