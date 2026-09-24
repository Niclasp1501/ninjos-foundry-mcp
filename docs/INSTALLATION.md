# Ninjo's Foundry MCP installieren

Ninjo's Foundry MCP besteht aus zwei Teilen:

- dem **Foundry-Modul** `ninjos-foundry-mcp`. Foundry installiert und aktualisiert es
  selbst über „Add-on-Module".
- dem **PC-Server**, den Claude startet. Um den geht es hier.

English version: [INSTALLATION.en.md](INSTALLATION.en.md).

---

## Voraussetzungen

- Windows 10 oder 11, oder macOS
- Claude Desktop, einmal gestartet. Claude Code und andere MCP-Programme gehen auch,
  siehe unten.
- **Kein Node.js nötig.** Das Paket bringt seine eigene Laufzeit mit.
- Keine Administratorrechte nötig.

## Installieren

### Windows

1. Die Datei `ninjos-foundry-mcp-server-<version>-win32-x64.zip` herunterladen.
2. Rechtsklick auf die Zip-Datei, „Alle extrahieren".
3. Im entpackten Ordner `setup.cmd` doppelklicken.
   Fragt Windows „Möchten Sie diese Datei ausführen?", mit „Ausführen" bestätigen.
4. Das Fenster zeigt, was eingerichtet wurde. Eine Taste drücken, um es zu schließen.
5. Claude Desktop ganz beenden (auch im Infobereich unten rechts) und neu starten.

Der Server liegt danach in `%LOCALAPPDATA%\FoundryMCPServer`. Den entpackten Ordner
kannst du löschen.

### Mac

1. Die Datei `ninjos-foundry-mcp-server-<version>-darwin-<arm64 oder x64>.zip`
   herunterladen und doppelklicken, damit sie entpackt wird.
2. Im entpackten Ordner **Rechtsklick** auf `setup.command`, dann „Öffnen", dann noch
   einmal „Öffnen". Ein einfacher Doppelklick wird beim ersten Mal abgewiesen, weil das
   Paket noch nicht von Apple beglaubigt ist.
3. Das Terminalfenster zeigt, was eingerichtet wurde. Enter drücken.
4. Claude Desktop beenden (Cmd+Q) und neu starten.

Der Server liegt danach in `~/Library/Application Support/FoundryMCPServer`.

### Prüfen

1. In Claude Desktop unter Einstellungen, Entwickler, steht `foundry-mcp` als laufend.
2. In Foundry die Welt **als Spielleitung** öffnen. Die Statusanzeige des Moduls zeigt
   „Verbunden".
3. Claude fragen: „Welche Welt ist in Foundry geöffnet?"

## Claude Code und andere Programme

Die Einrichtung trägt den Server **in Claude Desktop** ein. In Claude Code und Cursor
aktualisiert sie nur einen Eintrag, der schon da ist, und fügt keinen neuen hinzu. Den
Befehl für Claude Code zeigt sie am Ende an. Unter Windows lautet er:

```
claude mcp add --scope user foundry-mcp -- "%LOCALAPPDATA%\FoundryMCPServer\node.exe" "%LOCALAPPDATA%\FoundryMCPServer\app\build\server\wrapper.js"
```

Für jedes andere Programm, das MCP-Server über `command` und `args` startet:

- `command`: `%LOCALAPPDATA%\FoundryMCPServer\node.exe` (Mac:
  `~/Library/Application Support/FoundryMCPServer/node`)
- `args`: der Pfad zu `app\build\server\wrapper.js` im selben Ordner
- Name: `foundry-mcp`

