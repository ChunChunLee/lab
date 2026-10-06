// 學期管理、編輯科目、新增科目
import { h, icon } from '../ui/dom.js';
import {
  section, row, sheetView, openSheet, closeSheet, rerender, confirmDialog, promptDialog, actionDialog, input, fieldRow, toggleRow, button,
} from '../ui/kit.js';
import { store } from '../store.js';
import { semesterClassNames, studentsInClass } from '../model.js';
import { trimmed } from '../format.js';
import { openMasterRoster } from './masterRoster.js';

// MARK: 學期管理

export function openSemesters() {
  openSheet((sheet) => sheetView({
    title: '學期管理', cancel: null, onCancel: () => closeSheet(sheet),
    trailing: h('button', { type: 'button', class: 'bar-text bold', onclick: () => closeSheet(sheet), id: 'sheet-done' }, '完成'),
    body: [
      section({ header: '學期', footer: '點一下切換學期。每個學期有自己的學生名冊和科目，互不影響。按右邊的「⋯」可以改名或刪除。' },
        [...store.data.semesters].reverse().map((sem) => {
          const current = sem.id === store.currentSemester?.id;
          return row({
            key: sem.id, label: sem.name, sub: `學生 ${sem.roster.length} 人·科目 ${sem.subjects.length} 個`,
            leading: current ? icon('check', 'tint') : h('span', { class: 'icon' }),
            onclick: () => { store.selectSemester(sem.id); store.showToast(`已切換到 ${sem.name}`); closeSheet(sheet); },
            trailing: h('button', {
              type: 'button', class: 'icon-btn', 'aria-label': `${sem.name} 的更多操作`,
              onclick: async (e) => {
                e.stopPropagation();
                const choice = await actionDialog({
                  title: sem.name, actions: [{ label: '重新命名', value: 'rename' },
                    ...(store.data.semesters.length > 1 ? [{ label: '刪除學期', value: 'delete', destructive: true }] : [])],
                });
                if (choice === 'rename') {
                  const name = await promptDialog({ title: '重新命名學期', value: sem.name });
                  if (name !== null) store.renameSemester(sem.id, name);
                } else if (choice === 'delete') {
                  const ok = await confirmDialog({
                    title: `刪除「${sem.name}」？`, confirm: '刪除學期',
                    message: `這學期的 ${sem.roster.length} 位學生、${sem.subjects.length} 個科目和所有成績都會刪除。建議先到「設定與備份」匯出備份。`,
                  });
                  if (ok) store.deleteSemester(sem.id);
                }
              },
            }, icon('more')),
          });
        })),
      section({}, row({ label: '新增學期', tint: true, leading: icon('plusCircle', 'tint'), onclick: () => openAddSemester(sheet), id: 'add-semester' })),
    ],
  }));
}

function openAddSemester(parent) {
  const current = store.currentSemester;
  openSheet((sheet) => {
    const st = sheet.state;
    return sheetView({
      title: '新增學期', onCancel: () => closeSheet(sheet),
      confirm: {
        label: '建立', action: () => {
          store.addSemester(st.name, st.copy ? current?.id : null);
          store.showToast(`已建立 ${trimmed(st.name) || '新學期'}`);
          closeSheet(sheet);
          closeSheet(parent);
        },
      },
      body: [
        section({ header: '學期名稱' }, row({ label: input({ value: st.name, placeholder: '例如：115學年度第2學期', oninput: (v) => { st.name = v; }, id: 'semester-name' }) })),
        current?.roster.length
          ? section({ footer: st.copy ? `會複製 ${current.roster.length} 位學生（班級、座號、學號、姓名），不包含科目和成績。` : '新學期從空白開始，學生名冊和科目都要重新建立。' },
            toggleRow(`複製「${current.name}」的學生名冊`, st.copy, (v) => { st.copy = v; rerender(); }))
          : null,
      ],
    });
  }, { state: { name: store.suggestedSemesterName, copy: false } });
}

// MARK: 編輯科目

