# Eine Kampagne ins Ninjo-Kompendium sichern

Das `ninjo-kompendium` ist eine **Bibliothek über alle Kampagnen hinweg**, damit
Inhalte wiederverwendbar sind. Es wird **nie geleert**. Jede Kampagne bekommt
darin einen Ordner `Kampagne <Name>`, und darunter wird die Ordnerstruktur der
Welt nachgebaut.

```
ninjo-kompendium.szenen
├── Kampagne Fluch des Strahd     ← neu, spiegelt die Weltstruktur
│   ├── 01 Start
│   ├── 08 (K) Schloss Ravenloft
│   │   └── Ravenloft 1F Exterior
│   └── Curse of Strahd
│       └── Stonegarden – 1        ← zusammengezogen, siehe Fallstrick 4
├── 04 Phandalin                   ← andere Kampagnen bleiben unberührt
└── 06 Geister von Salzmarsch
```

Erstmals durchgeführt am 30.08.2026 für „Fluch des Stradh":

| Pack         | aus der Welt | Ordner | Pack gesamt |
| ------------ | -----------: | -----: | ----------: |
| szenen       |          902 |    264 |        1146 |
| journale     |         2818 |    168 |        3322 |
| bestiarium   |          395 |     29 |         622 |
| npcs         |          139 |     11 |         148 |
| charaktere   |           14 |      6 |         105 |
| gegenstaende |          440 |     37 |        1182 |
| tabellen     |          153 |      7 |         157 |
| makros       |          141 |      5 |         142 |
| musik        |           70 |     19 |         107 |

---

## Der Ablauf

**0. Sichern.** Immer, vorher — das Ganze ist nicht umkehrbar:

```bash
ssh foundry-server "cd /home/foundry/foundryuserdata/Data/modules && \
  tar czf ~/welt-backups/ninjo-kompendium-\$(date +%Y%m%d-%H%M).tgz ninjo-kompendium"
```

**1. Ordner anlegen**, flachste zuerst (Skript unten, Teil 1).

**2. Dokumente schreiben** (Skript unten, Teil 2) — direkt über
`Klasse.create(daten, {pack, keepId:true})` statt über `export-to-compendium`.
Gründe:

- Man wählt **je Dokument** das Zielpack. Akteure müssen auf drei Packs verteilt
  werden, das kann der Export nicht.
- Der Ordner wird beim Anlegen gleich mitgegeben — kein zweiter Durchgang, keine
  falsch einsortierten Fremdeinträge (Fallstrick 6).
- Kein `Query timeout`, weil die Schleife im Browser läuft und nicht über den
  MCP-Kanal.

548 Akteure brauchten so gut zwei Minuten, 804 übrige Dokumente knapp drei.

**3. Seite neu laden (F5), dann erst zählen.** Ohne Neuladen lügt der Index.

**4. Gegenprüfen** (Skript unten, Teil 3): Anzahl im Kampagnenordner muss der
Weltanzahl entsprechen, `davonNichtAusDerWelt` und `weltdokAusserhalb` müssen
**0** sein.

**5. Leere Ordnerhüllen entfernen.** Nach dem Umzug bleiben die Ordner der alten,
flachen Ablage leer zurück (beim ersten Mal 251 Stück). Wiederholt löschen, bis
nichts mehr übrig ist — ein Durchgang genügt nicht, weil Elternordner erst leer
werden, wenn ihre Kinder weg sind.

---

## Wohin welches Dokument gehört

Nach Typ, nicht nach Weltordner — bis auf die Akteure:

