@echo off
REM Обёртка для Планировщика заданий Windows (ежедневный бэкап БД).
REM %~dp0 — папка этого файла (server\scripts\), .. — server\
cd /d "%~dp0.."
call npm run backup >> "%~dp0..\backups\backup-cron.log" 2>&1
