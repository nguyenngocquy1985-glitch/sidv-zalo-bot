/**
 * parser.js — Đọc file Excel bảng kê hãng tàu
 * Hỗ trợ: ZIM (sheet SIDV), HPL (sheet UnitFacilityVisit...), và file chung
 */

const XLSX = require('xlsx');

const CONT_RE = /\b([A-Z]{4}[0-9]{6,7})\b/g;
const ISO_20  = /^(2[02][0-9]{2}|22[A-Z0-9]{2})$/i;
const ISO_40  = /^(4[24-9][0-9]{2}|45[A-Z0-9]{2})$/i;

/**
 * Nhận Buffer của file xlsx/xls → trả về { sessionName, containers[] }
 * containers[i] = { no, container, type, loc, note }
 */
function parseExcelBuffer(buffer, fileName) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sessionName = fileName.replace(/\.(xlsx|xls)$/i, '');

  // Thử sheet theo thứ tự ưu tiên: SIDV → sheet đầu tiên có cont
  let parsed = tryParseSIDVSheet(workbook, sessionName)
    || tryParseHPLSheet(workbook, sessionName)
    || tryParseGeneric(workbook, sessionName);

  return parsed || { sessionName, containers: [] };
}

/* ──── ZIM format: sheet "SIDV", cột B=Container, D=ISO, E=LOC, H=NOTE ──── */
function tryParseSIDVSheet(wb, sessionName) {
  const sheet = wb.Sheets['SIDV'] || wb.Sheets['sidv'];
  if (!sheet) return null;

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const containers = [];
  let no = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const contRaw = String(row[1] || '').trim().toUpperCase(); // col B (index 1)
    const iso     = String(row[3] || '').trim();               // col D
    const loc     = String(row[4] || '').trim();               // col E
    const note    = String(row[7] || '').trim();               // col H

    const m = contRaw.match(/([A-Z]{4}[0-9]{6,7})/);
    if (!m) continue;

    containers.push({
      no: ++no,
      container: m[1],
      type: ISO_20.test(iso) ? '20' : ISO_40.test(iso) ? '40' : '',
      loc, note,
    });
  }

  return containers.length ? { sessionName, containers } : null;
}

/* ──── HPL format: sheet UnitFacilityVisit..., cột C=ContNo, D=ISO, K=Pos, U=Grp ──── */
function tryParseHPLSheet(wb, sessionName) {
  // Tìm sheet chứa "UnitFacility" hoặc "unit"
  const sheetName = wb.SheetNames.find(n => /unit|facility/i.test(n));
  if (!sheetName) return null;

  const sheet = wb.Sheets[sheetName];
  const rows  = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const containers = [];
  let no = 0;

  // Tìm header row
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const r = rows[i].map(c => String(c).trim().toUpperCase());
    if (r.some(c => c.includes('UNIT') || c.includes('CONT'))) { headerIdx = i; break; }
  }

  const header = rows[headerIdx].map(c => String(c).trim().toUpperCase());
  const cUnit  = header.findIndex(c => /unit.nbr|container/i.test(c));
  const cIso   = header.findIndex(c => /type.iso|iso/i.test(c));
  const cPos   = header.findIndex(c => /position/i.test(c));
  const cGrp   = header.findIndex(c => /grp|group/i.test(c));

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row  = rows[i];
    // Lọc chỉ Grp = SITC
    if (cGrp >= 0 && String(row[cGrp] || '').trim().toUpperCase() !== 'SITC') continue;

    const contRaw = String(row[cUnit] || '').trim().toUpperCase();
    const m = contRaw.match(/([A-Z]{4}[0-9]{6,7})/);
    if (!m) continue;

    const iso = String(row[cIso] >= 0 ? row[cIso] : '').trim();
    const loc = String(row[cPos] >= 0 ? row[cPos] : '').trim();

    containers.push({
      no: ++no,
      container: m[1],
      type: ISO_20.test(iso) ? '20' : ISO_40.test(iso) ? '40' : '',
      loc, note: '',
    });
  }

  return containers.length ? { sessionName, containers } : null;
}

/* ──── Fallback: quét tất cả sheet, regex tìm container ──── */
function tryParseGeneric(wb, sessionName) {
  const containers = [];
  const seen = new Set();
  let no = 0;

  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    for (const row of rows) {
      for (const cell of row) {
        const text = String(cell).toUpperCase();
        let m;
        CONT_RE.lastIndex = 0;
        while ((m = CONT_RE.exec(text)) !== null) {
          if (!seen.has(m[1])) {
            seen.add(m[1]);
            containers.push({ no: ++no, container: m[1], type: '', loc: '', note: '' });
          }
        }
      }
    }
  }

  return containers.length ? { sessionName, containers } : null;
}

module.exports = { parseExcelBuffer };
