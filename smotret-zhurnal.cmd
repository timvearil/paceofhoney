@echo off
rem Smotret Zhurnal: lokalnyj stend paceofhoney.me v brauzere.
rem
rem ZACHEM. Chtoby videt sajt do publikacii dvojnym shhelchkom, bez terminala.
rem Delaet to zhe, chto "npm run dev": perenosit kadry iz arhiva (npm run images),
rem zapuskaet stend na 127.0.0.1:4321 i sam otkryvaet brauzer.
rem
rem Okno ne zakryvat, poka smotrite sajt. Zakryli okno - stend ostanovlen.
rem Esli stend uzhe zapushhen, vtoroj ne podnimaetsya - prosto otkryvaetsya brauzer:
rem inache Astro zanyal by sosednij port, i bylo by dva raznyh stenda.
chcp 65001 >nul
cd /d "%~dp0"

netstat -ano | findstr /r /c:"127\.0\.0\.1:4321 .*LISTENING" >nul
if not errorlevel 1 (
  echo Стенд Журнала уже запущен — открываю браузер.
  start "" "http://127.0.0.1:4321/"
  timeout /t 3 >nul
  exit /b 0
)

if not exist "node_modules\" (
  echo Нет папки node_modules — это не основной компьютер или зависимости не установлены.
  echo Стенд не запущен. Позовите Claude Code.
  echo.
  echo Нажмите любую клавишу, чтобы закрыть окно.
  pause >nul
  exit /b 1
)

echo Журнал: переношу кадры и запускаю стенд на 127.0.0.1:4321.
echo Браузер откроется сам. Это окно не закрывайте, пока смотрите сайт.
echo.
call npm.cmd run dev -- --open
echo.
echo Стенд остановлен. Нажмите любую клавишу, чтобы закрыть окно.
pause >nul