| Welt                           | Pack                              |
| ------------------------------ | --------------------------------- |
| Szenen                         | `szenen`                          |
| Journale                       | `journale`                        |
| Akteure Typ `character`        | `charaktere`                      |
| Akteure unter Weltordner `NPC` | `npcs` (führendes „NPC" entfällt) |
| übrige Akteure                 | `bestiarium`                      |
| Gegenstände                    | `gegenstaende`                    |
| Rolltabellen                   | `tabellen`                        |
| Playlisten                     | `musik`                           |
| Makros                         | `makros`                          |

`buch` und `presets` bleiben außen vor — die enthalten keine Kampagneninhalte.

---

## Sieben Fallstricke, jeder davon hat schon Zeit gekostet

**1. `export-to-compendium` läuft in `Query timeout` — und wird trotzdem fertig.**
902 Szenen dauern rund 135 Sekunden. Die Zeitüberschreitung betrifft nur die
Rückmeldung. Wer daraus auf einen Abbruch schließt und neu anfängt, wirft fertige
Arbeit weg — genau so ist ein Export mit 902 Einträgen gelöscht worden, weil eine
Zwischenzählung von 103 für das Endergebnis gehalten wurde. Behelf, solange es
keine Fortschrittsmeldung gibt: auf dem Server warten, bis der Pack-Ordner nicht
mehr wächst, und **erst dann** zählen.

**2. Der Kompendium-Index ist nach Ordnerverschiebungen veraltet.**
`getIndex({reload: true})` genügt **nicht**. Er meldete „0 Einträge im
Kampagnenordner", während die Dokumente längst richtig einsortiert waren.
Verlässlich wird die Zählung erst nach einem **Neuladen der Seite**.
Im Zweifel das Dokument fragen, nicht den Index:
`(await pack.getDocument(id)).folder?.name`

**3. `organize-compendium` kann nicht verschachteln.**
Ein `folderName: "A/B"` legt **einen** Ordner mit Schrägstrich im Namen an, keine
Hierarchie. Für echte Verschachtelung nur:

```js
await Folder.create({ name, type: 'Scene', folder: elternId }, { pack: packId });
```

**4. Kompendium-Ordner können höchstens 3 Ebenen.**
Die Welt hatte Pfade bis Tiefe 5. Mit dem Kampagnenordner davor passen nur
Weltpfade der Tiefe 1 und 2. Tiefere werden zusammengezogen:
`[Kampagne, ersterTeil, restlicheTeile.join(' – ')]` — bei den Szenen betraf das
60 von 261 Pfaden.

**5. `folderName` beim Export nimmt Unterordner NICHT mit.**
`folderName: "Crystal Caves"` scheitert mit „Kein Scene im Ordner", wenn dort nur
Unterordner liegen. Ordnernamen sind zudem nicht eindeutig („Room 1", „Camp",
„1"–„6" gibt es mehrfach).

**6. Niemals über Namen zuordnen — immer über die Id.**
Der wichtigste Punkt. Sowohl `export-to-compendium` als auch `create(…,
{keepId:true})` **behalten die Id** des Weltdokuments. Ein Packeintrag gehört
also genau dann zur Welt, wenn `game.journal.get(e._id)` etwas liefert. Namen
taugen dafür nicht:

- Die Welt selbst hat Dubletten (305 Journalnamen doppelt, 647 Dokumente).
- Andere Kampagnen im Archiv haben gleichnamige Einträge („Zustände",
  „Gefahren in der Wildnis", generierte „DontTouch-POI-Teleporter-…").

Beim ersten Durchlauf hat der Namensabgleich 32 Journale und 10 Szenen **aus
fremden Kampagnenordnern in den Strahd-Ordner gezogen**. Verloren war nichts,
aber die richtige Ablage ließ sich nur aus der Sicherung zurückholen (siehe
unten).

**6b. `export-to-compendium` legt Einträge in gleichnamige Packordner.**
Ein Weltordner „Regeln" landet im vorhandenen Packordner „Regeln" einer anderen
Kampagne. Auch das fängt die Id-Prüfung wieder ein — ein weiterer Grund, lieber
direkt mit `create` zu schreiben und den Ordner gleich mitzugeben.

**7. Szenen mit Token können beim Überschreiben scheitern.**
Beobachtet: `TypeError: Cannot read properties of undefined (reading
'createDocument')` in `ActorDeltaField._updateElement`. Der Export läuft weiter;
im geprüften Fall fehlte am Ende keine Szene. Trotzdem gegenprüfen (Teil 3).

---

## Die zweite Kampagne: Id-Kollisionen

Ab der zweiten Welt ist das der wichtigste Schritt. Welten, die voneinander
abgeleitet wurden oder Inhalte über Scene Packer geteilt haben, enthalten
**dieselben Dokument-Ids**. Bei „alt WdS" (`faerun_2`) waren das 693 von 711
Journalen, 178 von 210 Szenen, 164 von 323 Akteuren.

Eine Id kann im Pack nur einmal vorkommen. Wer blind `delete + create` macht,
reißt den Eintrag aus dem Ordner der **anderen** Kampagne heraus. Deshalb vor dem
Schreiben je Dokument prüfen, wo die Id schon liegt:

| Lage der Id im Pack                             | Vorgehen                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| gar nicht vorhanden                             | anlegen mit `keepId` unter `Kampagne <Name>`                             |
| in der alten flachen Ablage (kein `Kampagne …`) | aktualisieren und umhängen — das ist der frühere Stand genau dieser Welt |
| unter `Kampagne <andere>`                       | **überspringen**, nichts anfassen                                        |

```js
const v = nach.get(d.id); // nach = Map(id -> Indexeintrag)
const fremd =
  v &&
  v.folder &&
  opfad(p.folders.get(v.folder))[0].startsWith('Kampagne ') &&
  opfad(p.folders.get(v.folder))[0] !== WURZEL;
```

**Warum überspringen und nicht als Kopie mit neuer Id anlegen?** Weil die
Kollisionen in der Praxis genau die geteilten Inhalte sind: 570 der alt-WdS-
Journale lagen im Weltordner „Beneos Battlemaps", 50 Gegenstände unter „Fluch des
Strahd" — Reste der Welt, aus der kopiert wurde. Sie sind unter der Kampagne,
zu der sie gehören, bereits archiviert, und dort in der vollständigeren Fassung.
Eine zweite Kopie wäre nur Ballast.

Die Inhalte sind dabei **nicht** identisch: bei einer Stichprobe von 75
kollidierenden Dokumenten stimmten nur 5 wirklich überein. Strahds „Zustände"
etwa hat eine Seite „Erschöpfungsregeln", die der alt-WdS-Fassung fehlt.
Überschreiben verliert also echten Inhalt — das ist kein theoretisches Risiko.

Hinterher gegenprüfen, dass die andere Kampagne unverändert ist: Die Zählwerte je
Pack müssen exakt dieselben sein wie vorher.

## Packs sind je Welt gesperrt

Die Sperre eines Kompendiums steht in den **Welteinstellungen**, nicht im Modul.
In `faerun` waren alle neun Packs offen, in `faerun_2` alle neun gesperrt. Vor dem
Schreiben Zustand merken, entsperren, hinterher wiederherstellen:

```js
window.__sperren = {};
for (const packId of packs) {
  const p = game.packs.get(packId);
  window.__sperren[packId] = p.locked;
  if (p.locked) await p.configure({ locked: false });
}
// … Arbeit …
for (const [packId, war] of Object.entries(window.__sperren))
  if (war) await game.packs.get(packId).configure({ locked: true });
```

## Alte Dubletten aufräumen

Nach dem Umzug können Einträge doppelt liegen: einmal frisch im Kampagnenordner,
einmal als alte Sicherung derselben Kampagne in der flachen Ablage. Eindeutig ist
das **nur bei gleicher Id** — dann ist es dasselbe Dokument und die alte Fassung
kann weg. Bei den Akteuren waren das 143 Stück (alter Ordner „NPC", jetzt im Pack
`npcs`).

Einträge mit **anderer** Id sind keine Dubletten, sondern früherer Stand aus
einer früheren Weltfassung. Die bleiben stehen, solange niemand ausdrücklich
etwas anderes sagt.

Vor dem Löschen prüfen, dass es die frische Fassung wirklich gibt — in **allen**
in Frage kommenden Packs, nicht nur im selben.

---

## Aus der Sicherung nachschlagen

Wenn eine Zuordnung schiefging, steht der alte Stand im Sicherungsarchiv. Die
Packs sind LevelDB; `classic-level` liegt in Foundrys `node_modules`:

```js
// /tmp/dump.mjs — Aufruf: node /tmp/dump.mjs <pfad-zum-pack-ordner>
import { ClassicLevel } from '/opt/foundryvtt/resources/app/node_modules/classic-level/index.js';
const db = new ClassicLevel(process.argv[2], { valueEncoding: 'json' });
const eintraege = [],
  ordner = [];
for await (const [k, v] of db.iterator()) {
  if (k.startsWith('!folders!')) ordner.push({ id: v._id, name: v.name, folder: v.folder ?? null });
  else if (!k.includes('.')) eintraege.push({ id: v._id, name: v.name, folder: v.folder ?? null });
}
await db.close();
console.log(JSON.stringify({ eintraege, ordner }));
```

Nur auf einer **entpackten Sicherung** laufen lassen, nie auf dem laufenden Pack
— LevelDB lässt sich nicht zweimal öffnen.

---

## Das Skript

Läuft im Browser der GM-Sitzung. Teil 2 dauert Minuten und würde die Konsole
blockieren, deshalb läuft er als abgesetzte Aufgabe mit Fortschritt in
`window.__st`.

```js
// ---------- Teil 1: Ordner ----------
const WURZEL = 'Kampagne Fluch des Strahd';
const K = a => JSON.stringify(a);
const wpfad = f => {
  const t = [];
  let c = f,
    n = 0;
  while (c && n++ < 10) {
    t.unshift(c.name);
    c = c.folder;
  }
  return t;
};
const opfad = f => {
  const t = [];
  let c = f,
    n = 0;
  while (c && n++ < 6) {
    t.unshift(c.name);
    c = c.folder;
  }
  return t;
};
// höchstens 3 Ebenen: Tieferes zusammenziehen
const kuerz = t =>
  t.length === 0
    ? [WURZEL]
    : t.length <= 2
      ? [WURZEL, ...t]
      : [WURZEL, t[0], t.slice(1).join(' – ')];

const wahl = a => {
  const t = wpfad(a.folder);
  if (a.type === 'character') return { pack: 'ninjo-kompendium.charaktere', pfad: kuerz(t) };
  if (t[0] === 'NPC') return { pack: 'ninjo-kompendium.npcs', pfad: kuerz(t.slice(1)) };
  return { pack: 'ninjo-kompendium.bestiarium', pfad: kuerz(t) };
};

const plan = new Map(); // packId -> [{id, pfad}]
for (const a of game.actors) {
  const w = wahl(a);
  if (!plan.has(w.pack)) plan.set(w.pack, []);
  plan.get(w.pack).push({ id: a.id, pfad: w.pfad });
}

for (const [packId, liste] of plan) {
  const p = game.packs.get(packId);
  const idVon = new Map();
  for (const f of p.folders) idVon.set(K(opfad(f)), f.id);
  const alle = new Set();
  for (const e of liste) for (let i = 1; i <= e.pfad.length; i++) alle.add(K(e.pfad.slice(0, i)));
  for (const q of [...alle].map(JSON.parse).sort((a, b) => a.length - b.length)) {
    if (idVon.has(K(q))) continue;
    const elt = q.length > 1 ? idVon.get(K(q.slice(0, -1))) : null;
    const f = await Folder.create(
      { name: q.at(-1), type: 'Actor', folder: elt ?? null },
      { pack: packId }
    );
    idVon.set(K(q), f.id);
  }
}
window.__plan = [...plan].map(([packId, liste]) => ({ packId, liste }));
```

```js
// ---------- Teil 2: Dokumente schreiben (abgesetzt) ----------
window.__st = { gesamt: 0, fertig: 0, neu: 0, ersetzt: 0, fehler: [] };
for (const g of window.__plan) window.__st.gesamt += g.liste.length;

(async () => {
  for (const g of window.__plan) {
    const p = game.packs.get(g.packId);
    const idVon = new Map();
    for (const f of p.folders) idVon.set(K(opfad(f)), f.id);
    const vorhanden = new Set([...(await p.getIndex({ reload: true }))].map(e => e._id));
    for (const e of g.liste) {
      try {
        const d = game.actors.get(e.id).toObject();
        d.folder = idVon.get(K(e.pfad)) ?? null;
        // gleiche Id schon im Pack: löschen und neu anlegen, sonst kollidiert keepId
        if (vorhanden.has(e.id)) {
          await Actor.deleteDocuments([e.id], { pack: g.packId });
          window.__st.ersetzt++;
        } else window.__st.neu++;
        await Actor.create(d, { pack: g.packId, keepId: true });
      } catch (err) {
        window.__st.fehler.push(e.id + ': ' + err.message);
      }
      window.__st.fertig++;
    }
  }
  window.__st.ende = true;
})();
```

Fortschritt danach mit `window.__st` abfragen. **Nicht** im selben Aufruf auf das
Ende warten — ein `await` über mehr als ~30 Sekunden lässt die Auswertung in eine
Zeitüberschreitung laufen, während die Aufgabe im Hintergrund weiterläuft.

```js
// ---------- Teil 3: Gegenprüfen (nach F5) ----------
const p = game.packs.get('ninjo-kompendium.bestiarium');
const w = [...p.folders].find(f => f.name === WURZEL && !f.folder);
const unter = new Set();
const sam = f => {
  unter.add(f.id);
  for (const k of p.folders.filter(x => x.folder?.id === f.id)) sam(k);
};
sam(w);
const idx = await p.getIndex();
const drin = [...idx].filter(e => unter.has(e.folder));
const weltIds = new Set([...game.actors].map(d => d.id));
({
  imKampagnenordner: drin.length,
  davonNichtAusDerWelt: drin.filter(e => !weltIds.has(e._id)).length, // muss 0 sein
  weltdokAusserhalb: [...idx].filter(e => !unter.has(e.folder) && weltIds.has(e._id)).length,
});
```

```js
// ---------- Teil 4: leere Ordnerhüllen entfernen ----------
for (let runde = 0; runde < 6; runde++) {
  const idx = await p.getIndex();
  const belegt = new Set([...idx].map(e => e.folder));
  const hatKind = new Set([...p.folders].map(f => f.folder?.id).filter(Boolean));
  const leer = [...p.folders].filter(f => !belegt.has(f.id) && !hatKind.has(f.id));
  if (!leer.length) break;
  await Folder.deleteDocuments(
    leer.map(f => f.id),
    { pack: p.collection }
  );
}
```

**Wichtig zum Schlüssel:** Pfadteile mit `JSON.stringify` verketten, nie mit einem
Trennzeichen. Ordnernamen enthalten Leerzeichen, Bindestriche und Schrägstriche
(„Ravenloft 4F/5F", „Mansion Attic/Roof") — jedes Trennzeichen führt früher oder
später zu falsch zerlegten Namen.

`updateDocuments` gibt bei Ordnerwechseln ein leeres Array zurück, obwohl die
Änderung greift. Der Rückgabewert taugt nicht als Erfolgsnachweis — nach dem
Neuladen zählen (Fallstrick 2).
