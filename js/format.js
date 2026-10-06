// 數字、日期與分數的顯示格式（和 iOS 版的 Fmt 相同）

export function trimmed(s) {
  return String(s ?? '').trim();
}

/** 全形英數字轉半形 */
export function toHalfWidth(s) {
  return String(s).replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
}

/** 四捨五入到指定小數位（加一點點容差，避免 83.55 變成 83.5499… 而捨去） */
export function round(v, decimals) {
  const p = 10 ** Math.max(0, decimals);
  const x = v * p;
  const adj = x + (x >= 0 ? 1e-9 : -1e-9);
  return (adj >= 0 ? Math.floor(adj + 0.5) : -Math.floor(-adj + 0.5)) / p;
}

/** 固定小數位數，例如 83.6、85.0 */
export function fixed(v, decimals) {
  return round(v, decimals).toFixed(Math.max(0, decimals));
}

/** 分數：最多兩位小數，去掉多餘的 0，例如 88、87.5 */
export function score(v) {
  const r = round(v, 2);
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** 一格成績的文字：數字、「缺」、「免」或空白 */
export function scoreText(v) {
  if (v === undefined || v === null) return '';
  if (v === '缺' || v === '免') return v;
  return score(v);
}

// 開著注音鍵盤用實體鍵盤打數字時會打出這些符號，換回數字
const zhuyinKeys = {
  'ㄅ': '1', 'ㄉ': '2', 'ˇ': '3', 'ˋ': '4', 'ㄓ': '5', 'ˊ': '6', '˙': '7', 'ㄚ': '8', 'ㄞ': '9', 'ㄢ': '0', 'ㄡ': '.', 'ㄦ': '-',
};

/**
 * 解析老師輸入的分數。「缺」或 x 是缺交，「免」或 - 是免計，空白是未輸入。
 * 回傳 { kind: 'blank' } / { kind: 'value', value } / { kind: 'invalid' }
 */
export function parseScore(raw) {
  let t = trimmed(raw);
  t = [...t].map((c) => zhuyinKeys[c] ?? c).join('');
  t = toHalfWidth(t).trim();
  if (!t) return { kind: 'blank' };
  const lower = t.toLowerCase();
  if (['缺', '缺交', 'x'].includes(lower)) return { kind: 'value', value: '缺' };
  if (['免', '免計', '-'].includes(lower)) return { kind: 'value', value: '免' };
  if (/^\d+(\.\d+)?$|^\.\d+$/.test(t)) {
    const d = Number(t);
    if (Number.isFinite(d) && d >= 0) return { kind: 'value', value: d };
  }
  return { kind: 'invalid' };
}

const pad = (n) => String(n).padStart(2, '0');

export function toDate(d) {
  return d instanceof Date ? d : new Date(d);
}

/** 「10/4」 */
export function shortDate(d) {
  d = toDate(d);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 「2026/10/4」 */
export function fullDate(d) {
  d = toDate(d);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

/** 「2026-10-04」（檔名、日期輸入框用） */
export function fileDate(d) {
  d = toDate(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 「2026-10-04」轉成當天 0 點（本地時間） */
export function parseFileDate(s) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed(s));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function stamp(d) {
  d = toDate(d);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 「2026/10/4 09:30」 */
export function dateTime(d) {
  d = toDate(d);
  return `${fullDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const weekdays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

/** 「2026/10/4（週日）」 */
export function dayWithWeekday(d) {
  d = toDate(d);
  return `${fullDate(d)}（${weekdays[d.getDay()]}）`;
}

export function startOfDay(d) {
  d = toDate(d);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function isSameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

export function addDays(d, n) {
  const x = toDate(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate() + n, x.getHours(), x.getMinutes(), x.getSeconds());
}

/** 「今天」「昨天」「3 天前」 */
export function daysAgo(d, now = new Date()) {
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days < 1) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
}

export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${round(bytes / 1024, 1)} KB`;
  return `${round(bytes / 1024 / 1024, 1)} MB`;
}

/** 檔名不能有的字元換成底線 */
export function safeFileName(s) {
  const c = trimmed(String(s).replace(/[/\\:*?"<>|]/g, '_'));
  return c || '未命名';
}

/** 座號：「1.0」、「01」、全形「１」統一成「1」；不是數字的保持原樣 */
export function normalizeSeat(raw) {
  const t = trimmed(raw);
  const half = toHalfWidth(t).trim();
  if (/^\d+(\.0+)?$/.test(half)) {
    const d = Number(half);
    if (d >= 0 && d < 100000) return String(Math.trunc(d));
  }
  return t;
}

/** 顯示用座號：個位數補 0，例如「05」 */
export function displaySeat(seat) {
  if (/^\d$/.test(seat)) return `0${seat}`;
  return seat;
}

/** Excel 把學號存成數字時可能變成「11001.0」或「1.1001E+4」，轉回整數文字 */
export function normalizeNumber(s) {
  const t = trimmed(s);
  if (!(t.includes('.') || /e/i.test(t))) return t;
  if (!/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(t)) return t;
  const d = Number(t);
  if (!Number.isFinite(d) || Math.round(d) !== d || Math.abs(d) >= 1e15) return t;
  return String(d);
}

export function escapeHTML(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
