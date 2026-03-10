/**
 * login.js — Chạy 1 lần duy nhất trên máy tính để đăng nhập Zalo
 *
 * Cách dùng:
 *   node login.js
 *   → Quét QR code bằng app Zalo trên điện thoại
 *   → Tự động lưu session vào cookies.json
 *   → Copy cookies.json lên Railway theo hướng dẫn
 */

require('dotenv').config();
const { Zalo, LoginQRCallbackEventType } = require('zca-js');
const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, 'cookies.json');

async function login() {
  console.log('='.repeat(50));
  console.log('  SIDV Zalo Bot — Đăng nhập lần đầu');
  console.log('='.repeat(50));
  console.log('\n📱 Chuẩn bị quét QR code...\n');

  const zalo = new Zalo({ logging: true });
  let savedCreds = null;

  // QR login với callback để capture credentials
  const api = await zalo.loginQR({}, async (event) => {
    if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
      // Lưu QR ra file và mở tự động
      await event.actions.saveToFile('qr.png');
      try {
        const { execSync } = require('child_process');
        execSync('start "" "' + path.join(__dirname, 'qr.png') + '"', { windowsHide: true });
      } catch(e) {}
    } else if (event.type === LoginQRCallbackEventType.QRCodeExpired) {
      // Tự động tạo lại QR mới
      event.actions.retry();
    } else if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
      savedCreds = event.data; // { cookie, imei, userAgent }
      fs.writeFileSync(COOKIE_FILE, JSON.stringify(savedCreds, null, 2), 'utf8');
    }
  });

  if (!savedCreds) throw new Error('Không lấy được credentials sau khi đăng nhập');

  console.log('\n✅ Đăng nhập thành công!');
  console.log(`📁 Session đã lưu vào: ${COOKIE_FILE}`);

  // In hướng dẫn deploy
  const b64 = Buffer.from(fs.readFileSync(COOKIE_FILE, 'utf8')).toString('base64');
  console.log('\n' + '='.repeat(50));
  console.log('  BƯỚC TIẾP THEO — Deploy lên Railway:');
  console.log('='.repeat(50));
  console.log('\n1. Copy chuỗi bên dưới (toàn bộ, rất dài):');
  console.log('\nZALO_COOKIES=');
  console.log(b64);
  console.log('\n2. Vào Railway → project → Variables → Add Variable:');
  console.log('   Key:   ZALO_COOKIES');
  console.log('   Value: [chuỗi ở trên]');
  console.log('\n3. Cũng thêm:');
  console.log('   Key:   SHEETS_URL');
  console.log('   Value: [URL Apps Script của bạn]');
  console.log('\n4. Railway sẽ tự restart bot với session mới.');

  process.exit(0);
}

login().catch(err => {
  console.error('\n❌ Đăng nhập thất bại:', err.message);
  console.error('\nThử lại: node login.js');
  process.exit(1);
});
