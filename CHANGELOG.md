# Changelog

## [Unreleased]

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
- **The welcome window mentions Patreon.** Below the link to Ninjo's Forge, one line now
  says that the modules are free and stay free, and that you can support the work on
  Patreon and get premium add-ons. Only GMs see the window, and "Don't show again" still
  hides it for good.

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
