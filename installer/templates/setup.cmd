@echo off
rem Setup of Ninjo's Foundry MCP. Double click after unpacking the zip.
rem Installs to %LOCALAPPDATA%\FoundryMCPServer and configures Claude Desktop.
setlocal
cd /d "%TEMP%"
"%~dp0node.exe" "%~dp0app\build\server\install\cli.js" install --source "%~dp0." %*
echo.
pause
