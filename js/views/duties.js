// 「打掃」分頁：分配打掃工作（每個大組分開）和打掃檢查表
import { h, icon, frag } from '../ui/dom.js';
import {
  section, row, sheetView, openSheet, closeSheet, rerender, confirmDialog, barButton, showMenu, button, segmented, chip, prefs,
  fieldRow, input, textarea, toggleRow, choiceRows,
} from '../ui/kit.js';
import { store } from '../store.js';
import {
  dutySections, dutiesIn, studentsInSection, studentsByID, sortBySeat, sortedStudents, activeGroupSet, groupSections, fullGroupName,
  dutyCheck, dutyCheckDays, checkResult, newDuty,
} from '../model.js';
import { trimmed, displaySeat, dayWithWeekday, fileDate, parseFileDate, startOfDay, isSameDay } from '../format.js';
import { jobsFromText, planFromSheets } from '../logic/dutyImport.js';
import { exportMenuItems, exportReport, pickFile, readSpreadsheet, SPREADSHEET_ACCEPT } from '../io/exporter.js';
import { selectTab } from '../app.js';
import { openRandom, openGroupImport, exampleTable } from './groups.js';

const view = {
  mode: prefs.get('dutyMode', 'assign'), // 'assign' | 'checklist'
  key: null, // 選到的大組；'' 代表不分大組
  date: startOfDay(new Date()),
  showUnassigned: false,
};

const people = (list) => list.map((s) => `${displaySeat(s.seat)} ${s.name}`).join('、');

/** 分頁：各大組，加上還有「不分大組」的打掃工作時的那一頁；沒有大組就只有一頁（''） */
function tabs(s) {
  const sections = dutySections(s);
  if (!sections.length) return [''];
  return [...sections, ...(dutiesIn(s, null).length ? [''] : [])];
}

export function render() {
  const s = store.currentSubject;
  const t = tabs(s);
  const key = t.includes(view.key) ? view.key : t[0];
  const section = key || null;
  const sectioned = dutySections(s).length > 0;

  const topbar = frag(
    h('div', { class: 'duty-mode', key: 'mode' }, segmented([{ value: 'assign', label: '分配', id: 'duty-mode-assign' }, { value: 'checklist', label: '檢查表', id: 'duty-mode-checklist' }], view.mode,
      (v) => { view.mode = v; prefs.set('dutyMode', v); rerender(); }, { label: '畫面' })),
    sectionChips(s, t, key, sectioned));

  if (view.mode === 'checklist') {
    return {
      topbar,
      actions: [barButton('more', { label: '匯出與列印檢查表', id: 'checklist-more', onclick: (e) => showMenu(e.currentTarget, exportMenuItems({ type: 'dutyChecklist', section }, '列印檢查表（沒有紀錄的日期是空白欄）…')) })],
      body: checklist(s, section),
    };
  }

  const duties = dutiesIn(s, section);
  const others = t.filter((k) => k !== key && dutiesIn(s, k || null).length);
  return {
    topbar,
    actions: [
      barButton('plus', { label: '新增打掃工作', id: 'duty-add', onclick: (e) => showMenu(e.currentTarget, addItems(section)) }),
      barButton('more', {
        label: '匯出與列印', id: 'duty-more',
        onclick: (e) => showMenu(e.currentTarget, [
          others.length ? { label: '複製其他大組的打掃工作', icon: 'copy', submenu: others.map((k) => ({ label: k || '不分大組', action: () => {
            const n = store.copyDuties(k || null, section);
            store.showToast(n ? `已複製 ${n} 項打掃工作（不含學生）` : '沒有新的打掃工作可以複製');
          } })) } : null,
          sectioned && dutiesIn(s, null).length ? { label: '把「不分大組」分到各大組…', icon: 'split', action: confirmDistribute } : null,
          { label: '匯出填寫表（填入學號後匯入）', icon: 'doc', action: () => exportReport({ type: 'dutyTemplate' }, 'xlsx') },
          { divider: true },
          ...exportMenuItems({ type: 'duties' }),
        ].filter(Boolean)),
      }),
    ],
    body: assign(s, section, sectioned, duties),
  };
}

