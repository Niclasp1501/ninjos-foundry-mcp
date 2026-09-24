# Ninjo's Foundry MCP

Let Claude and other AI assistants prepare your Foundry VTT world with you: scenes, journals,
NPCs, compendiums and more, always within the permissions you set.

_(Scroll down for the German version / Weiter unten auf Deutsch)_

---

## 🇬🇧 English

Imagine writing to Claude: "Set up a harbour tavern for tonight, with an innkeeper, two shady
guests and a journal for each of them about what they know." And a few moments later, exactly that
is waiting in your Foundry world. Ninjo's Foundry MCP makes this possible. It connects Claude and
other AI assistants that speak the Model Context Protocol to your world, so they can read, look
things up and prepare things for you there.

You always decide how far that goes. Out of the box the assistant may create and change things,
but not delete anything, and everything it does is recorded and can usually be taken back.

### What you can do with it

Preparation is where it helps most. The assistant creates scenes, sorts them into folders,
attaches journals to them, and can even look at a scene as a picture with grid and tokens to
understand what is on it. It writes journals and whole quest chains, links them to the right NPCs,
and later finds whatever is written somewhere in your world. It builds characters and NPCs from
scratch or from your compendiums, with effects and conditions, and hands them to a player if you
like.

It helps on the canvas too: with walls and doors, lights, sounds, regions, tiles and drawings,
with measuring distances and with finding a path around walls. During the game it can set up
encounters, roll initiative, advance turns, make rolls and system checks, and ask individual
players for a roll. Chat, roll tables, macros, card stacks, playlists, world time and your files
are part of it as well.

Once a chapter of your campaign has been played, the assistant can move it into a compendium, sort
it there and lock it. Your world stays tidy, and nothing gets lost.

The core tools work in every game system. For D&D 5e, Pathfinder 2e, Das Schwarze Auge 5,
Warhammer Fantasy Roleplay 4e, the Cosmere RPG and Mongoose Traveller 2e, the module also knows
the particulars of the system.

### You stay in control

The module works for you as the GM only. Players get no access to it, not even through detours.

A master switch in the settings allows or forbids every change, and when it is off, the assistant
can only read. Below it you decide for each kind of document how far the assistant may go: read
only, create and change, or delete as well. Deleting is switched off everywhere until you
explicitly allow it for a kind of document, because it is the one change that cannot be taken
back. Running macros is off by default too.

Every change goes into a log. There you can read what the assistant did and undo single steps or
a whole request, wherever that is possible.

### Two parts that belong together

The Foundry MCP has two parts, and you need both. The **module** runs in Foundry, in your browser,
and carries out the requests in your world. The **server** runs on your PC next to Claude and
passes the tools on to the assistant. The two only talk to each other on your own computer, and
nothing can be reached from outside. If either part is missing, simply nothing happens: Foundry
shows the connection as disconnected, or Claude sees no tools.

### Setting it up

**First the module.** In Foundry, open the **Add-on Modules** tab, click **Install Module** and
search for _Ninjo's Foundry MCP_. You can also use this manifest URL:

```
https://github.com/Niclasp1501/ninjos-foundry-mcp/releases/latest/download/module.json
```

Then enable it in your world.

