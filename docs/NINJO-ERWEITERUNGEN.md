# Ninjo-Erweiterungen

Werkzeuge, die es im Ursprungsprojekt (`adambdooley/foundry-vtt-mcp`) nicht gibt
und die hier für den Aufbau eigener Kampagnen ergänzt wurden.

Alle Ergänzungen stehen in den Quelldateien in Blöcken zwischen

```
/* NINJO-ERWEITERUNG: ... */
...
/* ================= ENDE NINJO-ERWEITERUNG ================= */
```

damit sie bei einem Abgleich mit dem Ursprungsprojekt als Ganzes erkennbar
bleiben und nicht versehentlich verloren gehen.

---

## Szenenverwaltung (28.08.2026)

Bis dahin konnte der MCP Szenen nur auflisten, wechseln und per KI neu erzeugen
(`generate-map`). Was fehlte, war der Alltagsfall: aus einem vorhandenen Bild
oder Video eine Szene bauen.

### `create-scene`

Legt eine Szene aus einer Datei an, die bereits im Foundry-Datenverzeichnis
liegt.

| Feld                                            | Bedeutung                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `name`                                          | Name der Szene (Pflicht)                                                                          |
| `background`                                    | Pfad im Datenverzeichnis, z. B. `Maps/Schwertküste/Neverwinter/Gefängnis/SC_Kerker.jpg` (Pflicht) |
| `folderPath`                                    | Zielordner, verschachtelt erlaubt: `Orte/Neverwinter`. Fehlende Ebenen werden angelegt            |
| `templateName`                                  | Name oder Id einer bestehenden Szene, deren Einstellungen übernommen werden                       |
| `width` / `height`                              | Nur nötig, wenn die Messung nicht greifen soll                                                    |
| `padding`, `gridSize`, `navigation`, `activate` | wie in Foundry                                                                                    |

**Maße werden aus der Datei gemessen**, auch bei Videos (über ein verstecktes
`<video>`-Element und dessen Metadaten). Nur wenn das fehlschlägt, greifen die
Werte der Vorlage oder 4000 × 3000.

**Vorlagen werden kopiert, niemals wiederverwendet.** Aus der Vorlage werden
Gitter, Beleuchtung, Sichtbarkeit und Modul-Flags übernommen, aber `_id`,
`_stats`, `thumb`, `active` und alle eingebetteten Dokumente (Tokens, Wände,
Lichter, Notizen) entfernt. Das ist der Grund, warum es dieses Werkzeug gibt:
Zieht man eine Szene aus einem Kompendium in die Welt, behält sie ihre Kennung
und **überschreibt eine bestehende Szene mit derselben Kennung**. Genau so ist
am 27.08.2026 eine Landingpage verloren gegangen.

### `update-scene`

Umbenennen, Hintergrund tauschen, in einen anderen Ordner verschieben, Maße
oder Navigation ändern. Wird ein neuer Hintergrund gesetzt und keine Maße
angegeben, werden die Maße neu gemessen.

### `list-scene-folders`

Alle Szenenordner mit vollem Pfad (`Orte/Neverwinter`), Anzahl der Szenen und
Kennung. Vor `create-scene` nützlich, um den richtigen `folderPath` zu finden.

### `delete-scene`

Löscht eine Szene. Verlangt bewusst die **Kennung**, nicht den Namen, damit
nicht versehentlich eine ähnlich benannte Szene erwischt wird. Eine aktive
Szene wird nicht gelöscht.

---

## Zwei Fallstricke, die dabei gefunden wurden

### Medienpfade müssen URL-kodiert sein

Foundry speichert Pfade kodiert: aus `Gefängnis` wird `Gef%C3%A4ngnis`. Ein Pfad
mit rohen Umlauten wird **still verworfen**, die Szene bleibt ohne Hintergrund,
und es gibt keine Fehlermeldung. `encodeMediaPath()` kodiert deshalb immer,
erkennt aber bereits kodierte Pfade und lässt sie in Ruhe.

### Der Hintergrund hängt in Foundry v14 an der Ebene

In v14 liegt das Hintergrundbild **nicht** mehr in `scene.background.src`,
sondern in der Ebenen-Struktur der Szene:

```
scenes.levels!<sceneId>.defaultLevel0000 → background.src
```

Wer nur `scene.background.src` setzt, bekommt eine leere Szene. `createScene`
und `updateScene` ziehen die Standard-Ebene deshalb nach dem Anlegen nach. Beide
Wege werden gesetzt, damit ältere Foundry-Stände weiter funktionieren.

