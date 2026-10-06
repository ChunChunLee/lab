// 左側選單：學期、學生名冊、科目（最下面是「編輯科目」），以及設定與備份
import { h, icon } from '../ui/dom.js';
import { store } from '../store.js';
import { semesterClassNames } from '../model.js';
import { closeMenuDrawer } from '../app.js';
import { openSemesters, openSubjectEditor } from './menuViews.js';
import { openMasterRoster } from './masterRoster.js';
import { openBackup } from './backup.js';
import { sync, syncStatusText, syncNeedsAttention } from '../sync.js';

function item({ iconName, title, sub, subWarn, detail, current, onclick, id, chevron = true }) {
  return h('button', { type: 'button', class: ['side-item', { current }], onclick, id, key: id },
    icon(iconName),
    h('span', { class: 'text' }, h('b', null, title), sub ? h('small', { class: { warn: subWarn } }, sub) : null),
    detail ? h('span', { class: 'detail' }, detail) : null,
    current ? icon('check', 'tint') : chevron ? icon('chevronRight', 'row-chevron') : null);
}

/** 從選單打開畫面：先收起選單 */
function open(fn) {
  return () => { closeMenuDrawer(); fn(); };
}

export function sideMenu() {
  const sem = store.currentSemester;
  const roster = store.roster;
  const classes = sem ? semesterClassNames(sem).length : 0;
  const current = store.currentSubject;
  return [
    h('div', { class: 'side-scroll', key: 'scroll' },
      h('div', { class: 'side-brand' }, h('span', { class: 'app-icon' }, icon('flask')), '實習課管理'),
      h('div', { class: 'side-section' }, h('h3', null, '學期'),
        item({ iconName: 'calendar', title: sem?.name ?? '學期', detail: '切換', onclick: open(openSemesters), id: 'menu-semesters' })),
      h('div', { class: 'side-section' }, h('h3', null, '學生名冊'),
        item({ iconName: 'people', title: '學生名冊', detail: roster.length ? `${roster.length} 人·${classes} 班` : '尚未建立', onclick: open(openMasterRoster), id: 'menu-roster' })),
      h('div', { class: 'side-section' }, h('h3', null, '科目'),
        store.subjects.map((s) => item({
          iconName: s.id === current?.id ? 'bookFill' : 'book', title: s.name, sub: `${s.students.length} 人`, current: s.id === current?.id, chevron: false,
          id: `menu-subject-${s.id}`, onclick: () => { store.selectSubject(s.id); closeMenuDrawer(); },
        })),
        store.subjects.length ? null : h('div', { class: 'note', style: 'padding: 4px 20px 8px' }, '這學期還沒有科目'),
        item({ iconName: 'pencil', title: '編輯科目', detail: '新增、刪除', onclick: open(openSubjectEditor), id: 'menu-edit-subjects' }))),
    h('div', { class: 'side-footer', key: 'footer' },
      item({
        iconName: 'gear', title: '設定與備份', onclick: open(openBackup), id: 'menu-settings',
        sub: sync.state.enabled ? `雲端同步：${syncStatusText()}` : null, subWarn: syncNeedsAttention(),
      })),
  ];
}
