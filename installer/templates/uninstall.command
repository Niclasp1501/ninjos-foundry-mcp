#!/bin/sh
# Removes Ninjo's Foundry MCP. Your allowed-origins.json and logs stay.
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${TMPDIR:-/tmp}" || exit 1
"$DIR/node" "$DIR/app/build/server/install/cli.js" uninstall "$@"
printf '\nPress Enter to close. / Enter zum Schliessen.\n'
read -r _
