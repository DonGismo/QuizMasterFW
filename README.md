# 🚒 QuizMaster FW

**Live-Quiz für die Feuerwehr-Ausbildung – mit Beamer und Handys, komplett im lokalen WLAN.**

Ein Rechner im Gerätehaus ist der Server, der Quizleiter zeigt die Fragen am Beamer oder Fernseher, und alle Teilnehmenden spielen im Browser ihres Handys mit – ohne App, ohne Konto, ohne Internet, ohne Cloud. Die Ergebnisse jedes Spiels werden mit Namen gespeichert und lassen sich anschließend auswerten (z. B. als Nachweis für die jährliche Unterweisung).

![Version](https://img.shields.io/badge/version-1.3.0-c8102e) ![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-c8102e) ![Node.js ≥ 20.15](https://img.shields.io/badge/Node.js-%E2%89%A5%2020.15-c8102e) ![Windows-Installer](https://img.shields.io/badge/Installer-Windows%20MSI-c8102e)

---

## Inhalt

- [Funktionen](#funktionen)
- [Schnellstart](#schnellstart)
- [Bedienung](#bedienung)
- [Info-Folien nach einer Frage](#info-folien-nach-einer-frage)
- [Import und Export](#import-und-export)
- [Einstellungen](#einstellungen-configjson)
- [Daten und Sicherung](#daten-und-sicherung)
- [Entwicklung](#entwicklung)
- [Sicherheit und Datenschutz](#sicherheit-und-datenschutz)
- [Lizenz](#lizenz)

---

## Funktionen

**Für Teilnehmende (Handy)**
- Beitreten per QR-Code oder Adresse + 6-stellige Spiel-PIN, nur ein Name ist nötig
- Große farbige Antwortfelder mit Symbol (▲ ◆ ● ■) – auch bei Farbschwäche eindeutig
- Sofortiges Feedback: richtig/falsch, Punkte, aktueller Platz
- Automatisches Wiedereinsteigen nach WLAN-Abbruch oder Neuladen

**Für den Quizleiter (Beamer)**
- Lobby mit großem QR-Code, Countdown, Live-Zähler der Antworten, Antwortverteilung
- Rangliste wahlweise nach jeder, jeder 3. oder jeder 5. Frage
- **Info-Folien** nach einer Frage: Texte, Bilder, Videos oder YouTube – gestaltet in einem Folien-Editor wie in PowerPoint
- **Siegerehrung** vom letzten Platz bis zum Sieger, mit Podest, Trommelwirbel und Konfetti
- Steuerung per Maus, Leertaste/Enter oder Presenter-Fernbedienung

**Verwaltung**
- Quiz-Editor mit 2–4 Antworten und eigenem Zeitlimit pro Frage
- Import aus **Excel/CSV**, **JSON** oder als **Quiz-Paket (ZIP)** inklusive Info-Folien und Medien
- **Auswertung** je Spiel: jede Antwort jedes Teilnehmers, schwierigste Fragen, Export als CSV für Excel
- Schutz des Verwaltungsbereichs durch eine Admin-PIN

**Technik**
- Läuft ohne Internet; Server mit Node.js, Oberfläche ohne Build-Schritt
- Windows-Installer (MSI) mit mitgelieferter Node.js-Laufzeit, Firewall-Freigabe auf Nachfrage und Symbol im Infobereich der Taskleiste
- Getestet mit 200 gleichzeitigen Teilnehmern (Reaktionszeiten unter 50 ms im lokalen Netz)

---

## Schnellstart

### Variante A: Windows-Installer (empfohlen)

1. Die MSI-Datei `QuizMasterFW-<Version>.msi` auf dem Server-Rechner doppelklicken (Administratorrechte nötig). Node.js muss **nicht** installiert sein.
2. Zielordner wählen (Standard `C:\Program Files\QuizMaster FW`).
3. **Windows-Firewall:** Der Installer fragt, ob Port 3000 (TCP) freigegeben werden soll – angehakt lassen. Die Freigabe gilt nur für das lokale Subnetz im Netzwerkprofil „Privat“ und wird bei der Deinstallation wieder entfernt.
4. **QuizMaster FW** auf dem Desktop starten. Der Server läuft unsichtbar im Hintergrund, die Verwaltung öffnet sich im Browser.

**Symbol im Infobereich der Taskleiste** (rechts unten, ggf. unter „^“): Doppelklick öffnet die Verwaltung. Rechtsklick zeigt das Menü mit *Verwaltung öffnen*, *Teilnehmer-Adresse kopieren*, *Server-Protokoll anzeigen*, *Daten-Ordner öffnen* und **Beenden**.

- Update: neue MSI einfach drüber installieren – Quizze und Einstellungen bleiben erhalten.
- Ohne Oberfläche installieren: `msiexec /i QuizMasterFW-1.3.0.msi /qn` (mit Firewall-Freigabe) bzw. `msiexec /i QuizMasterFW-1.3.0.msi /qn FIREWALL=""` (ohne).
- Zur Fehlersuche gibt es im Startmenü zusätzlich **„QuizMaster FW (mit Konsolenfenster)“**.

### Variante B: Aus dem Quellcode

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.15.

```bash
git clone https://github.com/DonGismo/QuizMasterFW.git
cd QuizMasterFW
npm install
npm start
```

Unter Windows genügt alternativ ein Doppelklick auf `start.bat`. Die Konsole zeigt die Adressen an:

```
Quizleiter (dieser Rechner): http://localhost:3000/admin.html
Teilnehmer im WLAN:          http://192.168.2.86:3000
```

> **Firewall:** Beim ersten Start fragt Windows, ob Node.js im Netzwerk erreichbar sein darf – für **private Netzwerke** zulassen. Ohne Freigabe von Port 3000 erreichen die Handys den Server nicht.

**Standard-Admin-PIN:** `112112` – bitte in der [`config.json`](#einstellungen-configjson) ändern.

---

## Bedienung

1. **Verwaltung öffnen:** `http://localhost:3000/admin.html` und mit der Admin-PIN anmelden.
2. **Quiz anlegen** im Editor oder **importieren** (siehe [Import und Export](#import-und-export)). Beim ersten Start ist ein Beispiel-Quiz vorhanden.
3. **▶ Spiel starten** – der Beamer zeigt QR-Code, Adresse und Spiel-PIN.
4. Teilnehmende scannen den QR-Code oder tippen Adresse und PIN ein und geben ihren **Namen** ein (Pflicht für die Auswertung, doppelte Namen werden abgelehnt).
5. **Quiz starten.** Nach jeder Frage folgen die Auflösung, ggf. eine Info-Folie und – je nach Einstellung – die Rangliste. Nach der letzten Frage geht es direkt zur Siegerehrung.
6. **Siegerehrung**, jeder Schritt per Knopf oder Leertaste:
   - bei vielen Teilnehmenden zuerst Übersichten in Hunderterschritten (z. B. Platz 237 bis 201, dann 200 bis 101),
   - dann bis Platz 21, dann Platz 20 bis 4,
   - dann Platz 3, Platz 2 und mit Trommelwirbel der Sieger auf dem Podest,
   - zum Schluss die vollständige Ergebnisliste.

   Die Handys verraten den eigenen Platz erst, wenn der Sieger am Beamer enthüllt ist.
7. **Auswertung:** Das Ergebnis wird automatisch gespeichert. Unter *Verwaltung → Auswertung* sind alle Spiele mit jeder Antwort jedes Teilnehmers und den schwierigsten Fragen abrufbar, Download als CSV für Excel.

**Punkte:** Eine richtige Antwort bringt 500 bis 1000 Punkte – je schneller, desto mehr (Formel: `1000 × (1 − Antwortzeit ÷ Zeitlimit ÷ 2)`). Falsche oder fehlende Antworten bringen 0 Punkte. Die Zeit misst der Server, nicht das Handy.

---

## Info-Folien nach einer Frage

Jede Frage hat im Quiz-Editor den Schalter **„Info-Seite nach dieser Frage“**. Ist er an, erscheint nach der Auflösung am Beamer eine eigene Folie mit Hintergrundwissen zur Frage; die Handys zeigen „📺 Mehr Infos am Bildschirm“.

Gestaltet wird die Folie im **Folien-Editor**:
- **Texte** in festen Stilen des Feuerwehr-Designs (Titel, Text, rote Hinweis-Box, Info-Box), Größe S–XL, Ausrichtung links/mittig/rechts. Doppelklick auf einen Text, um direkt zu schreiben.
- **Bilder** (PNG, JPG, GIF, WebP), **Videos** (MP4, WebM) oder **YouTube-Links** (brauchen Internet am Beamer-Rechner). Dateien lassen sich auch auf die Folie ziehen, Bilder mit Strg+V einfügen.
- Elemente mit der Maus **verschieben** und an den Anfassern **in der Größe ändern** – mit Einrasten an Rändern, Mitte und anderen Elementen (Alt = ohne Einrasten). Pfeiltasten verschieben, Entf löscht, Strg+D dupliziert.
- Hintergrund Weiß, Hellgrau oder Rot; **Vorschau** im Vollbild.

Die Folien skalieren automatisch auf jede Bildschirmgröße (16:9).

---

## Import und Export

| Format | Fragen | Einstellungen | Info-Folien | Bilder/Videos | Gedacht für |
|---|---|---|---|---|---|
| 📦 Quiz-Paket (.zip) | ✔ | ✔ | ✔ | ✔ | Weitergabe an andere Rechner und Wehren |
| JSON | ✔ | ✔ | ✔ | – (nur Verweise) | Sicherung, Bearbeitung mit Werkzeugen |
| CSV | ✔ | – | – | – | Fragen in Excel erfassen |

Import über **Verwaltung → Import**: Datei auswählen oder hineinziehen, Vorschau prüfen, dann als neues Quiz anlegen oder an ein bestehendes anhängen. Fehlerhafte Zeilen werden mit Zeilennummer angezeigt und nicht übernommen. Export pro Quiz in der Quiz-Übersicht.

### CSV (Excel)

Trennzeichen Semikolon, erste Zeile ist die Kopfzeile. Eine Vorlage gibt es in der Oberfläche und unter [`public/vorlage-fragen.csv`](public/vorlage-fragen.csv).

```
Frage;Antwort A;Antwort B;Antwort C;Antwort D;Richtig;Zeit
Womit löscht man einen Fettbrand?;Wasser;Deckel aufsetzen;Mehl;Pusten;B;20
Ist ein C-Schlauch dünner als ein B-Schlauch?;Ja;Nein;;;A;15
```

- 2 bis 4 Antworten; *Antwort C/D* dürfen leer bleiben.
- **Richtig**: Buchstabe A–D (oder Ziffer 1–4).
- **Zeit**: Sekunden von 5 bis 120, leer = Standardzeit.
- Aus Excel als „CSV UTF-8“ oder „CSV (Trennzeichen-getrennt)“ speichern – beides wird erkannt, Umlaute inklusive.

### JSON

```json
{
  "titel": "Grundlagen",
  "beschreibung": "optional",
  "ranglisteIntervall": 1,
  "fragen": [
    { "frage": "Notruf der Feuerwehr?", "antworten": ["110", "112"], "richtig": 1, "zeit": 15 }
  ]
}
```

`richtig` zählt ab 0 (0 = erste Antwort). Optional kann jede Frage ein Feld `info` mit der Info-Folie enthalten.

### Quiz-Paket (ZIP)

*Verwaltung → Quizze → „📦 Export komplett“* erzeugt `<Titel>.quizpaket.zip` mit `quiz.json`, allen verwendeten Bildern und Videos (`medien/`) und einer `LIESMICH.txt`. Das Paket ist ein normales ZIP und lässt sich im Explorer öffnen. Fehlt beim Import eine Mediendatei, wird das Element von der Folie entfernt und gemeldet.

### Beispiel-Quizze

Im Ordner [`quizze/`](quizze) liegen fertige Quizze zum Import:
- **Brandbekämpfung zur Menschenrettung** – 25 Fragen mit Info-Folie zu jeder Frage (Quiz-Paket und JSON)
- **Atemschutz – Jährliche Unterweisung (FwDV 7)** – 20 Theoriefragen (JSON)

Die Inhalte stammen aus Ausbildungsunterlagen und sollten vor dem Einsatz fachlich geprüft werden.

---

## Einstellungen (`config.json`)

| Feld | Bedeutung | Standard |
|---|---|---|
| `port` | Port des Webservers | `3000` |
| `adminPin` | PIN für den Verwaltungsbereich – **bitte ändern** | `112112` |
| `standardZeit` | Zeitlimit pro Frage in Sekunden, wenn keins angegeben ist | `20` |
| `titel` | Name in der Konsole | `QuizMaster FW` |
| `basisUrl` | optional, z. B. `http://quiz.fw:3000`, falls die automatisch erkannte Adresse nicht passt | leer |
| `maxUploadMB` | maximale Größe einer Bild-/Videodatei | `200` |

Die Datei liegt im Projektordner bzw. bei der installierten Version unter `%LOCALAPPDATA%\QuizMasterFW\config.json` (Startmenü: „QuizMaster FW Daten und Einstellungen“). Nach Änderungen den Server neu starten. Wird der Port geändert, gilt die Firewall-Freigabe des Installers (Port 3000) nicht mehr.

---

## Daten und Sicherung

| | Aus dem Quellcode | Installierte Version |
|---|---|---|
| Quizze | `data/quizzes.json` | `%LOCALAPPDATA%\QuizMasterFW\quizzes.json` |
| Ergebnisse | `data/results/` | `%LOCALAPPDATA%\QuizMasterFW\results\` |
| Bilder/Videos | `data/medien/` | `%LOCALAPPDATA%\QuizMasterFW\medien\` |
| Einstellungen | `config.json` | `%LOCALAPPDATA%\QuizMasterFW\config.json` |

Zum Sichern den jeweiligen Ordner kopieren. Ein laufendes Spiel wird erst bei der Siegerehrung oder bei „Spiel beenden“ gespeichert – den Server also nicht mitten im Spiel beenden.

---

## Entwicklung

```bash
npm install                                    # Abhängigkeiten
npm start                                      # Server auf Port 3000
npm test                                       # Unit-Tests (node:test)
node --test --test-name-pattern="CSV" test/    # einzelnen Test ausführen
npm run lasttest -- --spieler 30               # Lasttest mit simulierten Teilnehmern
npm run msi                                    # Windows-Installer bauen
```

**Aufbau**

```
server/        Express + Socket.IO: Spiellogik, Speicherung, Import/Export, Quiz-Pakete
public/        Oberfläche ohne Build-Schritt: Teilnehmer (index), Beamer (host), Verwaltung (admin)
test/          Unit-Tests
tools/         Lasttest
installer/     MSI (WiX 5), Taskleisten-Starter (C#), Grafiken
quizze/        Beispiel-Quizze zum Import
```

Details zur Architektur stehen in [`ARCHITEKTUR.md`](ARCHITEKTUR.md).

**Lasttest:** `npm run lasttest` startet einen eigenen Testserver mit temporären Daten (die echten Daten bleiben unberührt), lässt einen Quizleiter und beliebig viele Teilnehmer ein komplettes Spiel spielen und prüft, ob jede Antwort gezählt wurde und die Punkte stimmen. Mit `--url http://<IP>:3000 --pin <Admin-PIN>` läuft er gegen einen laufenden Server.

**MSI bauen** (Windows mit Node.js und .NET SDK 6+): `npm run msi`. WiX Toolset 5 und die Erweiterungen kommen automatisch über NuGet, der Taskleisten-Starter wird mit dem in Windows enthaltenen C#-Compiler übersetzt. Ergebnis: `installer/out/QuizMasterFW-<Version>.msi`. Für jede neue Version die `version` in `package.json` erhöhen.

---

## Sicherheit und Datenschutz

QuizMaster FW ist für ein **vertrauenswürdiges lokales Netz** gedacht: Es gibt kein HTTPS und nur eine gemeinsame Admin-PIN. Den Server **nicht ins Internet freigeben**.

Alle Daten bleiben auf dem Server-Rechner. Gespeichert werden die eingegebenen Namen, Antworten und Punkte jedes Spiels – Teilnehmende sollten wissen, dass ihre Ergebnisse für die Auswertung gespeichert werden. Ergebnisse lassen sich in der Verwaltung einzeln löschen.

---

## Lizenz

QuizMaster FW steht unter der **[MIT-Lizenz](LICENSE)** – freie Nutzung, Anpassung und Weitergabe, auch für andere Feuerwehren, mit Nennung des Urhebers.

Verwendete Software von Dritten (jeweils MIT-Lizenz): [Node.js](https://nodejs.org) (im Installer enthalten), [Express](https://expressjs.com), [Socket.IO](https://socket.io), [node-qrcode](https://github.com/soldair/node-qrcode). Der Installer wird mit dem [WiX Toolset](https://wixtoolset.org) (MS-RL) gebaut.
