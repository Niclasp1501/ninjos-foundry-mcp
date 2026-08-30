# Eine Kampagne ins Ninjo-Kompendium sichern

Das `ninjo-kompendium` ist eine **Bibliothek über alle Kampagnen hinweg**, damit
Inhalte wiederverwendbar sind. Es wird **nie geleert**. Jede Kampagne bekommt
darin einen eigenen Ordner, und darunter wird die Ordnerstruktur der Welt
nachgebaut.

```
ninjo-kompendium.szenen
├── Kampagne Fluch des Strahd     ← neu, spiegelt die Weltstruktur
│   ├── 01 Start
│   ├── 08 (K) Schloss Ravenloft
│   │   └── Ravenloft 1F Exterior
│   └── Curse of Strahd
│       └── Stonegarden – 1        ← zusammengezogen, siehe unten
├── 04 Phandalin                   ← andere Kampagnen bleiben unberührt
└── 06 Geister von Salzmarsch
```

Erstmals durchgeführt am 30.08.2026 für „Fluch des Stradh": 902 Weltszenen in
264 Ordner, Pack von 499 auf 1146 Einträge.

---

## Der Ablauf

**0. Sichern.** Immer, vorher:

```bash
ssh foundry-server "cd /home/foundry/foundryuserdata/Data/modules && \
  tar czf ~/welt-backups/ninjo-kompendium-\$(date +%Y%m%d-%H%M).tgz ninjo-kompendium"
```

**1. Exportieren** — ohne `folderName`, alles auf einmal:

```
export-to-compendium { packId: "ninjo-kompendium.szenen", documentType: "Scene" }
```

**2. Warten**, bis der Pack auf der Platte nicht mehr wächst:

```bash
ssh foundry-server "P=…/modules/ninjo-kompendium/packs/szenen; prev=-1; stable=0
for i in \$(seq 1 40); do sz=\$(du -sk \$P | cut -f1)
  [ \"\$sz\" = \"\$prev\" ] && stable=\$((stable+1)) || stable=0
  [ \$stable -ge 3 ] && break; prev=\$sz; sleep 15; done"
```

**3. Ordner anlegen und einsortieren** — per Browser-JS in Foundry, nicht über
MCP (Begründung unten). Muster siehe Abschnitt „Das Skript".

**4. Seite neu laden (F5), dann erst zählen.** Ohne Neuladen lügt der Index.

---

## Sieben Fallstricke, jeder davon hat schon Zeit gekostet

**1. Der Export läuft in `Query timeout` — und wird trotzdem fertig.**
902 Szenen dauern rund 135 Sekunden, 1857 Journale entsprechend länger. Die
Zeitüberschreitung betrifft nur die Rückmeldung. Wer daraus auf einen Abbruch
schließt und neu anfängt, wirft fertige Arbeit weg — genau so ist ein Export mit
902 Einträgen gelöscht worden, weil eine Zwischenzählung von 103 für das
Endergebnis gehalten wurde.

**2. Der Kompendium-Index ist nach Ordnerverschiebungen veraltet.**
`getIndex({reload: true})` genügt **nicht**. Er meldete „0 Einträge im
Kampagnenordner", während die Dokumente selbst längst richtig einsortiert waren.
Verlässlich wird die Zählung erst nach einem **Neuladen der Seite**.
Im Zweifel das Dokument fragen, nicht den Index:
`(await pack.getDocument(id)).folder?.name`

**3. `organize-compendium` kann nicht verschachteln.**
Ein `folderName: "A/B"` legt **einen** Ordner mit Schrägstrich im Namen an, keine
Hierarchie. Für echte Verschachtelung:

```js
await Folder.create({ name, type: 'Scene', folder: elternId }, { pack: packId });
```

**4. Kompendium-Ordner können höchstens 3 Ebenen.**
Die Welt hatte Pfade bis Tiefe 5. Mit dem Kampagnenordner davor passen nur
Weltpfade der Tiefe 1 und 2. Tiefere werden zusammengezogen:
`[Kampagne, ersterTeil, restlicheTeile.join(' – ')]` — 60 von 261 Pfaden betraf das.

