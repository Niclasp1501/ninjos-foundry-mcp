# Changelog

## [14.2609.4] - 2026-09-14

- Rewritten server and Foundry module. Tool names, parameters, ports, environment
  variables, module id and world settings stay the same, so existing setups keep working,
  and an older module still works with the new server and the other way round.
- Permissions that really hold: every change checks the write switch and the permission
  level of its document kind in one place and reads the result back before it reports
  success. Deleting is off by default for every kind. Errors always name their cause.
- New tools for combat, dice, chat, roll tables, macros, canvas elements (walls, lights,
  regions, tiles, drawings), card stacks, world time, files and generic document access,
  plus a change log with `list-changes` and `undo-change`.
- Game system adapters for D&D 5e, Pathfinder Second Edition, DSA5, WFRP4e, the Cosmere
  RPG and Traveller; the core tools work in every system.
- New server setup: one zip with its own Node.js runtime, no installer program. It takes
  over an existing installation in place and keeps your settings. The project now ships
  under its own licence instead of MIT, see LICENSE.
