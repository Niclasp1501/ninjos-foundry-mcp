# Ninjo's Foundry MCP

**Current Version / Aktuelle Version:** `14.2608.1`

Run your Foundry VTT world through a conversation with Claude: build scenes, write
journals and quests, create actors, manage compendiums, request dice rolls.

_(Scroll down for German version / Scrolle weiter runter für die deutsche Version)_

> Built on [adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp) by Adam Dooley,
> used under the MIT license — see [LICENSE](LICENSE). This is an independent fork, not a replacement
> for the original project.

---

## ⚠️ This is one half of a pair

**The Foundry module alone does nothing.** It is a bridge, and a bridge needs both banks:

| Part                          | Runs on                             | What it does                                |
| ----------------------------- | ----------------------------------- | ------------------------------------------- |
| **The module** (this package) | inside Foundry, in the GM's browser | carries out the requests against your world |
| **The MCP server**            | on the GM's own PC, next to Claude  | offers Claude the tools and forwards them   |

Both come from the **same release** and must carry the **same version** — an old server
with a new module cannot talk to it. Install one without the other and nothing happens:
Foundry will show "MCP Server not found", or Claude will show no Foundry tools at all.

Everything is **GM-only**. Players never get access, and deleting is switched off
everywhere by default.

---

## 🇬🇧 English

### Installation

**Step 1 — the Foundry module.** In Foundry: _Add-on Modules → Install Module_, paste
this manifest URL, install, then enable **Ninjo's Foundry MCP** in your world:

```
https://github.com/Niclasp1501/ninjos-foundry-mcp/releases/latest/download/module.json
```

