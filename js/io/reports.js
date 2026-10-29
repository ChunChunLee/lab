// 報表：同一份表格定義同時產生 Excel 工作表、CSV 和列印用的 HTML（和 iOS 版相同的內容）
import { round, fixed, score, fullDate, shortDate, displaySeat, escapeHTML } from '../format.js';
import {
  sortedStudents, categoryOf, getScore, weightTotal, weightsAreValid, hasMultipleClasses, studentsByID,
  groupSections, hasSections, orderedMembers, unassignedStudents, dutySections, dutiesIn, studentsInSection,
  activeGroupSet, dutyCheckDays, checkResult, sortBySeat, defaultDuties,
} from '../model.js';
import { gradeReport, CATEGORY_MODES } from '../logic/grades.js';
import { STYLE } from './xlsx.js';

// MARK: 儲存格

export const cell = {
  text: (text, style = 'normal') => ({ text: text ?? '', number: null, style }),
  number: (v, decimals, style = 'normal') => (v === null || v === undefined
    ? { text: '', number: null, style }
    : { text: fixed(v, decimals), number: round(v, decimals), style }),
  score: (v, style = 'normal') => ({ text: score(v), number: round(v, 2), style }),
  count: (n) => ({ text: String(n), number: n, style: 'normal' }),
  empty: { text: '', number: null, style: 'normal' },
};

const col = (title, width, opts = {}) => ({ title, width, subtitle: opts.subtitle ?? null, numeric: !!opts.numeric });

/** 一張表：{ title, sheetName, columns, rows, footerRows, freezeColumns, landscape, notes } */
function table(t) {
  return { footerRows: [], freezeColumns: 0, landscape: false, notes: [], ...t };
}

const people = (list) => list.map((s) => `${displaySeat(s.seat)} ${s.name}`).join('、');

// MARK: 各分頁的報表

export function rosterReport(subject) {
  const showClass = hasMultipleClasses(subject);
  const rows = sortedStudents(subject).map((s) =>
    [...(showClass ? [cell.text(s.className)] : []), cell.text(displaySeat(s.seat)), cell.text(s.studentNo), cell.text(s.name), cell.text(s.note)]);
  const columns = [...(showClass ? [col('班級', 12)] : []), col('座號', 7), col('學號', 13), col('姓名', 12), col('備註', 36)];
  return table({ title: `${subject.name} 學生名冊`, sheetName: '名冊', columns, rows, notes: [`共 ${subject.students.length} 人`] });
}

