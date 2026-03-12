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
const http  = require('http');

const { parseExcelBuffer } = require('./parser');
const { addSessionToSheets } = require('./sheets');

const COOKIE_FILE = path.join(__dirname, 'cookies.json');

// ─── HTTP server khởi động NGAY (trước Zalo login) để Railway healthcheck OK ─
let _botApi    = null;
let _botGroup  = '';
const PORT = process.env.PORT || 3000;
http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/send-report') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    console.log('[HTTP] /send-report triggered');
    if (_botApi && _botGroup) await sendDailyReport(_botApi, _botGroup).catch(e => console.error('[HTTP] Lỗi:', e.message));
    else console.warn('[HTTP] Bot chưa ready');
  } else {
    res.writeHead(200); res.end('SIDV Bot OK');
  }
}).listen(PORT, () => console.log('🌐 HTTP server on port ' + PORT));

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

      // ── Lệnh text: !baocao ──
      if (typeof content === 'string') {
        const cmd = content.trim().toLowerCase();
        if (cmd === '!baocao' || cmd === 'baocao') {
          console.log(`[CMD] !baocao từ ${senderName}`);
          await sendDailyReport(api, threadId);
        }
        return;
      }

      // ── Chỉ xử lý khi content là object (file/ảnh/voice, không phải text) ──
      if (!content || typeof content !== 'object') return;

      // ── Tìm URL và tên file trong content ──
      const fileUrl  = content.href  || content.url  || content.fileUrl;
      const fileName = content.title || content.name || content.fileName || 'unknown';

      if (!fileUrl) {
        if (msgType === 'share.file') {
          // Log đầy đủ để debug
          console.log(`   ↳ share.file nhưng không tìm thấy URL. Keys: ${Object.keys(content).join(',')}`);
          console.log(`   ↳ Content sample:`, JSON.stringify(content).slice(0, 300));
        }
        return;
      }

      // ── Chỉ xử lý Excel (từ nhóm được phép) ──
      if (!/\.(xlsx|xls)$/i.test(fileName)) {
        if (msgType === 'share.file') {
          console.log(`⏭️  Bỏ qua file không phải Excel: ${fileName}`);
        }
        return;
      }
      // Xác nhận nhận file từ đúng nhóm
      console.log(`\n📎 [OK] File Excel từ ${senderName} | nhóm ${threadId} | ${fileName}`);

      // (log đã thêm ở trên)
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

  // Gán api vào biến global để HTTP server dùng được
  _botApi   = api;
  _botGroup = process.env.ALLOWED_GROUP_ID || '';

  // ─── Kiểm tra ngay khi khởi động: nếu trễ ≤30 phút so với giờ định kỳ → gửi luôn
  const startNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const sh = startNow.getHours(), sm = startNow.getMinutes();
  const missedMorning = (sh === 7 && sm >= 5) || (sh === 7 && sm <= 35) || (sh === 8 && sm <= 5);
  const missedEvening = (sh === 18 && sm <= 30) || (sh === 17 && sm >= 59);
  if (_botGroup && (missedMorning || missedEvening)) {
    console.log(`[Startup] Phát hiện khởi động lúc ${sh}:${sm.toString().padStart(2,'0')} VN — gửi báo cáo bù...`);
    setTimeout(() => sendDailyReport(api, _botGroup).catch(e => console.error('[Startup]', e.message)), 5000);
  }

  // ─── Lịch báo cáo sáng 07:05 ────────────────────────────────────────────
  scheduleDailyReport(api);

  process.on('SIGINT', () => {
    console.log('\n🛑 Đang dừng bot...');
    api.listener.stop();
    process.exit(0);
  });
}

// ─── Báo cáo sáng 07:05 ─────────────────────────────────────────────────────

function scheduleDailyReport(api) {
  const GROUP_ID = process.env.ALLOWED_GROUP_ID || '';
  if (!GROUP_ID) {
    console.log('⚠️  ALLOWED_GROUP_ID chưa set — bỏ qua lịch báo cáo sáng');
    return;
  }
  const reported = new Set(); // key: "ngày-giờ" — tránh gửi 2 lần
  console.log('⏰ Lịch báo cáo 07:05 và 18:00 hàng ngày → nhóm', GROUP_ID);

  setInterval(async () => {
    // Lấy giờ VN (UTC+7)
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const h = now.getHours(), m = now.getMinutes(), d = now.getDate();
    const is0705 = (h === 7  && m === 5);
    const is1800 = (h === 18 && m === 0);
    const key = `${d}-${h}`;

    if ((is0705 || is1800) && !reported.has(key)) {
      reported.add(key);
      console.log(`[DailyReport] ${h}:${m.toString().padStart(2,'0')} — Gửi báo cáo...`);
      await sendDailyReport(api, GROUP_ID);
    }
    // Dọn key cũ (chỉ giữ của ngày hôm nay)
    for (const k of reported) { if (!k.startsWith(`${d}-`)) reported.delete(k); }
  }, 30000); // kiểm tra mỗi 30 giây
}

async function fetchStats() {
  const url = process.env.SHEETS_URL + '?action=getStats';
  const res  = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  return JSON.parse(text);
}

async function sendDailyReport(api, groupId) {
  try {
    const stats = await fetchStats();
    const now   = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const days  = ['CN','T2','T3','T4','T5','T6','T7'];
    const dateStr = `${days[now.getDay()]}, ${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`;

    if (!stats.ok || !stats.total) {
      await api.sendMessage(
        { msg: `📊 BÁO CÁO SIDV — ${dateStr}\n⚠️ Chưa có dữ liệu. Mở tracker để cập nhật.` },
        groupId, ThreadType.Group
      );
      return;
    }

    const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2,'0')}`;
    const lines = [`📊 BÁO CÁO CONTAINER SIDV`, `📅 ${dateStr} — ${timeStr}`, ``];

    // Chi tiết từng session — chỉ hiển thị list CÒN CHƯA XONG
    const pending = (stats.sessions || []).filter(s => s.remaining > 0);
    if (pending.length > 0) {
      lines.push(`📋 Các list chưa kéo xong (${pending.length} list):`);
      pending.forEach(s => {
        const pct = s.total ? Math.round(s.done / s.total * 100) : 0;
        lines.push(`🔄 ${s.name}`);
        lines.push(`   ${s.done}/${s.total} cont — còn ${s.remaining} (${pct}%)`);
      });
      lines.push('');
    }

    lines.push(`✅ Đã kéo:  ${stats.done} cont`);
    lines.push(`🔄 Còn lại: ${stats.remaining} cont`);
    lines.push(`📦 Tổng:    ${stats.total} cont`);
    if (stats.updatedAt) lines.push(`🕐 ${stats.updatedAt}`);

    await api.sendMessage({ msg: lines.join('\n') }, groupId, ThreadType.Group);
    console.log('[DailyReport] ✅ Đã gửi báo cáo sáng');

  } catch (err) {
    console.error('[DailyReport] ❌ Lỗi:', err.message);
    try {
      await api.sendMessage(
        { msg: `⚠️ Lỗi đọc báo cáo SIDV: ${err.message}` },
        groupId, ThreadType.Group
      );
    } catch {}
  }
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
