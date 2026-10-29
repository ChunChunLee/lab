// 從 Excel 匯入分組：「大組｜小組｜學號｜姓名」（和 iOS 版相同的規則）
// 大組可以沒有；學號和姓名至少要有一個（沒有學號就用姓名比對，同名時再看班級、座號）。
// 也看得懂 App 匯出的分組名單（「組別」「身分」欄）。
import { trimmed, normalizeSeat, normalizeNumber } from '../format.js';
import { headerField as rosterHeaderField } from './rosterParser.js';
import { naturalCompare } from '../model.js';

const noSpace = (s) => String(s).replace(/\s/g, '');

export function fieldForHeader(text) {
  const t = noSpace(text).toLowerCase();
  if (!t) return null;
  if (t.includes('大組')) return 'section';
  if (t.includes('小組') || ['組別', '組', '組號', '組名', '分組', 'group'].includes(t)) return 'group';
  if (['身分', '身份', '組長', '職務', '角色'].includes(t)) return 'role';
  const f = rosterHeaderField(t);
  return ['studentNo', 'name', 'className', 'seat'].includes(f) ? f : null;
}

/** 在前幾列找欄位名稱：要有組別（大組或小組），以及學號或姓名 */
export function findHeader(rows) {
  for (const [r, row] of rows.slice(0, 10).entries()) {
    const columns = {};
    row.forEach((cell, c) => { const f = fieldForHeader(cell); if (f && columns[f] === undefined) columns[f] = c; });
    const hasGroup = columns.group !== undefined || columns.section !== undefined;
    const hasStudent = columns.name !== undefined || columns.studentNo !== undefined;
    if (hasGroup && hasStudent) return { row: r, columns };
  }
  return null;
}

const isUngrouped = (t) => ['未分組', '無', '-', '－', '—'].includes(t);

/** 大組：「A」→「A大組」、「1」→「第1大組」；其他照用 */
export function sectionNameFrom(raw) {
  const t = trimmed(raw);
  if (!t || isUngrouped(t)) return null;
  if (/^\d+$/.test(t)) return `第${Number(t)}大組`;
  if ([...t].length === 1) return t.toUpperCase() + '大組';
  return t;
}

/** 小組：「1」→「第1組」、「A」→「A組」；寫成「A大組第1組」的去掉大組；其他照用 */
export function groupNameFrom(raw, section) {
  let t = trimmed(raw);
  if (!t || isUngrouped(t)) return null;
  if (section && t.startsWith(section) && t.length > section.length) t = trimmed(t.slice(section.length));
  if (/^\d+$/.test(t)) return `第${Number(t)}組`;
  if ([...t].length === 1) return t.toUpperCase() + '組';
  return t;
}

/** 先比學號；對不到再比姓名（同名的用班級、座號分辨）。回傳 { student } 或 { error: 'notFound' | 'ambiguous', count } */
export function matchStudent({ studentNo, name, className, seat }, students) {
  if (studentNo) {
    const s = students.find((x) => x.studentNo === studentNo);
    if (s) return { student: s };
  }
  const key = noSpace(name ?? '');
  if (!key) return { error: 'notFound' };
  let candidates = students.filter((x) => noSpace(x.name) === key);
  if (candidates.length > 1 && className) {
    const same = candidates.filter((x) => x.className && (x.className.endsWith(className) || className.endsWith(x.className)));
    if (same.length) candidates = same;
  }
  if (candidates.length > 1 && seat) {
    const same = candidates.filter((x) => x.seat === normalizeSeat(seat));
    if (same.length) candidates = same;
  }
  if (candidates.length === 1) return { student: candidates[0] };
  if (!candidates.length) return { error: 'notFound' };
  return { error: 'ambiguous', count: candidates.length };
}

export const FAILURES = {
  noHeader: '找不到欄位名稱。第一列要寫「大組、小組、學號、姓名」（至少要有「小組」，以及「學號」或「姓名」）。',
  noStudents: '檔案裡沒有學生資料。',
};

/** 有好幾張工作表時，用第一張看得懂的。回傳 { plan } 或 { error } */
export function planFromSheets(sheets, students) {
  let failure = null;
  for (const sheet of sheets) {
    const r = planGroups(sheet.rows, students);
    if (r.plan) { r.plan.sheetName = sheet.name; return r; }
    if (!failure || r.error === 'noStudents') failure = r.error;
  }
  return { error: failure ?? 'noHeader' };
}

/**
 * 整理成分組：{ groups: [{ section, name, memberIDs, leaderID }], problems: [{ row, who, reason }], ungroupedCount }
 */
export function planGroups(rows, students) {
  const header = findHeader(rows);
  if (!header) return { error: 'noHeader' };
  const { columns } = header;
  const leaderColumnIsFlag = columns.role !== undefined && String(rows[header.row][columns.role]).includes('組長');
  const groups = [];
  const problems = [];
  let ungrouped = 0;
  const seen = new Map();
  let dataRows = 0;

  for (let r = header.row + 1; r < rows.length; r++) {
    const row = rows[r];
    const cell = (f) => (columns[f] === undefined || columns[f] >= row.length ? '' : trimmed(row[columns[f]]));
    const no = normalizeNumber(cell('studentNo'));
    const name = cell('name');
    if (!no && !name) continue;
    // 標題佔兩列以上（合併儲存格）時，下一列還是欄位名稱
    if (fieldForHeader(name) || fieldForHeader(no)) continue;
    dataRows++;
    const who = [no, name].filter(Boolean).join(' ');
    const m = matchStudent({ studentNo: no, name, className: cell('className'), seat: cell('seat') }, students);
    if (m.error === 'notFound') { problems.push({ row: r + 1, who, reason: '這個科目的名冊裡找不到這位學生' }); continue; }
    if (m.error === 'ambiguous') { problems.push({ row: r + 1, who, reason: `名冊裡有 ${m.count} 位同名的學生，請加上學號或班級` }); continue; }
    const student = m.student;
    if (seen.has(student.id)) { problems.push({ row: r + 1, who, reason: `和第 ${seen.get(student.id)} 列重複，只算第一次` }); continue; }
    seen.set(student.id, r + 1);

    let section = sectionNameFrom(cell('section'));
    let group = groupNameFrom(cell('group'), section);
    // 檔案只有大組欄、沒有小組欄：整個大組當一組
    if (!group && section && columns.group === undefined) { group = section; section = null; }
    if (!group) { ungrouped++; continue; }
    const role = cell('role');
    const isLeader = role.includes('組長')
      || (leaderColumnIsFlag && ['v', '✓', '✔', '★', '☆', '○', 'o', '是', 'y', 'yes', '1'].includes(role.toLowerCase()));
    let g = groups.find((x) => x.section === section && x.name === group);
    if (!g) { g = { section, name: group, memberIDs: [], leaderID: null }; groups.push(g); }
    g.memberIDs.push(student.id);
    if (isLeader && !g.leaderID) g.leaderID = student.id;
  }
  if (!dataRows) return { error: 'noStudents' };
  // 依大組、小組排序，不分大組的排前面
  groups.sort((a, b) => {
    if (a.section !== b.section) {
      if (!a.section) return -1;
      if (!b.section) return 1;
      return naturalCompare(a.section, b.section);
    }
    return naturalCompare(a.name, b.name);
  });
  const sections = [];
  for (const g of groups) if (g.section && !sections.includes(g.section)) sections.push(g.section);
  return {
    plan: {
      sheetName: '', groups, problems, ungroupedCount: ungrouped, sections,
      matchedCount: groups.reduce((n, g) => n + g.memberIDs.length, 0),
    },
  };
}
