// 「名冊」分頁：這個科目的學生（從學生名冊加入）。座號和備註是科目自己的。
import { h, icon } from '../ui/dom.js';
import {
  section, row, sheetView, openSheet, closeSheet, rerender, confirmDialog, barButton, showMenu, empty, button, fieldRow, input,
} from '../ui/kit.js';
import { store } from '../store.js';
import { sortedStudents, hasMultipleClasses, semesterClassNames, studentsInClass, getScore } from '../model.js';
import { trimmed, displaySeat, normalizeSeat } from '../format.js';
import { exportMenuItems } from '../io/exporter.js';
import { openMasterRoster } from './masterRoster.js';

const view = { search: '' };

export function render() {
  const s = store.currentSubject;
  const list = sortedStudents(s);
  const showClass = hasMultipleClasses(s);
  const q = trimmed(view.search);
  const shown = q ? list.filter((st) => st.name.includes(q) || st.studentNo.includes(q) || st.seat === normalizeSeat(q) || st.className.includes(q)) : list;

  const actions = [
    barButton('plus', { label: '從學生名冊加入', onclick: openAddFromRoster, id: 'roster-add-students' }),
    barButton('more', {
      label: '更多', id: 'roster-more',
      onclick: (e) => showMenu(e.currentTarget, [
        ...exportMenuItems({ type: 'roster' }),
        { divider: true },
        { label: '清空這個科目的名冊…', icon: 'trash', destructive: true, disabled: !list.length, action: async () => {
          const ok = await confirmDialog({ title: '清空名冊？', confirm: '清空', message: `${list.length} 位學生和他們在這個科目的成績、分組、打掃都會刪除。學生名冊不受影響。` });
          if (ok) store.clearRoster();
        } },
      ]),
    }),
  ];

  if (!list.length) {
    return {
      actions,
      body: empty('這個科目還沒有學生', '科目的學生從學生名冊加入：可以一次加入整班，也可以挑幾位。',
        button('從學生名冊加入', { kind: 'filled', iconName: 'plus', onclick: openAddFromRoster, id: 'empty-add-students' }),
        button('開啟學生名冊', { kind: 'gray', iconName: 'people', onclick: openMasterRoster })),
    };
  }

  return {
    actions,
    body: [
      h('div', { class: 'search', style: 'margin-bottom:14px', key: 'search' }, icon('search'),
        h('input', { type: 'search', placeholder: '搜尋姓名、學號或座號', value: view.search, oninput: (e) => { view.search = e.target.value; rerender(); }, id: 'subject-roster-search' })),
      section({ footer: `共 ${list.length} 人${q ? `，符合 ${shown.length} 人` : ''}。點一位學生可以改座號、寫備註，或從這個科目移除。` },
        shown.map((st) => row({
          key: st.id, id: `student-${st.name}`,
          label: h('span', { class: 'split', style: 'gap:10px;flex-wrap:nowrap' }, h('span', { class: 'seat' }, displaySeat(st.seat)), h('b', { style: 'font-weight:500' }, st.name),
            st.studentNo ? h('span', { class: 'muted num', style: 'font-size:15px' }, st.studentNo) : null),
          sub: [showClass ? st.className : null, st.note || null].filter(Boolean).join('·') || null,
          chevron: true,
          onclick: () => openStudentEdit(st),
        }))),
    ],
  };
}

