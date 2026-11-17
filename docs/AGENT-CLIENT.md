# Agent client: a Foundry user that stays logged in for an AI

The agent client is part of the PC server. It keeps a Foundry browser logged in as
one fixed Foundry user on your own computer, so an AI agent can work in that browser
and hold the bridge, without anyone pressing the login button and without the agent
ever seeing the password.

It is optional. Most people do not need it.

## Two ways to let an AI work in Foundry

|                  | Your own browser                                       | Agent client                                                                |
| ---------------- | ------------------------------------------------------ | --------------------------------------------------------------------------- |
| Who is logged in | you, as yourself                                       | a fixed user you choose, for example an account just for the AI             |
| Login            | you, as always                                         | automatic, also after a restart of Foundry                                  |
| Bridge           | your browser tab                                       | your tab while it is open; the agent client only while nobody else holds it |
| Good for         | working together with the AI while you play or prepare | the AI working on its own, or seeing the game as a player sees it           |
| Setup            | none                                                   | a few commands, once                                                        |

Both work side by side. The agent client uses its own browser profile: it never touches
the profile of your everyday Chrome or Edge, never logs you out, and never takes the
bridge from your browser.

## Before you start: an account for the AI

Create a separate Foundry user for the agent client, in Foundry under "Game Settings",
"User Management":

- **The lowest role that is enough.** The bridge needs at least "Assistant GM". To see
  the game as a player sees it, use a "Player" account.
- **Never your own gamemaster account.** Everything the agent does appears in Foundry
  under the user of the agent client, and that user's rights limit it.
- **A password of its own** that is used nowhere else. On a Foundry server reachable
  from the internet, that password is the only protection of the account: make it long.

## Requirements

- The PC server is installed (see [INSTALLATION.en.md](INSTALLATION.en.md)).
- Google Chrome is installed. The agent client uses it and the graphics card of the
  computer; it downloads no browser of its own. Without Chrome, Microsoft Edge works too:
  add `--browser msedge` to the profile.
- The Foundry module and the PC server are from the same release or newer. Older
  modules do not know the "fallback" bridge mode and would take the bridge from you.

## Setting it up

The commands below use `agent-client`. The setup of this release or newer puts a
launcher next to the server:

- Windows: `%LOCALAPPDATA%\FoundryMCPServer\agent-client.cmd`, for example
  `& "$env:LOCALAPPDATA\FoundryMCPServer\agent-client.cmd" help` in PowerShell.
- macOS: `~/Library/Application Support/FoundryMCPServer/agent-client`
- Linux: `~/.local/share/FoundryMCPServer/agent-client`

Without that launcher (an older installation, or a clone of the repository after
`npm run build`), call the command line directly:
`node <repository>/build/server/agent-client/cli.js help`.

**1. Find the id of the user.** The id is shown on the login screen of Foundry and
does not change when the user is renamed.

```
agent-client users --url https://foundry.example.com
```

**2. Create a profile.** The name is yours to choose (lowercase letters, digits and
hyphens).

```
agent-client add ai --url https://foundry.example.com --user-id AbCdEfGhIjKlMnOp
```

Instead of `--user-id`, `--user "AI Assistant"` looks the id up by name.

**3. Set the password, yourself.** Run this in a terminal (PowerShell, Command Prompt,
Windows Terminal, macOS Terminal). The input stays hidden, and the command refuses a
password that is piped in, so it cannot end up in a script or a history.

```
agent-client password ai
```

**4. Start it.**

```
agent-client start ai
agent-client status ai
```

`start ai --visible` shows the browser window, for example to watch what the agent does.
To switch between the two, stop the client and start it again with or without
`--visible`.

**5. Check that it works.** `status` should say `ready`, with the name and role of the
user and the world. Two more checks:

```
agent-client js ai "game.user.name"
agent-client screenshot ai check.png
```

The first prints the name of the user, the second saves what the client sees. Then
`agent-client stop ai`: in Foundry, the user is shown as logged out at once, and
`agent-client start ai` logs it in again.

