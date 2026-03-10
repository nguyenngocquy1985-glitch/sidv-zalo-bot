@echo off
chcp 65001 >nul
title Railway Login
set PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%
echo Dang nhap Railway - trinh duyet se mo tu dong...
echo.
railway login
echo.
if %errorlevel% equ 0 (
    echo THANH CONG! Railway da dang nhap.
    railway whoami
) else (
    echo THAT BAI. Thu lai.
)
echo.
pause
