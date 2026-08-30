# Anweisung: Einträge in Kompendien verwalten

**Anlass.** Beim Neuaufbau der Kampagnensicherung („Fluch des Stradh" nach
`ninjo-kompendium`) fiel auf: Es gibt keinen Weg, **Einträge** aus einem
Kompendium zu entfernen. Dadurch lässt sich ein gewachsenes Archiv nicht
neu aufbauen — ein Export kommt immer zu den Altbeständen dazu.

## Was heute geht und was nicht

| Vorhandene Funktion    | Wirkung                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `createCompendium`     | legt ein **Welt**-Kompendium an                                                                                             |
| `deleteCompendium`     | entfernt ein **Welt**-Kompendium samt Inhalt; Modul- und System-Packs werden bewusst verweigert                             |
| `exportToCompendium`   | schreibt Weltdokumente in **jedes** Pack, auch Modul-Packs; entsperrt auf Verlangen und stellt die Sperre danach wieder her |
| `organizeCompendium`   | verschiebt Einträge in einen Ordner                                                                                         |
| `importFromCompendium` | holt einen Eintrag in die Welt, immer mit frischer Id                                                                       |

**Die Lücke:** Kein Löschen einzelner Einträge, kein Leeren eines Packs.

**Wichtige Unterscheidung, die die Verweigerung in `deleteCompendium` betrifft:**
Ein Modul-Pack zu _entfernen_ heißt, in die Dateistruktur eines fremden Moduls
einzugreifen — das gehört in die Modulverwaltung und bleibt zu Recht gesperrt.
Den _Inhalt_ eines Packs zu löschen ist dagegen eine gewöhnliche
Dokumentoperation und für Modul-Packs genauso zulässig wie für Welt-Packs,
solange das Pack entsperrt und freigegeben ist. Die neuen Funktionen dürfen
also **nicht** die `packageType !== 'world'`-Prüfung aus `deleteCompendium`
übernehmen.

---

## 1. `compendium-list-entries`

Auflisten, was in einem Pack liegt. Wird für alles Weitere gebraucht: Ohne Ids
und Namen lässt sich weder gezielt löschen noch hinterher prüfen.
`listCompendiums` liefert bisher nur Zählwerte.

```
packId      Pflicht
namePattern optional, Teiltext (Groß-/Kleinschreibung egal)
folderName  optional, nur Einträge in diesem Ordner
limit       optional, Vorgabe 200, Höchstwert 1000
offset      optional, zum Blättern
```

**Rückgabe:** `{ packId, label, total, returned, offset, hasMore, entries: [{ id, name, type, folder }] }`

Nur den Index lesen (`pack.getIndex()`), nicht die vollen Dokumente — ein Pack
mit 1857 Journalen darf die Abfrage nicht sprengen.

## 2. `compendium-delete-entries`

Gezielt Einträge entfernen.

```
packId          Pflicht
ids             Ids der Einträge
names           alternativ Namen (exakt; mehrdeutige werden gemeldet, nicht geraten)
unlockIfNeeded  wie bei exportToCompendium: entsperren, danach Zustand wiederherstellen
dryRun          nur berichten, nichts löschen
```

**Rückgabe:** `{ packId, deleted: n, entries: [{id, name}], notFound: [...], ambiguous: [...], dryRun }`

Regeln:

- `assertAllowed('Compendiums', 'delete')` und `assertCompendiumFreigegeben` wie gehabt
- Gesperrtes Pack ohne `unlockIfNeeded` → Fehler, nicht stillschweigend entsperren
- Nicht gefundene Namen werden **gemeldet**, nicht übergangen
- Löschen über `pack.getDocuments()` + `Document.deleteDocuments(ids, {pack})`
- Prüfprotokoll wie bei `deleteCompendium`

## 3. `compendium-clear`

Ein Pack vollständig leeren, ohne es zu entfernen. Das ist der Fall, der den
Neuaufbau eines Archivs überhaupt erst möglich macht.

```
packId          Pflicht
confirmLabel    Pflicht — muss exakt dem Label entsprechen (wie bei deleteCompendium)
unlockIfNeeded  optional
dryRun          optional
```

**Rückgabe:** `{ packId, label, cleared: n, dryRun }`

Der `confirmLabel`-Riegel ist hier besonders wichtig: Eine verwechselte Kennung
würde sonst ein fremdes Archiv leeren. Bei mehr als 500 Einträgen in Blöcken zu
je ~200 löschen, sonst wird die Antwort zu groß.

## 4. `export-to-compendium` um `replace` erweitern

Der eigentliche Anwendungsfall ist „Archiv neu aufbauen". Heute braucht das
zwei Schritte, und zwischen ihnen ist das Archiv leer.

