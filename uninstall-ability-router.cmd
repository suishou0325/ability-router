@echo off
setlocal
set LOG=%TEMP%\ability-router-uninstall.log
set REPO=%~dp0
set REPO=%REPO:~0,-1%
echo ===== uninstall started ===== > "%LOG%"
echo Step: dsh plugin --profile desktop remove dsh-ability-router >> "%LOG%"
call dsh plugin --profile desktop remove dsh-ability-router >> "%LOG%" 2>&1
echo Exit code: %errorlevel% >> "%LOG%"
echo Step: unpark skills (keep conversation-style skills parked) >> "%LOG%"
node "%REPO%\scripts\unpark-skills.mjs" --except grill-me,grill-with-docs,wait-what,ask-matt,to-questionnaire,teach,loop-me >> "%LOG%" 2>&1
echo Exit code: %errorlevel% >> "%LOG%"
echo ===== uninstall finished ===== >> "%LOG%"
echo.
echo Uninstall finished. Log: %LOG%
echo Restart DeepSeek Harness Desktop to apply.
pause