**Then the server on your PC.** Download the server package
`ninjos-foundry-mcp-server-…-win32-x64.zip` from the
[releases page](https://github.com/Niclasp1501/ninjos-foundry-mcp/releases/latest), unpack it
and double click `setup.cmd`. Setup registers the server with Claude Desktop and takes over an
existing installation along with your settings. You need neither Node.js nor administrator
rights for this. Then quit Claude Desktop completely and start it again.

**Finally, load your world.** Open your world as the GM, and the module connects to the server.
To try it out, just ask Claude which world is open in Foundry.

For Claude Code, other clients and troubleshooting there is a detailed
[installation guide](https://github.com/Niclasp1501/ninjos-foundry-mcp/blob/main/docs/INSTALLATION.en.md).

You need Foundry VTT v13 or v14, a Windows PC, and Claude Desktop, Claude Code or another program
that speaks MCP. Foundry has to run in a browser on the same PC as the server. There is no package
for the Mac yet.

### Coming from an older version

With version 14.2609.4, the module and the server were rewritten from the ground up. Tool names,
your world's settings, permissions and the manifest URL stayed the same, so Foundry offers you the
update as usual. You do have to set up the server on your PC once with the new server package,
as described above. As long as an old server is still connected, a notice in Foundry reminds you.

---

## 🇩🇪 Deutsch

Stell dir vor, du schreibst Claude: „Leg mir für heute Abend eine Hafentaverne an, mit einem
Wirt, zwei zwielichtigen Gästen und je einem Journal dazu, was sie wissen." Und ein paar Momente
später steht genau das in deiner Foundry-Welt. Ninjo's Foundry MCP macht das möglich. Es verbindet
Claude und andere KI-Assistenten, die das Model Context Protocol sprechen, mit deiner Welt, sodass
sie dort lesen, nachschlagen und für dich vorbereiten können.

Dabei entscheidest immer du, wie weit das geht. Ab Werk darf der Assistent anlegen und ändern,
aber nichts löschen, und alles, was er tut, wird festgehalten und lässt sich in den meisten Fällen
zurücknehmen.

### Was du damit machen kannst

Die Vorbereitung ist der größte Gewinn. Der Assistent legt Szenen an, sortiert sie in Ordner,
hängt Journale daran und kann sich eine Szene sogar als Bild mit Gitter und Figuren ansehen, um zu
verstehen, was darauf liegt. Er schreibt Journale und ganze Questreihen, verknüpft sie mit den
passenden NSC und findet später wieder, was irgendwo in deiner Welt steht. Figuren und NSC baut er
von Grund auf oder aus deinen Kompendien, samt Effekten und Zuständen, und gibt sie auf Wunsch
einem Spieler.

Auch auf dem Spielfeld hilft er mit: bei Wänden und Türen, Lichtern, Klängen, Regionen, Kacheln und
Zeichnungen, beim Messen von Entfernungen und beim Finden eines Weges um Wände herum. Während des
Spiels kann er Begegnungen anlegen, die Initiative würfeln, Züge weiterschalten, Würfe und Proben
des Systems ausführen und einzelne Spieler um einen Wurf bitten. Chat, Zufallstabellen, Makros,
Kartenstapel, Wiedergabelisten, die Weltzeit und deine Dateien gehören ebenfalls dazu.

Wenn ein Abschnitt eurer Kampagne fertig gespielt ist, räumt der Assistent ihn in ein Kompendium,
sortiert ihn dort und sperrt es. So bleibt deine Welt übersichtlich, ohne dass etwas verloren geht.

Die Grundwerkzeuge laufen in jedem Spielsystem. Für D&D 5e, Pathfinder 2e, Das Schwarze Auge 5,
Warhammer Fantasy Roleplay 4e, das Cosmere RPG und Mongoose Traveller 2e kennt das Modul außerdem die
Eigenheiten des Systems.

### Du behältst die Kontrolle

Das Modul arbeitet nur für dich als Spielleiter. Spieler bekommen keinen Zugriff darauf, auch nicht
über Umwege.

Ein Hauptschalter in den Einstellungen erlaubt oder verbietet jede Änderung, und steht er auf aus,
kann der Assistent nur lesen. Darunter legst du für jede Art von Dokument fest, wie weit er gehen
darf: nur lesen, anlegen und ändern, oder zusätzlich löschen. Löschen ist dabei überall
abgeschaltet, bis du es für eine Dokumentart ausdrücklich erlaubst, denn es ist die eine Änderung,
die sich nicht zurücknehmen lässt. Makros ausführen darf der Assistent ab Werk ebenfalls nicht.

Jede Änderung landet in einem Protokoll. Dort kannst du nachlesen, was der Assistent getan hat, und
einzelne Schritte oder einen ganzen Auftrag wieder rückgängig machen, wo das möglich ist.

### Zwei Teile, die zusammengehören

Der Foundry MCP besteht aus zwei Teilen, und du brauchst beide. Das **Modul** läuft in Foundry, in
deinem Browser, und führt die Aufträge in deiner Welt aus. Der **Server** läuft auf deinem PC neben
Claude und reicht die Werkzeuge an den Assistenten weiter. Beide sprechen nur auf deinem eigenen
Rechner miteinander, von außen ist nichts erreichbar. Fehlt einer der beiden Teile, passiert
einfach nichts: Foundry zeigt die Verbindung als getrennt, oder Claude sieht keine Werkzeuge.

### Einrichten

**Zuerst das Modul.** Öffne in Foundry den Reiter **Add-on-Module**, klicke auf **Modul
installieren** und suche nach _Ninjo's Foundry MCP_. Du kannst auch diese Manifest-Adresse
verwenden:

```
https://github.com/Niclasp1501/ninjos-foundry-mcp/releases/latest/download/module.json
```

Danach aktivierst du es in deiner Welt.

**Dann der Server auf deinem PC.** Lade auf der
[Seite mit den Veröffentlichungen](https://github.com/Niclasp1501/ninjos-foundry-mcp/releases/latest)
das Serverpaket `ninjos-foundry-mcp-server-…-win32-x64.zip` herunter, entpacke es und starte
`setup.cmd` mit einem Doppelklick. Die Einrichtung meldet den Server bei Claude Desktop an und
übernimmt eine vorhandene Installation samt deiner Einstellungen. Du brauchst dafür weder Node.js
noch Administratorrechte. Beende Claude Desktop danach ganz und starte es neu.

**Zum Schluss die Welt laden.** Öffne deine Welt als Spielleiter, und das Modul verbindet sich mit
dem Server. Frag Claude zum Ausprobieren einfach, welche Welt gerade in Foundry geöffnet ist.

Für Claude Code, andere Programme und die Fehlersuche gibt es eine ausführliche
[Installationsanleitung](https://github.com/Niclasp1501/ninjos-foundry-mcp/blob/main/docs/INSTALLATION.md).

Du brauchst Foundry VTT v13 oder v14, einen Windows-PC und Claude Desktop, Claude Code oder ein
anderes Programm, das MCP spricht. Foundry muss dabei im Browser auf demselben PC laufen wie der
Server. Ein Paket für den Mac gibt es noch nicht.

### Wenn du von einer älteren Version kommst

Mit Version 14.2609.4 sind Modul und Server von Grund auf neu geschrieben worden. Werkzeugnamen,
Einstellungen deiner Welt, Rechte und die Manifest-Adresse sind gleich geblieben, deshalb bietet
Foundry dir das Update ganz normal an. Den Server auf deinem PC musst du allerdings einmal mit dem
neuen Serverpaket einrichten, wie oben beschrieben. Solange noch ein alter Server verbunden ist,
erinnert dich ein Hinweis in Foundry daran.

---

## Support / Unterstützen

The modules are free and stay free. If they help your group, you can support my work on [Patreon](https://www.patreon.com/ninjosforge) and get premium add-ons in return. What you get there is on the [premium page of Ninjo's Forge](https://ninjos-forge.web.app/en/premium).

Die Module sind kostenlos und bleiben es. Wenn sie deiner Runde helfen, kannst du meine Arbeit auf [Patreon](https://www.patreon.com/ninjosforge) unterstützen und bekommst Premium-Erweiterungen dazu. Was es dort gibt, steht auf der [Premium-Seite der Forge](https://ninjos-forge.web.app/premium).

---

## Technical notes

The **Foundry module** `ninjos-foundry-mcp` runs in the Gamemaster's browser. It connects to the
server on the same computer and carries out every request inside the world, after checking the
permissions. Only a Gamemaster connects. The **PC server** is started by your MCP client; all
clients share one background process, which talks to the module over a local WebSocket on port 31415. Nothing is reachable from other computers. The module and the server are updated
independently, and a server and a module one version apart still work together.

Every change goes through one permission check in the module, whichever tool asks for it. The
permission levels exist for scenes, playlists, journals, roll tables, actors, folders and
compendiums; the default is create and change. Items, macros, card stacks, chat messages and
combat encounters have no level yet: they can be created and changed while the write switch is
on, and deleting them is refused. Destructive tools can additionally require a one-time
confirmation with a dry run first ("Confirm destructive tools"). `list-changes` shows the change
log, and `undo-change` reverts an entry or a whole call where that is possible.

Supported MCP clients are Claude Desktop (including the Store edition), Claude Code, Cursor and any
client that starts MCP servers through `command` and `args`. The server runs on Windows 10 and 11.
Without an adapter for the game system, a tool that needs one says so.

The full installation guide, including updating and uninstalling, is in
[docs/INSTALLATION.en.md](docs/INSTALLATION.en.md) (German:
[docs/INSTALLATION.md](docs/INSTALLATION.md)).

### Tools of other modules

Other Foundry modules can offer their own tools through this module. The interface is
described in [docs/EXTENSION-TOOLS.md](docs/EXTENSION-TOOLS.md).

## Development

Node 24 or later.

```bash
npm ci
npm run check                # typecheck, language files, tests
npm run build                # server to build/, module scripts and languages to module/
npm run build:test-module    # module copy for a manual test deployment, see below
node installer/build.mjs --no-zip
```

`npm run build:test-module` writes `dist/test-module/ninjos-foundry-mcp/` without the
`manifest` and `download` fields and with a `-test.<time>` version suffix, so Foundry
never replaces a test deployment with the release from the package listing.

Tests never use the ports 31414 to 31416, so they do not disturb a running installation.

---

## License

Not open source. Free to use, also for paid games, but not to redistribute, copy into
other projects or sell without permission. See [LICENSE](LICENSE) (English and German,
the German version applies). Third-party material and its licences are listed there.
The Ninjo logo is excluded from any licence.

Versions before 14.2609.4 were released under the MIT License and stay under it. Version
14.2609.4 is a rewrite and contains none of the code of the project those versions were
forked from.
