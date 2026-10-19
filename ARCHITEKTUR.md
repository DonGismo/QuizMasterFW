# Architektur von QuizMaster FW

Technische Übersicht für alle, die am Code arbeiten. Bedienung und Installation stehen in der [README](README.md).

## Grundsätze

- **Deutsch durchgehend:** Oberfläche, Bezeichner und Kommentare sind deutsch (`spiel`, `frage`, `antworten`, `richtig`, `zustand` …) – bitte beibehalten.
- **Kein Build-Schritt, kein Frontend-Framework:** `public/` wird statisch ausgeliefert. Jede Seite hat genau ein Skript in `public/js/`, gemeinsame Helfer stehen in `public/js/common.js` (`$`, `esc`, `ansicht()`, `api()` – sendet die Admin-PIN aus dem sessionStorage als Header `x-admin-pin`).
- **Offline:** Der Socket.IO-Client kommt vom eigenen Server (`/socket.io/socket.io.js`), es werden keine externen Ressourcen geladen (Ausnahme: YouTube-Videos auf Info-Folien).

## Befehle

```bash
npm install
npm start                                      # Server auf 0.0.0.0:3000, zeigt die LAN-Adressen
npm test                                       # Unit-Tests (node:test), alle Dateien in test/
node --test --test-name-pattern="CSV" test/    # einzelner Test
npm run lasttest -- --spieler 30               # Lasttest: eigener Server auf :3099 mit temporären Daten
npm run msi                                    # Windows-Installer bauen
```

## Seiten

| Seite | Skript | Zweck |
|---|---|---|
| `index.html` | `spieler.js` | Teilnehmer am Handy; eine Seite, die zwischen `section[data-ansicht]`-Ansichten umschaltet |
| `host.html` | `host.js` | Beamer-Ansicht des Quizleiters |
| `admin.html` | `admin.js`, `folieneditor.js` | Anmeldung, Quiz-Editor, Import, Auswertung; Hash-Routing wie `#quiz=<id>`, `#ergebnis=<id>` |

## Server (`server/`)

- **`index.js`** – Express-REST unter `/api`. Alles außer `/api/info`, `/api/login` und `/api/qr.svg` braucht den Header `x-admin-pin`. Ermittelt die LAN-Adresse für Beitrittslink und QR-Code und legt beim ersten Start das Beispiel-Quiz `server/beispiel-quiz.json` an.
- **`game.js`** – Live-Spiele im Arbeitsspeicher (`Map` PIN → `Spiel`) und alle Socket.IO-Ereignisse.
  - Zustände: `lobby → frage → aufloesung → [info] → [rangliste] → (frage | ende)`. Nach der letzten Frage gibt es keine Rangliste, es geht direkt zu `ende`. Der Quizleiter schaltet alles mit einem einzigen Ereignis `host:weiter` weiter.
  - In `ende` führt der Beamer die Siegerehrung selbst durch (`host.js`, `siegerehrungSchritte`: Blöcke à 100 Plätze → bis Platz 21 → Platz 20–4 → Podest 3, 2, 1). Nach der Enthüllung des Siegers sendet er `host:siegerehrungFertig`; der Server schickt daraufhin `siegerehrung:ende` an die Handys, die erst dann den eigenen Platz zeigen.
  - Räume: `host:<pin>` und `spiel:<pin>`. Zeitmessung und Punkte (`berechnePunkte`: 1000 → 500 nach Antwortgeschwindigkeit) laufen auf dem Server.
  - Wiederverbinden per Token: Teilnehmer-Token im localStorage, Quizleiter-Token im sessionStorage je PIN. Die Beamer-URL wechselt nach dem Anlegen von `?quiz=` auf `?spiel=`, damit Neuladen kein neues Spiel erzeugt.
  - Ergebnisse werden bei Spielende über `store.saveResult` gespeichert.
