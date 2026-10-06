// 學生名單解析：貼上的文字、CSV、Excel 的表格 → 判斷欄位 → 合併進學生名冊（和 iOS 版相同的規則）
import { trimmed, normalizeSeat, normalizeNumber } from '../format.js';
import { newRosterStudent } from '../model.js';

// MARK: CSV

/** 解析 CSV／TSV（支援引號、欄位內換行、"" 跳脫） */
export function parseCSV(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** 產生 CSV：UTF-8 加 BOM、CRLF 換行，Windows 版 Excel 打開中文才不會亂碼 */
export function encodeCSV(rows) {
  const quote = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return '﻿' + rows.map((r) => r.map((c) => quote(String(c ?? ''))).join(',')).join('\r\n') + '\r\n';
}

/** 讀文字檔：先試 UTF-8，再試 Windows 繁體中文 Excel 常用的 Big5 */
export function decodeText(bytes) {
  for (const enc of ['utf-8', 'big5', 'utf-16le']) {
    try {
      const s = new TextDecoder(enc, { fatal: true }).decode(bytes);
      return s.startsWith('﻿') ? s.slice(1) : s;
    } catch { /* 試下一個 */ }
  }
  return null;
}

// MARK: 表格

export const FIELD_TITLES = { className: '班級', seat: '座號', studentNo: '學號', name: '姓名', note: '備註', ignore: '略過' };

/** 把貼上的文字切成表格：有 Tab 用 Tab（從 Excel 複製），否則用逗號，都沒有就用空白 */
export function rowsFromText(text) {
  const t = text.replace(/\r\n?/g, '\n');
  let rows;
  if (t.includes('\t')) rows = parseCSV(t, '\t');
  else if (t.includes(',')) rows = parseCSV(t, ',');
  else if (t.includes('，')) rows = parseCSV(t, '，');
  else rows = t.split('\n').map((line) => line.split(/[ 　]+/).filter(Boolean));
  return cleanRows(rows);
}

/** 去掉空白列、每格去頭尾空白 */
export function cleanRows(rows) {
  return rows.map((r) => r.map((c) => trimmed(c))).filter((r) => r.some((c) => c));
}

export function headerField(text) {
  const t = trimmed(text).replace(/ /g, '').toLowerCase();
  if (!t) return null;
  if (['班級', '班级', '班別', '班别', '班', '班級名稱', 'class'].includes(t)) return 'className';
  if (['座號', '座号', '座次', '號次', '座'].includes(t) || t.startsWith('座號')) return 'seat';
  if (t.includes('學號') || t.includes('学号') || t === 'student id' || t === 'studentid') return 'studentNo';
  if (t.includes('姓名') || t === '名字' || t === '學生' || t === 'name') return 'name';
  if (t.includes('備註') || t.includes('备注') || t.includes('備考') || t === '說明' || t === '註記' || t === 'note') return 'note';
  return null;
}

/** 一張名單表格：rows、hasHeader、mapping（每一欄是哪個欄位） */
export function analyzeRoster(rawRows) {
  const rows = cleanRows(rawRows);
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (!width) return { rows: [], hasHeader: false, mapping: [] };
  const headerFields = rows[0].map(headerField);
  const recognized = headerFields.filter(Boolean);
  const hasHeader = recognized.includes('name') || new Set(recognized).size >= 2;
  let mapping = Array(width).fill('ignore');
  if (hasHeader) {
    const used = new Set();
    headerFields.forEach((f, i) => { if (f && !used.has(f)) { mapping[i] = f; used.add(f); } });
    if (!used.has('name')) mapping = guessMapping(rows.slice(1), width, used, mapping);
  } else {
    mapping = guessMapping(rows, width, new Set(), mapping);
  }
  return { rows, hasHeader, mapping };
}

const hasLetters = (s) => /\p{L}/u.test(s);
const isNumeric = (s) => /^\d+(\.\d+)?$/.test(normalizeSeat(s));

/** 依內容猜欄位：1～3 位數字是座號，4 位以上的數字或英數是學號，有文字的是姓名，姓名後面的是備註 */
function guessMapping(rows, width, used, fixed) {
  const mapping = [...fixed];
  const taken = new Set(used);
  const stats = [];
  for (let c = 0; c < width; c++) {
    const cells = rows.map((r) => r[c]).filter((v) => v);
    const n = cells.length;
    stats.push(n ? {
      filled: n,
      numeric: cells.filter(isNumeric).length / n,
      letters: cells.filter(hasLetters).length / n,
      maxLen: Math.max(...cells.map((v) => [...v].length)),
      avgLen: cells.reduce((t, v) => t + [...v].length, 0) / n,
    } : { filled: 0, numeric: 0, letters: 0, maxLen: 0, avgLen: 0 });
  }
  const free = (c) => mapping[c] === 'ignore' && stats[c].filled > 0;
  const cols = [...Array(width).keys()];
  if (width === 1 && !taken.has('name')) { mapping[0] = 'name'; return mapping; }
  const alnum = (c) => {
    const cells = rows.map((r) => r[c]).filter((v) => v);
    return cells.length > 0 && cells.every((v) => /^[A-Za-z0-9]+$/.test(v) && /\d/.test(v));
  };
  let col;
  if (!taken.has('seat') && (col = cols.find((c) => free(c) && stats[c].numeric >= 0.9 && stats[c].maxLen <= 3)) !== undefined) {
    mapping[col] = 'seat'; taken.add('seat');
  }
  if (!taken.has('studentNo') && (col = cols.find((c) => free(c) && stats[c].maxLen >= 4 && (stats[c].numeric >= 0.9 || alnum(c)))) !== undefined) {
    mapping[col] = 'studentNo'; taken.add('studentNo');
  }
  // 班級：有文字、而且同一個值重複很多次的欄
  if (!taken.has('className') && rows.length >= 3 && (col = cols.find((c) => {
    if (!free(c) || stats[c].letters < 0.6) return false;
    const values = rows.map((r) => r[c]).filter((v) => v);
    return values.length > 0 && new Set(values).size <= Math.max(1, Math.floor(values.length / 4));
  })) !== undefined) {
    mapping[col] = 'className'; taken.add('className');
  }
  let nameCol = null;
  if (!taken.has('name') && (col = cols.find((c) => free(c) && stats[c].letters >= 0.6 && stats[c].avgLen <= 12)) !== undefined) {
    mapping[col] = 'name'; taken.add('name'); nameCol = col;
  }
  if (!taken.has('note') && nameCol !== null) {
    const c = cols.find((x) => x > nameCol && free(x));
    if (c !== undefined) mapping[c] = 'note';
  }
  return mapping;
}

export const dataRows = (table) => (table.hasHeader ? table.rows.slice(1) : table.rows);

/** 表格 → 學生（座號、學號、姓名、備註、班級） */
export function tableStudents(table) {
  const col = (f) => { const i = table.mapping.indexOf(f); return i < 0 ? null : i; };
  const nameCol = col('name');
  if (nameCol === null) return [];
  const cell = (row, c) => (c === null || c >= row.length ? '' : trimmed(row[c]));
  return dataRows(table).map((row) => ({
    seat: normalizeSeat(cell(row, col('seat'))),
    studentNo: normalizeNumber(cell(row, col('studentNo'))),
    name: cell(row, nameCol),
    note: cell(row, col('note')),
    className: cell(row, col('className')),
  })).filter((s) => s.name);
}

/** 這一欄第一筆資料，用來提示老師這一欄是什麼 */
export function sampleOf(table, column) {
  for (const row of dataRows(table)) if (row[column]) return row[column];
  return '';
}

/** 標題列裡寫的班級名稱，例如點名表的標題列是「座號｜姓名｜化工二甲」 */
export function classNameHint(table) {
  if (!table.hasHeader || !table.rows.length) return null;
  for (const [i, cell] of table.rows[0].entries()) {
    const t = trimmed(cell);
    if (!t || (i < table.mapping.length && table.mapping[i] !== 'ignore')) continue;
    if (headerField(t) || Number.isFinite(Number(t)) || [...t].length < 2 || [...t].length > 12) continue;
    if (/[甲乙丙丁戊己庚辛壬癸班]/.test(t) || /[一二三四五六七八九十]年/.test(t)) return t;
  }
  return null;
}

// MARK: 合併進學生名冊

/**
 * 學號相同（或同班同名、原本沒學號）的更新資料，其餘新增。沒有班級的用 defaultClass；沒有座號的接在該班最後。
 * 直接修改 roster，回傳 { added, updated, unchanged, skipped }
 */
export function mergeIntoRoster(incoming, defaultClass, roster) {
  const result = { added: 0, updated: 0, unchanged: 0, skipped: 0 };
  const matched = new Set();
  for (const p of incoming) {
    const name = trimmed(p.name);
    if (!name) continue;
    const no = trimmed(p.studentNo);
    const cls = trimmed(p.className) || trimmed(defaultClass);
    let r = (no ? roster.find((x) => x.studentNo === no) : null)
      ?? roster.find((x) => !x.studentNo && x.name === name && x.className === cls);
    if (r) {
      if (matched.has(r.id)) { result.skipped++; continue; }
      const before = JSON.stringify(r);
      r.name = name;
      if (no) r.studentNo = no;
      if (cls) r.className = cls;
      const seat = normalizeSeat(p.seat);
      if (seat) r.seat = seat;
      matched.add(r.id);
      if (JSON.stringify(r) === before) result.unchanged++; else result.updated++;
    } else {
      let seat = normalizeSeat(p.seat);
      if (!seat) {
        const max = Math.max(0, ...roster.filter((x) => x.className === cls).map((x) => Number(x.seat)).filter(Number.isInteger));
        seat = String(max + 1);
      }
      r = newRosterStudent({ className: cls, seat, studentNo: no, name });
      roster.push(r);
      matched.add(r.id);
      result.added++;
    }
  }
  return result;
}

export function mergeSummary(r) {
  const parts = [];
  if (r.added) parts.push(`新增 ${r.added} 人`);
  if (r.updated) parts.push(`更新 ${r.updated} 人`);
  if (r.unchanged) parts.push(`${r.unchanged} 人資料相同`);
  if (r.skipped) parts.push(`略過 ${r.skipped} 筆重複`);
  return parts.length ? parts.join('、') : '沒有變更';
}
