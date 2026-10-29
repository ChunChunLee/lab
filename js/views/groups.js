// 「分組」分頁：自己建立組別、從 Excel 匯入、隨機分組；可以分大組；點學生設組長或移組，電腦和 iPad 可以拖曳
import { h, icon, frag } from '../ui/dom.js';
import {
  section, row, sheetView, openSheet, closeSheet, rerender, confirmDialog, promptDialog, barButton, showMenu, empty, button,
  segmented, select, fieldRow, input, toggleRow, stepperRow, choiceRows, layout,
} from '../ui/kit.js';
import { store } from '../store.js';
import {
  activeGroupSet, groupSections, hasSections, nextSectionName, nextGroupName, fullGroupName, orderedMembers, unassignedStudents,
  studentsByID, sortedStudents, hasMultipleClasses, sortBySeat, sectionName as sectionNameAt,
} from '../model.js';
import { trimmed, displaySeat } from '../format.js';
import { makeSectionedGroups, SeededGenerator } from '../logic/groupMaker.js';
import { planFromSheets, FAILURES } from '../logic/groupImport.js';
import { exportMenuItems, exportReport, pickFile, readSpreadsheet, SPREADSHEET_ACCEPT } from '../io/exporter.js';
import { openAddFromRoster } from './roster.js';
import { prefs } from '../ui/kit.js';

const view = { setID: null };

function currentSet(s) {
  return s.groupSets.find((g) => g.id === view.setID) ?? activeGroupSet(s);
}

export function render() {
  const s = store.currentSubject;
  const set = currentSet(s);
  const actions = set ? [barButton('more', {
    label: '更多', id: 'groups-more',
    onclick: (e) => showMenu(e.currentTarget, [
      { label: `新增大組（${nextSectionName(set)}）…`, icon: 'stack', action: () => openGroupEditor(set.id, { section: nextSectionName(set) }) },
      { label: '全部移到未分組…', icon: 'undo', destructive: true, disabled: !set.groups.some((g) => g.memberIDs.length), action: async () => {
        if (await confirmDialog({ title: '全部移到未分組？', confirm: '全部移到未分組', message: '所有組員和組長都會清空，組別保留。' })) store.clearGroups(set.id);
      } },
      { divider: true },
      ...exportMenuItems({ type: 'groups', setID: set.id }),
    ]),
  })] : null;

  if (!s.students.length) {
    return { actions, body: empty('這個科目還沒有學生', '先到「名冊」從學生名冊加入學生，才能分組。', button('從學生名冊加入', { kind: 'filled', onclick: openAddFromRoster })) };
  }
  if (!set) {
    return {
      actions,
      body: empty('還沒有分組', '可以自己建立組別再把學生加進去、從 Excel 匯入分好的名單，或讓 App 隨機分組。',
        button('新增組別', { kind: 'filled', iconName: 'plus', onclick: () => openGroupEditor(null, {}), id: 'groups-add-empty' }),
        button('從 Excel 匯入', { kind: 'gray', iconName: 'table', onclick: () => openGroupImport(null) }),
        button('隨機分組', { kind: 'gray', iconName: 'shuffle', onclick: () => openRandom(null) })),
    };
  }
  return { actions, body: board(s, set) };
}

// MARK: 看板

