#!/bin/bash
# Update wrapper with debug logging

echo "Updating wrapper with debug logging..."
sudo cp /Users/Adam/Projects/foundry-vtt-mcp/packages/mcp-server/dist/index.bundle.cjs /Applications/FoundryMCPServer.app/Contents/Resources/foundry-mcp-server/index.cjs

echo "✅ Wrapper updated"
echo ""
echo "Now:"
echo "1. Quit Claude Desktop completely (Cmd+Q)"
echo "2. Wait 3 seconds"
echo "3. Reopen Claude Desktop"
echo "4. Check wrapper log: tail -f /tmp/foundry-mcp-server/wrapper.log"