export function openSubjectEditor() {
  openSheet((sheet) => sheetView({
    title: '編輯科目', cancel: null,
    trailing: h('button', { type: 'button', class: 'bar-text bold', onclick: () => closeSheet(sheet), id: 'sheet-done' }, '完成'),
    body: [
      section({ header: store.currentSemester?.name ?? '科目', footer: '點科目可以改名；「⋯」可以調整順序或刪除。' },
        store.subjects.map((s, i) => row({
          key: s.id, label: s.name, sub: `學生 ${s.students.length} 人·成績項目 ${s.items.length} 個`,
          onclick: async () => {
            const name = await promptDialog({ title: '重新命名科目', value: s.name });
            if (name !== null) store.renameSubject(s.id, name);
          },
          trailing: h('button', {
            type: 'button', class: 'icon-btn', 'aria-label': `${s.name} 的更多操作`,
            onclick: async (e) => {
              e.stopPropagation();
              const choice = await actionDialog({
                title: s.name, actions: [
                  ...(i > 0 ? [{ label: '往上移', value: 'up' }] : []),
                  ...(i < store.subjects.length - 1 ? [{ label: '往下移', value: 'down' }] : []),
                  { label: '刪除科目', value: 'delete', destructive: true }],
              });
              if (choice === 'up') store.moveSubject(s.id, -1);
              if (choice === 'down') store.moveSubject(s.id, 1);
              if (choice === 'delete') {
                const ok = await confirmDialog({ title: `刪除「${s.name}」？`, confirm: '刪除科目', message: `「${s.name}」的成績、分組和打掃工作都會刪除，學生名冊不受影響。` });
                if (ok) store.deleteSubject(s.id);
              }
            },
          }, icon('more')),
        })),
        store.subjects.length ? null : row({ label: h('span', { class: 'muted' }, '這學期還沒有科目') })),
      section({}, row({ label: '新增科目', tint: true, leading: icon('plusCircle', 'tint'), onclick: openAddSubject, id: 'add-subject' })),
    ],
  }));
}

// MARK: 新增科目

/** 取名字，並選擇要從學生名冊匯入哪些班級 */
export function openAddSubject() {
  const sem = store.currentSemester;
  const all = sem ? semesterClassNames(sem) : [];
  openSheet((sheet) => {
    const st = sheet.state;
    return sheetView({
      title: '新增科目', onCancel: () => closeSheet(sheet),
      confirm: {
        label: '建立', disabled: !trimmed(st.name),
        action: () => {
          store.addSubject(st.name, [...st.classes]);
          const n = store.currentSubject?.students.length ?? 0;
          store.showToast(`已建立「${store.currentSubject?.name}」${n ? `，加入 ${n} 位學生` : ''}`);
          closeSheet(sheet);
          rerender();
        },
      },
      body: [
        section({ header: '科目名稱' }, row({
          label: input({ value: st.name, placeholder: '例如：普通化學實習、分析化學', oninput: (v) => { st.name = v; rerender(); }, id: 'subject-name', autofocus: true }),
        })),
        section({
          header: '從學生名冊匯入班級（可複選）',
          footer: all.length ? '之後也可以在科目的「名冊」分頁加入或移除個別學生。' : null,
        },
        all.length
          ? all.map((c) => row({
            key: `c-${c}`, label: c || '未分班級', detail: `${studentsInClass(sem, c).length} 人`,
            leading: icon(st.classes.has(c) ? 'checkCircleFill' : 'circle', st.classes.has(c) ? 'tint' : 'muted'),
            onclick: () => { if (st.classes.has(c)) st.classes.delete(c); else st.classes.add(c); rerender(); },
            id: `class-${c}`,
          }))
          : [row({ label: h('span', { class: 'muted' }, '學生名冊還沒有學生。可以先建立科目，之後在科目的「名冊」分頁加入學生。') }),
            row({ label: '先建立學生名冊', tint: true, onclick: () => { closeSheet(sheet); openMasterRoster(); } })]),
      ],
    });
  }, { state: { name: '', classes: new Set(all.length === 1 ? all : []) } });
}

export { fieldRow, button };