- **`store.js`** – Speicherung als JSON-Dateien in `data/` (`quizzes.json`, `results/<id>.json`, `medien/`), atomares Schreiben über Temp-Datei und Umbenennen. Die Umgebungsvariable `QMFW_DATA_DIR` ändert den Ort.
- **`einstellungen.js`** – Regeln für eine neue Admin-PIN (`pinFehler`) und Speichern einzelner Werte in der `config.json` (`speichereConfig`, atomar). Route `POST /api/pin` in `index.js`: verlangt zusätzlich die aktuelle PIN (Fehler zählen beim Schutz gegen Durchprobieren mit, Antwort 403 statt 401, damit die Oberfläche nicht abmeldet) und übernimmt die neue PIN sofort ohne Neustart.
- **`importer.js`** – Import und Prüfung von CSV/JSON (`validateFrage` nutzen auch die Speicher-Routen), Quiz-Export, CSV-Export der Ergebnisse. CSV ist `;`-getrennt mit Kopfzeilen-Erkennung, beim Export mit UTF-8-BOM für Excel. Der Browser dekodiert hochgeladene Dateien (UTF-8, ersatzweise Windows-1252) und schickt den Text an `POST /api/import/pruefen`; diese Route prüft nur – gespeichert wird über die normalen Routen `POST/PUT /api/quizze`.
- **`paket.js`** – Quiz-Paket (`.quizpaket.zip` mit `quiz.json`, `medien/*`, `LIESMICH.txt`) mit eigenem ZIP-Schreiber (unkomprimiert) und -Leser (unkomprimiert und Deflate, akzeptiert `\`-Pfade aus Windows-ZIPs). Routen `GET /api/quizze/:id/export?format=paket` und `POST /api/import/paket` (Rohdaten; Medien werden sofort unter neuen Namen abgelegt). `entferneFehlendeMedien` entfernt Folien-Elemente ohne Mediendatei (auch beim JSON-Import). `erkenneMedientyp` erkennt Dateitypen an den ersten Bytes und wird auch beim Medien-Upload verwendet.

## Datenformat

- **Frage:** `{ frage, antworten: [2–4 Texte], richtig: Index ab 0, zeit: 5–120 Sekunden }`. In CSV ist `Richtig` A–D bzw. 1–4.
- **Info-Folie (optional):** `frage.info = { aktiv, hintergrund, elemente[] }`. Elemente sind in Prozent einer 16:9-Fläche positioniert; geprüft von `validateInfo`/`normalizeInfo` in `importer.js`. Medienpfade müssen `/medien/<hex>.<ext>` entsprechen.
  - `public/js/folie.js` zeichnet eine Folie (Schriftgrößen in `cqw`) und wird vom Beamer (`host.js`, Zustand `info`) und vom Folien-Editor (`folieneditor.js`, aufgerufen aus `admin.js` über `oeffneFolienEditor`) gemeinsam genutzt.
  - Uploads: `POST /api/medien` (Rohdaten, Typ an den ersten Bytes erkannt) → `data/medien/`, ausgeliefert unter `/medien`.

## Windows-Installer (`installer/`)

- `build.ps1` stellt `server/`, `public/`, die Laufzeit-Abhängigkeiten und die lokale `node.exe` in `installer/stage` zusammen und baut mit `dotnet build installer/QuizMasterFW.wixproj` (WiX 5 SDK) die Datei `installer/out/QuizMasterFW-<Version>.msi`. Für jede neue Version die `version` in `package.json` erhöhen (MajorUpgrade).
- Der eigene Dialog `FirewallDlg.wxs` setzt die Eigenschaft `FIREWALL`, von der die Firewall-Regel abhängt (TCP 3000, lokales Subnetz, Profil „Privat“).
- Verknüpfungen starten `QuizMaster FW.exe`, einen Starter mit Symbol im Infobereich (`installer/tray/QuizMasterTray.cs`, nur C#-5-Sprachmittel – übersetzt mit dem in Windows enthaltenen .NET-Framework-`csc.exe`). Er startet Node unsichtbar mit `QMFW_TRAY=1`, schreibt `server.log` in den Datenordner, liest aus der Startmeldung des Servers die Adressen (`Quizleiter (dieser Rechner):`, `Teilnehmer im WLAN:`, `Beenden…`, `läuft bereits`), öffnet den Browser selbst, verhindert Doppelstarts per Mutex und beendet Node über ein Job-Objekt automatisch mit. `QMFW_TEST=1` unterdrückt das Öffnen des Browsers für Tests.
- Ersatzweise startet `QuizMaster FW starten.cmd` mit Konsolenfenster; es setzt `QMFW_DATA_DIR`/`QMFW_CONFIG` auf `%LOCALAPPDATA%\QuizMasterFW` und `QMFW_BROWSER=1`. `server/index.js` kopiert die Standard-`config.json` beim ersten Start dorthin.
- Icon und Installer-Bilder erzeugt `installer/grafiken.js`.

## Konventionen

- Design-Werte (Feuerwehr-Rot/Weiß, Antwortfarben `--a0` … `--a3` mit Symbolen ▲◆●■) stehen in `public/css/style.css`. Antwortfelder immer mit Farbe **und** Symbol – wegen Farbschwäche.
- Alle Texte von Benutzern beim Zusammenbauen von HTML mit `esc()` maskieren.
- Die Anwender-Dokumentation (Start, Firewall, Importformate, Einstellungen) steht in der `README.md` – bei Änderungen an Importformat oder Einstellungen mit anpassen.