function addItems(section) {
  return [
    { label: '新增一項…', icon: 'plus', action: () => openDutyEdit(null, section), id: 'duty-add-one' },
    { label: '輸入多項（每行一項）…', icon: 'text', action: () => openBulkAdd(section), id: 'duty-add-bulk' },
    { label: '從 Excel 匯入…', icon: 'table', action: openDutyImport, id: 'duty-add-import' },
  ];
}

function sectionChips(s, t, key, sectioned) {
  const title = (k) => (k ? k : sectioned ? '不分大組' : '全部');
  return h('div', { class: 'chips', key: 'chips' },
    t.map((k) => chip(title(k), { on: k === key, count: dutiesIn(s, k || null).length, key: `t-${k}`, id: `duty-section-${title(k)}`, onclick: () => { view.key = k; rerender(); } })),
    sectioned ? null : frag(
      chip('分大組', { dashed: true, iconName: 'plus', key: 'split', id: 'duty-split', onclick: (e) => showMenu(e.currentTarget, [
        { label: '隨機或依座號分大組…', icon: 'shuffle', id: 'split-random', action: () => openRandom(activeGroupSet(s)?.id ?? null, { initialSections: 2, onDone: () => { view.key = null; } }) },
        { label: '從 Excel 匯入分組…', icon: 'table', action: () => openGroupImport(activeGroupSet(s)?.id ?? null, { onDone: () => { view.key = null; } }) },
        { label: '到「分組」分頁自己分', icon: 'group', action: () => selectTab('groups') },
      ], { align: 'left' }) }),
      h('span', { class: 'chips-hint', key: 'hint' }, '各大組的打掃工作分開')));
}

async function confirmDistribute() {
  const s = store.currentSubject;
  const ok = await confirmDialog({
    title: '把「不分大組」的打掃工作分到各大組？', confirm: '分到各大組', destructive: false,
    message: `每個大組會各有一份這 ${dutiesIn(s, null).length} 項打掃工作，已指派的學生跟著自己的大組。完成後「不分大組」這一頁會移除。`,
  });
  if (!ok) return;
  store.distributeLooseDuties();
  view.key = null;
  store.showToast(`已分到 ${dutySections(store.currentSubject).length} 個大組`);
}

// MARK: 分配

