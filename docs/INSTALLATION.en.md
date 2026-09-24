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

## Battle maps and scene images with Gemini

Three tools paint pictures for your world: `generate-battlemap` (a map from above for
the table), `generate-scene-image` (a location picture at eye level) and
`edit-map-image` (changes an existing image and stores the result as a new file next
to it). They store the image in Foundry, create a scene from it if you want, and show
Claude a small preview. Existing location pictures can go along as references, so the
map matches them.

The pictures come from Google's Gemini. **Every image costs money**, a few cents in 2K,
charged to **your own** Google account. Image models are not part of the free tier.
Google lists the current prices: <https://ai.google.dev/gemini-api/docs/pricing>

### Switching it on

1. Create a key in Google AI Studio (<https://aistudio.google.com>) under "API keys".
2. Put the key into your MCP server entry under `env`, in Claude Desktop that is
   `claude_desktop_config.json`:

   ```json
   "foundry-mcp": {
     "command": "…",
     "args": ["…"],
     "env": { "GEMINI_API_KEY": "your-key" }
   }
   ```

   For Claude Code: `claude mcp add` with `-e GEMINI_API_KEY=your-key` before the
   name.

3. Restart Claude. Without a key the three tools do not appear at all.

Setup keeps the value on every update. Optional:

| Variable                  | Effect                                                           |
| ------------------------- | ---------------------------------------------------------------- |
| `GEMINI_IMAGE_MODEL`      | image model, default `gemini-3.1-flash-image`                    |
| `GEMINI_IMAGE_SIZE`       | `1K`, `2K` or `4K`, default `2K`                                 |
| `FOUNDRY_MCP_IMAGE_STYLE` | your own style text instead of the built-in one, `none` for none |
| `GEMINI_TIMEOUT_MS`       | longest wait per image, default 180000                           |

### Protect your key

Whoever has your key makes images on your bill. So:

- **Set a limit.** In the Google Cloud project of the key, create a budget with an alert
  and cap the daily quotas of the "Generative Language API". AI Studio shows the usage
  under "Usage".
- **Restrict the key.** In the Google Cloud Console under "APIs & Services",
  "Credentials", allow the key for the "Generative Language API" only.
- **Put it into the MCP server entry on your PC and nowhere else.** Never into Foundry:
  world and module settings reach the browser of every player. Never into a chat, a
  screenshot, a shared file or a repository.
- **Act at once on any suspicion.** Delete the key in AI Studio and create a new one. The
  old one is worthless from that moment.

The server sends the key to Google only, in the request header, never in an address. It
appears in no log line and in no answer to Claude.

## Update

Same as installing: unpack the new zip, run `setup.cmd` or `setup.command`, restart
Claude.

- Settings in your entry (such as `GEMINI_API_KEY` or `LOG_LEVEL` under `env`) are kept.
- Other MCP servers and Claude's own settings are left alone.
- Before any change to a configuration a backup
  `claude_desktop_config.json.foundry-mcp-backup-<date>-<time>` is written. The newest
  three are kept. When nothing changes, nothing is written.
- If the server is still running, setup waits up to 90 seconds. It is quickest with
  Claude Desktop and Claude Code closed beforehand.

**If you used the old installer** (`FoundryMCPServer-Setup-….exe` or `.dmg`), nothing is
different for you. Setup takes over the previous installation: same folder, same entry
`foundry-mcp`, same values under `env`. The old uninstaller is removed so it cannot
delete the new files. Your allowed Foundry pages (`allowed-origins.json`) stay where
they are. A ComfyUI folder of an older version stays too; since 14.2609.6 it is no
longer used and may go.

Foundry updates the module on its own, independently of the server.

### Updating from 14.2609.3 or older

Version 14.2609.4 is a complete rewrite. Updating the Foundry module is not enough: the
MCP server on your PC has to be set up anew with the new server package.

1. Download `ninjos-foundry-mcp-server-<version>-win32-x64.zip` from the
   [releases page](https://github.com/Niclasp1501/ninjos-foundry-mcp/releases).
2. Unpack it and run `setup.cmd` (Mac: `setup.command`), as under "Install".
3. Quit Claude Desktop or your MCP client completely and start it again.

After the module update, Foundry shows the Gamemaster a notice with these steps. "Done,
don't show again" hides it on this device; it comes back as long as a server of the
previous generation is still connected, and the status indicator then says "MCP: old
server". World settings, permissions and your allowed Foundry pages stay.

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
  folder of an older version, and the configuration backups. To remove everything, delete the
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

### Battle maps and scene images

- **The three tools are missing:** `GEMINI_API_KEY` is not in the entry, or Claude was
  not restarted afterwards.
- **"Google rejected the API key" or "refused the request (HTTP 403)":** the key is
  mistyped, deleted, or not allowed for the "Generative Language API".
- **"limit for this key is reached (HTTP 429)":** the quota or budget is used up. That
  is the protection that keeps costs down; look in Google Cloud and raise it if you
  want.
- **`COMFYUI_ENABLED` in the log:** the ComfyUI map generator was removed in
  14.2609.6. Remove the entry and set `GEMINI_API_KEY`.
