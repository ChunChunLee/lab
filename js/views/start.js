// 這學期還沒有科目時的畫面：一步步建立學生名冊和科目
import { h, icon } from '../ui/dom.js';
import { button, section } from '../ui/kit.js';
import { store } from '../store.js';
import { semesterClassNames } from '../model.js';
import { openMasterRoster } from './masterRoster.js';
import { openAddSubject } from './menuViews.js';
import { openRestoreFromFile } from './backup.js';

function step(n, title, detail, done, buttonTitle, action, id) {
  return h('div', { class: 'card split', style: 'align-items:flex-start;flex-wrap:nowrap;gap:14px', key: `step${n}` },
    h('span', { style: `flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:700;background:${done ? 'var(--green)' : 'var(--tint)'}` },
      done ? icon('check') : String(n)),
    h('div', { class: 'stack', style: 'gap:6px;flex:1' },
      h('b', null, title), h('span', { class: 'note' }, detail),
      h('div', null, button(buttonTitle, { kind: 'filled', small: true, onclick: action, id }))));
}

export function startView() {
  const sem = store.currentSemester;
  const roster = store.roster;
  return {
    actions: null,
    body: h('div', { class: 'stack', style: 'max-width:520px;margin:20px auto;gap:22px' },
      h('div', { style: 'text-align:center' },
        h('div', { class: 'empty-icon' }, icon('flask')),
        h('h2', { style: 'margin:0 0 8px' }, sem?.name ?? '實習課管理'),
        h('p', { class: 'note', style: 'margin:0' }, '從左側選單（左上角 ☰，或從螢幕左邊緣往右滑）可以切換學期、學生名冊和科目。')),
      h('div', { class: 'stack' },
        step(1, '建立學生名冊',
          roster.length ? `已有 ${roster.length} 位學生（${semesterClassNames(sem).length} 班）。` : '輸入班級、學號、姓名，可以從 Excel 匯入整班。',
          roster.length > 0, roster.length ? '查看學生名冊' : '開啟學生名冊', openMasterRoster, 'start-roster'),
        step(2, '新增科目', '取好科目名稱，選擇要匯入的班級，學生就會加進科目的名冊。', false, '新增科目', openAddSubject, 'start-add-subject')),
      section({ footer: '資料存在這台裝置的瀏覽器裡。換裝置或換瀏覽器時，用「設定與備份」的備份檔搬資料；iOS 版 App 的備份檔也可以直接還原。' },
        h('div', { class: 'stack', style: 'padding:14px 16px' },
          button('從備份檔還原（也可以用 App 的備份）', { kind: 'gray', iconName: 'upload', onclick: openRestoreFromFile, id: 'start-restore' }),
          button('載入範例資料試用', { kind: 'gray', iconName: 'sparkle', onclick: () => store.loadSample(), id: 'start-sample' })))),
  };
}
