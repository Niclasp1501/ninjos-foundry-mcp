#!/bin/bash

# Foundry MCP Server Launch Script for macOS
# Detects architecture (Apple Silicon vs Intel) and launches with appropriate Node.js binary

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RESOURCES_DIR="$SCRIPT_DIR/../Resources"
SERVER_DIR="$RESOURCES_DIR/foundry-mcp-server"

# Detect architecture
ARCH=$(uname -m)

if [ "$ARCH" = "arm64" ]; then
  NODE_BIN="$RESOURCES_DIR/node-arm64/node"
  echo "Detected Apple Silicon (ARM64)" >&2
elif [ "$ARCH" = "x86_64" ]; then
  NODE_BIN="$RESOURCES_DIR/node-x64/node"
  echo "Detected Intel (x86_64)" >&2
else
  echo "Error: Unsupported architecture: $ARCH" >&2
  exit 1
fi

# Verify Node.js binary exists
if [ ! -f "$NODE_BIN" ]; then
  echo "Error: Node.js binary not found at $NODE_BIN" >&2
  exit 1
fi

# Verify server bundle exists
SERVER_INDEX="$SERVER_DIR/index.cjs"
if [ ! -f "$SERVER_INDEX" ]; then
  echo "Error: MCP server not found at $SERVER_INDEX" >&2
  exit 1
fi

# Launch the MCP server
exec "$NODE_BIN" "$SERVER_INDEX"
