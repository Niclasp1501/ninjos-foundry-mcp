# Abgleich mit dem Ursprung

Dieser Fork hat **keine gemeinsame Historie** mit
[adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp).
`git merge-base` liefert nichts, Änderungen von dort lassen sich also nicht
zusammenführen — sie müssen einzeln übernommen werden.

Diese Datei ist das Gedächtnis dafür. **Jeder** Commit aus dem Ursprung bekommt hier
eine Zeile, auch der abgelehnte. Ohne das prüft beim nächsten Mal jemand dieselben
vierzehn Commits noch einmal durch und weiß nicht, warum drei davon damals nicht
übernommen wurden.

`npm run pruefen:ursprung` holt den Stand und meldet, was hier noch fehlt.

## Beim Übernehmen zu beachten

**Der Ursprung nutzt weiter die Kennung `foundry-mcp-bridge`.** Übernommener Code
bringt sie mit. Am 30.08.2026 kam so ein `foundry-mcp-bridge.addActorsToScene`
herein, das das Modul nie erreicht hätte. `npm run pruefen:abfragen` fängt das
inzwischen ab — trotzdem nach jedem Übernehmen laufen lassen.

**Übernommene Tests schreiben die alte Kennung fest.** Sie werden rot, sobald der
Aufruf berichtigt ist. Richtig ist, den Test an `MODULE_ID` zu hängen, nicht die
Zeichenkette anzupassen.

**Die Reihenfolge zählt.** Ein Commit, der auf einem noch nicht übernommenen aufbaut,
erzeugt einen Konflikt über hunderte Zeilen. `1a10359` vor `80ee61a` zu ziehen ging
schief; andersherum lief beides sauber durch.

## Stand: 30.08.2026

Durchgesehen wurden alle 14 Commits des Ursprungs seit dem Fork (16.07.2026).

### Übernommen

| Commit    | Was                                                         | Unser Commit   |
| --------- | ----------------------------------------------------------- | -------------- |
| `4840691` | `ws://` für Loopback auch auf HTTPS-Seiten                  | vor dem 29.08. |
| `fe122af` | DSA5 und WFRP4e werden von `detectGameSystem` erkannt       | `6b0a619`      |
| `80ee61a` | `normalizePayload` für DSA5, mit 29 Tests                   | `f5dae7d`      |
| `1a10359` | DSA5 liefert sein eigenes Actor-Schema                      | `2989681`      |
| `fab6462` | `scene_name` und `quality` im Dedup-Hash der Kartenaufträge | `41fa510`      |
| `2e48b7f` | `place`-Aktion für `manage-actors`                          | `51c0c85`      |

### Unabhängig ebenfalls gemacht

Hier sind wir zum selben Ergebnis gekommen, ohne den Ursprung anzusehen. Das
bestätigt die Diagnosen — übernommen werden muss nichts.

| Commit    | Was                                          | Bei uns                                                                |
| --------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| `fa4f793` | `getPackIndex` registrieren                  | eigene Fassung mit Objektparametern, GM-Prüfung und Deckelung bei 5000 |
| `bf6685a` | Manifest auf das Release statt auf den Zweig | in `14.2608.1`                                                         |
| `fe94d8e` | CI-Riegel gegen Versionsdrift                | `scripts/version-pruefen.mjs`, zusätzlich mit Schema- und Tag-Prüfung  |
| `12f547a` | Ebenen-Hintergrund in Foundry v14            | eigene Fassung, siehe Fallstrick 2 in CLAUDE.md                        |
| `735d4c9` | Szenenhintergrund nach `generate-map`        | von derselben eigenen Fassung abgedeckt                                |

### Nicht übernommen

| Commit    | Was                                                 | Warum nicht                                                                                                                                                                 |
| --------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `df8b4d6` | `replace-journal-page`                              | Wir haben `journal-set-page`, das dasselbe tut und den Inhalt unverändert setzt, ohne Rahmen. Zwei Werkzeuge für denselben Zweck verwirren das Modell mehr, als sie nützen. |
| `4e1a088` | Release-Vorbereitung v0.8.3                         | Versionsnummern des Ursprungs. Wir zählen nach `<foundry-major>.<JJMM>.<ausgabe>`.                                                                                          |
| `6c5e5af` | Werkzeugzahl und Systemliste in den Release-Notizen | Bezieht sich auf den Umfang des Ursprungs, nicht auf unseren.                                                                                                               |
