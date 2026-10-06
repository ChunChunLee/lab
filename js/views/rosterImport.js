// 匯入學生名冊：貼上或選 Excel／CSV → 確認欄位和班級 → 加入學生名冊
import { h, icon } from '../ui/dom.js';
import { section, row, sheetView, openSheet, closeSheet, rerender, button, textarea, input, fieldRow, toggle, select } from '../ui/kit.js';
import { store } from '../store.js';
import { semesterClassNames } from '../model.js';
import { trimmed } from '../format.js';
import { pickFile, readSpreadsheet, SPREADSHEET_ACCEPT } from '../io/exporter.js';
import * as R from '../logic/rosterParser.js';

const FIELD_OPTIONS = ['className', 'seat', 'studentNo', 'name', 'note', 'ignore'].map((f) => ({ value: f, label: R.FIELD_TITLES[f] }));

function makeTable(name, table, className) {
  return { name, table, include: true, className };
}

const tableStudents = (t) => R.tableStudents(t.table);
const hasClassColumn = (t) => t.table.mapping.includes('className');

export function openRosterImport() {
  openSheet((sheet) => {
    const st = sheet.state;
    const included = st.tables.filter((t) => t.include);
    const canImport = included.length > 0 && included.every((t) => t.table.mapping.includes('name') && tableStudents(t).length && (hasClassColumn(t) || trimmed(t.className)));
    const total = included.reduce((n, t) => n + tableStudents(t).length, 0);

    const apply = () => {
      const sum = { added: 0, updated: 0, unchanged: 0, skipped: 0 };
      for (const t of included) {
        const r = store.importRoster(tableStudents(t), t.className);
        for (const k of Object.keys(sum)) sum[k] += r[k];
      }
      store.showToast(`已匯入學生名冊：${R.mergeSummary(sum)}`);
      closeSheet(sheet);
    };

    let body;
    if (!st.tables.length) body = inputStep(st);
    else if (st.tables.length === 1) body = singleTable(st, st.tables[0]);
    else body = multiSheets(st);

    return sheetView({
      title: '匯入學生名冊', onCancel: () => closeSheet(sheet),
      confirm: st.tables.length ? { label: '匯入', disabled: !canImport, action: apply } : null,
      body: [body, st.tables.length ? section({}, row({ label: '重新選擇', tint: true, leading: icon('undo', 'tint'), onclick: () => { st.tables = []; rerender(); } })) : null,
        st.tables.length ? h('p', { class: 'note', style: 'text-align:center' }, `共 ${total} 人。學號相同的會更新資料，不會重複新增。`) : null],
    });
  }, { state: { text: '', tables: [], error: null } });
}

function inputStep(st) {
  return [
    section({ header: '從檔案匯入', footer: st.error ? h('span', { class: 'red' }, st.error) : '支援 .xlsx 和 .csv。Excel 裡如果一班一張工作表，會用工作表名稱當班級。' },
      row({ label: '選擇 Excel 或 CSV 檔…', tint: true, leading: icon('folder', 'tint'), id: 'pick-file', onclick: async () => {
        const file = await pickFile(SPREADSHEET_ACCEPT);
        if (!file) return;
        const r = await readSpreadsheet(file);
        if (r.error) { st.error = r.error; rerender(); return; }
        const sheets = r.sheets.map((s) => ({ name: s.name || file.name, table: R.analyzeRoster(s.rows) })).filter((s) => s.table.rows.length);
        if (!sheets.length) { st.error = '這個檔案沒有內容。'; rerender(); return; }
        st.error = null;
        // 班級：標題列有寫班名就用它；否則好幾張工作表時用工作表名稱
        st.tables = sheets.map((s) => makeTable(s.name, s.table, R.classNameHint(s.table) ?? (sheets.length > 1 ? s.name : '')));
        rerender();
      } })),
    section({ header: '或直接貼上', footer: '系統會自動辨識班級、座號、學號、姓名欄位，下一步可以再調整。' },
      textarea({ value: st.text, placeholder: '在 Excel 選取「班級、座號、學號、姓名」等欄位（可以包含標題列）複製後，貼在這裡。', oninput: (v) => { st.text = v; rerender(); }, id: 'roster-paste' }),
      row({ label: '讀取貼上的名單', tint: !!trimmed(st.text), disabled: !trimmed(st.text), leading: icon('clipboard', 'tint'), id: 'read-paste', onclick: () => {
        const table = R.analyzeRoster(R.rowsFromText(st.text));
        if (!table.rows.length) { st.error = '沒有讀到內容。'; rerender(); return; }
        st.error = null;
        st.tables = [makeTable('貼上的內容', table, R.classNameHint(table) ?? '')];
        rerender();
      } })),
  ];
}

