# Ninjo's Foundry MCP

Ninjo's Foundry MCP lets an AI assistant that speaks the Model Context Protocol (MCP),
such as Claude Desktop, Claude Code or Cursor, work with your Foundry VTT world. Ask it
to read and write journals, build scenes, search compendiums, manage actors, tokens,
combat, chat, roll tables, playlists and more. It works only as far as the Gamemaster
allows.

## How it works

It has two parts that you install separately:

- **The Foundry module** `ninjos-foundry-mcp` runs in the Gamemaster's browser. It
  connects to the server on the same computer and carries out every request inside the
  world, after checking the permissions described below. Only a Gamemaster connects.
- **The PC server** runs on the Gamemaster's computer. Your MCP client starts it; all
  clients share one background process, which talks to the module over a local
  WebSocket on port 31415. Nothing is reachable from other computers.

The module and the server are updated independently. A server and a module one version
apart still work together.

## Installation

1. **Module:** in Foundry under "Add-on Modules", install "Ninjo's Foundry MCP" and
   enable it in your world.
2. **Server:** download `ninjos-foundry-mcp-server-<version>-win32-x64.zip` from the
   [releases page](https://github.com/Niclasp1501/ninjos-foundry-mcp/releases), unpack
   it and double click `setup.cmd`. No Node.js and no administrator rights are needed.
3. Restart Claude Desktop, open your world as Gamemaster and ask: "Which world is open in
   Foundry?"

**Updating from 14.2609.3 or older:** the module update alone is not enough, set up the
server on your PC anew with the new server package as in step 2; a notice in Foundry
explains this after the update.

Setup takes over an installation from the previous installer in place: same folder, same
entry, your settings stay. Details, Claude Code, other clients, updating, uninstalling
and troubleshooting: [docs/INSTALLATION.en.md](docs/INSTALLATION.en.md) (German:
[docs/INSTALLATION.md](docs/INSTALLATION.md)).

## Permissions

Every change goes through one check in the module, whichever tool asks for it:

- **"Allow Write Operations"** is the master switch. Off means the assistant can only
  read.
- **A permission level per document kind** (scenes, playlists, journals, roll tables,
  actors, folders, compendiums): read only, create and change, or create, change and
  delete. The default is **create and change**.
- **Deleting is off by default for every kind**, because it is the one change that cannot
  be undone. Turn it on per kind if you want it. Items, macros, card stacks, chat
  messages and combat encounters have no level yet: they can be created and changed while
  the switch is on, and deleting them is refused.
- Running macros is off by default. Destructive tools can additionally require a
  one-time confirmation with a dry run first ("Confirm destructive tools").
- Every change is logged. `list-changes` shows the log, `undo-change` reverts an entry
  or a whole call where that is possible.

## Supported systems

- **Foundry VTT** 13 and 14 (verified on 14).
- **Game systems:** the core tools (journals, scenes, compendiums, folders, playlists,
  roll tables, canvas, combat, chat, files) work in every system. System knowledge comes
  from adapters for D&D 5e, Pathfinder Second Edition, Das Schwarze Auge 5, Warhammer
  Fantasy Roleplay 4e, the Cosmere RPG and Traveller. Without an adapter a tool that
  needs one says so.
- **Server:** Windows 10 and 11. A macOS bundle is not published yet.
- **MCP clients:** Claude Desktop (including the Store edition), Claude Code, Cursor and
  any client that starts MCP servers through `command` and `args`.
- **Browser:** Foundry must run in a browser on the same computer as the server.

## Tools of other modules

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

## License

Not open source. Free to use, also for paid games, but not to redistribute, copy into
other projects or sell without permission. See [LICENSE](LICENSE) (English and German,
the German version applies). Third-party material and its licences are listed there.
The Ninjo logo is excluded from any licence.

Versions before 14.2609.4 were released under the MIT License and stay under it. Version
14.2609.4 is a rewrite and contains none of the code of the project those versions were
forked from.
