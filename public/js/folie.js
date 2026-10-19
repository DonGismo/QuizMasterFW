// Zeichnet eine Info-Seite (16:9-Folie). Wird von Beamer-Ansicht und Folien-Editor gemeinsam
// genutzt, damit der Editor genau das zeigt, was später am Beamer erscheint.
//
// info = { aktiv, hintergrund, elemente: [{ id, typ: text|bild|video, x, y, w, h (in %), z, ... }] }

const FOLIE_HINTERGRUENDE = { weiss: 'Weiß', grau: 'Hellgrau', rot: 'Rot' };
const FOLIE_STILE = { titel: 'Titel', text: 'Text', hinweis: 'Hinweis (rot)', info: 'Info-Box' };
const FOLIE_GROESSEN = { s: 'S', m: 'M', l: 'L', xl: 'XL' };
const FOLIE_AUSRICHTUNGEN = { links: '⯇ Links', mitte: '≡ Mitte', rechts: 'Rechts ⯈' };

function leereInfo() {
  return { aktiv: true, hintergrund: 'weiss', elemente: [] };
}

function positioniereElement(node, e) {
  node.style.left = e.x + '%';
  node.style.top = e.y + '%';
  node.style.width = e.w + '%';
  node.style.height = e.h + '%';
  node.style.zIndex = e.z || 1;
}

// Baut ein einzelnes Element.
// opts.bearbeiten: Editor-Modus (Videos nicht bedienbar, damit man sie verschieben kann)
// opts.miniatur:   Platzhalter statt Video/YouTube (für kleine Vorschauen)
// opts.autoplay:   Videodatei startet automatisch (Beamer)
function baueFolienElement(e, opts = {}) {
  const node = document.createElement('div');
  node.className = 'folie-el folie-' + e.typ;
  node.dataset.id = e.id;
  positioniereElement(node, e);

  if (e.typ === 'text') {
    node.classList.add('stil-' + (e.stil || 'text'), 'gr-' + (e.groesse || 'm'), 'al-' + (e.ausrichtung || 'links'));
    const inhalt = document.createElement('div');
    inhalt.className = 'folie-inhalt';
    inhalt.textContent = e.text || '';
    if (opts.bearbeiten && !e.text) inhalt.dataset.leer = 'Doppelklick zum Schreiben';
    node.appendChild(inhalt);
  } else if (e.typ === 'bild') {
    const img = document.createElement('img');
    img.src = e.src;
    img.alt = '';
    img.draggable = false;
    node.appendChild(img);
  } else if (e.typ === 'video') {
    if (opts.miniatur) {
      node.classList.add('folie-platzhalter');
      node.textContent = e.youtube ? '▶ YouTube' : '▶ Video';
    } else if (e.src) {
      const v = document.createElement('video');
      v.src = e.src;
      v.preload = 'metadata';
      v.playsInline = true;
      v.controls = !opts.bearbeiten;
      if (opts.autoplay) v.autoplay = true;
      node.appendChild(v);
    } else if (e.youtube) {
      const f = document.createElement('iframe');
      f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(e.youtube)}?rel=0&modestbranding=1${opts.autoplay ? '&autoplay=1' : ''}`;
      f.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
      f.allowFullscreen = true;
      f.title = 'YouTube-Video';
      node.appendChild(f);
    }
    if (opts.bearbeiten && !opts.miniatur) node.classList.add('folie-video-gesperrt');
  }
  return node;
}

function zeichneFolie(container, info, opts = {}) {
  container.innerHTML = '';
  container.className = 'folie hg-' + ((info && info.hintergrund) || 'weiss') + (opts.bearbeiten ? ' folie-bearbeiten' : '');
  const elemente = [...((info && info.elemente) || [])].sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const e of elemente) container.appendChild(baueFolienElement(e, opts));
  return container;
}

// Videos/YouTube auf einer Folie anhalten (z. B. beim Weiterschalten)
function stoppeFolie(container) {
  container.querySelectorAll('video').forEach(v => v.pause());
  container.querySelectorAll('iframe').forEach(f => f.remove());
}

// YouTube-ID aus allen üblichen Link-Formen (watch?v=, youtu.be/, shorts/, embed/) oder direkt
function youtubeId(text) {
  const s = String(text || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
