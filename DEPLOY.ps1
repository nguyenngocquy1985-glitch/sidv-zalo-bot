# SIDV Zalo Bot - Deploy tự động lên Railway (miễn phí)
# Cách chạy: Click phải vào file này → Run with PowerShell

$Host.UI.RawUI.WindowTitle = "SIDV Zalo Bot - Setup & Deploy"
$ErrorActionPreference = "Stop"

function Write-Step($n, $msg) {
    Write-Host "`n[$n] $msg" -ForegroundColor Cyan
}
function Write-OK($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "    >>  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "    ERR $msg" -ForegroundColor Red }

Clear-Host
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "   SIDV Zalo Bot - Tu dong cai dat & deploy"      -ForegroundColor Magenta
Write-Host "================================================`n" -ForegroundColor Magenta

$BotDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $BotDir

$env:PATH = "C:\Program Files\nodejs;C:\Program Files\GitHub CLI;$env:APPDATA\npm;$env:PATH"

# ─── Bước 1: Kiểm tra Node.js ─────────────────────────────────────────────
Write-Step 1 "Kiem tra Node.js..."
$nodeVer = node --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Node.js chua duoc cai. Restart may tinh roi chay lai."
    Read-Host "Bam Enter de thoat"; exit 1
}
Write-OK "Node.js $nodeVer"

# ─── Bước 2: Lấy SHEETS_URL ───────────────────────────────────────────────
Write-Step 2 "Cau hinh SHEETS_URL..."
if (Test-Path ".env") {
    $envContent = Get-Content ".env"
    $existingUrl = $envContent | Where-Object { $_ -match "SHEETS_URL=https" } | Select-Object -First 1
    if ($existingUrl) {
        Write-OK "SHEETS_URL da co: $($existingUrl -replace 'SHEETS_URL=','')"
        goto :skip_url
    }
}
Write-Warn "Mo tracker → bam nut ⚙️ → Copy URL Apps Script"
Write-Host ""
$sheetsUrl = Read-Host "   Dan URL vao day"
if (-not $sheetsUrl.StartsWith("https://script.google.com")) {
    Write-Fail "URL khong hop le. Phai bat dau bang https://script.google.com"
    Read-Host "Bam Enter de thoat"; exit 1
}
"SHEETS_URL=$sheetsUrl" | Set-Content ".env"
Write-OK "Da luu SHEETS_URL"
:skip_url

# ─── Bước 3: Đăng nhập GitHub ─────────────────────────────────────────────
Write-Step 3 "Dang nhap GitHub (trinh duyet se mo)..."
$ghStatus = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Chua dang nhap GitHub. Trinh duyet se mo..."
    Write-Warn "Neu chua co tai khoan → tao mien phi tai github.com truoc"
    gh auth login --hostname github.com --git-protocol https --web
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Dang nhap GitHub that bai"
        Read-Host "Bam Enter de thoat"; exit 1
    }
}
Write-OK "Da dang nhap GitHub"

# ─── Bước 4: Tạo GitHub repo ──────────────────────────────────────────────
Write-Step 4 "Tao GitHub repository..."
$repoCheck = gh repo view sidv-zalo-bot 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Tao repo moi sidv-zalo-bot (private)..."
    gh repo create sidv-zalo-bot --private --source=. --remote=origin --push
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Khong tao duoc repo"
        Read-Host "Bam Enter de thoat"; exit 1
    }
    Write-OK "Da tao va push len GitHub"
} else {
    git push origin master 2>&1 | Out-Null
    Write-OK "Da cap nhat GitHub repo"
}

# ─── Bước 5: Đăng nhập Railway ────────────────────────────────────────────
Write-Step 5 "Dang nhap Railway (trinh duyet se mo)..."
$railwayWho = railway whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Chua dang nhap Railway. Trinh duyet se mo..."
    Write-Warn "Neu chua co tai khoan → tao mien phi tai railway.app"
    railway login
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Dang nhap Railway that bai"
        Read-Host "Bam Enter de thoat"; exit 1
    }
}
Write-OK "Da dang nhap Railway"

# ─── Bước 6: Tạo Railway project và deploy ────────────────────────────────
Write-Step 6 "Tao Railway project va deploy..."
$railwayStatus = railway status 2>&1
if ($railwayStatus -match "No project") {
    Write-Warn "Tao project moi tren Railway..."
    railway init --name sidv-zalo-bot
}

# Set environment variables
Write-Warn "Cau hinh bien moi truong tren Railway..."
$sheetsLine = Get-Content ".env" | Where-Object { $_ -match "SHEETS_URL=" }
$sheetsVal  = $sheetsLine -replace "SHEETS_URL=",""
railway variables set SHEETS_URL="$sheetsVal" | Out-Null
Write-OK "Da set SHEETS_URL tren Railway"

Write-Warn "Dang deploy len Railway server..."
railway up --detach
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Deploy that bai. Kiem tra lai."
    Read-Host "Bam Enter de thoat"; exit 1
}
Write-OK "Da deploy len Railway thanh cong!"

# ─── Bước 7: Đăng nhập Zalo (scan QR) ────────────────────────────────────
Write-Step 7 "Dang nhap Zalo (can quet QR bang dien thoai)..."
Write-Warn ""
Write-Warn "Chuan bi dien thoai - mo Zalo - Quet QR se hien ben duoi..."
Write-Host ""
node login.js

if (Test-Path "cookies.json") {
    Write-OK "Session Zalo da luu (cookies.json)"

    # Encode cookies và set lên Railway
    Write-Warn "Dang upload Zalo session len Railway..."
    $cookiesB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content "cookies.json" -Raw)))
    railway variables set ZALO_COOKIES="$cookiesB64" | Out-Null
    Write-OK "Da set ZALO_COOKIES tren Railway"

    # Restart Railway service để nhận config mới
    Write-Warn "Khoi dong lai bot tren Railway..."
    railway service restart 2>&1 | Out-Null
    Write-OK "Bot da khoi dong lai voi Zalo session moi"
} else {
    Write-Fail "Khong tim thay cookies.json. Zalo login co the that bai."
}

# ─── HOÀN THÀNH ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "   HOAN THANH! Bot dang chay tren Railway."      -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Ket qua:" -ForegroundColor White
Write-Host "  - Bot Zalo dang chay 24/7 tren Railway (mien phi)" -ForegroundColor White
Write-Host "  - Khi hang tau gui file .xlsx qua Zalo → bot tu xu ly" -ForegroundColor White
Write-Host "  - Mo tracker → bam '📥 Kiem tra bang ke tu Zalo' de import" -ForegroundColor White
Write-Host ""
Write-Host "Luu y: Moi 3 thang phai chay lai DEPLOY.ps1 de gia han Zalo session." -ForegroundColor Yellow
Write-Host ""

$railwayUrl = railway open 2>&1
Write-Host "Xem bot tren Railway: $railwayUrl" -ForegroundColor Cyan
Write-Host ""
Read-Host "Bam Enter de dong"
