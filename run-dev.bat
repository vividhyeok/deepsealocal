@echo off
setlocal

cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

echo Starting DeepSea Local...
call npm run dev

endlocal
