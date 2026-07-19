@echo off
REM Batch wrapper for PowerShell Claude Desktop configuration
REM This script provides a more reliable way to execute PowerShell from NSIS

echo [INFO] Starting Claude Desktop configuration...
echo [INFO] Install directory: %1

REM Change to the installation directory
cd /d "%~1"
if errorlevel 1 (
    echo [ERROR] Failed to change to installation directory: %~1
    exit /b 1
)

REM Verify PowerShell script exists
if not exist "configure-claude.ps1" (
    echo [ERROR] PowerShell script not found: configure-claude.ps1
    exit /b 2
)

REM Execute PowerShell script with proper error handling
echo [INFO] Executing PowerShell configuration script...
powershell.exe -inputformat none -NoProfile -ExecutionPolicy Bypass -File "configure-claude.ps1" -InstallDir "%~1"

REM Capture PowerShell exit code
set PS_EXIT_CODE=%errorlevel%

if %PS_EXIT_CODE% equ 0 (
    echo [SUCCESS] Claude Desktop configuration completed successfully
    exit /b 0
) else (
    echo [ERROR] PowerShell script failed with exit code: %PS_EXIT_CODE%
    exit /b %PS_EXIT_CODE%
)