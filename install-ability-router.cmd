@echo off
setlocal
set LOG=%TEMP%\ability-router-install.log
set REPO=%~dp0
set REPO=%REPO:~0,-1%
echo ===== install started ===== > "%LOG%"
echo Repo: %REPO% >> "%LOG%"
echo Step: dsh plugin --profile desktop add link:%REPO% >> "%LOG%"
call dsh plugin --profile desktop add link:"%REPO%" >> "%LOG%" 2>&1
echo Exit code: %errorlevel% >> "%LOG%"
echo ===== install finished ===== >> "%LOG%"
echo.
echo Install finished. Log: %LOG%
echo If it says "fully quit it", quit DeepSeek Harness Desktop first, then run again.
pause