function assign(s, section, sectioned, duties) {
  const byID = studentsByID(s);
  let top;
  if (sectioned && !section) {
    top = h('div', { class: 'banner', key: 'loose' },
      h('span', { class: 'note' }, '這些是分大組之前建立的打掃工作。分到各大組後，每個大組會各有一份，已指派的學生跟著自己的大組。'),
      h('div', null, button(`分到各大組（${dutySections(s).join('、')}）`, { kind: 'filled', iconName: 'split', small: true, onclick: confirmDistribute })));
  } else if (s.students.length) {
    const list = studentsInSection(s, section);
    const assigned = new Set(duties.flatMap((d) => d.studentIDs));
    const rest = list.filter((x) => !assigned.has(x.id));
    top = section_({ key: 'unassigned' },
      !list.length ? row({ label: h('span', { class: 'muted' }, `${section ?? ''}還沒有學生，請先到「分組」把學生分進組裡。`) })
        : !rest.length ? row({ label: h('span', { class: 'green' }, `${section ? `${section}` : ''}每位學生都有打掃工作`), leading: icon('checkCircleFill', 'green') })
          : frag(row({ label: h('span', { class: 'warn' }, `尚未分配：${rest.length} 人`), leading: icon('person', 'warn'), trailing: icon(view.showUnassigned ? 'chevronUp' : 'chevronDown', 'muted'), onclick: () => { view.showUnassigned = !view.showUnassigned; rerender(); }, id: 'duty-unassigned' }),
            view.showUnassigned ? row({ label: h('span', { class: 'note' }, people(rest)) }) : null));
  }
  return [
    top,
    section_({
      key: `duties-${section}`,
      header: section ? `${section}的打掃工作` : sectioned ? '不分大組的打掃工作' : '打掃區域與負責項目',
      footer: sectioned
        ? `大組依「分組」分頁目前使用的方案「${activeGroupSet(s)?.name ?? ''}」。點一列可以指派學生；每列右邊的 ⋯ 可以調整順序或刪除。`
        : '點一列可以指派學生；每列右邊的 ⋯ 可以調整順序或刪除。按上方的「分大組」把學生分成 A大組、B大組後，就可以切換大組，每個大組的打掃工作分開。',
    },
    duties.map((d, i) => {
      const list = sortBySeat(d.studentIDs.map((id) => byID.get(id)).filter(Boolean));
      return row({
        key: d.id, id: `duty-${d.name}`,
        label: h('b', { style: 'font-weight:600' }, d.name),
        sub: frag(list.length ? h('span', { style: 'color:var(--label)' }, people(list)) : null, d.note ? h('span', { class: 'note', style: 'display:block' }, d.note) : null),
        detail: list.length ? `${list.length} 人` : h('span', { class: 'warn' }, '未指派'),
        onclick: () => openDutyEdit(d, section),
        trailing: h('button', { type: 'button', class: 'icon-btn', 'aria-label': `${d.name} 的更多操作`, onclick: (e) => { e.stopPropagation(); dutyMenu(e, d, i, duties.length, section); } }, icon('ellipsis', 'small')),
      });
    }),
    duties.length ? null : h('div', { class: 'row', key: 'empty' }, h('div', { class: 'stack', style: 'flex:1' },
      h('span', { class: 'muted' }, section ? `${section}還沒有打掃工作。` : '還沒有打掃工作。'),
      h('div', { class: 'btn-row' },
        button('輸入打掃工作', { kind: 'filled', iconName: 'text', small: true, onclick: () => openBulkAdd(section), id: 'duty-empty-bulk' }),
        button('從 Excel 匯入', { kind: 'gray', iconName: 'table', small: true, onclick: openDutyImport }),
        section && dutiesIn(s, null).length ? button(`使用「不分大組」的 ${dutiesIn(s, null).length} 項`, { kind: 'gray', iconName: 'split', small: true, onclick: confirmDistribute, id: 'duty-use-loose' }) : null)))),
  ];
}

// section 名稱和上面的變數衝突，換個名字
const section_ = section;

function dutyMenu(e, d, i, count, section) {
  showMenu(e.currentTarget, [
    { label: '往上移', icon: 'arrowUp', disabled: i === 0, action: () => store.moveDuty(d.id, -1, section) },
    { label: '往下移', icon: 'arrowDown', disabled: i === count - 1, action: () => store.moveDuty(d.id, 1, section) },
    { divider: true },
    { label: '刪除…', icon: 'trash', destructive: true, action: async () => {
      const ok = await confirmDialog({ title: `刪除「${d.name}」？`, confirm: '刪除', message: d.studentIDs.length ? `會一併移除 ${d.studentIDs.length} 位學生的指派，學生本身不受影響。` : '這一項還沒有指派學生。' });
      if (ok) store.deleteDuty(d.id);
    } },
  ]);
}

// MARK: 新增、編輯一項

