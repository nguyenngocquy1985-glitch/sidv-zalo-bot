/**
 * index.js — SIDV Zalo Bot
 * Nhận file Excel bảng kê hãng tàu qua Zalo → parse → đẩy lên Google Sheets
 *
 * Chạy: node index.js
 * Deploy: Railway / Render (set env vars SHEETS_URL + ZALO_COOKIES)
 */

require('dotenv').config();
const { Zalo, ThreadType } = require('zca-js');
const fetch = require('node-fetch');
const fs    = require('fs');
const path  = require('path');

const { parseExcelBuffer } = require('./parser');
const { addSessionToSheets } = require('./sheets');

const COOKIE_FILE = path.join(__dirname, 'cookies.json');

// ─── Tải credentials từ env (Railway) hoặc file local ─────────────────────
function loadCredentials() {
  if (process.env.ZALO_COOKIES) {
    try {
      const decoded = Buffer.from(process.env.ZALO_COOKIES, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch {
      console.error('❌ ZALO_COOKIES env var không hợp lệ (phải là JSON base64)');
      process.exit(1);
    }
  }
  if (fs.existsSync(COOKIE_FILE)) {
    return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  }
  return null;
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const creds = loadCredentials();

  if (!creds) {
    console.error('❌ Chưa có thông tin đăng nhập Zalo.');
    console.error('   → Chạy "npm run login" để đăng nhập lần đầu.');
    process.exit(1);
  }

  console.log('🔄 Đang kết nối Zalo...');
  const zalo = new Zalo({ logging: true, selfListen: true });
  const api  = await zalo.login(creds);

  console.log('✅ Đã kết nối Zalo thành công!');
  console.log('📩 Đang lắng nghe tin nhắn có file Excel...\n');

  // ─── Listener disconnected: Zalo có thể kick bot nếu mở Zalo Web song song ──
  api.listener.on('disconnected', () => {
    console.error('⚠️  LISTENER BỊ NGẮT KẾT NỐI! Có thể do đang mở Zalo Web trên trình duyệt.');
    console.error('   Đóng Zalo Web và restart bot để khắc phục.');
  });

  // ─── Xử lý tin nhắn đến ───────────────────────────────────────────────
  api.listener.on('message', async (message) => {
    try {
      const threadId   = message.threadId;
      const threadType = message.type;   // ThreadType.User | ThreadType.Group
      const senderName = message.data?.dName || message.data?.senderName || 'Người gửi';
      const msgType    = message.data?.msgType || '';
      const content    = message.data?.content;

      // ── DEBUG: log mọi tin nhắn nhận được ──
      const isText = typeof content === 'string';
      console.log(`📨 [${threadType === ThreadType.Group ? 'GRP' : 'USR'}] ${senderName} | msgType="${msgType}" | content=${isText ? `"${String(content).slice(0,50)}"` : `{${Object.keys(content||{}).join(',')}}`}`);

      // ── Chỉ xử lý tin nhắn có content là object (file/media/link) ──
      if (!content || typeof content !== 'object') return;

      // ── Tìm URL file và tên file trong content ──
      // Zalo truyền file qua content.href (URL download) và content.title (tên file)
      const fileUrl  = content.href  || content.url  || content.fileUrl;
      const fileName = content.title || content.name || content.fileName || 'unknown';

      if (!fileUrl) {
        console.log(`   ↳ content là object nhưng không có URL file, bỏ qua.`);
        console.log(`   ↳ content keys: ${JSON.stringify(content).slice(0, 200)}`);
        return;
      }

      // ── Chỉ xử lý Excel ──
      if (!/\.(xlsx|xls)$/i.test(fileName)) {
        console.log(`⏭️  Bỏ qua file không phải Excel: ${fileName}`);
        return;
      }

      console.log(`\n📎 Nhận file từ ${senderName}: ${fileName}`);
      await sendMsg(api, `⏳ Đang xử lý file "${fileName}"...`, threadId, threadType);

      try {
        // Download file
        const resp   = await fetch(fileUrl);
        const buffer = Buffer.from(await resp.arrayBuffer());

        // Parse Excel
        const parsed = parseExcelBuffer(buffer, fileName);

        if (!parsed.containers.length) {
          await sendMsg(api,
            `⚠️ File "${fileName}" không có container nào hợp lệ.\nKiểm tra lại định dạng file.`,
            threadId, threadType
          );
          return;
        }

        // Đẩy lên Google Sheets
        await addSessionToSheets({
          sessionName: parsed.sessionName,
          containers:  parsed.containers,
        });

        // Phân loại 20'/40'
        const c20 = parsed.containers.filter(c => c.type === '20').length;
        const c40 = parsed.containers.filter(c => c.type === '40').length;
        const typeStr = [c20 && `${c20} cont 20'`, c40 && `${c40} cont 40'`].filter(Boolean).join(' + ');

        // Xác nhận thành công
        await sendMsg(api,
          `✅ ĐÃ NHẬN BẢNG KÊ\n` +
          `📋 ${parsed.sessionName}\n` +
          `📦 ${parsed.containers.length} container (${typeStr})\n` +
          `🕐 ${new Date().toLocaleString('vi-VN')}\n\n` +
          `👉 Mở tracker → bấm "📥 Kiểm tra bảng kê từ Zalo"`,
          threadId, threadType
        );

        console.log(`✅ Xử lý thành công: ${parsed.sessionName} (${parsed.containers.length} cont)`);

      } catch (err) {
        console.error(`❌ Lỗi xử lý file ${fileName}:`, err.message);
        await sendMsg(api,
          `❌ Lỗi khi xử lý file "${fileName}":\n${err.message}`,
          threadId, threadType
        );
      }

    } catch (err) {
      console.error('❌ Lỗi xử lý tin nhắn:', err.message);
    }
  });

  api.listener.start();

  // Giữ bot chạy liên tục
  process.on('SIGINT', () => {
    console.log('\n🛑 Đang dừng bot...');
    api.listener.stop();
    process.exit(0);
  });
}

// ─── Helper: gửi tin nhắn ─────────────────────────────────────────────────
async function sendMsg(api, text, threadId, threadType) {
  try {
    await api.sendMessage({ msg: text }, threadId, threadType);
  } catch (err) {
    console.error('⚠️  Không gửi được tin nhắn phản hồi:', err.message);
  }
}

main().catch(err => {
  console.error('💥 Bot crash:', err);
  process.exit(1);
});