function board(s, set) {
  const byID = studentsByID(s);
  const unassigned = unassignedStudents(s, set);
  const assigned = s.students.length - unassigned.length;
  const sections = groupSections(set);
  const loose = set.groups.filter((g) => !g.section);
  const showUnassigned = unassigned.length > 0 || !set.groups.length;
  const isActive = activeGroupSet(s)?.id === set.id;

  return [
    h('div', { class: 'group-controls', key: 'controls' },
      h('div', { class: 'split' },
        h('button', { type: 'button', class: 'set-menu', id: 'set-menu', onclick: (e) => setMenu(e, s, set, isActive) },
          h('span', null, set.name), icon('chevronDown')),
        isActive ? h('span', { class: 'badge' }, icon('starFill'), '目前使用')
          : button('設為目前使用', { kind: 'tinted', small: true, onclick: () => { store.setActiveGroupSet(set.id); store.showToast(`「${set.name}」設為目前使用的分組`); } })),
      h('div', { class: 'btn-row group-actions' },
        button('新增組別', { kind: 'filled', iconName: 'plus', small: true, onclick: () => openGroupEditor(set.id, {}), id: 'groups-add' }),
        button(layout() === 'phone' ? 'Excel 匯入' : '從 Excel 匯入', { kind: 'gray', iconName: 'table', small: true, onclick: () => openGroupImport(set.id), id: 'groups-import' }),
        button('隨機分組', { kind: 'gray', iconName: 'shuffle', small: true, onclick: () => openRandom(set.id), id: 'groups-random' })),
      h('p', { class: ['note', { warn: unassigned.length && set.groups.length }], style: 'margin:0' },
        `共 ${sections.length ? `${sections.length} 個大組、` : ''}${set.groups.length} 組·已分組 ${assigned} 人·未分組 ${unassigned.length} 人`)),
    loose.length || (!sections.length && showUnassigned)
      ? h('div', { class: 'cards', key: 'loose' }, loose.map((g) => groupCard(s, set, g, byID)), !sections.length && showUnassigned ? unassignedCard(s, set, unassigned) : null)
      : null,
    sections.map((sec) => {
      const groups = set.groups.filter((g) => g.section === sec);
      const n = groups.reduce((t, g) => t + g.memberIDs.length, 0);
      return h('div', { class: 'section-block', key: `sec-${sec}`, id: `section-${sec}` },
        h('div', { class: 'section-head' },
          h('h2', null, sec), h('span', { class: 'note num' }, `${groups.length} 組·${n} 人`), h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'icon-btn', style: 'color:var(--tint)', 'aria-label': `${sec} 的更多操作`, onclick: (e) => showMenu(e.currentTarget, [
            { label: '重新命名大組…', icon: 'pencil', action: async () => { const n2 = await promptDialog({ title: '重新命名大組', value: sec }); if (n2 !== null) store.renameSection(sec, n2, set.id); } },
            { label: `在${sec}新增一組…`, icon: 'plus', action: () => openGroupEditor(set.id, { section: sec }) },
          ]) }, icon('more', 'small'))),
        h('div', { class: 'cards' }, groups.map((g) => groupCard(s, set, g, byID))));
    }),
    sections.length && showUnassigned ? h('div', { class: 'cards', key: 'unassigned' }, unassignedCard(s, set, unassigned)) : null,
    h('p', { class: 'note', key: 'hint', style: 'margin-top:18px' }, '「新增組別」可以自己建立一組並選組員；組別卡片下方的「加入學生」可以再加人。點一下學生可以設為組長或移到別組；電腦和 iPad 也可以直接拖曳學生。'),
  ];
}

function memberButton(s, set, st, groupID, leader) {
  return h('button', {
    type: 'button', class: ['member', { leader }], key: st.id, draggable: 'true', id: `member-${st.name}`,
    ondragstart: (e) => { e.dataTransfer.setData('text/plain', st.id); e.dataTransfer.effectAllowed = 'move'; },
    onclick: (e) => memberMenu(e, s, set, st, groupID),
  },
  leader ? icon('starFill', 'leader-star') : h('span', { class: 'dot' }),
  h('span', { class: 'seat' }, displaySeat(st.seat)),
  h('span', { class: 'member-name' }, st.name),
  leader ? h('span', { class: 'leader-tag' }, '組長') : null);
}

function dropZone(set, groupID) {
  return {
    ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('drop'); },
    ondragleave: (e) => e.currentTarget.classList.remove('drop'),
    ondrop: (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove('drop');
      const id = e.dataTransfer.getData('text/plain');
      if (id) store.moveStudent(id, groupID, set.id);
    },
  };
}