function openDutyEdit(duty, section) {
  openSheet((sheet) => {
    const st = sheet.state;
    const s = store.currentSubject;
    const all = st.onlyThisSection && section ? studentsInSection(s, section) : sortedStudents(s);
    const q = trimmed(st.search);
    const shown = q ? all.filter((x) => x.name.includes(q) || x.studentNo.includes(q) || x.seat === q) : all;
    const other = new Map();
    for (const d of dutiesIn(s, section)) if (d.id !== duty?.id) for (const id of d.studentIDs) other.set(id, [...(other.get(id) ?? []), d.name]);
    const set = activeGroupSet(s);
    const groups = (set?.groups ?? []).filter((g) => !section || !st.onlyThisSection || g.section === section);
    const save = () => {
      const order = sortedStudents(s).map((x) => x.id).filter((id) => st.selected.has(id));
      if (duty) store.updateDuty({ ...duty, name: trimmed(st.name), note: trimmed(st.note), studentIDs: order });
      else store.addDuty(newDuty(trimmed(st.name), trimmed(st.note), order, section));
      closeSheet(sheet);
    };
    return sheetView({
      title: duty ? '編輯打掃工作' : '新增打掃工作', onCancel: () => closeSheet(sheet),
      confirm: { label: '儲存', disabled: !trimmed(st.name), action: save },
      body: [
        section_({ header: section ?? null },
          row({ label: input({ value: st.name, placeholder: '區域或項目，例如：水槽、實習股長', oninput: (v) => { st.name = v; rerender(); }, id: 'duty-name', autofocus: !duty }) }),
          row({ label: input({ value: st.note, placeholder: '說明（選填），例如：每次下課前清洗並擦乾', oninput: (v) => { st.note = v; }, id: 'duty-note' }) })),
        section_({ header: `負責學生（已選 ${st.selected.size} 人）` },
          section ? toggleRow(`只列出${section}的學生`, st.onlyThisSection, (v) => { st.onlyThisSection = v; rerender(); }) : null,
          h('div', { class: 'row', key: 'search' }, h('div', { class: 'search', style: 'flex:1' }, icon('search'),
            h('input', { type: 'search', placeholder: '搜尋姓名、學號或座號', value: st.search, oninput: (e) => { st.search = e.target.value; rerender(); } }))),
          groups.length ? row({ label: '依分組一次選整組', tint: true, leading: icon('group', 'tint'), key: 'by-group', onclick: (e) => showMenu(e.currentTarget, groups.map((g) => ({
            label: `${fullGroupName(g)}（${g.memberIDs.length} 人）`, action: () => { for (const m of g.memberIDs) st.selected.add(m); rerender(); },
          }))) }) : null,
          st.selected.size ? row({ label: `清除已選的 ${st.selected.size} 人`, destructive: true, key: 'clear', onclick: () => { st.selected.clear(); rerender(); } }) : null,
          shown.map((x) => {
            const on = st.selected.has(x.id);
            return row({
              key: x.id, id: `duty-pick-${x.name}`, leading: icon(on ? 'checkCircleFill' : 'circle', on ? 'tint' : 'muted'),
              label: h('span', null, h('span', { class: 'seat' }, displaySeat(x.seat)), ' ', x.name),
              detail: other.get(x.id)?.join('、') ?? null,
              onclick: () => { if (on) st.selected.delete(x.id); else st.selected.add(x.id); rerender(); },
            });
          }),
          shown.length ? null : row({ label: h('span', { class: 'muted' }, all.length ? '找不到符合的學生' : '名冊還沒有學生') })),
        duty ? section_({}, row({ label: '刪除這一項', destructive: true, onclick: async () => {
          const ok = await confirmDialog({ title: `刪除「${duty.name}」？`, confirm: '刪除' });
          if (ok) { store.deleteDuty(duty.id); closeSheet(sheet); }
        } })) : null,
      ],
    });
  }, { state: { name: duty?.name ?? '', note: duty?.note ?? '', selected: new Set(duty?.studentIDs ?? []), search: '', onlyThisSection: true } });
}

// MARK: 輸入多項

const ALL = '\u0001all';

