# Changelog

## [Unreleased]

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
