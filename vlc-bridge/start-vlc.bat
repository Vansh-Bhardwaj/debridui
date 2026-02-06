@echo off
REM ══════════════════════════════════════════════════════════════════
REM  DebridUI VLC Bridge — Quick Start
REM  Launches VLC with HTTP interface enabled for web app integration.
REM  Run once, or add to Windows Startup for auto-launch.
REM ══════════════════════════════════════════════════════════════════

setlocal

REM ── Find VLC ──
set "VLC_PATH="
if exist "C:\Program Files\VideoLAN\VLC\vlc.exe" set "VLC_PATH=C:\Program Files\VideoLAN\VLC\vlc.exe"
if exist "C:\Program Files (x86)\VideoLAN\VLC\vlc.exe" set "VLC_PATH=C:\Program Files (x86)\VideoLAN\VLC\vlc.exe"
if exist "%LOCALAPPDATA%\Programs\VideoLAN\VLC\vlc.exe" set "VLC_PATH=%LOCALAPPDATA%\Programs\VideoLAN\VLC\vlc.exe"

if "%VLC_PATH%"=="" (
    echo VLC not found. Install VLC from https://www.videolan.org/
    pause
    exit /b 1
)

REM ── Check if VLC is already running ──
tasklist /FI "IMAGENAME eq vlc.exe" 2>NUL | find /I "vlc.exe" >NUL
if %ERRORLEVEL% equ 0 (
    echo VLC is already running.
    exit /b 0
)

REM ── Launch VLC with HTTP interface ──
echo Starting VLC with HTTP interface...
start "" "%VLC_PATH%" --extraintf http --http-password vlcbridge --qt-start-minimized
echo VLC started. The DebridUI extension will connect automatically.