function groupCard(s, set, g, byID) {
  const members = orderedMembers(g, byID);
  return h('div', { class: 'group-card', key: g.id, id: `group-${fullGroupName(g)}`, ...dropZone(set, g.id) },
    h('div', { class: 'group-card-head' },
      h('b', null, g.name), h('span', { class: 'note num' }, `${members.length} 人`), h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'icon-btn', style: 'color:var(--tint)', 'aria-label': `${fullGroupName(g)} 的更多操作`, onclick: (e) => groupMenu(e, set, g) }, icon('ellipsis', 'small'))),
    h('div', { class: 'group-card-body' }, members.map((st) => memberButton(s, set, st, g.id, st.id === g.leaderID))),
    h('button', { type: 'button', class: 'add-members', onclick: () => openGroupEditor(set.id, { groupID: g.id }), 'aria-label': `在${fullGroupName(g)}加入學生` }, icon('plusCircle'), '加入學生'));
}

function unassignedCard(s, set, list) {
  return h('div', { class: 'group-card unassigned', key: 'unassigned', id: 'group-未分組', ...dropZone(set, null) },
    h('div', { class: 'group-card-head' }, h('b', null, '未分組'), h('span', { class: 'note num' }, `${list.length} 人`)),
    h('div', { class: 'group-card-body' }, list.length ? list.map((st) => memberButton(s, set, st, null, false)) : h('p', { class: 'note', style: 'padding:6px 12px' }, '把學生拖到這裡')));
}

function memberMenu(e, s, set, st, groupID) {
  const g = set.groups.find((x) => x.id === groupID);
  const items = [{ header: `${displaySeat(st.seat)} ${st.name}` }];
  if (g) items.push(g.leaderID === st.id
    ? { label: '取消組長', icon: 'star', action: () => store.setLeader(null, g.id, set.id) }
    : { label: '設為組長', icon: 'starFill', action: () => store.setLeader(st.id, g.id, set.id) });
  const others = set.groups.filter((x) => x.id !== groupID);
  if (others.length) items.push({ label: '移到…', icon: 'move', submenu: others.map((x) => ({ label: fullGroupName(x), action: () => store.moveStudent(st.id, x.id, set.id) })) });
  if (groupID) items.push({ label: '移到未分組', icon: 'undo', action: () => store.moveStudent(st.id, null, set.id) });
  showMenu(e.currentTarget, items);
}

function groupMenu(e, set, g) {
  const sections = groupSections(set).filter((x) => x !== g.section);
  showMenu(e.currentTarget, [
    { label: '編輯組別（名稱、組員）…', icon: 'pencil', action: () => openGroupEditor(set.id, { groupID: g.id }) },
    { label: '移到大組', icon: 'stack', submenu: [
      ...sections.map((sec) => ({ label: `移到${sec}`, action: () => store.moveGroup(g.id, sec, set.id) })),
      { label: `移到新的大組（${nextSectionName(set)}）`, action: () => store.moveGroup(g.id, nextSectionName(set), set.id) },
      ...(g.section ? [{ label: '不分大組', action: () => store.moveGroup(g.id, null, set.id) }] : []),
    ] },
    { divider: true },
    { label: '刪除這一組…', icon: 'trash', destructive: true, action: async () => {
      const ok = await confirmDialog({ title: `刪除「${fullGroupName(g)}」？`, confirm: '刪除這一組', message: g.memberIDs.length ? `這一組的 ${g.memberIDs.length} 位組員會移到「未分組」。` : '這一組沒有組員。' });
      if (ok) store.deleteGroup(g.id, set.id);
    } },
  ]);
}

function setMenu(e, s, set, isActive) {
  showMenu(e.currentTarget, [
    { header: '分組方案' },
    ...s.groupSets.map((x) => ({ label: x.id === activeGroupSet(s)?.id ? `${x.name}（目前使用）` : x.name, checked: x.id === set.id, action: () => { view.setID = x.id; rerender(); } })),
    { divider: true },
    { label: '新增分組方案…', icon: 'plus', action: async () => { const n = await promptDialog({ title: '新增分組方案', placeholder: '例如：下學期' }); if (n !== null) { view.setID = store.addGroupSet(n); rerender(); } } },
    isActive ? null : { label: '設為目前使用', icon: 'starFill', action: () => store.setActiveGroupSet(set.id) },
    { label: '重新命名…', icon: 'pencil', action: async () => { const n = await promptDialog({ title: '重新命名分組方案', value: set.name }); if (n !== null) store.renameGroupSet(set.id, n); } },
    { label: '複製這個方案', icon: 'copy', action: () => { view.setID = store.duplicateGroupSet(set.id); rerender(); } },
    { label: '刪除這個方案…', icon: 'trash', destructive: true, action: async () => {
      if (await confirmDialog({ title: `刪除分組方案「${set.name}」？`, confirm: '刪除方案', message: '只會刪除這一套分組，學生和其他分組方案不受影響。' })) { store.deleteGroupSet(set.id); view.setID = null; }
    } },
  ].filter(Boolean), { align: 'left' });
}

