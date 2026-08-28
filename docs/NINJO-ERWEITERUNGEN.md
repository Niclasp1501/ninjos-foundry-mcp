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

## Naheliegende nächste Schritte

Noch nicht gebaut, aber beim Kampagnenaufbau absehbar gebraucht:

- **Wiedergabelisten**: auflisten, aus einem Kompendium in die Welt holen, einer
  Szene zuordnen. Konkreter Anlass: In der Welt `farun4` zeigen vier
  Musikverknüpfungen in den Journalen ins Leere, weil das Material aus einer
  Vorgängerwelt kopiert wurde, die Wiedergabelisten aber nicht.
- **Zufallstabellen**: anlegen und befüllen. Das Abenteuer bringt reichlich
  W6- und W8-Tabellen mit, die bisher nur als Text in den Journalen stehen.
- **Dateien hochladen**: Bilder über Foundrys eigene Dateiverwaltung ablegen,
  statt sie per SSH auf den Server zu schieben.
- **Notizen auf Szenen setzen**: Journalseiten als Stecknadeln auf einer Karte
  verankern.
