# Installing Ninjo's Foundry MCP

Ninjo's Foundry MCP has two parts:

- the **Foundry module** `ninjos-foundry-mcp`. Foundry installs and updates it itself
  under "Add-on Modules".
- the **PC server** that Claude starts. This guide is about that one.

Deutsche Fassung: [INSTALLATION.md](INSTALLATION.md).

---

## Requirements

- Windows 10 or 11, or macOS
- Claude Desktop, started once. Claude Code and other MCP clients work too, see below.
- **No Node.js needed.** The bundle brings its own runtime.
- No administrator rights needed.

## Install

### Windows

1. Download `ninjos-foundry-mcp-server-<version>-win32-x64.zip`.
2. Right click the zip file, "Extract All".
3. In the extracted folder, double click `setup.cmd`.
   If Windows asks "Do you want to run this file?", confirm with "Run".
4. The window shows what was set up. Press a key to close it.
5. Quit Claude Desktop completely (also in the tray at the bottom right) and start it
   again.

The server now lives in `%LOCALAPPDATA%\FoundryMCPServer`. You may delete the extracted
folder.

### Mac

1. Download `ninjos-foundry-mcp-server-<version>-darwin-<arm64 or x64>.zip` and double
   click it to unpack it.
2. In the unpacked folder, **right click** `setup.command`, choose "Open", then "Open"
   again. A plain double click is refused the first time, because the bundle is not
   notarized by Apple yet.
3. The Terminal window shows what was set up. Press Enter.
4. Quit Claude Desktop (Cmd+Q) and start it again.

The server now lives in `~/Library/Application Support/FoundryMCPServer`.

### Check

1. In Claude Desktop under Settings, Developer, `foundry-mcp` shows as running.
2. Open your world in Foundry **as Gamemaster**. The module's status indicator shows
   "Connected".
3. Ask Claude: "Which world is open in Foundry?"

## Claude Code and other clients

Setup adds the server **to Claude Desktop**. In Claude Code and Cursor it only updates
an entry that already exists and never adds one. It prints the command for Claude Code
at the end. On Windows it is:

```
claude mcp add --scope user foundry-mcp -- "%LOCALAPPDATA%\FoundryMCPServer\node.exe" "%LOCALAPPDATA%\FoundryMCPServer\app\build\server\wrapper.js"
```

For any other client that starts MCP servers through `command` and `args`:

- `command`: `%LOCALAPPDATA%\FoundryMCPServer\node.exe` (Mac:
  `~/Library/Application Support/FoundryMCPServer/node`)
- `args`: the path of `app\build\server\wrapper.js` in the same folder
- name: `foundry-mcp`

The command `print-config` prints the finished block with the paths of your machine
(see "Troubleshooting").

## Update

Same as installing: unpack the new zip, run `setup.cmd` or `setup.command`, restart
Claude.

- Settings in your entry (such as `COMFYUI_ENABLED` or `LOG_LEVEL` under `env`) are kept.
- Other MCP servers and Claude's own settings are left alone.
- Before any change to a configuration a backup
  `claude_desktop_config.json.foundry-mcp-backup-<date>-<time>` is written. The newest
  three are kept. When nothing changes, nothing is written.
- If the server is still running, setup waits up to 90 seconds. It is quickest with
  Claude Desktop and Claude Code closed beforehand.

**If you used the old installer** (`FoundryMCPServer-Setup-….exe` or `.dmg`), nothing is
different for you. Setup takes over the previous installation: same folder, same entry
`foundry-mcp`, same values under `env`. The old uninstaller is removed so it cannot
delete the new files. Your allowed Foundry pages (`allowed-origins.json`) and an
installed ComfyUI with its models stay where they are.

Foundry updates the module on its own, independently of the server.

## Uninstall

### Windows

Settings, Apps, "Foundry MCP Server", Uninstall. Or double click `uninstall.cmd` in
`%LOCALAPPDATA%\FoundryMCPServer`.

### Mac

Start `uninstall.command` in `~/Library/Application Support/FoundryMCPServer` with right
click, "Open".

### What happens

- The entry is removed from Claude Desktop (including the Store edition), Claude Code
  and Cursor, each with a backup. Other entries stay.
- Program files and the entry under "Apps" are removed.
- **Kept**, because it is your data: `allowed-origins.json`, the `logs` folder, a ComfyUI
  with models, and the configuration backups. To remove everything, delete the
  `FoundryMCPServer` folder by hand afterwards.
- Remove the Foundry module in Foundry under "Add-on Modules".
- Mac: an old program folder `/Applications/FoundryMCPServer.app` from the previous
  installer is no longer used and can go to the Trash.

---

## Troubleshooting

### See the current state

Windows, in the Command Prompt:

```
"%LOCALAPPDATA%\FoundryMCPServer\node.exe" "%LOCALAPPDATA%\FoundryMCPServer\app\build\server\install\cli.js" status
```

Mac, in Terminal:

```
~/Library/Application\ Support/FoundryMCPServer/node ~/Library/Application\ Support/FoundryMCPServer/app/build/server/install/cli.js status
```

It shows version, folder, whether a server is running, and for every configuration it
found the entries that point at this server. `print-config` instead of `status` prints
the block for a manual configuration. Neither changes anything.

### Claude does not show the tools

1. Did you really quit and restart Claude Desktop? On Windows, also close it in the tray.
2. Look at the state (above). If Claude Desktop has no entry, run setup again.
3. Claude Desktop's logs are in the `logs` folder next to `claude_desktop_config.json`;
   the server writes there as `foundry-mcp`.

### "not valid JSON" or "left unchanged"

The configuration file was already damaged. Setup never changes such a file, so no other
server gets lost. Open it in an editor, repair it or restore a backup, then run setup
again.

### "an entry that looks like this server under another name"

There is already a hand-made entry, for example for a build from source. Setup does not
add a second one, or every tool would appear twice. Remove the old entry and run setup
again, or keep it if you want it.

### "The server is still running"

A Claude window or a Claude Code session is still open. Close everything and run setup
again. If it continued anyway, the new version starts with the next restart of Claude.

### Windows warns about the file

`setup.cmd` is an unsigned text file. The runtime `node.exe` is signed by the OpenJS
Foundation. To be sure, compare the SHA-256 checksum of the zip with the `.sha256` file
next to it:

```
certutil -hashfile ninjos-foundry-mcp-server-<version>-win32-x64.zip SHA256
```

### The Store edition of Claude lost the entry

A major update of the Store edition can reset its settings. Just run setup again; it
finds the Store edition by itself.

### The module does not connect

- Only the Gamemaster connects. Open the world as Gamemaster.
- The server listens on this computer on port 31415. Foundry must run in a browser **on
  the same computer** as Claude. No firewall rule is needed for that.
- If the Foundry page was refused, the module's status indicator says so. Allowed pages
  are stored in `allowed-origins.json` in `%LOCALAPPDATA%\FoundryMCPServer` (Mac:
  `~/.config/ninjos-foundry-mcp`).

### Map generator

Setup no longer installs ComfyUI. If you have it or install it yourself, add
`"COMFYUI_ENABLED": "true"` under `env` in your entry, plus `COMFYUI_INSTALL_PATH` if
needed. These values are kept on every update.