/** 從學生名冊加入：可以一次選整班 */
export function openAddFromRoster() {
  const sem = store.currentSemester;
  openSheet((sheet) => {
    const st = sheet.state;
    const subject = store.currentSubject;
    const inSubject = new Set(subject.students.map((x) => x.rosterID).filter(Boolean));
    const classes = semesterClassNames(sem);
    if (!store.roster.length) {
      return sheetView({
        title: '從學生名冊加入', onCancel: () => closeSheet(sheet),
        body: empty('學生名冊還沒有學生', '先在學生名冊建立班級和學生（可以從 Excel 匯入），再加到這個科目。',
          button('開啟學生名冊', { kind: 'filled', iconName: 'people', onclick: () => { closeSheet(sheet); openMasterRoster(); } })),
      });
    }
    return sheetView({
      title: '從學生名冊加入', onCancel: () => closeSheet(sheet),
      confirm: {
        label: st.selected.size ? `加入 ${st.selected.size} 人` : '加入', disabled: !st.selected.size,
        action: () => { const n = store.addStudentsFromRoster(st.selected); store.showToast(`已加入 ${n} 位學生`); closeSheet(sheet); },
      },
      body: classes.map((c) => {
        const list = studentsInClass(sem, c);
        const available = list.filter((r) => !inSubject.has(r.id));
        const allOn = available.length > 0 && available.every((r) => st.selected.has(r.id));
        return section({
          key: `c-${c}`,
          header: [h('span', null, `${c || '未分班級'}（${list.length} 人）`), h('span', { class: 'spacer' }),
            available.length ? h('button', { type: 'button', class: 'btn btn-plain btn-small', id: `select-class-${c}`, onclick: () => {
              for (const r of available) if (allOn) st.selected.delete(r.id); else st.selected.add(r.id);
              rerender();
            } }, allOn ? '取消全選' : '整班加入') : h('span', null, '已全部加入')],
        }, list.map((r) => {
          const added = inSubject.has(r.id);
          const on = st.selected.has(r.id);
          return row({
            key: r.id, disabled: added,
            leading: icon(added ? 'checkCircleFill' : on ? 'checkCircleFill' : 'circle', added ? 'muted' : on ? 'tint' : 'muted'),
            label: h('span', null, h('span', { class: 'seat' }, displaySeat(r.seat)), ' ', r.name),
            detail: added ? '已在科目裡' : r.studentNo,
            onclick: added ? undefined : () => { if (on) st.selected.delete(r.id); else st.selected.add(r.id); rerender(); },
          });
        }));
      }),
    });
  }, { state: { selected: new Set() } });
}

/** 科目裡的學生：座號、備註可以改；姓名、學號、班級要到學生名冊改 */
function openStudentEdit(student) {
  openSheet((sheet) => {
    const st = sheet.state;
    const subject = store.currentSubject;
    const scored = subject.items.filter((it) => getScore(subject, it.id, student.id) !== undefined).length;
    return sheetView({
      title: student.name, onCancel: () => closeSheet(sheet),
      confirm: { label: '儲存', action: () => { store.updateStudent({ ...student, seat: normalizeSeat(st.seat), note: trimmed(st.note) }); closeSheet(sheet); } },
      body: [
        section({ footer: '姓名、學號、班級要到左側選單的「學生名冊」修改，會同步到每個科目。' },
          row({ label: '姓名', detail: student.name }),
          row({ label: '學號', detail: student.studentNo || '—' }),
          student.className ? row({ label: '班級', detail: student.className }) : null),
        section({ header: '這個科目' },
          fieldRow('座號', input({ value: st.seat, inputmode: 'numeric', align: 'right', oninput: (v) => { st.seat = v; }, id: 'edit-seat' })),
          fieldRow('備註', input({ value: st.note, align: 'right', placeholder: '例如：對乳膠手套過敏', oninput: (v) => { st.note = v; }, id: 'edit-note' }))),
        section({}, row({
          label: '從這個科目移除', destructive: true, id: 'remove-student',
          onclick: async () => {
            const ok = await confirmDialog({ title: `從科目移除「${student.name}」？`, confirm: '移除', message: scored ? `這位學生在這科的 ${scored} 筆成績、分組和打掃指派都會刪除。學生名冊不受影響。` : '學生名冊不受影響。' });
            if (ok) { store.deleteStudents(new Set([student.id])); closeSheet(sheet); }
          },
        })),
      ],
    });
  }, { state: { seat: student.seat, note: student.note } });
}
