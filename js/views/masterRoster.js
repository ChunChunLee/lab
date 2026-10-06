// 學生名冊（全學期共用）：上方用班級分頁切換，可以搜尋、新增、編輯、從 Excel 匯入
import { h, icon } from '../ui/dom.js';
import {
  section, row, sheetView, openSheet, closeSheet, rerender, confirmDialog, promptDialog, input, fieldRow, button, chip, showMenu, empty,
} from '../ui/kit.js';
import { store } from '../store.js';
import { semesterClassNames, studentsInClass, sortBySeat, newRosterStudent } from '../model.js';
import { trimmed, displaySeat, normalizeSeat } from '../format.js';
import { openRosterImport } from './rosterImport.js';

const className = (c) => c || '未分班級';

export function openMasterRoster() {
  openSheet((sheet) => {
    const st = sheet.state;
    const sem = store.currentSemester;
    const roster = store.roster;
    const classes = sem ? semesterClassNames(sem) : [];
    const current = classes.includes(st.selected) ? st.selected : classes[0];
    const q = trimmed(st.search);

    const addMenu = (e) => showMenu(e.currentTarget, [
      { label: '從 Excel／CSV 匯入…', icon: 'table', action: () => openRosterImport(), id: 'roster-import' },
      { label: '新增學生…', icon: 'plus', action: () => openRosterStudentEdit(null, current ?? ''), id: 'roster-add' },
    ], { align: 'left' });

    let body;
    if (!roster.length) {
      body = empty('還沒有學生', '學生名冊是這學期所有科目共用的名單（班級、座號、學號、姓名）。可以從 Excel 匯入整班，或一位一位新增。',
        button('從 Excel／CSV 匯入', { kind: 'filled', iconName: 'table', onclick: () => openRosterImport(), id: 'roster-import-empty' }),
        button('新增學生', { kind: 'gray', iconName: 'plus', onclick: () => openRosterStudentEdit(null, '') }));
    } else if (q) {
      const hits = sortBySeat(roster.filter((r) => r.name.includes(q) || r.studentNo.includes(q) || r.className.includes(q)));
      body = section({ header: `搜尋結果（${hits.length} 人）` }, hits.length ? hits.map((r) => studentRow(r, true)) : row({ label: h('span', { class: 'muted' }, '找不到符合的學生') }));
    } else {
      const list = studentsInClass(sem, current);
      body = section({
        header: [h('span', null, `${className(current)}（${list.length} 人）`), h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'icon-btn', style: 'color:var(--tint)', 'aria-label': `${className(current)} 的更多操作`, onclick: (e) => classMenu(e, current, st) }, icon('more', 'small'))],
      }, list.map((r) => studentRow(r, false)));
    }

    return sheetView({
      title: '學生名冊', wide: true,
      leading: h('button', { type: 'button', class: 'bar-btn', 'aria-label': '新增', onclick: addMenu, id: 'roster-plus' }, icon('plus')),
      trailing: h('button', { type: 'button', class: 'bar-text bold', onclick: () => closeSheet(sheet), id: 'sheet-done' }, '完成'),
      body: [
        roster.length ? h('div', { class: 'search', style: 'margin-bottom:12px', key: 'search' }, icon('search'),
          h('input', { type: 'search', placeholder: '搜尋姓名、學號或班級', value: st.search, oninput: (e) => { st.search = e.target.value; rerender(); }, id: 'roster-search' })) : null,
        roster.length && !q ? h('div', { class: 'chips', style: 'padding:0 0 14px', key: 'chips' },
          classes.map((c) => chip(className(c), { on: c === current, count: studentsInClass(sem, c).length, key: `c-${c}`, id: `class-${className(c)}`, onclick: () => { st.selected = c; rerender(); } })),
          chip('新增班級', { dashed: true, iconName: 'plus', key: 'add-class', onclick: async () => {
            const name = await promptDialog({ title: '新增班級', message: '輸入班級名稱，例如「化工二甲」，接著新增這班的學生。', placeholder: '班級名稱', confirm: '下一步' });
            if (name !== null && trimmed(name)) openRosterStudentEdit(null, trimmed(name));
          } })) : null,
        body,
      ],
    });
  }, { kind: 'cover', state: { selected: null, search: '' } });
}

