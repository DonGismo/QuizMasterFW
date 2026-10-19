// Speicherung in JSON-Dateien unter data/ (keine Datenbank nötig).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.QMFW_DATA_DIR || path.join(__dirname, '..', 'data');
const QUIZ_FILE = path.join(DATA_DIR, 'quizzes.json');
const RESULTS_DIR = path.join(DATA_DIR, 'results');
const MEDIEN_DIR = path.join(DATA_DIR, 'medien'); // Bilder/Videos der Info-Seiten

function ensureDirs() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.mkdirSync(MEDIEN_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Erst in Temp-Datei schreiben, dann umbenennen: kein halb geschriebenes JSON bei Absturz.
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

// ---------- Quizze ----------

function listQuizzes() {
  return readJson(QUIZ_FILE, []);
}

function getQuiz(id) {
  return listQuizzes().find(q => q.id === id) || null;
}

function saveQuiz(quiz) {
  const quizzes = listQuizzes();
  const now = new Date().toISOString();
  const idx = quizzes.findIndex(q => q.id === quiz.id);
  if (idx >= 0) {
    quizzes[idx] = { ...quizzes[idx], ...quiz, geaendert: now };
  } else {
    quiz = { ...quiz, id: quiz.id || newId(), erstellt: now, geaendert: now };
    quizzes.push(quiz);
  }
  writeJson(QUIZ_FILE, quizzes);
  return idx >= 0 ? quizzes[idx] : quiz;
}

function deleteQuiz(id) {
  const quizzes = listQuizzes();
  const rest = quizzes.filter(q => q.id !== id);
  writeJson(QUIZ_FILE, rest);
  return rest.length !== quizzes.length;
}

// ---------- Ergebnisse ----------

function saveResult(result) {
  ensureDirs();
  const id = result.id || newId();
  const full = { ...result, id };
  writeJson(path.join(RESULTS_DIR, id + '.json'), full);
  return full;
}

function listResults() {
  ensureDirs();
  return fs.readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => readJson(path.join(RESULTS_DIR, f), null))
    .filter(Boolean)
    .map(r => ({
      id: r.id,
      quizTitel: r.quizTitel,
      gestartet: r.gestartet,
      beendet: r.beendet,
      teilnehmer: r.spieler.length,
      fragen: r.fragen.length,
    }))
    .sort((a, b) => (b.beendet || '').localeCompare(a.beendet || ''));
}

function getResult(id) {
  if (!/^[a-f0-9]+$/.test(id)) return null;
  return readJson(path.join(RESULTS_DIR, id + '.json'), null);
}

function deleteResult(id) {
  if (!/^[a-f0-9]+$/.test(id)) return false;
  try {
    fs.unlinkSync(path.join(RESULTS_DIR, id + '.json'));
    return true;
  } catch {
    return false;
  }
}

// ---------- Medien ----------

// Speichert eine hochgeladene Datei unter zufälligem Namen; liefert den öffentlichen Pfad.
function saveMedium(buffer, ext) {
  ensureDirs();
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(MEDIEN_DIR, name), buffer);
  return '/medien/' + name;
}

ensureDirs();

module.exports = {
  DATA_DIR, MEDIEN_DIR, newId, saveMedium,
  listQuizzes, getQuiz, saveQuiz, deleteQuiz,
  saveResult, listResults, getResult, deleteResult,
};
