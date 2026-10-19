// Erzeugt Programm-Icon (ICO) und Installer-Bilder (BMP) im FW-Design ohne Zusatzprogramme.
// Aufruf: node installer/grafiken.js  → installer/assets/{quizmaster.ico,banner.bmp,dialog.bmp}

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROT = [200, 16, 46];
const ROT_DUNKEL = [139, 10, 30];
const WEISS = [255, 255, 255];
const GELB = [255, 211, 77];

// Flammen aus dem Logo (public/js/common.js), Koordinaten im 64er-Raster
const FLAMME = 'M33 10c2 8-6 12-6 20 0 3 2 5 4 6-1-4 2-7 4-9 0 5 5 7 5 12 0 5-4 9-9 9-6 0-11-5-11-11 0-9 8-14 13-27z';
const FLAMME_INNEN = 'M32 34c1 3-2 4-2 7 0 2 1 3 3 3 2 0 4-2 4-4 0-3-3-4-5-6z';

// Einfacher Pfad-Parser (nur M, relative c, z) → Polygon
function pfadZuPolygon(d) {
  const t = d.match(/[a-zA-Z]|-?\d*\.?\d+/g);
  const pts = [];
  let i = 0, x = 0, y = 0, cmd = '';
  while (i < t.length) {
    if (/[a-zA-Z]/.test(t[i])) cmd = t[i++];
    if (cmd === 'M') { x = +t[i++]; y = +t[i++]; pts.push([x, y]); cmd = 'c'; }
    else if (cmd === 'c') {
      const [x1, y1, x2, y2, x3, y3] = t.slice(i, i + 6).map(Number);
      i += 6;
      for (let s = 1; s <= 12; s++) {
        const u = s / 12, v = 1 - u;
        pts.push([
          x + 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u * x3,
          y + 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u * y3,
        ]);
      }
      x += x3; y += y3;
    } else if (cmd === 'z') { i++; }
  }
  return pts;
}

function imPolygon(px, py, poly) {
  let drin = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[a], [xb, yb] = poly[b];
    if ((ya > py) !== (yb > py) && px < (xb - xa) * (py - ya) / (yb - ya) + xa) drin = !drin;
  }
  return drin;
}

const POLY_AUSSEN = pfadZuPolygon(FLAMME);
const POLY_INNEN = pfadZuPolygon(FLAMME_INNEN);

// Farbe des Logos an Punkt (lx, ly) im 64er-Raster; null = transparent
function logoFarbe(lx, ly) {
  const r = Math.hypot(lx - 32, ly - 32);
  if (r > 30) return null;
  if (r > 26) return WEISS;
  if (imPolygon(lx, ly, POLY_INNEN)) return GELB;
  if (imPolygon(lx, ly, POLY_AUSSEN)) return WEISS;
  return ROT;
}

// Rastert eine Fläche mit 4×4-Supersampling. farbe(x, y) liefert [r,g,b] oder null.
function rastere(w, h, farbe, hintergrund) {
  const px = Buffer.alloc(w * h * 4);
  const N = 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const c = farbe(x + (sx + 0.5) / N, y + (sy + 0.5) / N) || hintergrund;
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const o = (y * w + x) * 4;
      if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; }
      px[o + 3] = Math.round(255 * a / (N * N));
    }
  }
  return px;
}

// ---------- PNG / ICO ----------

function png(w, h, rgba) {
  const zeilen = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(zeilen, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (typ, daten) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(daten.length);
    const td = Buffer.concat([Buffer.from(typ), daten]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 Bit, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(zeilen, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(groessen) {
  const bilder = groessen.map(s => png(s, s, rastere(s, s, (x, y) => logoFarbe(x * 64 / s, y * 64 / s), null)));
  const kopf = Buffer.alloc(6 + 16 * bilder.length);
  kopf.writeUInt16LE(0, 0); kopf.writeUInt16LE(1, 2); kopf.writeUInt16LE(bilder.length, 4);
  let offset = kopf.length;
  bilder.forEach((b, i) => {
    const o = 6 + i * 16, s = groessen[i];
    kopf[o] = s >= 256 ? 0 : s; kopf[o + 1] = s >= 256 ? 0 : s;
    kopf.writeUInt16LE(1, o + 4); kopf.writeUInt16LE(32, o + 6);
    kopf.writeUInt32LE(b.length, o + 8); kopf.writeUInt32LE(offset, o + 12);
    offset += b.length;
  });
  return Buffer.concat([kopf, ...bilder]);
}

// ---------- BMP (24 Bit, für WiX-Dialoge) ----------

function bmp(w, h, rgba) {
  const zeile = Math.ceil(w * 3 / 4) * 4;
  const daten = Buffer.alloc(zeile * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((h - 1 - y) * w + x) * 4; // BMP: unten zuerst
      const o = y * zeile + x * 3;
      daten[o] = rgba[i + 2]; daten[o + 1] = rgba[i + 1]; daten[o + 2] = rgba[i];
    }
  }
  const kopf = Buffer.alloc(54);
  kopf.write('BM', 0);
  kopf.writeUInt32LE(54 + daten.length, 2);
  kopf.writeUInt32LE(54, 10);
  kopf.writeUInt32LE(40, 14);
  kopf.writeInt32LE(w, 18); kopf.writeInt32LE(h, 22);
  kopf.writeUInt16LE(1, 26); kopf.writeUInt16LE(24, 28);
  kopf.writeUInt32LE(daten.length, 34);
  return Buffer.concat([kopf, daten]);
}

// Logo an Position (lx, ly) mit Durchmesser d einblenden, sonst Grundfarbe
function mitLogo(grund, lx, ly, d) {
  return (x, y) => {
    if (x >= lx && x < lx + d && y >= ly && y < ly + d) {
      const c = logoFarbe((x - lx) * 64 / d, (y - ly) * 64 / d);
      if (c) return c;
    }
    return grund(x, y);
  };
}

const ziel = path.join(__dirname, 'assets');
fs.mkdirSync(ziel, { recursive: true });

fs.writeFileSync(path.join(ziel, 'quizmaster.ico'), ico([16, 24, 32, 48, 64, 256]));

// Banner oben in den Dialogen (493×58): weiß, rechts Logo, unten Warnstreifen
const banner = rastere(493, 58, mitLogo((x, y) => {
  if (y >= 52) return Math.floor((x + y) / 8) % 2 ? ROT : WEISS;
  return WEISS;
}, 432, 4, 46), WEISS);
fs.writeFileSync(path.join(ziel, 'banner.bmp'), bmp(493, 58, banner));

// Willkommens-/Abschlussbild (493×312): linker Bereich (164 px) rot mit großem Logo, Rest weiß
const dialog = rastere(493, 312, mitLogo((x, y) => {
  if (x < 164) return y > 290 && Math.floor((x + y) / 10) % 2 ? ROT_DUNKEL : ROT;
  if (x < 170) return Math.floor((x + y) / 8) % 2 ? ROT : WEISS;
  return WEISS;
}, 22, 86, 120), WEISS);
fs.writeFileSync(path.join(ziel, 'dialog.bmp'), bmp(493, 312, dialog));

console.log('Grafiken erzeugt in', ziel);
