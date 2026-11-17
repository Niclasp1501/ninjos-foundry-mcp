@echo off
rem Agent client of Ninjo's Foundry MCP: keeps a Foundry user logged in for an AI agent.
rem Run it from PowerShell or Command Prompt, for example: agent-client.cmd help
"%~dp0node.exe" "%~dp0app\build\server\agent-client\cli.js" %*
