/**
 * yard-watcher.js — SIDV Yard Auto-Updater
 * Phát hiện file XLS mới từ Yard System → đẩy lên Google Sheets → Tracker tự cập nhật
 */
'use strict';
require('dotenv').config(); // đọc SHEETS_URL từ .env trong cùng thư mục zalo-bot/

const fetch = require('node-fetch'); // dùng giống sheets.js — tự handle redirect
const fs    = require('fs');
const path  = require('path');

// ─── Cấu hình ──────────────────────────────────────────────────────────────
// Thư mục theo dõi: Desktop (nơi Yard System lưu file XLS)
const YARD_FOLDER = process.env.YARD_FOLDER
  || path.join(__dirname, '..', '..');  // D:\Program File\Desktop\

const SHEETS_URL  = process.env.SHEETS_URL || '';

// ─── Container regex ────────────────────────────────────────────────────────
const CONT_RE = /\b([A-Z]{4}[0-9]{6,7})\b/g;

// ─── State ──────────────────────────────────────────────────────────────────
let lastProcessedFile = null;
const reported = new Set();

// ─── Parse XLS binary → danh sách container ─────────────────────────────────
function extractContainers(filePath) {
  const buf = fs.readFileSync(filePath);
  let text = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    text += (b >= 32 && b < 127) ? String.fromCharCode(b) : ' ';
  }
  const found = new Set();
  CONT_RE.lastIndex = 0;
  let m;
  while ((m = CONT_RE.exec(text)) !== null) {
    found.add(m[1].length === 11 ? m[1].slice(0, 10) : m[1]);
  }
  return [...found];
}

// ─── POST đến Google Sheets (dùng node-fetch, tự follow redirect) ────────────
async function pushToSheets(containers, fname) {
  if (!SHEETS_URL) { console.warn('  ⚠️  Chưa có SHEETS_URL trong .env'); return; }
  const body = JSON.stringify({ action: 'updateYard', containers, fname,
    updatedAt: new Date().toLocaleString('vi-VN') });
  const res  = await fetch(SHEETS_URL, { method: 'POST', body, redirect: 'follow' });
  const text = await res.text();
  let result;
  try { result = JSON.parse(text); } catch { result = { ok: false, raw: text.slice(0, 300) }; }
  if (result.ok) console.log(`  ✅ Đã đẩy ${containers.length} container lên Sheets`);
  else console.error('  ❌ Sheets lỗi:', result.error || result.raw || JSON.stringify(result));
}

// ─── Kiểm tra và xử lý file mới trong thư mục ───────────────────────────────
async function checkFolder() {
  const folder = path.resolve(YARD_FOLDER);
  if (!fs.existsSync(folder)) { console.warn('  Thư mục không tồn tại:', folder); return; }

  // Chỉ nhận .XLS (Yard System) — bỏ qua .xlsx (bảng kê hãng tàu)
  const files = fs.readdirSync(folder)
    .filter(f => /\.xls$/i.test(f) && !f.startsWith('~$'))
    .map(f => { const fp = path.join(folder, f); return { name: f, path: fp, mtime: fs.statSync(fp).mtimeMs }; })
    .sort((a, b) => b.mtime - a.mtime);

  if (!files.length) { console.log('  Không có file .XLS nào trong thư mục'); return; }

  const latest  = files[0];
  const ageMin  = Math.round((Date.now() - latest.mtime) / 60000);
  // Lấy ngày hôm nay theo giờ VN
  const todayVN = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toDateString();
  const fileDayVN = new Date(new Date(latest.mtime).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toDateString();
  const isToday = todayVN === fileDayVN;

  if (!isToday) {
    console.log(`  File mới nhất: "${latest.name}" (${ageMin} phút trước) — không phải hôm nay, bỏ qua`);
    return;
  }
  if (lastProcessedFile === latest.name) {
    console.log(`  "${latest.name}" đã xử lý rồi — bỏ qua`); return;
  }

  console.log(`  📂 Đang xử lý: ${latest.name}`);
  const containers = extractContainers(latest.path);
  console.log(`  🔍 Tìm thấy: ${containers.length} container`);
  if (!containers.length) return;

  await pushToSheets(containers, latest.name.replace(/\.[^.]+$/, ''));
  lastProcessedFile = latest.name;
}

// ─── Lịch tự động: 07:04 và 17:59 (giờ VN UTC+7) ───────────────────────────
setInterval(async () => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const h = now.getHours(), m = now.getMinutes(), d = now.getDate();
  const key = `${d}-${h}`;
  if (((h === 7 && m === 4) || (h === 17 && m === 59)) && !reported.has(key)) {
    reported.add(key);
    const timeStr = `${h}:${m.toString().padStart(2, '0')}`;
    console.log(`\n[${timeStr}] ⏰ Đến giờ tự động kiểm tra Yard...`);
    await checkFolder().catch(e => console.error('  Lỗi:', e.message));
  }
  for (const k of reported) { if (!k.startsWith(`${d}-`)) reported.delete(k); }
}, 30000);

// ─── Banner khởi động ────────────────────────────────────────────────────────
const folder = path.resolve(YARD_FOLDER);
console.log('');
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║   🖥️  SIDV YARD WATCHER — Đang chạy                     ║');
console.log('╠══════════════════════════════════════════════════════════╣');
console.log('║  📁 Thư mục theo dõi:                                    ║');
console.log(`║     ${folder.slice(0, 52).padEnd(52)}  ║`);
console.log('║                                                          ║');
console.log('║  ⏰ Tự động xử lý lúc: 07:04 và 17:59 hàng ngày        ║');
console.log('║  ✉️  Sau đó Tracker sẽ tự cập nhật (07:04 và 17:59)     ║');
console.log('╠══════════════════════════════════════════════════════════╣');
console.log('║  📋 CÁCH DÙNG:                                           ║');
console.log('║  1. Mở Yard System → đăng nhập (quy / 1234)             ║');
console.log('║  2. Export file XLS                                      ║');
console.log('║  3. Lưu vào thư mục trên (trước 07:04 hoặc 17:59)       ║');
console.log('║  → Tự động đẩy lên Sheets → Tracker tự cập nhật ✅      ║');
console.log('╚══════════════════════════════════════════════════════════╝');
console.log('');

// Kiểm tra ngay khi khởi động
setTimeout(async () => {
  console.log('[Khởi động] Kiểm tra file có sẵn...');
  await checkFolder().catch(e => console.error('  Lỗi:', e.message));
}, 2000);