```
replace   optional, Vorgabe false
          true = Pack vor dem Export leeren (identisch zu compendium-clear)
```

Bei `replace: true` ebenfalls `confirmLabel` verlangen — es ist eine
zerstörende Operation.

---

## Was beim Bauen zu beachten ist

**Die vier Stellen** (siehe CLAUDE.md): `data-access.ts` (Umsetzung),
`queries.ts` (Registrierung + Handler), `tools/*.ts` (Werkzeugbeschreibung +
Weiterreichen), `backend.ts` (switch-Zweig).

**Zeitüberschreitung beachten.** Gemessen am 30.08.2026: Der Export von 902
Szenen dauert rund 135 Sekunden und läuft dabei in `Query timeout` — der
Vorgang selbst **läuft im Hintergrund weiter und wird fertig**. Das hat in der
Praxis zu einem Fehlschluss geführt: Eine Zwischenzählung (103 Einträge) wurde
für das Endergebnis gehalten und ein fertiger Export verworfen.

Zwei Konsequenzen für die Umsetzung:

1. Löschen und Leeren sollen **Zählwerte zurückgeben**, damit man das Ergebnis
   nicht raten muss.
2. Für lange Vorgänge wäre eine Fortschrittsmeldung oder eine Kennung zum
   Nachfragen sinnvoll. Bis es die gibt, gilt als Behelf: Auf dem Server
   beobachten, bis der Pack-Ordner nicht mehr wächst, und **erst dann** zählen —
   nicht aus einer Zwischenzahl schließen.

**Sicherung vor dem ersten Einsatz.** Ein Pack zu leeren ist nicht umkehrbar.
Vorher:

```bash
ssh foundry-server "cd /home/foundry/foundryuserdata/Data/modules && \
  tar czf ~/welt-backups/ninjo-kompendium-\$(date +%Y%m%d-%H%M).tgz ninjo-kompendium"
```

**Prüfen lässt sich am besten so:** In ein frisch angelegtes Welt-Kompendium
exportieren, dort löschen und leeren, Zählwerte vergleichen. Erst danach an
`ninjo-kompendium` gehen.

---

## Durchsicht vom 30.08.2026

Alle Tatsachenbehauptungen oben wurden gegen den Quelltext geprüft und stimmen:
die `packageType`-Sperre in `deleteCompendium` ([data-access.ts:9737]), der
`confirmLabel`-Riegel, das Entsperren mit Wiederherstellung im `finally`, und vor
allem die Lücke selbst — es gibt nirgends ein Löschen einzelner Einträge.

Drei Ergänzungen für die Umsetzung:

**1. Die Werkzeugnamen brechen das Muster.** Alle zwölf vorhandenen
Kompendium-Werkzeuge stehen Verb zuerst: `list-compendiums`, `delete-compendium`,
`set-compendium-lock`, `export-to-compendium`. Also:

| statt                       | besser                      |
| --------------------------- | --------------------------- |
| `compendium-list-entries`   | `list-compendium-entries`   |
| `compendium-delete-entries` | `delete-compendium-entries` |
| `compendium-clear`          | `clear-compendium`          |

**2. Punkt 1 gibt es zur Hälfte schon.** Seit dem 30.08.2026 hat das Modul
`getPackIndex` — genau „nur den Index lesen, nicht die vollen Dokumente", mit
Feldauswahl in Punktschreibweise und einer Deckelung bei 5000 Einträgen. Das
gehört **erweitert** (um `folderName`, `namePattern`, `offset`, `total`,
`hasMore`), nicht durch einen zweiten Indexleser ersetzt. Die Deckelung dabei
beibehalten: Ein Pack mit 1857 Journalen darf den Datenkanal nicht sprengen.

**3. Löschen ist ab Werk abgeschaltet.** `assertAllowed('Compendiums', 'delete')`
ist richtig, heißt aber: Ohne `permCompendiums: full` in den Moduleinstellungen
tun die neuen Werkzeuge nichts. Das gehört **in die Werkzeugbeschreibung**, sonst
sieht die Verweigerung nach einem Fehler aus statt nach einer Einstellung.

### Nebenbefund, bereits behoben

Beim Prüfen fiel auf, dass `exportToCompendium` und `organizeCompendium` die
Freigabeliste nur dann abfragten, wenn das Pack **gesperrt** war und
`unlockIfNeeded` fehlte. Ein entsperrtes Kompendium wurde nie gegen die Liste
gehalten — wer unter „Kompendien freigeben" den Schreibzugriff einschränkte, wurde
beim Export übergangen. `deleteCompendium` prüfte von jeher bedingungslos.

Beide prüfen jetzt immer. Die Sperre selbst bleibt dabei wie dokumentiert: Eine
gefüllte Freigabeliste sticht sie, und `unlockIfNeeded` löst sie für den Vorgang.
