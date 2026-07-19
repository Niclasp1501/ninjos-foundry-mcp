#!/bin/bash
# Quick update script to deploy backend changes without full reinstall

echo "🔄 Updating backend with quality settings..."

# Copy updated backend
sudo cp packages/mcp-server/dist/backend.bundle.cjs /Applications/FoundryMCPServer.app/Contents/Resources/foundry-mcp-server/backend.bundle.cjs

# Kill old backend
echo "Stopping old backend..."
pkill -9 -f "backend.bundle.cjs"

echo "✅ Backend updated! It will auto-restart when Claude Desktop reconnects."
echo ""
echo "Next steps:"
echo "1. Restart Claude Desktop to pick up changes"
echo "2. Change quality setting in Foundry"
echo "3. Test map generation"