/** 成績表。filter 有值時只列出該類別的項目和小計（列印用）。回傳 [成績, 項目, 配分] */
export function gradeReports(subject, filter = null) {
  const report = gradeReport(subject);
  const settings = subject.gradeSettings;
  const items = report.items.filter((it) => !filter || it.categoryID === filter);
  const categories = report.categoriesInUse.filter((c) => !filter || c.id === filter);

  const columns = [col('座號', 6), col('學號', 11), col('姓名', 10)];
  for (const it of items) {
    const cat = categoryOf(subject, it.categoryID)?.name ?? '未分類';
    columns.push(col(it.name, 12, { subtitle: `${cat}·${shortDate(it.date)}·滿分${score(it.fullScore)}`, numeric: true }));
  }
  for (const c of categories) columns.push(col(`${c.name}小計`, 10, { subtitle: `配分 ${score(c.weight)}%`, numeric: true }));
  columns.push(col('總成績', 9, { numeric: true }));

  const rows = report.students.map((s) => {
    const row = [cell.text(displaySeat(s.seat)), cell.text(s.studentNo), cell.text(s.name)];
    for (const it of items) {
      const v = getScore(subject, it.id, s.id);
      if (typeof v === 'number') row.push(cell.score(v, report.isFailingPoints(v, it.fullScore) ? 'fail' : 'normal'));
      else if (v === '缺') row.push(cell.text('缺', 'missing'));
      else if (v === '免') row.push(cell.text('免', 'excused'));
      else row.push(cell.text('', 'blank'));
    }
    for (const c of categories) {
      const v = report.categoryScore(s.id, c.id);
      row.push(cell.number(v, 1, report.isFailing(v) ? 'fail' : 'normal'));
    }
    const total = report.total(s.id);
    row.push(cell.number(total, settings.totalDecimals, report.isFailing(total) ? 'fail' : 'emphasis'));
    return row;
  });

  const statRow = (title, itemCell, valueCell) => [
    cell.empty, cell.empty, cell.text(title),
    ...items.map((it) => itemCell(report.itemStats.get(it.id))),
    ...categories.map((c) => valueCell(report.categoryStats.get(c.id), 1)),
    valueCell(report.totalStats, settings.totalDecimals),
  ];
  const maybeScore = (v) => (v === null ? cell.empty : cell.score(v));
  const footerRows = [
    statRow('平均', (s) => cell.number(s.average, 1), (s) => cell.number(s.average, 1)),
    statRow('最高', (s) => maybeScore(s.maximum), (s, d) => cell.number(s.maximum, d)),
    statRow('最低', (s) => maybeScore(s.minimum), (s, d) => cell.number(s.minimum, d)),
    statRow('缺交人數', (s) => cell.count(s.missing), () => cell.empty),
    statRow('未輸入人數', (s) => cell.count(s.blank), () => cell.empty),
  ];

  const weightNote = subject.categories.map((c) => `${c.name} ${score(c.weight)}%`).join('、');
  const notes = [`配分：${weightNote}（合計 ${score(weightTotal(subject))}%）`];
  if (!weightsAreValid(subject)) notes.push('注意：配分合計不等於 100%，總成績依現有比例換算。');
  if (filter) { const c = categoryOf(subject, filter); if (c) notes.push(`只列出「${c.name}」類別的項目。`); }
  notes.push(`計算方式：${CATEGORY_MODES[settings.categoryMode].title}；缺交以 0 分計，免計不列入；未輸入${settings.blankAsZero ? '以 0 分計' : '不列入計算'}。`);

  const main = table({ title: `${subject.name} 成績表`, sheetName: '成績', columns, rows, footerRows, freezeColumns: 3, landscape: true, notes });

  const itemRows = items.map((it) => {
    const st = report.itemStats.get(it.id);
    return [cell.text(it.name), cell.text(categoryOf(subject, it.categoryID)?.name ?? '未分類'), cell.text(fullDate(it.date)),
      cell.score(it.fullScore), cell.number(st.average, 1), maybeScore(st.maximum), maybeScore(st.minimum),
      cell.count(st.entered), cell.count(st.missing), cell.count(st.excused), cell.count(st.blank)];
  });
  const itemTable = table({
    title: `${subject.name} 成績項目`, sheetName: '項目', rows: itemRows,
    columns: [col('項目', 22), col('類別', 10), col('日期', 11), col('滿分', 7, { numeric: true }), col('平均', 8, { numeric: true }),
      col('最高', 7, { numeric: true }), col('最低', 7, { numeric: true }), col('已登錄', 8, { numeric: true }),
      col('缺交', 7, { numeric: true }), col('免計', 7, { numeric: true }), col('未輸入', 8, { numeric: true })],
  });
  const weightRows = subject.categories.map((c) => [cell.text(c.name), cell.score(c.weight), cell.count(items.filter((i) => i.categoryID === c.id).length)]);
  weightRows.push([cell.text('合計', 'emphasis'), cell.score(weightTotal(subject), weightsAreValid(subject) ? 'emphasis' : 'fail'), cell.count(items.length)]);
  const weightTable = table({
    title: `${subject.name} 配分`, sheetName: '配分', rows: weightRows,
    columns: [col('類別', 14), col('配分（%）', 10, { numeric: true }), col('項目數', 8, { numeric: true })],
  });
  return [main, itemTable, weightTable];
}

