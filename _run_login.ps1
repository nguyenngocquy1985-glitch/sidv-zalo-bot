Set-Location "D:\Program File\Desktop\CHECK CHUYỂN VỎ\zalo-bot"
Write-Host "Starting Zalo login..." -ForegroundColor Cyan

$proc = Start-Process -FilePath "C:\Program Files\nodejs\node.exe" `
    -ArgumentList "login.js" `
    -WorkingDirectory "D:\Program File\Desktop\CHECK CHUYỂN VỎ\zalo-bot" `
    -NoNewWindow -PassThru

# Watch for qr.png and open it
$qrPath = "D:\Program File\Desktop\CHECK CHUYỂN VỎ\zalo-bot\qr.png"
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $qrPath) {
        Write-Host "QR found! Opening..." -ForegroundColor Green
        Start-Process $qrPath
        break
    }
}

Write-Host "Waiting for login to complete..." -ForegroundColor Yellow
$proc.WaitForExit()
Write-Host "Login process exited with code: $($proc.ExitCode)" -ForegroundColor $(if($proc.ExitCode -eq 0){'Green'}else{'Red'})

if (Test-Path "D:\Program File\Desktop\CHECK CHUYỂN VỎ\zalo-bot\cookies.json") {
    Write-Host "SUCCESS: cookies.json saved!" -ForegroundColor Green
} else {
    Write-Host "FAILED: no cookies.json" -ForegroundColor Red
}

Read-Host "Press Enter to close"
