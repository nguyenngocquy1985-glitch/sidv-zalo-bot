@echo off
chcp 65001 >nul
title SIDV Zalo Bot — Đăng nhập Zalo
cd /d "%~dp0"
echo.
echo ==========================================
echo  SIDV Zalo Bot - Dang nhap Zalo
echo ==========================================
echo.
echo Chuan bi dien thoai: Mo Zalo ^> bam icon QR goc tren phai
echo.

:: Chạy login và tự mở QR
"C:\Program Files\nodejs\node.exe" login.js &
set NODE_PID=%!

:: Đợi qr.png xuất hiện rồi mở
:wait_qr
if exist qr.png (
    timeout /t 1 /nobreak >nul
    start "" qr.png
    goto :end_wait
)
timeout /t 1 /nobreak >nul
goto :wait_qr
:end_wait

:: Chờ login.js kết thúc
wait

echo.
echo ==========================================
echo  Ket qua o tren. Bam Enter de dong.
echo ==========================================
pause