export function groupsReport(subject, set) {
  const byID = studentsByID(subject);
  const sectioned = hasSections(set);
  const rows = [];
  for (const g of set.groups) {
    for (const s of orderedMembers(g, byID)) {
      const leader = s.id === g.leaderID;
      rows.push([...(sectioned ? [cell.text(g.section ?? '')] : []), cell.text(g.name), cell.text(leader ? '組長' : '組員', leader ? 'emphasis' : 'normal'),
        cell.text(displaySeat(s.seat)), cell.text(s.studentNo), cell.text(s.name)]);
    }
  }
  for (const s of unassignedStudents(subject, set)) {
    rows.push([...(sectioned ? [cell.text('')] : []), cell.text('未分組'), cell.text(''), cell.text(displaySeat(s.seat)), cell.text(s.studentNo), cell.text(s.name)]);
  }
  const columns = [...(sectioned ? [col('大組', 9)] : []), col('組別', 10), col('身分', 7), col('座號', 7), col('學號', 13), col('姓名', 12)];
  const note = sectioned ? `共 ${groupSections(set).length} 個大組、${set.groups.length} 組` : `共 ${set.groups.length} 組`;
  return table({ title: `${subject.name} 分組名單（${set.name}）`, sheetName: '分組', columns, rows, notes: [note] });
}

/** 分組匯入範本：「大組｜小組｜學號｜姓名」（好幾班時加上班級），已經分好的先填上 */
export function groupTemplateReport(subject, set) {
  const groupOf = new Map();
  for (const g of set?.groups ?? []) for (const m of g.memberIDs) groupOf.set(m, g);
  const showClass = hasMultipleClasses(subject);
  const rows = sortedStudents(subject).map((s) => {
    const g = groupOf.get(s.id);
    return [cell.text(g?.section ?? ''), cell.text(g?.name ?? ''), cell.text(s.studentNo), cell.text(s.name), ...(showClass ? [cell.text(s.className)] : [])];
  });
  const columns = [col('大組', 9), col('小組', 9), col('學號', 13), col('姓名', 12), ...(showClass ? [col('班級', 12)] : [])];
  return table({ title: `${subject.name} 分組匯入範本`, sheetName: '分組', columns, rows });
}

/** 打掃工作分配。有分大組時每個大組各列一段，各自有「尚未分配」 */
export function dutiesReport(subject) {
  const byID = studentsByID(subject);
  const sections = dutySections(subject);
  const sectioned = sections.length > 0;
  const tabs = sectioned ? [...sections, ...(dutiesIn(subject, null).length ? [null] : [])] : [null];
  const rows = [];
  for (const section of tabs) {
    const lead = sectioned ? [cell.text(section ?? '不分大組', 'emphasis')] : [];
    const duties = dutiesIn(subject, section);
    for (const d of duties) {
      const list = sortBySeat(d.studentIDs.map((id) => byID.get(id)).filter(Boolean));
      rows.push([...lead, cell.text(d.name, 'emphasis'), cell.text(people(list)), cell.count(list.length), cell.text(d.note)]);
    }
    const assigned = new Set(duties.flatMap((d) => d.studentIDs));
    const rest = (section === null && sectioned ? [] : studentsInSection(subject, section)).filter((s) => !assigned.has(s.id));
    if (rest.length) rows.push([...lead, cell.text('尚未分配', 'fail'), cell.text(people(rest)), cell.count(rest.length), cell.text('')]);
  }
  const columns = [...(sectioned ? [col('大組', 9)] : []), col('區域／項目', 14), col('負責學生', 44), col('人數', 6, { numeric: true }), col('說明', 28)];
  return table({ title: `${subject.name} 打掃工作分配`, sheetName: '打掃', columns, rows });
}