**6. Tell your AI about it.** The agent uses the same commands. Put a few lines like these
into the standing instructions of your agent (in Claude Code, the project instructions):

```
Foundry: the agent client "ai" keeps the user "AI Assistant" logged in.
Command: & "$env:LOCALAPPDATA\FoundryMCPServer\agent-client.cmd" <command>
- status ai: is it logged in? If not "ready", tell me the state, do not retry in a loop.
- js ai "<code>": run JavaScript in Foundry, for example to read or change the world.
- screenshot ai <file.png>: look at the game as that user sees it.
- start ai / stop ai: start or end it. Never ask for or set the password; I do that.
```

### Two clients: one for the AI, one to see the player view

Several profiles can run side by side, each with its own user and browser. A common pair:

```
agent-client add ai --url https://foundry.example.com --user "AI Assistant" --bridge fallback
agent-client add player --url https://foundry.example.com --user "Test Player" --bridge off
```

`ai` does the work and holds the bridge while you are away. `player` is a "Player"
account that only looks: with `screenshot player` the agent can check what your players
will see, for example whether a hidden token or a secret journal page stays hidden.
Give `player` no bridge (`--bridge off`); one bridge is enough.

### Windows of other modules

When the page loads, the client closes the welcome and update windows of this module. Other
modules may open their own windows at start (an update notice, a question about settings),
and those stay open, because the client cannot know what answering them would do. They
cover part of a screenshot but do not stop `js`. Answer them once with `--visible`, or let
the agent close them without choosing anything:

```
agent-client js ai "for (const a of foundry.applications.instances.values()) if (a.rendered && a.constructor.name === 'DialogV2') await a.close()"
```

## Commands

| Command                                     | What it does                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `users --url <address>`                     | lists the users of the world with their ids                                                               |
| `add <name> --url <address> --user-id <id>` | creates a profile; `--replace` overwrites an existing one                                                 |
| `password <name>`                           | sets or changes the password (hidden input)                                                               |
| `password <name> --remove`                  | removes the stored password                                                                               |
| `remove <name>`                             | deletes the profile, its password and its browser data                                                    |
| `list`                                      | all profiles                                                                                              |
| `start <name> [--visible]`                  | starts the client in the background                                                                       |
| `stop <name>`                               | stops it; the user is free to log in elsewhere at once                                                    |
| `status [<name>] [--json]`                  | who is logged in, world, role, bridge, canvas                                                             |
| `js <name> <code>`                          | runs JavaScript in the Foundry page and prints the result as JSON; `-` reads the code from standard input |
| `screenshot <name> <file.png>`              | saves a screenshot of the page                                                                            |
| `reload <name>`                             | reloads the page                                                                                          |
| `log <name>`                                | what the client did, without passwords                                                                    |

`js` takes an expression (`game.user.name`) or a function body with `return`
(`const s = game.scenes.active; return s?.name`). `await` works. Foundry documents come
back as plain data; a result is limited to 512 KB and 60 seconds.

## Profile options

| Option      | Values                                                                                                                                                     | Default    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `--canvas`  | `world`: the world decides (for example a sheet view module that switches the canvas off for some players); `on`; `off`                                    | `world`    |
| `--bridge`  | `fallback`: hold the bridge only while no other browser does; `on`: like a normal browser, the newest connection holds it; `off`: never connect the bridge | `fallback` |
| `--browser` | `chrome`; `msedge` for a computer without Chrome; `auto` tries Chrome, then Edge                                                                           | `chrome`   |
| `--size`    | window size, for example `1920x1080`                                                                                                                       | `1600x900` |

## Who holds the bridge

The PC server talks to one Foundry browser at a time. A normal browser that connects
takes the bridge, and the previous one waits on standby. An agent client in `fallback`
mode is different: it holds the bridge only while no other browser is connected, and
hands it over as soon as yours connects, even when the agent client reconnects later.

So with the defaults: while your Foundry tab is open, the AI works through your tab.
When you close it, the agent client takes over until you come back.

## What happens when

