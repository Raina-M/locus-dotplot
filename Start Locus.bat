@echo off
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 run_locus.py %*
  if errorlevel 1 pause
  exit /b
)
where python >nul 2>nul
if not errorlevel 1 (
  python run_locus.py %*
  if errorlevel 1 pause
  exit /b
)
echo Locus requires Python 3.9 or later.
echo Install Python 3 from https://www.python.org/downloads/ and try again.
pause
exit /b 1
