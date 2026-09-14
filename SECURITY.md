# Security policy

Ninjo's Foundry MCP lets an AI assistant change a Foundry VTT world. A flaw in how it
decides who may do what can hurt real campaigns, so reports are taken seriously.

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub:
[Report a vulnerability](https://github.com/Niclasp1501/ninjos-foundry-mcp/security/advisories/new)
(the "Security" tab of this repository, "Report a vulnerability").

Do not open a public issue, discussion or pull request for a vulnerability before a fix
is released.

A useful report contains:

- the module version and the PC server version
- the Foundry VTT version and the game system
- what an attacker can do, and from where (another program on the same computer, a web
  page, a player in the world, another computer on the network)
- steps to reproduce, ideally on a fresh test world

This project is maintained by one person. You will get an answer in the private
advisory as soon as possible, and you will be told how the fix is going. Once a fix is released, the advisory
is published and you are credited in it, unless you prefer not to be.

## What counts

Anything that breaks the promises in the README, in particular:

- **The bridge between server and module:** the server accepting a connection from
  another computer without remote mode, or from a browser page that is not an allowed
  Foundry origin; the control port answering an HTTP request.
- **Permissions:** a change that goes through although "Allow Write Operations" is off
  or the permission level of its document kind forbids it; deleting where deleting is not
  allowed; running a macro while macro execution is off; the one-time confirmation of
  destructive tools being skipped or reused.
- **Player queries:** a player, or a module acting for a player, getting the module to
  read or change anything the Gamemaster has not allowed; queries accepted from a sender
  who is not a Gamemaster where a Gamemaster is required.
- **Files:** reading or writing outside the Foundry data folder, writing into modules,
  systems or other worlds, writing scripts.
- **Setup:** the setup scripts damaging other entries of an MCP client configuration or
  running anything they were not meant to run.

Not a vulnerability in this project:

- what a Gamemaster can do anyway in Foundry, or what the assistant does with rights the
  Gamemaster granted
- flaws in Foundry VTT, a game system, an MCP client or Node.js itself (please report
  those to their authors)
- the setup bundle being unsigned; this is documented

## Bounty

There is no bug bounty, paid or otherwise.

## Supported versions

Only the **latest release** receives security fixes, for both the module and the PC
server. Please update before reporting. Versions before 14.2609.4 belong to the previous
generation of this project and are no longer maintained.
