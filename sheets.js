/**
 * sheets.js — Gửi bảng kê lên Google Apps Script (bridge tới Google Sheets)
 */

const fetch = require('node-fetch');

const SHEETS_URL = process.env.SHEETS_URL;

/**
 * Ghi một session (bảng kê) vào sheet "Sessions_Pending" trên Google Sheets
 */
async function addSessionToSheets({ sessionName, containers, timestamp }) {
  if (!SHEETS_URL) throw new Error('Chưa cấu hình SHEETS_URL trong .env');

  const body = JSON.stringify({
    action: 'addSession',
    sessionName,
    containers,   // [{ no, container, type, loc, note }, ...]
    timestamp: timestamp || new Date().toLocaleString('vi-VN'),
  });

  const res = await fetch(SHEETS_URL, {
    method: 'POST',
    body,
    redirect: 'follow',
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { ok: false, error: text }; }

  if (!json.ok) throw new Error('Apps Script lỗi: ' + json.error);
  return json;
}

module.exports = { addSessionToSheets };