**5. `folderName` beim Export nimmt Unterordner NICHT mit.**
`folderName: "Crystal Caves"` scheiterte mit „Kein Scene im Ordner", weil dort nur
Unterordner liegen. Ordnernamen sind zudem nicht eindeutig („Room 1", „Camp",
„1"–„6" gibt es mehrfach). Deshalb: alles auf einmal exportieren und danach
einsortieren, nicht ordnerweise.

**6. Gleiche Namen werden überschrieben, nicht verdoppelt.**
Der Export meldet „Vorhandenen Stand ueberschrieben" — alte Fassungen mit
korrigierten Pfaden werden also von selbst ersetzt. Ein separater Löschschritt
ist unnötig.

**7. Szenen mit Token können beim Überschreiben scheitern.**
Beobachtet: `TypeError: Cannot read properties of undefined (reading
'createDocument')` in `ActorDeltaField._updateElement` beim Import einer Szene mit
Token. Der Export läuft weiter; im geprüften Fall fehlte am Ende keine einzige
Szene. Trotzdem hinterher gegenprüfen:

```js
const imPack = new Set([...(await pack.getIndex())].map(e => e.name));
[...game.scenes].filter(s => !imPack.has(s.name)); // muss leer sein
```

---

## Das Skript

Läuft im Browser (Konsole oder MCP-JS), nicht über die MCP-Werkzeuge.

```js
const packId = 'ninjo-kompendium.szenen';
const WURZEL = 'Kampagne Fluch des Strahd';
const SAMMLUNG = game.scenes; // je Art anpassen
const KLASSE = Scene; // je Art anpassen

const pack = game.packs.get(packId);
const pfad = f => {
  const t = [];
  let c = f,
    n = 0;
  while (c && n++ < 10) {
    t.unshift(c.name);
    c = c.folder;
  }
  return t;
};
const ziel = t =>
  t.length === 0
    ? [WURZEL]
    : t.length <= 2
      ? [WURZEL, ...t]
      : [WURZEL, t[0], t.slice(1).join(' – ')];

// 1) Ordner anlegen, flachste zuerst
const pfadeAlle = new Set();
for (const d of SAMMLUNG) {
  const z = ziel(pfad(d.folder));
  for (let i = 1; i <= z.length; i++) pfadeAlle.add(JSON.stringify(z.slice(0, i)));
}
const sortiert = [...pfadeAlle].map(JSON.parse).sort((a, b) => a.length - b.length);

const schluessel = arr => JSON.stringify(arr);
const ordnerPfad = f => {
  const t = [];
  let c = f,
    n = 0;
  while (c && n++ < 6) {
    t.unshift(c.name);
    c = c.folder;
  }
  return t;
};
const idVon = new Map();
for (const f of pack.folders) idVon.set(schluessel(ordnerPfad(f)), f.id);

for (const p of sortiert) {
  if (idVon.has(schluessel(p))) continue;
  const elternId = p.length > 1 ? idVon.get(schluessel(p.slice(0, -1))) : null;
  const f = await Folder.create(
    { name: p.at(-1), type: SAMMLUNG.documentName, folder: elternId ?? null },
    { pack: packId }
  );
  idVon.set(schluessel(p), f.id);
}

// 2) Einsortieren
const zielId = new Map();
for (const d of SAMMLUNG) zielId.set(d.name, idVon.get(schluessel(ziel(pfad(d.folder)))));
const idx = await pack.getIndex({ reload: true });
const updates = [];
for (const e of idx) {
  const z = zielId.get(e.name);
  if (z && e.folder !== z) updates.push({ _id: e._id, folder: z });
}
for (let i = 0; i < updates.length; i += 100)
  await KLASSE.updateDocuments(updates.slice(i, i + 100), { pack: packId });
```

**Wichtig zum Schlüssel:** Pfadteile mit `JSON.stringify` verketten, nicht mit
einem Trennzeichen. Ordnernamen enthalten Leerzeichen, Bindestriche und
Schrägstriche („Ravenloft 4F/5F", „Mansion Attic/Roof") — jedes Trennzeichen
führt früher oder später zu falsch zerlegten Namen.

`updateDocuments` gibt in diesem Fall ein leeres Array zurück, obwohl die
Änderung greift. Der Rückgabewert taugt nicht als Erfolgsnachweis — siehe
Fallstrick 2, nach dem Neuladen zählen.