Den fertigen Block mit den Pfaden deines Rechners gibt der Befehl `print-config` aus
(siehe „Fehlersuche").

## Battlemaps und Szenenbilder mit Gemini

Drei Werkzeuge malen Bilder für deine Welt: `generate-battlemap` (eine Karte von oben
für den Tisch), `generate-scene-image` (ein Ortsbild aus Augenhöhe) und
`edit-map-image` (ändert ein vorhandenes Bild und legt das Ergebnis als neue Datei
daneben). Sie legen das Bild in Foundry ab, machen auf Wunsch eine Szene daraus und
zeigen Claude eine kleine Vorschau. Vorhandene Szenenbilder können als Vorlage
mitgehen, damit die Karte zu ihnen passt.

Die Bilder kommen von Googles Gemini. **Jedes Bild kostet Geld**, einige Cent in 2K,
abgerechnet über **deinen eigenen** Google-Zugang. Bildmodelle sind nicht im
kostenlosen Kontingent. Die aktuellen Preise stehen bei Google:
<https://ai.google.dev/gemini-api/docs/pricing>

### Einschalten

1. In Google AI Studio (<https://aistudio.google.com>) unter „API keys" einen Schlüssel
   anlegen.
2. Den Schlüssel in deinem Eintrag des MCP-Servers unter `env` eintragen, in Claude
   Desktop also in `claude_desktop_config.json`:

   ```json
   "foundry-mcp": {
     "command": "…",
     "args": ["…"],
     "env": { "GEMINI_API_KEY": "dein-schlüssel" }
   }
   ```

   Für Claude Code: `claude mcp add` mit `-e GEMINI_API_KEY=dein-schlüssel` vor dem
   Namen.

3. Claude neu starten. Ohne Schlüssel erscheinen die drei Werkzeuge gar nicht.

Die Einrichtung übernimmt den Wert bei jeder Aktualisierung. Wahlweise dazu:

| Variable                  | Wirkung                                                   |
| ------------------------- | --------------------------------------------------------- |
| `GEMINI_IMAGE_MODEL`      | Bildmodell, ab Werk `gemini-3.1-flash-image`              |
| `GEMINI_IMAGE_SIZE`       | `1K`, `2K` oder `4K`, ab Werk `2K`                        |
| `FOUNDRY_MCP_IMAGE_STYLE` | eigener Stiltext statt des eingebauten, `none` für keinen |
| `GEMINI_TIMEOUT_MS`       | längste Wartezeit je Bild, ab Werk 180000                 |

### Deinen Schlüssel schützen

Wer deinen Schlüssel hat, erzeugt Bilder auf deine Rechnung. Deshalb:

- **Ein Limit setzen.** Im Google-Cloud-Projekt des Schlüssels ein Budget mit
  Benachrichtigung anlegen und für die „Generative Language API" die Kontingente pro
  Tag begrenzen. Den Verbrauch zeigt AI Studio unter „Usage".
- **Den Schlüssel beschränken.** In der Google Cloud Console unter „APIs und Dienste",
  „Anmeldedaten" den Schlüssel nur für die „Generative Language API" freigeben.
- **Ihn nur beim MCP-Server auf deinem PC eintragen.** Nie in Foundry: Welt- und
  Moduleinstellungen landen in den Browsern aller Spieler. Nie in einen Chat, ein
  Bildschirmfoto, eine geteilte Datei oder ein Repository.
- **Bei einem Verdacht sofort handeln.** Den Schlüssel in AI Studio löschen und einen
  neuen anlegen. Der alte ist damit sofort wertlos.

Der Server schickt den Schlüssel nur an Google, im Kopf der Anfrage, nie in einer
Adresse. Er steht in keiner Protokollzeile und in keiner Antwort an Claude.

## Aktualisieren

Genauso wie installieren: neue Zip-Datei entpacken, `setup.cmd` bzw. `setup.command`
ausführen, Claude neu starten.

- Einstellungen in deinem Eintrag (etwa `GEMINI_API_KEY` oder `LOG_LEVEL` unter `env`)
  bleiben erhalten.
- Andere MCP-Server und Einstellungen von Claude bleiben unangetastet.
- Vor jeder Änderung an einer Konfiguration entsteht eine Sicherung
  `claude_desktop_config.json.foundry-mcp-backup-<Datum>-<Uhrzeit>`. Die drei neuesten
  bleiben liegen. Ändert sich nichts, wird nichts geschrieben.
- Läuft der Server noch, wartet die Einrichtung bis zu 90 Sekunden. Am schnellsten geht
  es, wenn Claude Desktop und Claude Code vorher geschlossen sind.

**Wer den alten Installer benutzt hat** (`FoundryMCPServer-Setup-….exe` oder `.dmg`),
macht nichts anders. Die Einrichtung übernimmt die bisherige Installation: gleicher
Ordner, gleicher Eintrag `foundry-mcp`, gleiche Werte unter `env`. Der alte
Deinstaller wird entfernt, damit er die neuen Dateien nicht löschen kann. Deine
freigegebenen Foundry-Seiten (`allowed-origins.json`) bleiben, wo sie sind. Ein
ComfyUI-Ordner einer älteren Version bleibt ebenfalls liegen; seit 14.2609.6 wird er
nicht mehr benutzt und darf weg.

Das Foundry-Modul aktualisiert Foundry selbst, unabhängig vom Server.

### Aktualisieren von 14.2609.3 oder älter

Version 14.2609.4 ist komplett neu geschrieben. Das Foundry-Modul zu aktualisieren reicht
nicht: Der MCP-Server auf deinem PC muss mit dem neuen Serverpaket neu eingerichtet
werden.

1. `ninjos-foundry-mcp-server-<version>-win32-x64.zip` von der
   [Downloadseite](https://github.com/Niclasp1501/ninjos-foundry-mcp/releases)
   herunterladen.
2. Entpacken und `setup.cmd` ausführen (Mac: `setup.command`), wie unter „Installieren".
3. Claude Desktop oder dein MCP-Programm ganz beenden und neu starten.

Nach dem Modulupdate zeigt Foundry der Spielleitung einen Hinweis mit diesen Schritten.
„Erledigt, nicht mehr anzeigen" blendet ihn auf diesem Gerät aus; er kommt wieder, solange
noch ein Server der vorigen Generation verbunden ist, und die Statusanzeige zeigt dann
„MCP: alter Server". Einstellungen der Welt, Rechte und deine freigegebenen Foundry-Seiten
bleiben.

## Deinstallieren

### Windows

Einstellungen, Apps, „Foundry MCP Server", Deinstallieren. Alternativ
`uninstall.cmd` in `%LOCALAPPDATA%\FoundryMCPServer` doppelklicken.

### Mac

`uninstall.command` in `~/Library/Application Support/FoundryMCPServer` mit
Rechtsklick, „Öffnen" starten.

### Was dabei passiert

- Der Eintrag wird aus Claude Desktop (auch der Store-Fassung), Claude Code und Cursor
  entfernt, jeweils mit Sicherung. Andere Einträge bleiben.
- Programmdateien und der Eintrag unter „Apps" werden entfernt.
- **Bleibt**, weil es deine Daten sind: `allowed-origins.json`, der Ordner `logs`, ein
  ComfyUI-Ordner einer älteren Version und die Sicherungen der Konfiguration. Wer alles loswerden will,
  löscht danach den Ordner `FoundryMCPServer` von Hand.
- Das Foundry-Modul entfernst du in Foundry unter „Add-on-Module".
- Mac: Ein alter Programmordner `/Applications/FoundryMCPServer.app` des früheren
  Installers wird nicht mehr benutzt und kann in den Papierkorb.

---

## Fehlersuche

### Den Stand ansehen

Windows, in der Eingabeaufforderung:

```
"%LOCALAPPDATA%\FoundryMCPServer\node.exe" "%LOCALAPPDATA%\FoundryMCPServer\app\build\server\install\cli.js" status
```

Mac, im Terminal:

```
~/Library/Application\ Support/FoundryMCPServer/node ~/Library/Application\ Support/FoundryMCPServer/app/build/server/install/cli.js status
```

Die Ausgabe nennt Version, Ordner, ob ein Server läuft, und für jede gefundene
Konfiguration die Einträge, die auf diesen Server zeigen. Statt `status` gibt
`print-config` den Block für die Konfiguration von Hand aus. Beide ändern nichts.

### Claude zeigt die Werkzeuge nicht

1. Claude Desktop wirklich beendet und neu gestartet? Auf Windows auch im Infobereich
   schließen.
2. Stand ansehen (oben). Steht bei Claude Desktop kein Eintrag, die Einrichtung erneut
   ausführen.
3. Die Protokolle von Claude Desktop liegen im Ordner `logs` neben
   `claude_desktop_config.json`; der Server schreibt dort als `foundry-mcp`.

### „nicht gültiges JSON" oder „left unchanged"

Die Konfigurationsdatei war schon vorher beschädigt. Die Einrichtung ändert eine solche
Datei nie, damit keine anderen Server verloren gehen. Datei in einem Editor öffnen,
reparieren oder aus einer Sicherung zurückholen, dann die Einrichtung erneut ausführen.

### „Eintrag unter anderem Namen, der wie dieser Server aussieht"

Es gibt schon einen selbst angelegten Eintrag, zum Beispiel für einen Bau aus dem
Quelltext. Die Einrichtung legt dann keinen zweiten an, sonst erschienen alle Werkzeuge
doppelt. Den alten Eintrag entfernen und die Einrichtung erneut ausführen, oder ihn so
lassen, wenn er gewollt ist.

### „Der Server läuft noch"

Ein Claude-Fenster oder eine Claude-Code-Sitzung ist noch offen. Alles schließen und
die Einrichtung erneut ausführen. Hat sie trotzdem weitergemacht, startet die neue
Fassung nach dem nächsten Neustart von Claude.

### Windows warnt vor der Datei

`setup.cmd` ist eine Textdatei ohne Signatur. Die Laufzeit `node.exe` ist von der
OpenJS Foundation signiert. Wer sichergehen will, vergleicht die SHA-256-Prüfsumme der
Zip-Datei mit der Datei `.sha256` daneben:

```
certutil -hashfile ninjos-foundry-mcp-server-<version>-win32-x64.zip SHA256
```

### Die Store-Fassung von Claude hat den Eintrag verloren

Ein großes Update der Store-Fassung kann ihre Einstellungen zurücksetzen. Die
Einrichtung einfach erneut ausführen, sie findet die Store-Fassung von selbst.

### Das Modul verbindet sich nicht

- Nur die Spielleitung verbindet sich. Die Welt als Spielleitung öffnen.
- Der Server lauscht auf diesem Rechner auf Port 31415. Foundry muss im Browser **auf
  demselben Rechner** laufen wie Claude. Eine Firewallregel ist dafür nicht nötig.
- Wurde die Foundry-Seite abgewiesen, steht das in der Statusanzeige des Moduls.
  Freigegebene Seiten stehen in `allowed-origins.json` im Ordner
  `%LOCALAPPDATA%\FoundryMCPServer` (Mac: `~/.config/ninjos-foundry-mcp`).

### Battlemaps und Szenenbilder

- **Die drei Werkzeuge fehlen:** `GEMINI_API_KEY` steht nicht im Eintrag, oder Claude
  wurde danach nicht neu gestartet.
- **„Google rejected the API key" oder „refused the request (HTTP 403)":** Schlüssel
  falsch abgeschrieben, gelöscht, oder für die „Generative Language API" nicht
  freigegeben.
- **„limit for this key is reached (HTTP 429)":** Das Kontingent oder Budget ist
  erreicht. Das ist der Schutz, der dich vor hohen Kosten bewahrt; in Google Cloud
  nachsehen und bei Bedarf anheben.
- **`COMFYUI_ENABLED` im Protokoll:** Der ComfyUI-Kartengenerator ist seit 14.2609.6
  ausgebaut. Den Eintrag entfernen und `GEMINI_API_KEY` setzen.