| Situation                       | Behaviour                                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundry restarts                | The session is gone. The page lands on the login screen and the client logs in again by itself.                                                                                        |
| The password is wrong           | State `password-rejected`. The client waits 15 minutes before the next try, so it never floods Foundry with failed logins. Set the right password with `agent-client password <name>`. |
| The user is logged in elsewhere | State `in-use`. The client never logs anyone out; it looks again every 2 minutes.                                                                                                      |
| No password stored              | State `no-password`. No browser is started.                                                                                                                                            |
| Foundry shows no world          | State `no-world`. The client tries again every minute.                                                                                                                                 |
| The computer is off             | Nothing runs. Start the client again with `agent-client start <name>`.                                                                                                                 |

Commands such as `js` or `screenshot` wait until the client is ready, or say why it is
not.

## The password and what it is protected against

**Where it is stored:** in the secret store of the operating system, never in a plain
file, a configuration file, a command line, an environment variable or a log.

- Windows: encrypted with DPAPI for your Windows user, in `password.dpapi` in the profile
  folder. Only your Windows user on this computer can decrypt it.
- macOS: the login keychain. `agent-client password` hands over to the keychain, which
  asks for the password itself.
- Linux: the Secret Service (GNOME Keyring, KWallet) through `secret-tool`. Install
  `libsecret-tools` (Debian, Ubuntu) or `libsecret` (Fedora, Arch) first.

**How it is used:** right before each login the client takes the password from the
store and sends it to Foundry's login, the same request the login form sends. It is
never typed into the page, so it is on no screenshot, and it is forgotten right after.

**What this protects against:**

- The password never appears in a conversation with the agent, in a log, in the
  repository, in a list of running processes or on a screenshot.
- No agent has to know or type it.

**What it does not protect against:** any program that runs as **the same operating
system user** can ask the secret store for the password, just as the agent client does.
An AI agent that runs on your computer under your user could therefore read it if it set
out to. The agent client prevents accidents, not a determined program on your own
account. Choose the Foundry user and its role with that in mind: the account of the
agent client should never be able to do more than you are happy for the AI to do.

**A stronger setup** would run the agent client under a separate operating system
account, so the password is encrypted for that account and your agents cannot decrypt
it. This version does not support it yet: agents under your own user could not send
commands to a client running under another account. Until it does, use the measures
above: a separate Foundry account, the lowest role, a password of its own.

## Taking access away

Any of these ends it at once:

- In Foundry, change the password of the user, or delete the user.
- On the computer, `agent-client password <name> --remove`, or `agent-client remove <name>`
  for the whole profile.
- `agent-client stop <name>` ends a running client.

## Where things are stored

- Windows: `%USERPROFILE%\.ninjos-foundry-mcp\agent-clients\<name>\`
- macOS and Linux: `~/.config/ninjos-foundry-mcp/agent-clients/<name>/`
- Anywhere else: set `FOUNDRY_MCP_AGENT_CLIENTS_DIR` to a folder, for every program that
  uses the agent client.

**Why not in AppData on Windows:** the Claude desktop app from the Microsoft Store or its
own installer is a packaged app. Windows redirects every file that such an app, and every
program it starts, writes below `AppData` into a private copy inside the package
(`AppData\Local\Packages\Claude_...\LocalCache`). An agent working in the app would
create a profile in that copy, and you would not find it from an ordinary PowerShell, so
the password would end up in the other place. Your user folder is not redirected; the app
and your terminal see the same files there.

Each profile folder holds `profile.json` (address, user id, options; no password), the
browser profile of the client, its log, and on Windows `password.dpapi`. Uninstalling
the PC server leaves these folders in place; remove the profiles first with
`agent-client remove <name>` if you want them gone.

## Platforms

Windows is the platform this was built and tested on. On macOS and Linux the same code
runs and uses the keychain or the Secret Service, but it has not been tested there yet.

## Licence

The agent client uses `playwright-core` (Apache License 2.0) to drive the browser. Its
notices ship in `THIRD-PARTY-NOTICES.txt` of the setup bundle. Google Chrome and
Microsoft Edge are not part of this project; the agent client uses the one installed on
your computer.