/** 打掃工作填寫表：「打掃工作｜說明｜學號…」＋學生對照表 */
export function dutyTemplateReports(subject) {
  const byID = studentsByID(subject);
  const jobs = [];
  for (const section of [...dutySections(subject), null]) {
    for (const d of dutiesIn(subject, section)) {
      const j = jobs.find((x) => x.name === d.name);
      if (j) {
        for (const id of d.studentIDs) if (!j.ids.includes(id)) j.ids.push(id);
        if (!j.note) j.note = d.note;
      } else jobs.push({ name: d.name, note: d.note, ids: [...d.studentIDs] });
    }
  }
  if (!jobs.length) jobs.push(...defaultDuties().map((d) => ({ name: d.name, note: '', ids: [] })));
  const slots = Math.max(4, ...jobs.map((j) => j.ids.length));
  const rows = jobs.map((j) => {
    const cells = j.ids.map((id) => byID.get(id)).filter(Boolean).map((s) => cell.text(s.studentNo || s.name));
    return [cell.text(j.name), cell.text(j.note), ...cells, ...Array(slots - cells.length).fill(cell.text(''))];
  });
  const main = table({
    title: `${subject.name} 打掃工作（填入學號）`, sheetName: '打掃工作', rows,
    columns: [col('打掃工作', 14), col('說明', 22), ...Array(slots).fill(col('學號', 11))],
  });
  const set = activeGroupSet(subject);
  const showClass = hasMultipleClasses(subject);
  const listed = new Set();
  const refRows = [];
  const add = (s, section, group) => {
    listed.add(s.id);
    refRows.push([cell.text(section), cell.text(group), cell.text(displaySeat(s.seat)), cell.text(s.studentNo), cell.text(s.name), ...(showClass ? [cell.text(s.className)] : [])]);
  };
  for (const g of set?.groups ?? []) {
    for (const s of sortBySeat(g.memberIDs.map((id) => byID.get(id)).filter(Boolean))) if (!listed.has(s.id)) add(s, g.section ?? '', g.name);
  }
  for (const s of sortedStudents(subject)) if (!listed.has(s.id)) add(s, '', '未分組');
  const reference = table({
    title: `${subject.name} 學生對照（${set?.name ?? '未分組'}）`, sheetName: '學生對照', rows: refRows,
    columns: [col('大組', 9), col('小組', 9), col('座號', 7), col('學號', 13), col('姓名', 12), ...(showClass ? [col('班級', 12)] : [])],
  });
  return [main, reference];
}

/** 打掃檢查表：每項打掃工作一列，每次檢查一欄，○ 完成、× 沒做好；紀錄不到 8 次時補空白欄 */
export function dutyChecklistReport(subject, section) {
  const byID = studentsByID(subject);
  const duties = dutiesIn(subject, section);
  const days = dutyCheckDays(subject, section);
  const blanks = Math.max(0, 8 - days.length);
  const rows = duties.map((d) => {
    const list = sortBySeat(d.studentIDs.map((id) => byID.get(id)).filter(Boolean));
    const marks = days.map((day) => {
      const r = checkResult(day, d.id);
      return r === true ? cell.text('○') : r === false ? cell.text('×', 'fail') : cell.text('');
    });
    return [cell.text(d.name, 'emphasis'), cell.text(people(list)), ...marks, ...Array(blanks).fill(cell.text(''))];
  });
  const footerRows = days.length
    ? [[cell.text('完成'), cell.text(''), ...days.map((day) => cell.text(`${duties.filter((d) => checkResult(day, d.id) === true).length}/${duties.length}`)), ...Array(blanks).fill(cell.text(''))]]
    : [];
  const columns = [col('打掃工作', 12), col('負責學生', 30), ...days.map((d) => col(shortDate(d.date), 7)), ...Array(blanks).fill(col('／', 7))];
  const notes = ['○ 完成　× 沒做好', ...days.filter((d) => d.note?.trim()).map((d) => `${shortDate(d.date)} 備註：${d.note.trim()}`)];
  return table({ title: `${subject.name} 打掃檢查表${section ? `（${section}）` : ''}`, sheetName: '打掃檢查', columns, rows, footerRows, freezeColumns: 1, landscape: true, notes });
}