// MARK: 新增、編輯組別

const NEW_SECTION = '\u0001new';

/** target：{ groupID } 編輯，或 { section } 新增到這個大組 */
export function openGroupEditor(setID, target) {
  const s0 = store.currentSubject;
  const set0 = s0.groupSets.find((g) => g.id === setID);
  const editing = target.groupID ? set0?.groups.find((g) => g.id === target.groupID) : null;
  const memberSet = new Set(editing?.memberIDs ?? []);
  const groupOf0 = new Map();
  for (const g of set0?.groups ?? []) if (g.id !== editing?.id) for (const m of g.memberIDs) groupOf0.set(m, g);
  const anyUngrouped = s0.students.some((st) => !memberSet.has(st.id) && !groupOf0.has(st.id));

  openSheet((sheet) => {
    const st = sheet.state;
    const s = store.currentSubject;
    const set = s.groupSets.find((g) => g.id === setID);
    const sections = groupSections(set);
    const chosen = st.sectionTag === NEW_SECTION ? (trimmed(st.newSection) || null) : (st.sectionTag || null);
    const defaultName = set ? nextGroupName(set, chosen) : '第1組';
    const groupOf = new Map();
    for (const g of set?.groups ?? []) if (g.id !== editing?.id) for (const m of g.memberIDs) groupOf.set(m, g);
    const students = sortedStudents(s);
    const byID = studentsByID(s);
    const members = new Set(st.members);
    const notMembers = students.filter((x) => !members.has(x.id));
    const ungrouped = notMembers.filter((x) => !groupOf.has(x.id));
    const q = trimmed(st.search);
    const candidates = notMembers.filter((x) => (!st.onlyUngrouped || !groupOf.has(x.id))
      && (!q || x.name.includes(q) || x.studentNo.includes(q) || x.seat === q || x.className.includes(q)));
    const showClass = hasMultipleClasses(s);

    const save = () => {
      const sid = store.ensureGroupSet(setID);
      store.saveGroup(editing?.id ?? null, sid, {
        name: !trimmed(st.name) && !editing ? defaultName : st.name, section: chosen, memberIDs: st.members, leaderID: st.leaderID,
      });
      closeSheet(sheet);
    };

    return sheetView({
      title: editing ? '編輯組別' : '新增組別', onCancel: () => closeSheet(sheet),
      confirm: { label: editing ? '儲存' : '新增', disabled: st.sectionTag === NEW_SECTION && !trimmed(st.newSection), action: save },
      body: [
        section({ header: '組別', footer: `完整名稱：${(chosen ?? '') + (trimmed(st.name) || defaultName)}` },
          fieldRow('大組', select([{ value: '', label: '不分大組' }, ...sections.map((x) => ({ value: x, label: x })), { value: NEW_SECTION, label: '新增大組…' }], st.sectionTag,
            (v) => { st.sectionTag = v; if (v === NEW_SECTION && !trimmed(st.newSection)) st.newSection = set ? nextSectionName(set) : sectionNameAt(0); rerender(); }, { id: 'group-section', label: '大組' })),
          st.sectionTag === NEW_SECTION ? fieldRow('大組名稱', input({ value: st.newSection, align: 'right', placeholder: '例如：A大組', oninput: (v) => { st.newSection = v; rerender(); }, id: 'group-new-section' })) : null,
          fieldRow('組名', input({ value: st.name, align: 'right', placeholder: defaultName, oninput: (v) => { st.name = v; rerender(); }, id: 'group-name' }))),
        section({ header: `組員（${st.members.length} 人）`, footer: st.members.length ? '點 ☆ 設為組長，點 ⊖ 移出這一組。' : null },
          st.members.length ? sortBySeat(st.members.map((id) => byID.get(id)).filter(Boolean)).map((x) => {
            const leader = x.id === st.leaderID;
            return h('div', { class: 'row', key: x.id },
              h('button', { type: 'button', class: ['icon-btn', 'star', { on: leader }], 'aria-label': leader ? `取消 ${x.name} 的組長` : `把 ${x.name} 設為組長`, onclick: () => { st.leaderID = leader ? null : x.id; rerender(); } }, icon(leader ? 'starFill' : 'star', 'small')),
              h('span', { class: 'seat' }, displaySeat(x.seat)),
              h('span', { class: 'row-main' }, h('span', { style: leader ? 'font-weight:600' : null }, x.name, leader ? h('span', { class: 'leader-tag', style: 'margin-left:6px' }, '組長') : null)),
              showClass ? h('span', { class: 'note' }, x.className) : null,
              h('button', { type: 'button', class: 'icon-btn remove', 'aria-label': `把 ${x.name} 移出這一組`, onclick: () => { st.members = st.members.filter((m) => m !== x.id); if (st.leaderID === x.id) st.leaderID = null; rerender(); } }, icon('minusCircleFill', 'small')));
          }) : row({ label: h('span', { class: 'muted' }, '還沒有組員，從下面的名單點選學生加入。') })),
        section({ header: '加入學生', footer: st.onlyUngrouped ? null : '已經在別組的學生，加進來會從原本的組移過來。' },
          h('div', { class: 'row', key: 'search' }, h('div', { class: 'search', style: 'flex:1' }, icon('search'),
            h('input', { type: 'search', placeholder: '搜尋姓名、學號或座號', value: st.search, oninput: (e) => { st.search = e.target.value; rerender(); } }))),
          h('div', { class: 'row', key: 'filter' }, h('div', { style: 'flex:1' }, segmented([
            { value: true, label: `未分組（${ungrouped.length}）` }, { value: false, label: `全部學生（${notMembers.length}）` }], st.onlyUngrouped, (v) => { st.onlyUngrouped = v; rerender(); }, { label: '顯示' }))),
          candidates.map((x) => {
            const g = groupOf.get(x.id);
            return row({
              key: x.id, id: `pick-${x.name}`, leading: icon('plusCircle', 'tint'),
              label: h('span', null, h('span', { class: 'seat' }, displaySeat(x.seat)), ' ', x.name),
              detail: g ? h('span', { class: 'warn', style: 'font-size:14px' }, `在${fullGroupName(g)}`) : showClass ? x.className : null,
              onclick: () => { st.members.push(x.id); rerender(); },
            });
          }),
          candidates.length ? null : row({ label: h('span', { class: 'muted' }, !students.length ? '這個科目的名冊還沒有學生' : q ? '找不到符合的學生' : st.onlyUngrouped && !ungrouped.length ? '所有學生都分好組了。要從別組調人，請切換到「全部學生」。' : '沒有其他學生了') })),
      ],
    });
  }, {
    state: {
      name: editing?.name ?? '', sectionTag: (editing ? editing.section : target.section) ?? '', newSection: '',
      members: [...(editing?.memberIDs ?? [])], leaderID: editing?.leaderID ?? null, search: '', onlyUngrouped: anyUngrouped,
    },
  });
}

