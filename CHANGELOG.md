# Changelog

## [14.2611.1] - 2026-11-07

- **The AI can delete macros, if you allow it.** "Permissions · Macros" is a new level next to
  the others, and deleting stays off until you set it to "Create, change and delete". The new
  tool `delete-macro` deletes a world macro by id or name. If the macro is on a player's or a
  Gamemaster's hotbar, it deletes nothing and names every hotbar, so the AI has to ask you
  first. `undo-change` recreates a deleted macro with its id, which also puts it back into its
  hotbar slots. Macros in compendiums now need this level as well as the one for compendiums.
- **The bridge status shows its whole text again.** In Foundry 14 the panel above the player
  list shrank to the narrow column of the scene controls and read "MCP..." instead of the
  state of the bridge. It is now as wide as the player list below it.
- **Updated libraries in the PC server:** the MCP server library 2.3.1 (was 2.0.0), ws 8.22.0
  and werift 0.25.0. Nothing changes in how you use it. The setup bundle of this version
  carries them, so run `setup.cmd` from it as with every update.

## [14.2609.6] - 2026-09-30

- **Battle maps and scene images from Gemini.** Three new tools, `generate-battlemap`,
  `generate-scene-image` and `edit-map-image`, paint pictures in one consistent style, store
  them in Foundry and create the scene. Existing scene pictures can go along as references,
  so a battle map matches the location pictures of the same place. The tools appear once
  `GEMINI_API_KEY` is set for the MCP server.
- **Every image is a paid request on your own Google account.** Give the key a spending
  limit, restrict it to the Generative Language API, and put it only into the MCP server
  entry on your PC, never into Foundry. The key travels in the request header only and
  appears in no log and no answer. The installation guide explains each step.
- **Breaking: the ComfyUI map generator is gone.** `generate-map`, `check-map-status`,
  `cancel-map-job`, the map generation window and its two settings were removed.
  `COMFYUI_ENABLED` now only writes a hint into the log. A ComfyUI folder of an older
  version is left alone and can be deleted.
- **A tidier bridge status.** The readout above the player list is now a panel in the look of
  Foundry's own list, in the light and the dark theme, and no longer breaks over two lines.
  It can be clicked again everywhere to retry a waiting bridge. The welcome window also
  mentions Patreon below the link to Ninjo's Forge; "Don't show again" still hides it.

## [14.2609.5] - 2026-09-19

- The bridge connects as soon as you return to Foundry. When Foundry was opened before the
  MCP server on the PC, the bridge could stay on "connecting" for minutes after the server
  started, because the browser slows down the timers of a tab in the background. Now a
  waiting bridge tries at once when the Foundry tab becomes visible, the window gets focus
  or the network comes back. After three quick attempts (1, 2 and 5 seconds) it retries
  every 10 seconds, where it used to wait 10, then 20, then every 30 seconds.

## [14.2609.4] - 2026-09-14

- **Set up the MCP server on your PC anew.** This version is a complete rewrite, and the
  old server does not become the new one by updating the module. Download
  `ninjos-foundry-mcp-server-14.2609.4-win32-x64.zip` from the releases page, unpack it,
  run `setup.cmd` and restart Claude Desktop or your MCP client. After the update, a
  notice in Foundry explains this to the Gamemaster, and it comes back while an old
  server is still connected. World settings and permissions stay.
- Rewritten server and Foundry module. Tool names, parameters, ports, environment
  variables, module id and world settings stay the same, and an older module still works
  with the new server and the other way round.
- Permissions that really hold: every change checks the write switch and the permission
  level of its document kind in one place and reads the result back before it reports
  success. Deleting is off by default for every kind. Errors always name their cause.
- New tools for combat, dice, chat, roll tables, macros, canvas elements (walls, lights,
  regions, tiles, drawings), card stacks, world time, files and generic document access,
  plus a change log with `list-changes` and `undo-change`. Game system adapters for D&D
  5e, Pathfinder Second Edition, DSA5, WFRP4e, the Cosmere RPG and Traveller; the core
  tools work in every system.
- New server setup: one zip with its own Node.js runtime, no installer program. It takes
  over an existing installation in place and keeps your settings. The project now ships
  under its own licence instead of MIT, see LICENSE.
