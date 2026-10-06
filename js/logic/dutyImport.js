// 匯入打掃工作（和 iOS 版相同的規則）：
// - 文字框：每一行是一項打掃工作，「名稱：說明」冒號後面當說明。
// - Excel：「打掃工作｜說明｜學號｜學號…」，學號可以分好幾格，或在一格裡用「、」隔開；沒有學號也可以寫姓名。
//   學生依「分組」目前使用的方案分到各自的大組，每個大組都會有一份完整的打掃工作清單。
import { trimmed, normalizeNumber } from '../format.js';
import { activeGroupSet, groupSections, dutySectionByStudent, sortedStudents } from '../model.js';

/** 每一行一項；去掉開頭的編號或符號，「名稱：說明」拆成說明，重複的只留第一個 */
export function jobsFromText(text) {
  const result = [];
  for (const raw of String(text).split(/\r?\n|\r/)) {
    let line = trimmed(raw).replace(/^(\d{1,2}\s*[.、．)）]|[-•・·*＊●○])\s*/, '');
    if (!line) continue;
    let job = { name: line, note: '' };
    const sep = line.search(/[：:\t]/);
    if (sep >= 0) {
      const name = trimmed(line.slice(0, sep));
      if (name) job = { name, note: trimmed(line.slice(sep + 1)) };
    }
    if (!result.some((j) => j.name === job.name)) result.push(job);
  }
  return result;
}

export function fieldForHeader(text) {
  const t = String(text).replace(/\s/g, '').toLowerCase();
  if (!t) return null;
  if (['學號', '學生', '姓名', '負責', '組員', '人員', '座號'].some((k) => t.includes(k))) return 'student';
  if (['工作', '項目', '名稱', '職務', '區域', '掃區', '區域／項目', '區域/項目', '工作項目', '工作名稱'].includes(t)
    || (t.startsWith('打掃') && [...t].length <= 4)) return 'job';
  if (['說明', '備註', '內容', '注意事項'].includes(t)) return 'note';
  return null;
}

/** 在前幾列找欄位名稱：要有打掃工作那一欄。學生欄是寫著學號、學生、姓名的欄，以及接在學生欄後面、沒有寫欄名的欄 */
export function findHeader(rows) {
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (const [r, row] of rows.slice(0, 10).entries()) {
    const fields = row.map(fieldForHeader);
    const job = fields.indexOf('job');
    if (job < 0) continue;
    const noteIndex = fields.indexOf('note');
    const note = noteIndex < 0 ? null : noteIndex;
    const students = [];
    for (let c = 0; c < width; c++) {
      if (c === job || c === note) continue;
      const f = c < fields.length ? fields[c] : null;
      if (f === 'student' || (!f && students.length && (c >= row.length || !trimmed(row[c])))) students.push(c);
    }
    return { row: r, job, note, students };
  }
  return null;
}

/** 一個學生代號：4 位數以上是學號、1～3 位數是座號，其他當姓名 */
export function matchToken(token, students) {
  const t = normalizeNumber(trimmed(token));
  const digits = /^\d+$/.test(t);
  let candidates;
  if (digits && t.length >= 4) candidates = students.filter((s) => s.studentNo === t);
  else if (digits) candidates = students.filter((s) => /^\d+$/.test(s.seat) && Number(s.seat) === Number(t));
  else { const key = t.replace(/\s/g, ''); candidates = students.filter((s) => s.name.replace(/\s/g, '') === key); }
  if (candidates.length === 1) return { student: candidates[0] };
  if (!candidates.length) return { error: 'notFound' };
  return { error: 'ambiguous', count: candidates.length };
}

/** 一格裡的學生：用「、」「,」「/」、換行分開；「01 王小明」這種有姓名的就不看座號 */
export function tokensInCell(cell) {
  const result = [];
  for (const piece of String(cell).split(/[、,，;；/／\n]/)) {
    const parts = piece.split(/\s+/).filter(Boolean);
    const names = parts.filter((p) => !(p.length <= 3 && /^\d+$/.test(p)));
    result.push(...(names.length ? names : parts));
  }
  return result.filter(Boolean);
}

export const FAILURE = '檔案裡沒有打掃工作。第一欄寫打掃工作的名稱，例如「實驗桌」「水槽」。';

/** 先找有「打掃工作」欄名的工作表，都沒有才用第一張有內容的。回傳 { plan } 或 { error } */
export function planFromSheets(sheets, subject) {
  const ordered = [...sheets.filter((s) => findHeader(s.rows)), ...sheets.filter((s) => !findHeader(s.rows))];
  for (const sheet of ordered) {
    const r = planDuties(sheet.rows, subject);
    if (r.plan) { r.plan.sheetName = sheet.name; return r; }
  }
  return { error: FAILURE };
}

/**
 * { jobs: [{name, note}], sections: [String|null], items: [{section, name, note, studentIDs}], problems, assignedCount }
 */
export function planDuties(rows, subject) {
  const h = findHeader(rows) ?? { row: -1, job: 0, note: 1, students: [] };
  const students = subject.students;
  const sectionOf = dutySectionByStudent(subject);
  const setSections = groupSections(activeGroupSet(subject));
  const sectioned = setSections.length > 0;
  const jobs = [];
  const assigned = new Map(); // 大組（'' 代表不分大組）→ 工作 → 學生
  const problems = [];

  for (let r = h.row + 1; r < rows.length; r++) {
    const row = rows[r];
    const cell = (c) => (c === null || c === undefined || c >= row.length ? '' : trimmed(row[c]));
    const name = cell(h.job);
    // 空白列、合併儲存格讓欄名多佔一列，或 App 匯出的「尚未分配」列
    if (!name || name === '尚未分配' || (h.row >= 0 && name === trimmed(rows[h.row][h.job]))) continue;
    const existing = jobs.find((j) => j.name === name);
    if (existing) { if (!existing.note) existing.note = cell(h.note); } else jobs.push({ name, note: cell(h.note) });

    for (const c of h.students) {
      for (const token of tokensInCell(cell(c))) {
        const m = matchToken(token, students);
        if (m.error === 'notFound') { problems.push({ row: r + 1, who: token, reason: `「${name}」：這個科目的名冊裡找不到` }); continue; }
        if (m.error === 'ambiguous') { problems.push({ row: r + 1, who: token, reason: `「${name}」：有 ${m.count} 位學生符合，請改填學號` }); continue; }
        let key = '';
        if (sectioned) {
          const sec = sectionOf.get(m.student.id);
          if (!sec) { problems.push({ row: r + 1, who: m.student.name, reason: `「${name}」：還沒分到大組，請先到「分組」把他分進大組` }); continue; }
          key = sec;
        }
        if (!assigned.has(key)) assigned.set(key, new Map());
        const byJob = assigned.get(key);
        if (!byJob.has(name)) byJob.set(name, []);
        const list = byJob.get(name);
        if (!list.includes(m.student.id)) list.push(m.student.id);
      }
    }
  }
  if (!jobs.length) return { error: FAILURE };

  // 每個大組都有完整的工作清單
  const sections = sectioned ? setSections : [null];
  const order = sortedStudents(subject).map((s) => s.id);
  const items = [];
  for (const section of sections) {
    for (const job of jobs) {
      const ids = new Set(assigned.get(section ?? '')?.get(job.name) ?? []);
      items.push({ section, name: job.name, note: job.note, studentIDs: order.filter((id) => ids.has(id)) });
    }
  }
  return {
    plan: { sheetName: '', jobs, sections, items, problems, assignedCount: new Set(items.flatMap((i) => i.studentIDs)).size },
  };
}