// MARK: 轉成 Excel、CSV、HTML

export function toXLSXSheet(t) {
  const xStyle = (c, bold) => {
    switch (c.style) {
      case 'fail': return STYLE.fail;
      case 'blank': return STYLE.blank;
      case 'missing': return STYLE.missing;
      case 'excused': return STYLE.excused;
      case 'emphasis': return STYLE.bold;
      default: return bold ? STYLE.bold : STYLE.normal;
    }
  };
  const toCell = (c, bold) => ({ value: c.number ?? (c.text || null), style: xStyle(c, bold) });
  return {
    name: t.sheetName,
    rows: [
      t.columns.map((c) => ({ value: c.subtitle ? `${c.title}\n${c.subtitle}` : c.title, style: STYLE.header })),
      ...t.rows.map((r) => r.map((c) => toCell(c, false))),
      ...t.footerRows.map((r) => r.map((c) => toCell(c, true))),
    ],
    columnWidths: t.columns.map((c) => c.width),
    freezeRows: 1, freezeColumns: t.freezeColumns, landscape: t.landscape,
    printTitleRows: 1, pageHeader: t.title, fitToWidth: t.columns.length <= 14,
  };
}

export function toCSVRows(t) {
  return [
    t.columns.map((c) => (c.subtitle ? `${c.title}（${c.subtitle}）` : c.title)),
    ...t.rows.map((r) => r.map((c) => c.text)),
    ...t.footerRows.map((r) => r.map((c) => c.text)),
  ];
}

const esc = escapeHTML;

