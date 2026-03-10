@echo off
chcp 65001 >nul
title SIDV Zalo Bot — Setup

echo.
echo ================================================
echo   SIDV Zalo Bot — Tự động cài đặt
echo ================================================
echo.

set NODE="C:\Program Files\nodejs\node.exe"
set NPM="C:\Program Files\nodejs\npm.cmd"
set GH="C:\Program Files\GitHub CLI\gh.exe"
set RAILWAY_CMD=railway

:: Kiểm tra Node.js
%NODE% --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Node.js chua duoc cai. Chay lai sau khi restart may tinh.
    pause & exit /b 1
)
echo [OK] Node.js da co san

:: Cài packages nếu chưa có
if not exist node_modules (
    echo [...] Dang cai npm packages...
    %NPM% install
)
echo [OK] npm packages da cai

:: Kiểm tra .env
if not exist .env (
    echo.
    echo ================================================
    echo   Buoc 1: Nhap URL Google Apps Script
    echo ================================================
    echo.
    echo Mo tracker.html ^> Bam nut ^^⚙️ ^> Copy URL Apps Script
    echo.
    set /p SHEETS_URL="Dan URL vao day: "
    echo SHEETS_URL=%SHEETS_URL%> .env
    echo [OK] Da luu SHEETS_URL
) else (
    echo [OK] File .env da co san
)

:: Đăng nhập GitHub (nếu chưa)
%GH% auth status >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ================================================
    echo   Buoc 2: Dang nhap GitHub
    echo ================================================
    echo.
    echo Trinh duyet se mo de dang nhap GitHub...
    echo Neu chua co tai khoan GitHub, tao tai: github.com
    echo.
    %GH% auth login --web --git-protocol https
    if %errorlevel% neq 0 (
        echo [WARN] Bo qua GitHub login. Se deploy khac.
        goto :skip_github
    )
)

:: Tạo GitHub repo và push
%GH% repo view sidv-zalo-bot >nul 2>&1
if %errorlevel% neq 0 (
    echo [...]  Tao GitHub repo sidv-zalo-bot...
    %GH% repo create sidv-zalo-bot --private --source=. --remote=origin --push
    echo [OK] Da day code len GitHub
) else (
    git push origin master >nul 2>&1
    echo [OK] Da cap nhat GitHub
)

:skip_github

:: Railway login
%RAILWAY_CMD% whoami >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo ================================================
    echo   Buoc 3: Dang nhap Railway (server mien phi)
    echo ================================================
    echo.
    echo Trinh duyet se mo railway.app...
    echo Dang nhap bang GitHub hoac email.
    echo.
    %RAILWAY_CMD% login
)

:: Tạo Railway project
%RAILWAY_CMD% status >nul 2>&1
if %errorlevel% neq 0 (
    echo [...]  Tao Railway project...
    %RAILWAY_CMD% init
)

:: Set env vars trên Railway
echo [...]  Dang cau hinh bien moi truong tren Railway...
for /f "tokens=2 delims==" %%i in (.env) do set SHEETS_VAL=%%i
%RAILWAY_CMD% variables set SHEETS_URL=%SHEETS_VAL%

:: Deploy
echo.
echo [...]  Dang deploy len Railway...
%RAILWAY_CMD% up --detach

echo.
echo ================================================
echo   Buoc cuoi: Dang nhap Zalo
echo ================================================
echo.
echo Chuan bi dien thoai de quet QR code Zalo.
echo.
pause
%NODE% login.js

echo.
echo ================================================
echo   HOAN THANH! Bot dang chay tren Railway.
echo ================================================
echo.
echo Zalo cua ban se tu dong nhan file bang ke.
echo.
pause
