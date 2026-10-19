const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pinFehler, speichereConfig } = require('../server/einstellungen');

test('PIN-Regeln: Länge, Leerzeichen, Standard-PIN', () => {
  assert.strictEqual(pinFehler('4711'), null);
  assert.strictEqual(pinFehler('Wache-12!'), null);
  assert.match(pinFehler(''), /neue PIN/);
  assert.match(pinFehler(undefined), /neue PIN/);
  assert.match(pinFehler('123'), /mindestens 4/);
  assert.match(pinFehler('1'.repeat(21)), /höchstens 20/);
  assert.match(pinFehler('12 34'), /Leerzeichen/);
  assert.match(pinFehler('112112'), /Standard-PIN/);
});

test('config.json: nur die geänderten Werte werden ersetzt', () => {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'qmfw-config-'));
  const datei = path.join(ordner, 'config.json');
  fs.writeFileSync(datei, JSON.stringify({ port: 3000, adminPin: '112112', titel: 'Wache Nord' }));
  speichereConfig(datei, { adminPin: '4711' });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(datei, 'utf8')), { port: 3000, adminPin: '4711', titel: 'Wache Nord' });
  assert.ok(!fs.existsSync(datei + '.tmp'));
  fs.rmSync(ordner, { recursive: true, force: true });
});
