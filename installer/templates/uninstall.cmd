@echo off
rem Removes Ninjo's Foundry MCP. Your allowed-origins.json, logs and ComfyUI stay.
rem Everything runs in one line, because this file is deleted while it runs.
setlocal
cd /d "%TEMP%"
"%~dp0node.exe" "%~dp0app\build\server\install\cli.js" uninstall %* & echo. & pause & exit /b