function openBulkAdd(section) {
  const sections0 = dutySections(store.currentSubject);
  openSheet((sheet) => {
    const st = sheet.state;
    const s = store.currentSubject;
    const sections = dutySections(s);
    const jobs = jobsFromText(st.text);
    const targets = !sections.length ? [null] : st.target === ALL ? sections : [st.target || null];
    const existing = new Set(targets.flatMap((t) => dutiesIn(s, t).map((d) => d.name)));
    return sheetView({
      title: '輸入打掃工作', onCancel: () => closeSheet(sheet),
      confirm: {
        label: '新增', disabled: !jobs.length, action: () => {
          const added = store.addDuties(jobs, targets);
          const skipped = jobs.length * targets.length - added;
          store.showToast(`已新增 ${added} 項打掃工作${skipped > 0 ? `（已經有的 ${skipped} 項略過）` : ''}`);
          if (targets.length === 1) view.key = targets[0] ?? '';
          closeSheet(sheet);
          setTimeout(() => document.querySelector('#content .group:last-of-type .row:last-child')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
        },
      },
      body: [
        section_({ header: '每一行是一項打掃工作', footer: '冒號後面的文字會當成說明，例如「水槽：下課前清洗並擦乾」。也可以從 Excel 複製一欄貼上。已經有的打掃工作會略過。' },
          textarea({ value: st.text, placeholder: '實驗桌\n水槽：下課前清洗並擦乾\n地板\n廢液桶', rows: 8, oninput: (v) => { st.text = v; rerender(); }, id: 'duty-bulk-text', autofocus: true })),
        sections.length ? section_({ header: '加到' }, choiceRows([...sections.map((x) => ({ value: x, label: x })), { value: ALL, label: `所有大組（${sections.join('、')}）` }], st.target, (v) => { st.target = v; rerender(); })) : null,
        jobs.length ? section_({ header: `預覽（${jobs.length} 項）` }, jobs.map((j) => row({ key: j.name, label: j.name, sub: j.note || null, detail: existing.has(j.name) ? '已經有了' : null }))) : null,
      ],
    });
  }, { state: { text: '', target: section ?? (sections0.length ? ALL : '') } });
}

// MARK: 從 Excel 匯入

function openDutyImport() {
  openSheet((sheet) => {
    const st = sheet.state;
    const s = store.currentSubject;
    const byID = studentsByID(s);
    const sections = groupSections(activeGroupSet(s));
    const plan = st.plan;
    if (!plan) {
      return sheetView({
        title: '從 Excel 匯入打掃工作', onCancel: () => closeSheet(sheet),
        body: [
          section_({ header: 'Excel 格式', footer: '第一列寫欄位名稱，之後每項打掃工作一列。「說明」可以不要；「學號」可以填好幾格，也可以在一格裡用「、」隔開，沒有學號也可以寫姓名。只寫打掃工作、不填學號，就只匯入工作清單。' },
            h('div', { style: 'padding:12px' }, exampleTable([['打掃工作', '說明', '學號', '學號', '學號'], ['實驗桌', '擦桌面', '11201', '11230', ''], ['水槽', '', '11202', '11231', ''], ['廢液桶', '', '11205', '', '']]))),
          section_({
            footer: st.error ? h('span', { class: 'red' }, st.error) : sections.length
              ? `填學號時不用管大組：匯入時會依「分組」目前使用的方案「${activeGroupSet(s).name}」，把學生分到各自的大組（${sections.join('、')}），每個大組各有一份打掃工作清單。填寫表的第二張工作表有學生對照，可以查學號。`
              : '填寫表會列出目前的打掃工作，在「學號」欄填上負責的學生後存檔，再回來選擇這個檔案。在「分組」分好大組的話，匯入時會自動把學生分到各自的大組。',
          },
          row({ label: '選擇 Excel 或 CSV 檔…', tint: true, leading: icon('folder', 'tint'), id: 'duty-import-pick', onclick: async () => {
            const file = await pickFile(SPREADSHEET_ACCEPT);
            if (!file) return;
            const r = await readSpreadsheet(file, { fillMergedCells: true });
            if (r.error) { st.error = r.error; rerender(); return; }
            const res = planFromSheets(r.sheets, store.currentSubject);
            if (res.error) { st.error = res.error; rerender(); return; }
            st.error = null; st.fileName = file.name; st.replace = true; st.plan = res.plan;
            rerender();
          } }),
          row({ label: '匯出填寫表（列出目前的打掃工作）', tint: true, leading: icon('share', 'tint'), onclick: () => exportReport({ type: 'dutyTemplate' }, 'xlsx') })),
        ],
      });
    }
    return sheetView({
      title: '從 Excel 匯入打掃工作', onCancel: () => closeSheet(sheet),
      confirm: {
        label: '匯入', action: () => {
          store.applyDutyImport(plan, st.replace);
          store.showToast(`已匯入 ${plan.jobs.length} 項打掃工作，${plan.sections.length > 1 ? `分到 ${plan.sections.length} 個大組、` : ''}指派 ${plan.assignedCount} 位學生`);
          closeSheet(sheet);
        },
      },
      body: [
        section_({ header: '讀到的內容', footer: plan.sections.length > 1 ? `依「${activeGroupSet(s)?.name ?? ''}」的分組，分到 ${plan.sections.filter(Boolean).join('、')}。` : null },
          row({ label: '檔案', detail: plan.sheetName ? `${st.fileName}（${plan.sheetName}）` : st.fileName }),
          row({ label: '打掃工作', detail: `${plan.jobs.length} 項` }),
          row({ label: '指派到的學生', detail: `${plan.assignedCount} 人` })),
        plan.problems.length ? section_({ header: `略過 ${plan.problems.length} 位`, footer: '這些學生不會指派。可以修改 Excel 後重新選擇檔案，或匯入後再手動指派。' },
          plan.problems.map((p, i) => row({ key: `p${i}`, label: `第 ${p.row} 列：${p.who}`, sub: h('span', { class: 'warn' }, p.reason) }))) : null,
        section_({ header: '匯入方式', footer: st.replace ? '原本所有大組的打掃工作和指派都會換成檔案裡的內容。' : '同名的打掃工作會加入檔案裡的學生，其他的保留。' },
          choiceRows([{ value: true, label: '取代原本的打掃工作' }, { value: false, label: '合併到原本的清單' }], st.replace, (v) => { st.replace = v; rerender(); })),
        plan.sections.map((sec) => section_({ key: `pv-${sec}`, header: sec ? `預覽：${sec}` : '預覽' },
          plan.items.filter((it) => it.section === sec).map((it) => {
            const list = it.studentIDs.map((id) => byID.get(id)).filter(Boolean);
            return row({ key: it.name, label: it.name, detail: list.length ? list.map((x) => x.name).join('、') : h('span', { class: 'warn' }, '未指派') });
          }))),
        section_({}, row({ label: '重新選擇檔案', tint: true, leading: icon('undo', 'tint'), onclick: () => { st.plan = null; rerender(); } })),
      ],
    });
  }, { state: { plan: null, error: null, fileName: '', replace: true } });
}

// MARK: 檢查表

function checklist(s, section) {
  const duties = dutiesIn(s, section);
  const check = dutyCheck(s, view.date, section);
  const byID = studentsByID(s);
  const done = duties.filter((d) => checkResult(check, d.id) === true).length;
  const fail = duties.filter((d) => checkResult(check, d.id) === false).length;
  const unchecked = duties.filter((d) => checkResult(check, d.id) === undefined);
  const days = [...dutyCheckDays(s, section)].reverse();
  const date = view.date;
  return [
    section_({ key: 'date', header: section ? `${section}·${dayWithWeekday(date)}` : dayWithWeekday(date) },
      fieldRow('檢查日期', h('input', {
        type: 'date', class: 'text-input right', value: fileDate(date), id: 'check-date',
        onchange: (e) => { const d = parseFileDate(e.target.value); if (d) { view.date = d; rerender(); } },
      })),
      duties.length ? h('div', { class: 'row', key: 'progress' },
        h('div', { class: 'progress' }, h('span', { style: `width:${duties.length ? (done / duties.length) * 100 : 0}%` })),
        h('span', { class: ['num', fail ? 'warn' : 'muted'], style: 'font-size:15px;white-space:nowrap', id: 'check-summary' }, `完成 ${done}/${duties.length}${fail ? `·沒做好 ${fail}` : ''}`)) : null,
      unchecked.length ? row({ label: unchecked.length === duties.length ? '全部完成' : `其餘 ${unchecked.length} 項都完成`, tint: true, leading: icon('checkCircle', 'tint'), id: 'check-rest',
        onclick: () => store.checkRemainingDuties(unchecked.map((d) => d.id), date, section) }) : null),
    section_({ key: 'items', header: '打掃工作與打掃人員', footer: '點 ✓ 表示做好了、✗ 表示沒做好；再點一次可以取消。' },
      duties.map((d) => {
        const r = checkResult(check, d.id);
        const list = sortBySeat(d.studentIDs.map((id) => byID.get(id)).filter(Boolean));
        return h('div', { class: ['row', 'check-row', r === true ? 'ok' : r === false ? 'bad' : ''], key: d.id },
          h('div', { class: 'row-main' },
            h('b', { style: 'font-weight:600' }, d.name),
            list.length ? h('span', { class: 'check-people' }, people(list)) : h('span', { class: 'warn', style: 'font-size:15px' }, '未指派'),
            d.note ? h('span', { class: 'note' }, d.note) : null),
          h('button', { type: 'button', class: ['icon-btn', { 'on-green': r === true }], id: `check-done-${d.name}`, 'aria-label': `${d.name} 做好了`, 'aria-pressed': r === true ? 'true' : 'false',
            onclick: () => store.setDutyCheck(d.id, r === true ? null : true, date, section) }, icon(r === true ? 'checkCircleFill' : 'checkCircle')),
          h('button', { type: 'button', class: ['icon-btn', { 'on-red': r === false }], id: `check-fail-${d.name}`, 'aria-label': `${d.name} 沒做好`, 'aria-pressed': r === false ? 'true' : 'false',
            onclick: () => store.setDutyCheck(d.id, r === false ? null : false, date, section) }, icon(r === false ? 'xCircleFill' : 'xCircle')));
      }),
      duties.length ? null : row({ label: h('span', { class: 'muted' }, '這裡還沒有打掃工作，請先切換到「分配」新增打掃工作和負責的學生。') })),
    section_({ key: 'note', header: '備註' },
      h('input', {
        class: 'text-input', style: 'padding:12px 16px', value: check?.note ?? '', placeholder: '例如：水槽沒擦乾、廢液桶沒分類', id: 'check-note',
        oninput: (e) => store.setDutyCheckNote(e.target.value, date, section),
      })),
    days.length ? section_({ key: 'history', header: `檢查紀錄（${days.length} 次）`, footer: '點一下看那一天的檢查；「⋯」可以把檢查表匯出成 Excel 或列印。' },
      days.map((day) => {
        const ok = duties.filter((d) => checkResult(day, d.id) === true).length;
        const bad = duties.filter((d) => checkResult(day, d.id) === false).length;
        const current = isSameDay(day.date, date);
        return row({
          key: day.id, label: h('span', { style: current ? 'font-weight:600' : null }, dayWithWeekday(day.date)), sub: day.note || null,
          detail: h('span', { class: 'num', style: 'font-size:15px' }, h('span', { class: 'green' }, `✓ ${ok}`), bad ? h('span', { class: 'red', style: 'margin-left:8px' }, `✗ ${bad}`) : null, h('span', { class: 'muted' }, ` / ${duties.length}`)),
          onclick: () => { view.date = startOfDay(day.date); rerender(); document.getElementById('content')?.scrollTo({ top: 0, behavior: 'smooth' }); },
          trailing: h('button', { type: 'button', class: 'icon-btn', 'aria-label': `刪除 ${dayWithWeekday(day.date)} 的紀錄`, onclick: async (e) => {
            e.stopPropagation();
            const yes = await confirmDialog({ title: `刪除 ${dayWithWeekday(day.date)} 的檢查紀錄？`, confirm: '刪除紀錄', message: '這一天的勾選和備註都會刪除，打掃工作和負責學生不受影響。' });
            if (yes) store.deleteDutyCheckDay(day.id);
          } }, icon('trash', 'small')),
        });
      })) : null,
  ];
}