export function tableHTML(t) {
  let h = t.notes.length ? `<ul class="notes">${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  // 欄寬依報表定義的比例固定，姓名欄才不會被擠成一字一行
  const total = Math.max(1, t.columns.reduce((n, c) => n + c.width, 0));
  h += '<table><colgroup>' + t.columns.map((c) => `<col style="width:${((c.width / total) * 100).toFixed(2)}%">`).join('') + '</colgroup><thead><tr>';
  h += t.columns.map((c) => `<th>${esc(c.title)}${c.subtitle ? `<span class="sub">${esc(c.subtitle)}</span>` : ''}</th>`).join('');
  h += '</tr></thead><tbody>';
  const rowHTML = (row, footer) => {
    let r = footer ? '<tr class="foot">' : '<tr>';
    row.forEach((c, i) => {
      const cls = [];
      if (t.columns[i]?.numeric) cls.push('num');
      cls.push({ fail: 'fail', blank: 'blank', missing: 'miss', excused: 'exc', emphasis: 'em' }[c.style] ?? '');
      const k = cls.filter(Boolean).join(' ');
      r += `<td${k ? ` class="${k}"` : ''}>${esc(c.text)}</td>`;
    });
    return r + '</tr>';
  };
  h += t.rows.map((r) => rowHTML(r, false)).join('') + t.footerRows.map((r) => rowHTML(r, true)).join('');
  return h + '</tbody></table>';
}

export function groupCardsHTML(subject, set) {
  const byID = studentsByID(subject);
  const card = (g) => {
    const members = orderedMembers(g, byID);
    return `<div class="card"><h3>${esc(g.name)}<span class="count">${members.length} 人</span></h3><ol>`
      + members.map((s) => `<li${s.id === g.leaderID ? ' class="leader"' : ''}><span class="seat">${esc(displaySeat(s.seat))}</span>${esc(s.name)}</li>`).join('')
      + '</ol></div>';
  };
  const sections = groupSections(set);
  const summary = sections.length ? `共 ${sections.length} 個大組、${set.groups.length} 組` : `共 ${set.groups.length} 組`;
  let h = `<p class="meta">分組方案：${esc(set.name)}·${summary}</p><div class="cards">` + set.groups.filter((g) => !g.section).map(card).join('');
  for (const section of sections) {
    const groups = set.groups.filter((g) => g.section === section);
    const n = groups.reduce((t, g) => t + g.memberIDs.length, 0);
    h += `</div><h2 class="section">${esc(section)}<span class="count">${groups.length} 組·${n} 人</span></h2><div class="cards">` + groups.map(card).join('');
  }
  const rest = unassignedStudents(subject, set);
  if (rest.length && sections.length) h += '</div><div class="cards" style="margin-top:8pt">';
  if (rest.length) {
    h += `<div class="card muted"><h3>未分組<span class="count">${rest.length} 人</span></h3><ol>`
      + rest.map((s) => `<li><span class="seat">${esc(displaySeat(s.seat))}</span>${esc(s.name)}</li>`).join('') + '</ol></div>';
  }
  return h + '</div>';
}

export const PRINT_CSS = `
* { box-sizing: border-box; }
body { font-family: "PingFang TC", "Heiti TC", -apple-system, "Microsoft JhengHei", sans-serif; font-size: 10pt; color: #1b2430; margin: 0; }
header { margin-bottom: 6pt; }
h1 { font-size: 15pt; margin: 0 0 2pt; }
h2 { font-size: 12pt; margin: 12pt 0 4pt; }
.meta { color: #5b6673; font-size: 9pt; margin: 0 0 6pt; }
ul.notes { margin: 0 0 6pt; padding-left: 14pt; color: #3d4753; font-size: 8.5pt; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th, td { border: 0.6pt solid #9aa5b1; padding: 1.5pt 4pt; vertical-align: middle; overflow-wrap: anywhere; }
td { font-size: 9.5pt; line-height: 1.35; }
th { background: #e8eef5; font-weight: 600; font-size: 8.5pt; line-height: 1.25; text-align: center; padding: 3pt; }
th .sub { display: block; font-weight: 400; color: #5b6673; font-size: 7.5pt; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.miss { color: #c62828; font-weight: 600; text-align: center; }
td.exc { color: #6b7480; text-align: center; }
td.blank { background: #fff4d6; }
td.fail { color: #c62828; }
td.em { font-weight: 600; }
tr.foot td { background: #f3f6f9; font-weight: 600; }
.cards { display: flex; flex-wrap: wrap; gap: 8pt; }
h2.section { font-size: 12pt; margin: 10pt 0 5pt; padding-bottom: 2pt; border-bottom: 1pt solid #9aa5b1; page-break-after: avoid; }
h2.section .count { font-weight: 400; color: #5b6673; font-size: 9pt; margin-left: 8pt; }
.card { width: calc(33.3% - 6pt); border: 0.8pt solid #9aa5b1; border-radius: 4pt; padding: 6pt 8pt; page-break-inside: avoid; }
.card.muted { border-style: dashed; }
.card h3 { font-size: 11pt; margin: 0 0 4pt; display: flex; justify-content: space-between; }
.card .count { font-weight: 400; color: #5b6673; font-size: 9pt; }
.card ol { list-style: none; margin: 0; padding: 0; }
.card li { padding: 1.5pt 0; }
.card .seat { display: inline-block; width: 22pt; color: #5b6673; font-variant-numeric: tabular-nums; }
.card li.leader { font-weight: 600; }
.card li.leader::after { content: "（組長）"; color: #b26a00; font-weight: 400; font-size: 8.5pt; }
`;

export function printDocument(title, subjectName, body, landscape) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${PRINT_CSS} @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }</style></head><body>
<header><h1>${esc(title)}</h1><div class="meta">${esc(subjectName)}　列印日期 ${fullDate(new Date())}</div></header>${body}</body></html>`;
}