function studentRow(r, showClass) {
  const n = store.subjectCountForRosterStudent(r.id);
  return row({
    key: r.id, id: `roster-${r.name}`,
    label: h('span', { class: 'split', style: 'gap:10px;flex-wrap:nowrap' }, h('span', { class: 'seat' }, displaySeat(r.seat)), h('b', { style: 'font-weight:500' }, r.name),
      r.studentNo ? h('span', { class: 'muted num', style: 'font-size:15px' }, r.studentNo) : null),
    sub: showClass ? className(r.className) : null,
    detail: n ? `${n} 個科目` : null,
    onclick: () => openRosterStudentEdit(r, r.className),
  });
}

async function classMenu(e, c, st) {
  showMenu(e.currentTarget, [
    { label: '在這班新增學生…', icon: 'plus', action: () => openRosterStudentEdit(null, c) },
    { label: '重新命名班級…', icon: 'pencil', action: async () => {
      const name = await promptDialog({ title: '重新命名班級', value: c });
      if (name !== null && trimmed(name) !== c) { store.renameClass(c, name); st.selected = trimmed(name); rerender(); }
    } },
    { divider: true },
    { label: '刪除這個班級…', icon: 'trash', destructive: true, action: async () => {
      const n = store.roster.filter((r) => r.className === c).length;
      const ok = await confirmDialog({ title: `刪除「${className(c)}」？`, confirm: '刪除班級', message: `這班的 ${n} 位學生會從學生名冊和這學期所有科目移除（含成績）。` });
      if (ok) store.deleteClass(c);
    } },
  ]);
}

/** 新增或編輯學生名冊的一位學生 */
export function openRosterStudentEdit(student, defaultClass) {
  const sem = store.currentSemester;
  const classes = sem ? semesterClassNames(sem).filter(Boolean) : [];
  const fresh = () => ({ className: defaultClass ?? '', seat: store.nextRosterSeat(defaultClass ?? ''), studentNo: '', name: '' });
  openSheet((sheet) => {
    const st = sheet.state;
    const valid = trimmed(st.name);
    const save = (again) => {
      const data = { className: trimmed(st.className), seat: normalizeSeat(st.seat), studentNo: trimmed(st.studentNo), name: trimmed(st.name) };
      if (student) store.updateRosterStudent({ ...student, ...data });
      else store.addRosterStudent(newRosterStudent(data));
      if (again) {
        store.showToast(`已新增 ${data.name}`);
        sheet.state = { ...fresh(), className: data.className, seat: store.nextRosterSeat(data.className) };
        rerender();
      } else closeSheet(sheet);
    };
    const n = student ? store.subjectCountForRosterStudent(student.id) : 0;
    return sheetView({
      title: student ? '編輯學生' : '新增學生', onCancel: () => closeSheet(sheet),
      confirm: { label: '儲存', disabled: !valid, action: () => save(false) },
      body: [
        section({ footer: student && n ? `這位學生在 ${n} 個科目裡，改姓名、學號、班級會同步到這些科目。` : null },
          fieldRow('班級', h('span', { style: 'flex:1;display:flex' },
            h('input', { class: 'text-input right', list: 'class-list', value: st.className, placeholder: '例如：化工二甲', oninput: (e) => { st.className = e.target.value; }, id: 'student-class' }),
            h('datalist', { id: 'class-list' }, classes.map((c) => h('option', { value: c }))))),
          fieldRow('座號', input({ value: st.seat, inputmode: 'numeric', align: 'right', oninput: (v) => { st.seat = v; }, id: 'student-seat' })),
          fieldRow('學號', input({ value: st.studentNo, inputmode: 'numeric', align: 'right', placeholder: '選填', oninput: (v) => { st.studentNo = v; }, id: 'student-no' })),
          fieldRow('姓名', input({ value: st.name, align: 'right', placeholder: '必填', oninput: (v) => { st.name = v; rerender(); }, id: 'student-name', autofocus: !student }))),
        student ? null : section({}, row({ label: '儲存並新增下一位', tint: true, disabled: !valid, onclick: () => save(true), id: 'save-next' })),
        student ? section({}, row({
          label: '刪除這位學生', destructive: true,
          onclick: async () => {
            const ok = await confirmDialog({ title: `刪除「${student.name}」？`, confirm: '刪除', message: n ? `會從學生名冊和 ${n} 個科目移除，成績、分組和打掃的資料也會一起刪除。` : '會從學生名冊移除。' });
            if (ok) { store.deleteRosterStudents(new Set([student.id])); closeSheet(sheet); }
          },
        })) : null,
      ],
    });
  }, { state: student ? { ...student } : fresh() });
}