// MARK: 隨機分組

/** initialSections：一打開預設分成幾個大組（從打掃分頁來的時候是 2） */
export function openRandom(setID, { initialSections = null, onDone } = {}) {
  const s0 = store.currentSubject;
  const set0 = s0.groupSets.find((g) => g.id === setID);
  openSheet((sheet) => {
    const st = sheet.state;
    const s = store.currentSubject;
    const set = s.groupSets.find((g) => g.id === setID);
    const ids = s.students.map((x) => x.id);
    const hasMembers = set?.groups.some((g) => g.memberIDs.length);
    const preview = makeSectionedGroups(ids, { sections: st.sections, groupSize: st.groupSize, shuffle: false, randomLeaders: false, rng: new SeededGenerator(1) });
    const sizes = preview.map((g) => g.memberIDs.length);
    const nSec = new Set(preview.map((g) => g.section).filter(Boolean)).size;
    const lo = Math.min(...sizes), hi = Math.max(...sizes);
    const run = (shuffle) => {
      const sid = store.ensureGroupSet(setID);
      store.setSectionCount(st.sections, sid);
      store.setGroupSize(st.groupSize, sid);
      store.regroup(sid, { shuffle, randomLeaders: st.leaders });
      prefs.set('randomLeaders', st.leaders);
      const updated = store.currentSubject.groupSets.find((g) => g.id === sid);
      const secText = groupSections(updated).length > 1 ? `${groupSections(updated).length} 個大組、` : '';
      store.showToast(`${shuffle ? '已隨機分成' : '已依座號分成'} ${secText}${updated.groups.length} 組`);
      view.setID = sid;
      closeSheet(sheet);
      onDone?.(sid);
    };
    return sheetView({
      title: '隨機分組', onCancel: () => closeSheet(sheet),
      body: [
        section({ footer: ids.length ? `${ids.length} 位學生 → ${nSec > 1 ? `${nSec} 個大組、` : ''}共 ${preview.length} 組（${lo === hi ? `每組 ${hi} 人` : `每組 ${lo}～${hi} 人`}）` : '這個科目的名冊還沒有學生。' },
          stepperRow(st.sections === 1 ? '不分大組' : `分成 ${st.sections} 個大組`, st.sections, (v) => { st.sections = v; rerender(); }, { min: 1, max: 8, label: '大組數', key: 'sections' }),
          stepperRow(`每組最多 ${st.groupSize} 人`, st.groupSize, (v) => { st.groupSize = v; rerender(); }, { min: 2, max: 12, label: '每組人數', key: 'size' }),
          toggleRow('隨機指定組長', st.leaders, (v) => { st.leaders = v; rerender(); })),
        section({ footer: hasMembers ? h('span', { class: 'warn' }, `「${set.name}」目前的組別、組員和組長會被新的分組取代。想保留的話，先在方案選單「複製這個方案」。`) : null },
          row({ label: hasMembers ? '重新隨機分組' : '隨機分組', tint: true, leading: icon('shuffle', 'tint'), disabled: !ids.length, onclick: () => run(true), id: 'run-random' }),
          row({ label: '依座號順序分組', tint: true, leading: icon('listNumber', 'tint'), disabled: !ids.length, onclick: () => run(false), id: 'run-sequential' })),
      ],
    });
  }, { state: { sections: initialSections ?? set0?.sectionCount ?? 1, groupSize: set0?.groupSize ?? 4, leaders: prefs.get('randomLeaders', true) } });
}