function classField(t) {
  const sem = store.currentSemester;
  const classes = sem ? semesterClassNames(sem).filter(Boolean) : [];
  return fieldRow(hasClassColumn(t) ? '沒填班級的' : '班級', h('span', { style: 'flex:1;display:flex' },
    h('input', { class: 'text-input right', list: 'import-class-list', value: t.className, placeholder: '例如：化工二甲', oninput: (e) => { t.className = e.target.value; rerender(); }, id: 'import-class' }),
    h('datalist', { id: 'import-class-list' }, classes.map((c) => h('option', { value: c })))));
}

function singleTable(st, t) {
  const students = tableStudents(t);
  const table = t.table;
  return [
    section({ header: '班級', footer: hasClassColumn(t) ? '表格裡有「班級」欄，以表格為準；空白的用這裡的班級。' : '這些學生要放進哪一班。' }, classField(t)),
    section({ header: '欄位', footer: '確認每一欄是什麼資料，用不到的選「略過」。' },
      row({ label: '第一列是標題', trailing: toggle(table.hasHeader, (v) => { table.hasHeader = v; rerender(); }, { label: '第一列是標題' }) }),
      table.mapping.map((f, i) => row({
        key: `col-${i}`, label: `第 ${i + 1} 欄`, sub: R.sampleOf(table, i) ? `例如：${R.sampleOf(table, i)}` : '（空白）',
        trailing: select(FIELD_OPTIONS, f, (v) => {
          // 同一個欄位只能對應一欄
          table.mapping = table.mapping.map((x, j) => (j === i ? v : x === v && v !== 'ignore' ? 'ignore' : x));
          rerender();
        }, { label: `第 ${i + 1} 欄`, id: `map-${i}` }),
      }))),
    preview(students, t.className),
  ];
}

function multiSheets(st) {
  const all = st.tables.filter((t) => t.include);
  return [
    section({ header: `Excel 裡有 ${st.tables.length} 張工作表`, footer: '每張工作表當作一個班級。班級名稱會先用標題列寫的班名，沒有的話用工作表名稱，都可以修改。表格裡有「班級」欄的話以表格為準。' },
      st.tables.map((t, i) => h('div', { class: 'row-wrap', key: `sheet-${i}` },
        row({ label: `工作表「${t.name}」`, sub: `${tableStudents(t).length} 位學生`, trailing: toggle(t.include, (v) => { t.include = v; rerender(); }, { label: t.name }) }),
        t.include ? classField(t) : null))),
    section({ header: `預覽（共 ${all.reduce((n, t) => n + tableStudents(t).length, 0)} 人）` },
      all.map((t, i) => h('details', { class: 'row-wrap', key: `pv-${i}` },
        h('summary', { class: 'row', style: 'cursor:pointer' }, h('span', { class: 'row-main' }, `${t.className || t.name}（${tableStudents(t).length} 人）`)),
        tableStudents(t).map((s, j) => row({ key: `s${j}`, label: h('span', null, h('span', { class: 'seat' }, s.seat), ' ', s.name), detail: s.className || t.className }))))),
  ];
}

function preview(students, cls) {
  return section({ header: `預覽（${students.length} 人）` },
    students.slice(0, 200).map((s, i) => row({
      key: `p${i}`, label: h('span', null, h('span', { class: 'seat' }, s.seat), ' ', s.name, s.studentNo ? h('span', { class: 'muted num', style: 'margin-left:8px;font-size:15px' }, s.studentNo) : null),
      detail: s.className || cls || h('span', { class: 'warn' }, '沒有班級'),
    })),
    students.length ? null : row({ label: h('span', { class: 'warn' }, '沒有讀到學生，請確認「姓名」是哪一欄。') }));
}

export { input, button };