---

## Betroffene Dateien

| Datei                                        | Was                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/foundry-module/src/data-access.ts` | Logik: `createScene`, `updateScene`, `deleteScene`, `listSceneFolders`, `getOrCreateFolderPath`, `probeMediaSize`, `encodeMediaPath` |
| `packages/foundry-module/src/queries.ts`     | Handler und Registrierung der Abfragen                                                                                               |
| `packages/mcp-server/src/tools/scene.ts`     | Werkzeugbeschreibungen und Weiterreichung                                                                                            |
| `packages/mcp-server/src/backend.ts`         | Verteilung der Werkzeugnamen                                                                                                         |

## Bauen und ausliefern

```bash
npm run build:foundry     # Browser-Modul
npm run build:server      # MCP-Server
```

Danach die geänderten Dateien aus `packages/foundry-module/dist` auf den
Foundry-Server nach `Data/modules/foundry-mcp-bridge/dist` kopieren.

**Wichtig:** `settings.js` auf dem Server **nicht** überschreiben, dort steckt
die eigene Eindeutschung (Sicherung liegt als `settings.js.en.bak` daneben).

Neue Werkzeugnamen werden erst nach einem Neustart des MCP-Servers sichtbar.
Änderungen an bestehenden Werkzeugen greifen bereits nach einem Neuladen des
Browsers.

---

## Kampagnenaufbau (28.08.2026)

Eigene Datei `packages/mcp-server/src/tools/ninjo-campaign.ts`, damit ein
Abgleich mit dem Ursprungsprojekt nichts davon anfasst.

### Wiedergabelisten

| Werkzeug             | Zweck                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `list-playlists`     | Wiedergabelisten der Welt mit ihren Stücken und Kennungen                                      |
| `set-scene-playlist` | Wiedergabeliste und wahlweise ein Stück an eine Szene binden. Leerer Name löst die Verknüpfung |

### `import-from-compendium`

Holt ein Dokument aus einem Kompendium in die Welt: Wiedergabelisten, Szenen,
Journale, Akteure, Zufallstabellen. **Vergibt immer eine neue Kennung.**

Das ist der Unterschied zum Hineinziehen von Hand: Dabei behält der Eintrag
seine Kennung und überschreibt still, was in der Welt dieselbe trägt. Genau
dieser Mechanismus stand am 27.08.2026 unter Verdacht, eine Szene gelöscht zu
haben.

### Zufallstabellen

| Werkzeug            | Zweck                                                |
| ------------------- | ---------------------------------------------------- |
| `list-roll-tables`  | Tabellen der Welt mit Formel und Anzahl der Einträge |
| `create-roll-table` | Tabelle aus einer Liste von Texten anlegen           |

Bereiche werden fortlaufend vergeben, wenn keine angegeben sind, und die
Würfelformel ergibt sich aus dem höchsten Bereich. Sechs Einträge werden also
von selbst zu `1d6`.

### Szenen

| Werkzeug              | Zweck                                                              |
| --------------------- | ------------------------------------------------------------------ |
| `create-scene-note`   | Journal oder Journalseite als Stecknadel auf einer Szene verankern |
| `refresh-scene-thumb` | Vorschaubild neu erzeugen, nötig nach einem Bildtausch             |

### Nachträge zur Szenenverwaltung

- `create-scene` übernimmt jetzt die **komplette Ebenen-Konfiguration** der
  Vorlage, nicht nur den Bildpfad. Foundry legt neue Ebenen mit grauem
  Hintergrund (`#999999`) und Höhe 0 bis 20 an; ohne diesen Schritt sah eine aus
  der Vorlage gebaute Szene anders aus als die Vorlage.
- `update-scene` kann die Hintergrundfarbe über `backgroundColor` setzen.
- **Navigationsname**: Der Szenenname folgt der Ablage-Konvention (`SC_` für
  Szenen, `BM_` für Kampfkarten, Unterstriche statt Leerzeichen), damit er sich
  sortieren lässt. In der Leiste über dem Spieltisch steht dagegen Lesbares:
  aus `SC_Neverwinter_Kerker_Tür` wird `Neverwinter Kerker Tür`. Über `navName`
  auch frei setzbar.

## Kompendien verwalten (28.08.2026)

Fertig gespielte Abschnitte gehören ins Kompendium, nicht in die Welt. Dafür
gibt es jetzt fünf Werkzeuge — und eine Freigabe, die entscheidet, was davon
überhaupt angefasst werden darf.

### Wer darf was

Zwei Stellschrauben greifen ineinander:

- Die **Rechtematrix** unter „Kompendien" steht ab Werk auf _Anlegen und
  ändern_. Löschen verlangt ausdrücklich _Anlegen, ändern und löschen_ — wie
  bei allen anderen Arten auch.
- Das Fenster **Kompendien freigeben** legt fest, welche Kompendien gemeint
  sind. Ist dort nichts angehakt, gilt: jedes entsperrte Kompendium darf
  bearbeitet werden. Das trifft den Normalfall, denn wer ein Kompendium
  entsperrt, will daran arbeiten. Wer es enger will, hakt einzeln an.

Gesperrte Kompendien bleiben geschützt. `unlockIfNeeded` löst die Sperre für
einen einzigen Vorgang und stellt sie danach wieder her — auch dann, wenn der
Vorgang mittendrin scheitert.

### `create-compendium`, `export-to-compendium`, `organize-compendium`

Anlegen, befüllen, einsortieren. Gesichert wird nach Namen, nach Ordner, oder
alles einer Art. Es gehen alle Dokumentarten: `JournalEntry`, `Scene`, `Actor`,
`RollTable`, `Playlist`, `Item`, `Macro`. Bei Szenen kommt der vollständige
Stand mit — Ebene, Hintergrund, Kacheln, verknüpfte Wiedergabeliste.

**Die Kennung bleibt beim Sichern erhalten.** Lag ein Eintrag schon im
Kompendium, wird er überschrieben statt verdoppelt, und die Gesamtzahl im
Kompendium ändert sich nicht. Das ist richtig so — sonst sammelten sich bei
jedem Sichern Dubletten an — sieht aber wie ein Fehlschlag aus. Die Rückmeldung
weist deshalb getrennt aus, was neu angelegt und was überschrieben wurde.

### `set-compendium-lock`

Sperren und entsperren. Ein Archiv, das fertig ist, gehört gesperrt.

### `delete-compendium`

Entfernt ein Weltkompendium samt Inhalt. Drei Sicherungen liegen davor:

1. Die Rechtematrix muss auf _löschen_ stehen — ab Werk tut sie das nicht.
2. Das Kompendium muss freigegeben sein.
3. `confirmLabel` muss genau der Beschriftung entsprechen. Eine vertippte
   Kennung trifft so nicht das falsche Kompendium.

Kompendien aus Modulen und aus dem Spielsystem liegen nicht in der Welt und
lassen sich hierüber nicht entfernen; die Fehlermeldung sagt das auch.

---

### Journal an die Szene hängen (29.08.2026)

Foundry kennt zwei verschiedene Verbindungen zwischen Szene und Journal, und
sie werden leicht verwechselt:

- **Das Szenenjournal** (`scene.journal`, in der Szenenkonfiguration das Feld
  _Journaleintrag_). Es gehört zur ganzen Szene und öffnet sich über die
  Seitenleiste. `create-scene` und `update-scene` setzen es jetzt über
  `journalIdentifier`, wahlweise mit `journalPageName` auf eine bestimmte
  Seite. Ein leerer Bezeichner löst die Verbindung wieder.
- **Eine Notiz auf der Karte** (`create-scene-note`). Das ist ein Buchsymbol an
  einer Koordinate, für einzelne Orte innerhalb einer Karte.

Beim Bauen aus einer Vorlage werden `journal` und `journalEntryPage` jetzt
mitentfernt — sonst erbt jede neue Szene die Verknüpfung der Vorlage.

---

### Was bewusst nicht gebaut wurde

**Dateien hochladen.** Der Weg dafür wäre der Datenkanal zwischen Server und
Browser, und der bricht bei großen Antworten ab (siehe die Hinweise zu den
Journalen im CHANGELOG). Ein Bild von 700 KB ergibt als Base64 rund 930.000
Zeichen und läge deutlich über der Grenze, ab der die Verbindung reißt. Das
wäre nur mit einer Stückelung zu lösen. Solange der Foundry-Server über SSH
erreichbar ist, ist `scp` dafür der robustere Weg.

---

## Naheliegende nächste Schritte

Noch nicht gebaut, aber beim Kampagnenaufbau absehbar gebraucht:

- **Szenenordner pflegen**: umbenennen, verschieben, löschen. Für Journale gibt
  es das bereits, für Szenen noch nicht.
- **Zufallstabellen ändern**: bestehende Tabellen ergänzen oder korrigieren.
  Bisher lassen sie sich nur neu anlegen.
- **Dateien hochladen** mit Stückelung, falls der SSH-Weg einmal wegfällt.