// MARK: 從 Excel 匯入分組

export function openGroupImport(setID, { onDone } = {}) {
  openSheet((sheet) => {
    const st = sheet.state;
    const s = store.currentSubject;
    const set = s.groupSets.find((g) => g.id === setID);
    const byID = studentsByID(s);
    const plan = st.plan;
    if (!plan) {
      return sheetView({
        title: '從 Excel 匯入分組', onCancel: () => closeSheet(sheet),
        body: [
          section({ header: 'Excel 格式', footer: '第一列寫欄位名稱，之後每位學生一列。大組可以寫 A、B（會變成「A大組」），小組可以寫 1、2（會變成「第1組」）。沒有大組就不用那一欄；學號和姓名至少要有一個，沒有學號就用姓名比對。大組、小組用合併儲存格也可以。' },
            h('div', { style: 'padding:12px' }, exampleTable([['大組', '小組', '學號', '姓名'], ['A', '1', '11201', '王小明'], ['A', '1', '11202', '李小華'], ['A', '2', '11205', '陳大文'], ['B', '1', '11210', '林美玲']]))),
          section({ footer: st.error ? h('span', { class: 'red' }, st.error) : '範本會列出這個科目的所有學生，在 Excel 填上大組和小組後存檔，再回來選擇這個檔案。' },
            row({ label: '選擇 Excel 或 CSV 檔…', tint: true, leading: icon('folder', 'tint'), id: 'group-import-pick', onclick: async () => {
              const file = await pickFile(SPREADSHEET_ACCEPT);
              if (!file) return;
              const r = await readSpreadsheet(file, { fillMergedCells: true });
              if (r.error) { st.error = r.error; rerender(); return; }
              const res = planFromSheets(r.sheets, store.currentSubject.students);
              if (res.error) { st.error = FAILURES[res.error]; rerender(); return; }
              st.error = null;
              st.fileName = file.name;
              st.newSetName = file.name.replace(/\.[^.]+$/, '');
              st.intoNewSet = !!set?.groups.some((g) => g.memberIDs.length);
              st.plan = res.plan;
              rerender();
            } }),
            row({ label: '匯出範本（已填好這科的學號、姓名）', tint: true, leading: icon('share', 'tint'), onclick: () => exportReport({ type: 'groupTemplate', setID }, 'xlsx') })),
        ],
      });
    }
    const rest = s.students.length - plan.matchedCount;
    const toNew = !set || st.intoNewSet;
    return sheetView({
      title: '從 Excel 匯入分組', onCancel: () => closeSheet(sheet),
      confirm: {
        label: '匯入', disabled: !plan.groups.length || (toNew && !trimmed(st.newSetName)),
        action: () => {
          const sid = store.applyGroupImport(plan, toNew ? { newSet: st.newSetName } : { replace: set.id });
          store.showToast(`已匯入 ${plan.sections.length ? `${plan.sections.length} 個大組、` : ''}${plan.groups.length} 組、${plan.matchedCount} 位學生`);
          view.setID = sid;
          closeSheet(sheet);
          onDone?.(sid);
        },
      },
      body: [
        section({ header: '讀到的內容', footer: rest > 0 ? `這科還有 ${rest} 位學生沒有分到組，匯入後會放在「未分組」。` : null },
          row({ label: '檔案', detail: plan.sheetName ? `${st.fileName}（${plan.sheetName}）` : st.fileName }),
          row({ label: '組別', detail: plan.sections.length ? `${plan.sections.length} 個大組、${plan.groups.length} 組` : `${plan.groups.length} 組` }),
          row({ label: '分到組的學生', detail: `${plan.matchedCount} 人` })),
        plan.problems.length ? section({ header: `略過 ${plan.problems.length} 列`, footer: '這些學生不會匯入。可以修改 Excel 後重新選擇檔案，或匯入後再手動加進組裡。' },
          plan.problems.map((p) => row({ key: `p${p.row}`, label: `第 ${p.row} 列：${p.who}`, sub: h('span', { class: 'warn' }, p.reason) }))) : null,
        section({ header: '匯入到', footer: toNew ? '匯入的分組會設為目前使用；原本的分組方案都會保留。' : `「${set.name}」原本的組別、組員和組長會被取代。` },
          set ? choiceRows([{ value: false, label: `取代「${set.name}」` }, { value: true, label: '另存成新的分組方案' }], st.intoNewSet, (v) => { st.intoNewSet = v; rerender(); }) : null,
          toNew ? fieldRow('方案名稱', input({ value: st.newSetName, align: 'right', oninput: (v) => { st.newSetName = v; rerender(); } })) : null),
        section({ header: '預覽' }, plan.groups.map((g) => row({
          key: `${g.section}-${g.name}`, label: h('b', null, (g.section ?? '') + g.name), detail: `${g.memberIDs.length} 人`,
          sub: orderedMembers({ ...g }, byID).map((m) => (m.id === g.leaderID ? '★' : '') + m.name).join('、'),
        }))),
        section({}, row({ label: '重新選擇檔案', tint: true, leading: icon('undo', 'tint'), onclick: () => { st.plan = null; rerender(); } })),
      ],
    });
  }, { state: { plan: null, error: null, fileName: '', newSetName: '', intoNewSet: false } });
}

export function exampleTable(rows) {
  return h('table', { class: 'sheet-example' }, h('tbody', null, rows.map((r, i) => h('tr', { key: `r${i}` }, r.map((c, j) => h('td', { key: `c${j}` }, c))))));
}

export { frag };
