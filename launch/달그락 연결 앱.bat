@echo off
rem 달그락 연결 앱 (Windows): 이 파일을 두 번 누르면 켜져요. 창을 닫으면 꺼져요.
chcp 65001 >nul
title 달그락 연결 앱
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 goto oldnode

node "..\bin\dalgrak-helper.mjs"
if errorlevel 1 goto failed
goto :eof

:nonode
echo Node.js가 없어요. 열리는 페이지에서 LTS 버전을 설치한 뒤 이 파일을 다시 눌러주세요.
start "" "https://nodejs.org"
pause >nul
exit /b 1

:oldnode
echo Node.js가 오래됐어요. 열리는 페이지에서 LTS 버전을 설치한 뒤 다시 눌러주세요.
start "" "https://nodejs.org"
pause >nul
exit /b 1

:failed
echo.
echo 문제가 생겨 멈췄어요. 위 글을 확인한 뒤 아무 키나 누르면 창이 닫혀요.
pause >nul
exit /b 1
