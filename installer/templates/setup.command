#!/bin/sh
# Setup of Ninjo's Foundry MCP. Double click after unpacking the zip.
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${TMPDIR:-/tmp}" || exit 1
"$DIR/node" "$DIR/app/build/server/install/cli.js" install --source "$DIR" "$@"
printf '\nPress Enter to close. / Enter zum Schliessen.\n'
read -r _