**Step 2 — the MCP server on your PC.** Download the installer for your system from
[Releases](https://github.com/Niclasp1501/ninjos-foundry-mcp/releases/latest) — it
installs the server and registers it with Claude Desktop. Then restart Claude Desktop.

**Step 3 — load your world.** The module connects from the browser to the server on your
PC. If both halves are up, Claude sees the Foundry tools.

Requirements: Foundry VTT v13 or v14, Claude Desktop, and Windows or macOS for the
installers (Node.js 18+ if you build from source).

<details>
<summary>Building from source instead</summary>

```bash
git clone https://github.com/Niclasp1501/ninjos-foundry-mcp.git
cd ninjos-foundry-mcp
npm install
npm run build
npm run pruefen   # checks that both halves agree on the query names
```

The module is `packages/foundry-module/`, the server `packages/mcp-server/`.

</details>

### Overview

The Ninjo's Foundry MCP enables natural AI conversations with your Foundry VTT game data:

- **Quest Creation**: [Create quests from prompts that incorporate what exists in your world and journals](https://www.youtube.com/watch?v=NqyB_z2AKME)
- **Character Management**: Query character stats, abilities, and information
- **Compendium Search**: Find items, spells, and creatures using natural language
- **Content Creation**: Generate actors, NPCs, and quest journals from simple prompts
- **Scene Information**: Access current scene data and world details
- **Dice Coordination**: Interactive roll requests with player targeting
- **Campaign Management**: Multi-part quest and campaign tracking
- **Map Generation**: Create maps from prompts and automatically upload them into scenes in Foundry VTT using the optional ComfyUI component

### Configuring Claude Desktop by hand

Add this to your Claude Desktop configuration (claude_desktop_config.json) file:

```json
{
  "mcpServers": {
    "foundry-mcp": {
      "command": "node",
      "args": ["path/to/ninjos-foundry-mcp/packages/mcp-server/dist/index.js"],
      "env": {
        "FOUNDRY_HOST": "localhost",
        "FOUNDRY_PORT": "31415"
      }
    }
  }
}
```

Starting Claude Desktop will start the MCP Server.

> **Windows Store / MSIX installs:** If you installed Claude Desktop from the Microsoft Store, it reads its config from a virtualised path, not `%APPDATA%\Claude\`. Edit `claude_desktop_config.json` here instead:
> `%LOCALAPPDATA%\Packages\<...Claude...>\LocalCache\Roaming\Claude\claude_desktop_config.json`
> The automated Windows installer (v0.8.1+) writes to both locations for you. Note that a major Claude Desktop update can reset this container — if your tools disappear after an update, re-run the installer or re-add the `mcpServers` block at that path.

### Getting Started

1. Start Foundry VTT and load your world
2. Open Claude Desktop
3. Chat with Claude about your currently loaded Foundry World

### Example Usage

Once connected, ask Claude Desktop:

- _"Show me my character Clark's stats"_
- _"Find all CR 12 humanoid creatures for an encounter"_
- _"Create a quest about investigating missing villagers"_
- _"Roll a stealth check for Tulkas"_
- _"What's in the current Foundry scene?"_
- _"Create me a small map of a Riverside Cottage in Foundry"_

### Features

- **43 MCP Tools** that allow Claude to interact with Foundry
- **D&D 5e NPC Creation Suite**: Build complete NPCs from prompts — stat block, attacks, saves, auras, and spellcasting
- **Mongoose Traveller 2e (mgt2e) Support**: Full actor lifecycle — create/update/delete travellers, NPCs, creatures, and spacecraft with skill shorthand normalisation; creature compendium index with characteristic DMs; weapon-trait enum reference
- **WFRP4e Support**: Character reading plus editing — update characteristics, wounds, skills and careers, and add or remove items on existing actors
- **Generic Actor CRUD**: `manage-actors` creates, updates, and deletes actors of any type on any system; also updates and deletes embedded items
- **Character Management**: Access stats, abilities, inventory, and detailed entity information
- **Token Manipulation**: Move, update, delete tokens and manage status conditions
- **Enhanced Compendium Search**: Instant filtering by CR, type, abilities, and more
- **Content Creation**: Generate actors, NPCs, and quest journals (with optional folder organisation)
- **World Item Management**: Create, list, and update world-level Items; attach items directly to actors
- **Campaign Management**: Multi-part quest tracking with progress dashboards
- **Interactive Dice System**: Send different dice roll requests to players from Claude
- **Actor Ownership**: Manage player permissions for characters and tokens
- **GM-Only**: MCP Bridge only connects to Game Master users
- **Map Generation**: A portable ComfyUI backend that generates battlemaps from prompts
- **Remote Connections**: WebRTC connections initiated through browser (Tested with Google Chrome) to MCP server and ComfyUI
- **Windows and Mac Installers** Automated installation of Foundry MCP Server for Claude Dekstop, Ninjo's Foundry MCP Foundry VTT Module, and ComfyUI backend with dependencies

### MCP Tools

- **1** get-world-info
- **2** list-scenes
- **3** get-current-scene
- **4** get-available-conditions  
- **5** list-compendium-packs
- **6** list-characters
- **7** get-character  
- **8** search-character-items  
- **9** get-character-entity
- **10** get-token-details
- **11** toggle-token-condition (add)  
- **12** toggle-token-condition (remove)
- **13** update-token
- **14** search-compendium
- **15** get-compendium-item
- **16** get-compendium-entry-full
- **17** list-creatures-by-criteria  
- **18** list-journals  
- **19** create-quest-journal
- **20** update-quest-journal
- **21** search-journals
- **22** link-quest-to-npc
- **23** list-actor-ownership
- **24** assign-actor-ownership
- **25** remove-actor-ownership
- **26** move-token
- **27** use-item
- **28** request-player-rolls
- **29** generate-map
- **30** check-map-status
- **31** cancel-map-job
- **32** switch-scene  
- **33** create-actor-from-compendium
- **34** list-dsa5-archetypes (DSA5 Only)
- **35** create-dsa5-character-from-archetype (DSA5 Only)
- **36** create-campaign-dashboard
- **37** manage-world-items (create / list / update world items, add items to actor, describe system enum schema)
- **38** dnd5e-create-npc (D&D 5e Only)
- **39** dnd5e-add-feature (D&D 5e Only)
- **40** dnd5e-add-features-from-compendium (D&D 5e Only)
- **41** manage-actors (create / update / delete actors; update / delete embedded items — any system)

#### Ninjo additions

Clean journal handling, token art, and tooling for large imported adventures.

- **42** journal-create — clean multi-page JournalEntry, content stored verbatim (no quest template, no junk page)
- **43** journal-set-page — replace a page's content verbatim
- **44** journal-add-page — add a page with verbatim HTML
- **45** journal-append-page — append a chunk to an existing page
- **46** journal-page-from-file — fill a page from a file in Foundry's Data directory (**any size**)
- **47** journal-split-page — split an oversized page into one page per section
- **48** journal-rewrite-images — external image URLs → local Foundry paths
- **49** journal-link-tags — raw `@creature[…]` / `@item[…]` tags → real `@UUID` links
- **50** journal-delete-page / **51** journal-delete / **52** journal-rename
- **53** actor-set-token — token image, portrait, token name, dynamic ring
- **54** folder-rename / **55** folder-delete

---

### Working with large imported adventures

Adventures imported by tools such as Plutonium arrive as **one page per chapter**,
often 70k–250k characters. That breaks several assumptions, and the tools below
exist because of it. Read this before touching such a world.

#### The socket limit is the central constraint

Foundry's socket **drops the whole connection** when a query response gets too
large — it does not return an error, and the bridge stays dead until the browser
reloads. A single 250k-character page killed it reliably.

Two mechanisms handle this:

| Direction   | Mechanism                                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reading** | `list-journals` chunks content. Default 50k, max 200k per call. Check `hasMore` and pass `offset: nextOffset` for the next chunk.                                                               |
| **Writing** | `journal-page-from-file` — the file is placed in Foundry's Data directory and the **browser fetches it directly** from the Foundry server. Nothing crosses the socket, so size stops mattering. |

`journal-append-page` also exists (create with the first chunk, append the rest in
~40k pieces), but the file route is simpler and has no size ceiling at all.

**Rule of thumb:** anything above ~100k characters goes through
`journal-page-from-file`, never through `journal-set-page`.

#### Do not split chapters by default

`journal-split-page` works, but it is rarely what you want: **Foundry already
builds a nested table of contents from the headings inside a page.** A 150k
chapter is navigable as-is. Splitting produces a flat list of sibling pages and
_loses_ that hierarchy, because Foundry cannot nest pages.

Split only when you genuinely need per-section pages (e.g. to translate or edit
one section at a time). Notes if you do:

- Sections are found via `DOMParser` at the requested heading `level`.
  Imported chapters wrap everything in one container `div`, so the parser
  descends into it — otherwise it finds exactly one section and splits nothing.
- New pages are placed **directly after** the source page. Foundry spaces `sort`
  values 100000 apart, so a naive `+1` lands at the end of the journal.
- `deleteOriginal` defaults to `false`. Verify first, delete afterwards.

#### Fixing an import

Two cleanups are almost always worth running, in this order:

```
journal-rewrite-images  urlPattern: "https://cdn.5e.tools/"
                        localPrefix: "Bilder/Kampagnen/<Adventure>"
journal-link-tags       actorPacks: ["<german-pack>", "dnd5e.actors24", "dnd5e.monsters"]
```

Both support `dryRun: true` — always look first.

**Linking against a localised compendium.** A German pack lists _Wache_, not
_guard_, so matching English tags by name fails. But localised packs keep the
**English document IDs** of the 2024 books, and those are derivable:

```
"guard"   ->  mmGuard000000000
"priest"  ->  mmPriest00000000
"commoner"->  mmCommoner000000
```

`journal-link-tags` therefore matches by name **and** by derived ID
(`"mm" + PascalCase(name)`, padded to 16 characters). In practice this raised a
real chapter from 18 to 96 resolved links.

Names that resolve nowhere are **reported in `unresolved`, never silently
skipped** — usually adventure-specific NPCs whose stat blocks live in a later
chapter and do not exist as actors. That is a gap to fill, not a bug.

#### Token art and the dynamic ring

`actor-set-token` sets the token image, the portrait, the prototype token name,
and the dnd5e/Foundry dynamic ring.

- Enabling the ring requires **both** `ring.enabled` _and_
  `ring.subject.texture`. With only the flag, Foundry draws the ring around an
  empty field, because `texture.src` then counts as the background.
- **Do not use `ringScale` to make room for the ring.** The ring always spans the
  full token square; shrinking the subject leaves the ring at full size and looks
  out of proportion. The free margin belongs **in the artwork** — see
  `--token-margin` in the image tool (0.17 measured as the sweet spot: below it
  the art covers the ring, above it Foundry's dark ring background shows through).
- Ring colour follows disposition automatically — hostile red, neutral blue,
  friendly green. Override with `ringColor`.
- Without `tokenName`, placed tokens keep the compendium name ("Bandit") instead
  of the actor's name.

#### Translating an imported chapter

Translation happens **outside** this bridge, in the companion CLI
(`Ninjo´s Gemini DnD Portrait-Token Maker/translate.js`), which runs on the
user's own API key. The bridge only reads and writes:

```
list-journals (chunked)        read the chapter
  ↓
translate.js --glossary …      translate prose, keep HTML/@UUID/[[/r]]/&Reference
  ↓
verify + repair HTML           see below
  ↓
scp to Foundry Data/           put the file where the browser can reach it
  ↓
journal-page-from-file         one call, any size
  ↓
journal-link-tags              resolve creature tags
```

**Always verify the HTML afterwards.** LLM translation reliably damages structure
at chunk boundaries — in one 167k chapter it added 5 surplus `</div>` and dropped
one `</p>`, which would have wrecked rendering. Compare tag counts against the
source (`<div>`/`</div>`, `<p>`/`</p>`, `<h1..3>`, `<img>`, `@creature[`, `@item[`,
`[[/r`, `@UUID[`) and repair imbalances before writing anything back.

A glossary keeps terminology stable across chapters — without one, a location is
named differently in chapter 3 than in chapter 11.

### Settings

<img width="964" height="803" alt="image" src="https://github.com/user-attachments/assets/bfd435d5-2df4-40a6-a79b-87e98121db3f" />

- **Enhanced Creature Index** Configure Enhanced Index button leads to Enhanced Creature Index sub-menu (Details below)
- **Map Generation Service Configuration** Configure Map Generation button leads to Map Generation Service sub-menu (Details below)
- **Enable MCP Bridge** This should be checked by default and the status should show as connected. It can be used to turn off the MCP Bridge connection within the game without the need to disable the add-on itself.
- **Connection Type** Can be set to Auto for automatic detection of connection type. Can also be set to force either WebRTC for Internet connections or Websocket for Local connections.
- **Websocket Server Host** IP Address of Claude Desktop MCP Server location. Only used for local network websocket connections. Remote Servers use WebRT. Defaults to localhost.
- **Allow Write Operations** This will prevent Claude from making any changes to world content and restrict it to reading only
- **Max Actors Per Request** This is a failsafe to stop a massive amount of actors being created from one single request. It does not limit the amount of characters being created by multiple requests
- **Show Connection Messages** This can turn off the banner messages for connections for Ninjo's Foundry MCP
- **Auto-Reconnect on Disconnect** Will automatically attempt to reconnect if the connection is lost
- **Connection Check Frequency** How often it will check connection status

#### Enhanced Creature Index Sub-menu

<img width="497" height="604" alt="image" src="https://github.com/user-attachments/assets/bf1a6fdb-9bd5-4256-b922-d28cf65b1e7d" />

- **Rebuild Creature Index** This button will rebuild the creature index if there is an issue or it is out of sync with changes in your compendiums
- **Enable Enhanced Creature Index** This should be left on as Claude builds additional metadata in the world files to give it better searches
- **Auto-Rebuild Index on Pack Changes** Experimental feature that hasn't been fully tested yet

#### Map Generation Service Sub-menu

<img width="489" height="779" alt="image" src="https://github.com/user-attachments/assets/a43d3a3d-266f-41c9-b40a-236d14cfcba9" />

- **Service Status** There are three buttons for Check Status, Start Service, and Stop Service. These buttons help monitor and control the connection from the Ninjo's Foundry MCP to the ComfyUI backend which is started by the Claude Desktop application.
- **Auto-start Map Generation Service** Controls whether ComfyUI service connection is automatically connected at startup of the Foundry world.
- **Generation Quality** Controls the quality of the maps generated by the SDXL checkpoints wiht ComfyUI. Low uses 8 steps of generation, Medium uses 20 steps of generation, and High uses 35 steps. The D&D Battlemaps SDXL Upscale v1.0 Checkpoint used in this image generation recommends using 35 steps but on low end GPUs or GPUs with out CUDA, this generation will take several minutes. These options can give you a trade off to have maps generated faster at the expense of quality.

### Architecture

```
Claude Desktop ↔ MCP Protocol ↔ MCP Server ↔ WebSocket ↔ Foundry Module ↔ Foundry VTT
                                     ↓
                              ComfyUI Service
                              (AI Map Generation)
```

- **Foundry Module**: Provides secure data access within Foundry VTT
- **MCP Server**: External Node.js server handling Claude Desktop communication
- **Map Generation Service**: A headless ComfyUI backend that is spawned by Claude Desktop
- **No API Keys Required**: Uses your existing Claude Desktop subscription

### Security & Permissions

- **GM-Only Access**: All functionality restricted to Game Master users
- **Configurable Permissions**: Control what data Claude can access and modify
- **Session-Based Authentication**: Uses Foundry's built-in authentication system

### System Requirements

- **Foundry VTT**: Version 13
- **Claude Desktop**: Latest version with MCP support
- **Claude Pro/Max Plan**: Required to connect to MCP servers
- **Operating System**: Windows 10/11 (installer), or other OSes/manual Windows install with Node.js 18+ (manual)
- **GPU Requirements**: A GPU with at least 8GB of VRAM

### Schema Smoke Test

The MCP schema smoke test verifies that tool schemas load correctly and do not enforce overly strict `additionalProperties` defaults.

```bash
npm -w @foundry-mcp/server run build
npm run test:mcp:schema
```

### Support & Development

- **Issues**: Report bugs on [GitHub Issues](https://github.com/Niclasp1501/ninjos-foundry-mcp/issues)
- **YouTube Channel**: [Subscribe for updates and tutorials](https://www.youtube.com/channel/UCVrSC-FzuAk5AgvfboJj0WA)
- **Documentation**: Built with TypeScript, comprehensive documentation included
- **License**: MIT License (Additional Third Party licenses are included for bundled components for the installers)

---

## 🇩🇪 Deutsch

Foundry VTT im Gespräch mit Claude bedienen: Szenen bauen, Journale und Questreihen
schreiben, Figuren und NSC anlegen, Kompendien verwalten, Würfelwürfe anfordern.

### Zwei Hälften, und du brauchst beide

**Das Foundry-Modul allein tut nichts.** Es ist eine Brücke, und eine Brücke braucht
beide Ufer:

| Teil                         | Läuft                                     | Aufgabe                                              |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------- |
| **Das Modul** (dieses Paket) | in Foundry, im Browser des Spielleiters   | führt die Aufträge gegen deine Welt aus              |
| **Der MCP-Server**           | auf dem PC des Spielleiters, neben Claude | bietet Claude die Werkzeuge an und reicht sie weiter |

Beide stammen aus **demselben Release** und tragen **dieselbe Version**. Ein alter
Server kann mit einem neuen Modul nicht sprechen. Installierst du nur eine Hälfte,
passiert schlicht nichts: Foundry meldet „MCP Server not found", oder Claude zeigt gar
keine Foundry-Werkzeuge.

Alles ist **nur für den Spielleiter**. Spieler bekommen keinen Zugriff, und **Löschen ist
ab Werk überall abgeschaltet** — es muss je Dokumentart ausdrücklich freigegeben werden.

### Einrichten

**Schritt 1 — das Foundry-Modul.** In Foundry unter _Add-on-Module → Modul installieren_
diese Manifest-Adresse einfügen, installieren, dann in deiner Welt **Ninjo's Foundry MCP**
anhaken:

```
https://github.com/Niclasp1501/ninjos-foundry-mcp/releases/latest/download/module.json
```

**Schritt 2 — der MCP-Server auf deinem PC.** Den Installer für dein System aus den
[Releases](https://github.com/Niclasp1501/ninjos-foundry-mcp/releases/latest) laden. Er
richtet den Server ein und meldet ihn bei Claude Desktop an. Danach Claude Desktop neu
starten.

**Schritt 3 — Welt laden.** Das Modul verbindet sich aus dem Browser zum Server auf deinem
PC. Stehen beide Hälften, sieht Claude die Foundry-Werkzeuge.

Voraussetzungen: Foundry VTT v13 oder v14, Claude Desktop, und Windows oder macOS für die
Installer (Node.js 18+, wenn du selbst baust).

### Was das Modul kann

- **Szenen** anlegen, ändern, aus einer Weltsicherung bergen, in Ordner einsortieren,
  Journale daran hängen
- **Journale und Questreihen** schreiben, durchsuchen, mit NSC verknüpfen
- **Figuren und NSC** bauen, auch aus Kompendien, mit Rechtevergabe an Spieler
- **Kompendien** anlegen, befüllen, sortieren, sperren — gedacht zum Archivieren
  fertig gespielter Abschnitte
- **Wiedergabelisten und Zufallstabellen** setzen
- **Würfelwürfe** bei einzelnen Spielern anfordern
- **Rechte je Dokumentart** in drei Stufen: nur lesen, anlegen und ändern, oder
  zusätzlich löschen

Unterstützt werden D&D 5e, Pathfinder 2e, DSA 5, Cosmere RPG, WFRP 4e und Mongoose
Traveller 2e. Die meisten Werkzeuge arbeiten systemunabhängig.

### Herkunft

Dies ist ein eigenständiger Fork von
[adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp) von Adam
Dooley, verwendet unter der MIT-Lizenz — siehe [LICENSE](LICENSE). Er tritt **nicht** als
Ersatz des Ursprungsprojekts auf.

Die ausführliche Beschreibung aller Werkzeuge, der Einstellungen und der Arbeit mit großen
importierten Abenteuern steht weiter oben im englischen Teil.
