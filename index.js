/**
 * index.js — SIDV Zalo Bot
 * Nhận file Excel bảng kê hãng tàu qua Zalo → parse → đẩy lên Google Sheets
 *
 * Env vars:
 *   ZALO_COOKIES     - base64 JSON credentials
 *   SHEETS_URL       - Google Apps Script URL
 *   ALLOWED_GROUP_ID - (tuỳ chọn) chỉ nhận file từ nhóm này
 */

require('dotenv').config();
const { Zalo, ThreadType } = require('zca-js');
const fetch = require('node-fetch');
const fs    = require('fs');
const path  = require('path');

const { parseExcelBuffer } = require('./parser');
const { addSessionToSheets } = require('./sheets');

const COOKIE_FILE = path.join(__dirname, 'cookies.json');

// ─── Tải credentials ────────────────────────────────────────────────────────
function loadCredentials() {
  if (process.env.ZALO_COOKIES) {
    try {
      const decoded = Buffer.from(process.env.ZALO_COOKIES, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch {
      console.error('❌ ZALO_COOKIES env var không hợp lệ');
      process.exit(1);
    }
  }
  if (fs.existsSync(COOKIE_FILE)) {
    return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  }
  return null;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const creds = loadCredentials();
  if (!creds) {
    console.error('❌ Chưa có thông tin đăng nhập Zalo. Chạy "npm run login" trước.');
    process.exit(1);
  }

  const ALLOWED_GROUP = process.env.ALLOWED_GROUP_ID || '';
  if (ALLOWED_GROUP) {
    console.log(`🎯 Chỉ nhận file từ nhóm: ${ALLOWED_GROUP}`);
  } else {
    console.log('📡 Nhận file từ TẤT CẢ nhóm (chưa cấu hình ALLOWED_GROUP_ID)');
  }

  console.log('🔄 Đang kết nối Zalo...');
  const zalo = new Zalo({ logging: true, selfListen: true });
  const api  = await zalo.login(creds);

  console.log('✅ Đã kết nối Zalo thành công!');
  console.log('📩 Đang lắng nghe tin nhắn có file Excel...\n');

  // ─── Cảnh báo nếu bị ngắt kết nối ─────────────────────────────────────
  api.listener.on('disconnected', () => {
    console.error('⚠️  LISTENER BỊ NGẮT! Đóng Zalo Web trên trình duyệt nếu đang mở.');
  });

  // ─── Xử lý tin nhắn ───────────────────────────────────────────────────
  api.listener.on('message', async (message) => {
    try {
      const threadId   = message.threadId;
      const threadType = message.type;
      const senderName = message.data?.dName || message.data?.senderName || 'Người gửi';
      const msgType    = message.data?.msgType || '';
      const content    = message.data?.content;
      const isGroup    = threadType === ThreadType.Group;

      // ── Log mọi tin nhắn (để tìm Group ID) ──
      console.log(`📨 [${isGroup ? 'GRP' : 'USR'}] threadId=${threadId} | ${senderName} | msgType="${msgType}"`);

      // ── Filter: chỉ xử lý nhóm được phép (nếu đã cấu hình) ──
      if (ALLOWED_GROUP && isGroup && threadId !== ALLOWED_GROUP) {
        return; // bỏ qua nhóm khác, không cần log thêm
      }

      // ── Chỉ xử lý khi content là object (file/ảnh/voice, không phải text) ──
      if (!content || typeof content !== 'object') return;

      // ── Tìm URL và tên file trong content ──
      const fileUrl  = content.href  || content.url  || content.fileUrl;
      const fileName = content.title || content.name || content.fileName || 'unknown';

      if (!fileUrl) {
        // Log cấu trúc content để debug khi cần
        if (msgType === 'share.file') {
          console.log(`   ↳ share.file nhưng không tìm thấy URL. Keys: ${Object.keys(content).join(',')}`);
        }
        return;
      }

      // ── Chỉ xử lý Excel ──
      if (!/\.(xlsx|xls)$/i.test(fileName)) {
        console.log(`⏭️  Bỏ qua file không phải Excel: ${fileName}`);
        return;
      }

      console.log(`\n📎 Nhận file từ ${senderName} (nhóm: ${threadId}): ${fileName}`);
      await sendMsg(api, `⏳ Đang xử lý file "${fileName}"...`, threadId, threadType);

      try {
        // Download
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
        await addSessionToSheets({ sessionName: parsed.sessionName, containers: parsed.containers });

        // Thống kê 20'/40'
        const c20 = parsed.containers.filter(c => c.type === '20').length;
        const c40 = parsed.containers.filter(c => c.type === '40').length;
        const cUnk= parsed.containers.filter(c => !c.type).length;
        const typeStr = [
          c20 && `${c20} cont 20'`,
          c40 && `${c40} cont 40'`,
          cUnk && `${cUnk} cont ?`
        ].filter(Boolean).join(' + ');

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
        await sendMsg(api, `❌ Lỗi khi xử lý file "${fileName}":\n${err.message}`, threadId, threadType);
      }

    } catch (err) {
      console.error('❌ Lỗi xử lý tin nhắn:', err.message);
    }
  });

  api.listener.start();

  process.on('SIGINT', () => {
    console.log('\n🛑 Đang dừng bot...');
    api.listener.stop();
    process.exit(0);
  });
}

// ─── Helper gửi tin nhắn ───────────────────────────────────────────────────
async function sendMsg(api, text, threadId, threadType) {
  try {
    await api.sendMessage({ msg: text }, threadId, threadType);
  } catch (err) {
    console.error('⚠️  Không gửi được phản hồi:', err.message);
  }
}

main().catch(err => {
  console.error('💥 Bot crash:', err);
  process.exit(1);
});
