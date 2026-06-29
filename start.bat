@echo off
REM Double-click launcher for the Receptor Atlas app.
REM Always runs from this folder, so it works wherever you move the folder to.
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies the first time...
  call npm install
  if errorlevel 1 ( echo. & echo npm install failed. See the message above. & pause & exit /b 1 )
)

if not exist db\atlas.db (
  echo Building the database from seed data...
  call npm run migrate
)

echo.
echo Starting the Atlas app at http://localhost:3000
echo Close this window (or press Ctrl+C) to stop it.
echo.
start "" http://localhost:3000/the-conservators-desk.html
node server.js
