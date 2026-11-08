@echo off
cd /d "C:\Software\issue-maker"

:: Node.js 실행 확인 및 백그라운드 구동
node dist\index.js >> data\bot.log 2>&1
