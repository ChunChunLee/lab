// 「成績」分頁：總表（像試算表，iPad、電腦預設）和逐項登錄（一次一個項目，手機預設）
import { h, icon, frag } from '../ui/dom.js';
import {
  section, row, sheetView, openSheet, closeSheet, rerender, renderNow, confirmDialog, promptDialog, barButton, showMenu, empty, button,
  segmented, chip, prefs, layout, fieldRow, input, select, toggleRow, stepperRow, choiceRows,
} from '../ui/kit.js';
import { store } from '../store.js';
import { sortedItems, sortedStudents, categoryOf, getScore, weightTotal, weightsAreValid, uuid, nowISO } from '../model.js';
import { score, scoreText, parseScore, shortDate, fullDate, fileDate, parseFileDate, displaySeat, trimmed, fixed, round } from '../format.js';
import { gradeReport, CATEGORY_MODES } from '../logic/grades.js';
import { exportMenuItems } from '../io/exporter.js';
import { openAddFromRoster } from './roster.js';

const isTouch = () => matchMedia('(pointer: coarse)').matches;

const view = {
  mode: prefs.get('gradeMode', null), // 'grid' | 'entry'
  filter: null, // 類別 ID
  entryItem: null,
  sel: null, // 總表選到的格子 { r, c }
  scrolledFor: null,
};

const modeNow = () => view.mode ?? (layout() === 'phone' ? 'entry' : 'grid');

export function render() {
  const s = store.currentSubject;
  const items = sortedItems(s);
  const actions = [
    barButton('plus', { label: '新增成績項目', onclick: () => openItemEditor(null), id: 'add-item' }),
    barButton('more', {
      label: '更多', id: 'grades-more',
      onclick: (e) => showMenu(e.currentTarget, [
        { label: '配分與類別…', icon: 'pencil', action: openWeightsEditor, id: 'edit-weights' },
        { label: '成績計算設定…', icon: 'gear', action: openSettings, id: 'grade-settings' },
        modeNow() === 'entry' && currentEntryItem(s)
          ? { label: '這個項目未輸入的都設為缺交…', icon: 'x', action: () => markBlanks(currentEntryItem(s)) } : null,
        { divider: true },
        ...exportMenuItems({ type: 'grades', filter: view.filter }, view.filter ? `列印（只有「${categoryOf(s, view.filter)?.name}」）／存成 PDF…` : '列印／存成 PDF…'),
      ].filter(Boolean)),
    }),
  ];

  if (!s.students.length) {
    return { actions, body: empty('這個科目還沒有學生', '先到「名冊」從學生名冊加入學生，才能登錄成績。', button('從學生名冊加入', { kind: 'filled', onclick: openAddFromRoster })) };
  }
  if (!items.length) {
    return {
      actions, topbar: weightBar(s),
      body: empty('還沒有成績項目', '按右上角的 ＋ 新增成績項目（例如「實驗一 報告」），選類別、日期和滿分，就可以開始登錄分數。',
        button('新增成績項目', { kind: 'filled', iconName: 'plus', onclick: () => openItemEditor(null), id: 'empty-add-item' })),
    };
  }

  const mode = modeNow();
  const topbar = frag(weightBar(s),
    h('div', { class: 'grade-controls', key: 'controls' },
      segmented([{ value: 'grid', label: '總表', id: 'mode-grid' }, { value: 'entry', label: '逐項登錄', id: 'mode-entry' }], mode,
        (v) => { view.mode = v; prefs.set('gradeMode', v); view.sel = null; rerender(); }, { label: '登錄方式' }),
      mode === 'grid' ? categoryChips(s, items) : null));

  if (mode === 'entry') return { actions, topbar, body: entryBody(s, items), after: afterEntry };
  return { actions, topbar, raw: true, body: gridBody(s, items), after: afterGrid };
}

// MARK: 上方的配分

function weightBar(s) {
  const total = weightTotal(s);
  const valid = weightsAreValid(s);
  return h('button', { type: 'button', class: ['weight-bar', { invalid: !valid }], key: 'weights', onclick: openWeightsEditor, id: 'weight-bar' },
    h('span', { class: 'weight-list' }, s.categories.map((c) => h('span', { key: c.id, class: 'weight' }, `${c.name} ${score(c.weight)}%`))),
    h('span', { class: 'weight-total' }, valid ? frag(`合計 ${score(total)}%`, icon('check')) : frag(icon('warning'), `合計 ${score(total)}%，不等於 100%`)));
}

function categoryChips(s, items) {
  const used = s.categories.filter((c) => items.some((it) => it.categoryID === c.id));
  if (used.length < 2) return null;
  return h('div', { class: 'chips inline', key: 'chips' },
    chip('全部', { on: !view.filter, onclick: () => { view.filter = null; view.sel = null; rerender(); }, key: 'all' }),
    used.map((c) => chip(c.name, { on: view.filter === c.id, key: c.id, onclick: () => { view.filter = c.id; view.sel = null; rerender(); } })));
}

// MARK: 總表

function gridModel(s, items) {
  const report = gradeReport(s);
  const shownItems = items.filter((it) => !view.filter || it.categoryID === view.filter);
  const cats = report.categoriesInUse.filter((c) => !view.filter || c.id === view.filter);
  return { report, students: report.students, items: shownItems, cats };
}

function cellClass(v, it, report) {
  if (v === undefined) return 'blank';
  if (v === '缺') return 'miss';
  if (v === '免') return 'exc';
  return [report.isFailingPoints(v, it.fullScore) ? 'fail' : '', v > it.fullScore ? 'over' : ''].join(' ');
}

function gridBody(s, items) {
  const { report, students, items: shown, cats } = gridModel(s, items);
  const decimals = s.gradeSettings.totalDecimals;
  const head = h('tr', null,
    h('th', { class: 'sticky-l seat-col' }, '座號'),
    h('th', { class: 'sticky-l2 name-col' }, '姓名'),
    shown.map((it, c) => h('th', { key: it.id, class: 'item-col', id: `head-${c}` },
      h('button', { type: 'button', class: 'head-btn', onclick: (e) => itemMenu(e, it), 'aria-label': `${it.name} 的操作` },
        h('span', { class: 'head-name' }, it.name),
        h('span', { class: 'head-sub' }, `${categoryOf(s, it.categoryID)?.name ?? ''}·${shortDate(it.date)}·滿分${score(it.fullScore)}`)))),
    cats.map((c) => h('th', { key: `cat-${c.id}`, class: 'calc-col' }, h('span', { class: 'head-name' }, `${c.name}小計`), h('span', { class: 'head-sub' }, `配分 ${score(c.weight)}%`))),
    h('th', { class: 'sticky-r total-col' }, '總成績'));

  const body = students.map((st, r) => h('tr', { key: st.id },
    h('td', { class: 'sticky-l seat-col num' }, displaySeat(st.seat)),
    h('td', { class: 'sticky-l2 name-col' }, st.name),
    shown.map((it, c) => {
      const v = getScore(s, it.id, st.id);
      const sel = view.sel && view.sel.r === r && view.sel.c === c;
      return h('td', {
        key: it.id, class: ['cell', cellClass(v, it, report), { selected: sel }], 'data-cell': `${r}-${c}`, id: `cell-${r}-${c}`,
        onclick: () => selectCell(r, c, true),
      }, scoreText(v));
    }),
    cats.map((c) => {
      const v = report.categoryScore(st.id, c.id);
      return h('td', { key: `cat-${c.id}`, class: ['calc', 'num', { fail: report.isFailing(v) }] }, v === null ? '' : fixed(v, 1));
    }),
    (() => { const t = report.total(st.id); return h('td', { class: ['sticky-r', 'total-col', 'num', { fail: report.isFailing(t) }], id: `total-${r}` }, t === null ? '' : fixed(t, decimals)); })()));

  const stat = (label, fnItem, fnCat, fnTotal) => h('tr', { class: 'foot', key: `f-${label}` },
    h('td', { class: 'sticky-l seat-col' }), h('td', { class: 'sticky-l2 name-col' }, label),
    shown.map((it) => h('td', { key: it.id, class: 'num' }, fnItem(report.itemStats.get(it.id)))),
    cats.map((c) => h('td', { key: c.id, class: 'num' }, fnCat(report.categoryStats.get(c.id)))),
    h('td', { class: 'sticky-r total-col num' }, fnTotal(report.totalStats)));
  const n1 = (v) => (v === null ? '' : fixed(v, 1));
  const sc = (v) => (v === null ? '' : score(v));
  const nd = (v) => (v === null ? '' : fixed(v, decimals));
  const foot = [
    stat('平均', (x) => n1(x.average), (x) => n1(x.average), (x) => n1(x.average)),
    stat('最高', (x) => sc(x.maximum), (x) => n1(x.maximum), (x) => nd(x.maximum)),
    stat('最低', (x) => sc(x.minimum), (x) => n1(x.minimum), (x) => nd(x.minimum)),
    stat('缺交', (x) => String(x.missing), () => '', () => ''),
    stat('未輸入', (x) => String(x.blank), () => '', () => ''),
  ];

  return h('div', { class: 'grid-scroll', id: 'grid-scroll', key: 'grid-scroll' },
    h('div', { class: 'grid-wrap', key: 'grid-wrap' },
      h('table', { class: 'grade-grid', key: 'grid' }, h('thead', null, head), h('tbody', null, body, foot)),
      h('input', {
        key: 'grid-editor', class: 'grid-editor', id: 'grid-editor', 'aria-label': '分數',
        inputmode: layout() === 'phone' ? 'decimal' : 'text', enterkeyhint: 'next', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        onkeydown: gridKey, onblur: () => commitEditor(),
      })),
    isTouch() && view.sel ? accessoryBar('grid') : null);
}

function editorEl() { return document.getElementById('grid-editor'); }

/** 選一格開始輸入（在點按的處理函式裡呼叫，iPhone、iPad 才會跳出鍵盤） */
function selectCell(r, c, fromTap = false) {
  const s = store.currentSubject;
  const { students, items } = gridModel(s, sortedItems(s));
  if (!students.length || !items.length) return;
  if (view.sel && fromTap) commitEditor();
  r = Math.max(0, Math.min(students.length - 1, r));
  c = Math.max(0, Math.min(items.length - 1, c));
  view.sel = { r, c, itemID: items[c].id, studentID: students[r].id };
  renderNow();
  const ed = editorEl();
  if (!ed) return;
  ed.value = scoreText(getScore(s, items[c].id, students[r].id));
  ed.dataset.original = ed.value;
  positionEditor();
  ed.focus({ preventScroll: true });
  ed.select();
}

function positionEditor() {
  const ed = editorEl();
  if (!ed) return;
  const td = view.sel && document.getElementById(`cell-${view.sel.r}-${view.sel.c}`);
  if (!td) { ed.style.display = 'none'; return; }
  ed.style.display = 'block';
  ed.style.left = `${td.offsetLeft}px`;
  ed.style.top = `${td.offsetTop}px`;
  ed.style.width = `${td.offsetWidth}px`;
  ed.style.height = `${td.offsetHeight}px`;
  // 捲到看得到（扣掉固定的欄）
  const sc = document.getElementById('grid-scroll');
  if (sc) {
    const leftFixed = 140, rightFixed = 84, topFixed = 54;
    if (td.offsetLeft - sc.scrollLeft < leftFixed) sc.scrollLeft = td.offsetLeft - leftFixed;
    else if (td.offsetLeft + td.offsetWidth - sc.scrollLeft > sc.clientWidth - rightFixed) sc.scrollLeft = td.offsetLeft + td.offsetWidth - sc.clientWidth + rightFixed;
    if (td.offsetTop - sc.scrollTop < topFixed) sc.scrollTop = td.offsetTop - topFixed;
    else if (td.offsetTop + td.offsetHeight - sc.scrollTop > sc.clientHeight - 90) sc.scrollTop = td.offsetTop + td.offsetHeight - sc.clientHeight + 90;
  }
}

/** 把輸入框裡的分數存起來。回傳 false 代表格式不對 */
function commitEditor() {
  const ed = editorEl();
  if (!ed || !view.sel || ed.style.display === 'none') return true;
  if (ed.value === ed.dataset.original) return true;
  const p = parseScore(ed.value);
  if (p.kind === 'invalid') {
    store.showToast('分數格式不對：請輸入數字，或「缺」（x）、「免」（-）', true);
    ed.value = ed.dataset.original;
    return false;
  }
  store.setScore(view.sel.itemID, view.sel.studentID, p.kind === 'blank' ? undefined : p.value);
  ed.dataset.original = ed.value;
  return true;
}

function moveSel(dr, dc) {
  if (!view.sel) return;
  if (!commitEditor()) return;
  selectCell(view.sel.r + dr, view.sel.c + dc);
}

/** 實體鍵盤：Enter 往下、Shift+Enter 往上、Tab 往右、方向鍵移動、Esc 取消 */
function gridKey(e) {
  if (e.isComposing || e.keyCode === 229) return;
  const ed = e.currentTarget;
  const atStart = ed.selectionStart === 0 && ed.selectionEnd === 0;
  const atEnd = ed.selectionStart === ed.value.length;
  const allSelected = ed.selectionStart === 0 && ed.selectionEnd === ed.value.length;
  switch (e.key) {
    case 'Enter': e.preventDefault(); moveSel(e.shiftKey ? -1 : 1, 0); break;
    case 'Tab': e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1); break;
    case 'ArrowDown': e.preventDefault(); moveSel(1, 0); break;
    case 'ArrowUp': e.preventDefault(); moveSel(-1, 0); break;
    case 'ArrowLeft': if (atStart || allSelected) { e.preventDefault(); moveSel(0, -1); } break;
    case 'ArrowRight': if (atEnd || allSelected) { e.preventDefault(); moveSel(0, 1); } break;
    case 'Escape': e.preventDefault(); ed.value = ed.dataset.original; view.sel = null; ed.blur(); rerender(); break;
    default:
  }
}

function afterGrid() {
  positionEditor();
  const sc = document.getElementById('grid-scroll');
  const key = `${store.currentSubject?.id}-${view.filter}`;
  if (sc && view.scrolledFor !== key) {
    view.scrolledFor = key;
    sc.scrollLeft = sc.scrollWidth; // 一打開就看到最新的項目
  }
  placeAccessory();
}

// MARK: 鍵盤上方的按鈕列（iPhone、iPad 螢幕鍵盤）

function accessoryBar(kind) {
  const keep = (e) => e.preventDefault(); // 按按鈕時輸入框不要失去焦點
  const act = (fn) => ({ onpointerdown: keep, onmousedown: keep, onclick: fn });
  const setValue = (v) => {
    const ed = kind === 'grid' ? editorEl() : document.activeElement;
    if (!ed || ed.tagName !== 'INPUT') return;
    ed.value = v;
    if (kind === 'grid') { commitEditor(); ed.select(); } else ed.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const move = (d) => (kind === 'grid' ? moveSel(d, 0) : entryMove(d));
  return h('div', { class: 'accessory', key: `accessory-${kind}`, id: 'accessory' },
    h('button', { type: 'button', class: 'acc-btn miss', ...act(() => setValue('缺')) }, '缺交'),
    h('button', { type: 'button', class: 'acc-btn', ...act(() => setValue('免')) }, '免'),
    h('button', { type: 'button', class: 'acc-btn', ...act(() => setValue('')) }, '清除'),
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'acc-btn icon-only', 'aria-label': '上一位', ...act(() => move(-1)) }, icon('chevronUp')),
    h('button', { type: 'button', class: 'acc-btn primary', id: 'acc-next', ...act(() => move(1)) }, '下一位', icon('chevronDown')),
    kind === 'grid' ? h('button', { type: 'button', class: 'acc-btn', ...act(() => { commitEditor(); view.sel = null; editorEl()?.blur(); rerender(); }) }, '完成') : null);
}

/** 讓按鈕列貼在螢幕鍵盤上方 */
function placeAccessory() {
  const bar = document.getElementById('accessory');
  if (!bar) return;
  const vv = window.visualViewport;
  const bottom = vv ? window.innerHeight - (vv.height + vv.offsetTop) : 0;
  bar.style.bottom = `${Math.max(0, bottom)}px`;
}
window.visualViewport?.addEventListener('resize', placeAccessory);
window.visualViewport?.addEventListener('scroll', placeAccessory);

// MARK: 項目選單

function itemMenu(e, it) {
  e.stopPropagation();
  commitEditor();
  view.sel = null;
  showMenu(e.currentTarget, [
    { header: it.name },
    { label: '逐項登錄這個項目', icon: 'listNumber', action: () => { view.mode = 'entry'; prefs.set('gradeMode', 'entry'); view.entryItem = it.id; rerender(); } },
    { label: '編輯項目…', icon: 'pencil', action: () => openItemEditor(it) },
    { label: '未輸入的都設為缺交…', icon: 'x', action: () => markBlanks(it) },
    { divider: true },
    { label: '刪除項目…', icon: 'trash', destructive: true, action: () => deleteItem(it) },
  ], { align: 'left' });
}

async function markBlanks(it) {
  const s = store.currentSubject;
  const blanks = s.students.filter((st) => getScore(s, it.id, st.id) === undefined).length;
  if (!blanks) { store.showToast('這個項目每個人都有登錄了'); return; }
  const ok = await confirmDialog({ title: `把 ${blanks} 位未輸入的設為缺交？`, confirm: '設為缺交', message: `「${it.name}」還沒有分數的學生會記為缺交（以 0 分計）。` });
  if (ok) { store.markBlanksMissing(it.id); store.showToast(`已把 ${blanks} 位設為缺交`); }
}

async function deleteItem(it) {
  const s = store.currentSubject;
  const n = Object.keys(s.scores[it.id] ?? {}).length;
  const ok = await confirmDialog({ title: `刪除「${it.name}」？`, confirm: '刪除項目', message: n ? `已登錄的 ${n} 筆分數會一起刪除。` : '這個項目還沒有分數。' });
  if (ok) store.deleteItem(it.id);
}

// MARK: 逐項登錄

function currentEntryItem(s) {
  const items = sortedItems(s);
  return items.find((it) => it.id === view.entryItem) ?? items.at(-1) ?? null;
}

function entryBody(s, items) {
  const it = currentEntryItem(s);
  const report = gradeReport(s);
  const st = report.itemStats.get(it.id);
  const cat = categoryOf(s, it.categoryID);
  const students = sortedStudents(s);
  return [
    h('div', { class: 'entry-head', key: 'entry-head' },
      h('div', { class: 'split', style: 'flex-wrap:nowrap' },
        select(items.map((x) => ({ value: x.id, label: x.name })), it.id, (v) => { view.entryItem = v; rerender(); }, { id: 'entry-item', label: '成績項目' }),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-plain btn-small', onclick: () => openItemEditor(it) }, '編輯')),
      h('div', { class: 'note' }, `${cat?.name ?? '未分類'}·${fullDate(it.date)}·滿分 ${score(it.fullScore)}`),
      h('div', { class: 'entry-stats num' },
        h('span', null, `平均 ${st.average === null ? '—' : fixed(st.average, 1)}`),
        h('span', null, `最高 ${st.maximum === null ? '—' : score(st.maximum)}`),
        h('span', null, `最低 ${st.minimum === null ? '—' : score(st.minimum)}`),
        h('span', { class: st.recorded < students.length ? 'warn' : 'green', id: 'entry-recorded' }, `已登錄 ${st.recorded}/${students.length}`),
        st.missing ? h('span', { class: 'red' }, `缺交 ${st.missing}`) : null)),
    section({ key: `entry-${it.id}`, footer: '輸入分數後按「下一位」（或 Enter）。輸入「缺」或 x 是缺交，「免」或 - 是免計。' },
      students.map((stu) => {
        const v = getScore(s, it.id, stu.id);
        return h('label', { class: ['row', 'entry-row', cellClass(v, it, report)], key: stu.id },
          h('span', { class: 'seat' }, displaySeat(stu.seat)),
          h('span', { class: 'row-main' }, h('span', null, stu.name), stu.note ? h('span', { class: 'row-sub' }, stu.note) : null),
          h('input', {
            class: 'entry-input', id: `entry-${stu.seat}`, 'data-student': stu.id, value: scoreText(v),
            inputmode: layout() === 'phone' ? 'decimal' : 'text', enterkeyhint: 'next', autocomplete: 'off', 'aria-label': `${stu.name} 的分數`,
            onchange: (e) => commitEntry(e.target, it),
            onkeydown: (e) => {
              if (e.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter' || (e.key === 'ArrowDown')) { e.preventDefault(); entryMove(e.shiftKey ? -1 : 1); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); entryMove(-1); }
            },
            onfocus: (e) => { e.target.select(); rerender(); },
            onblur: () => rerender(),
          }));
      })),
    isTouch() && document.activeElement?.classList?.contains('entry-input') ? accessoryBar('entry') : null,
  ];
}

function commitEntry(inputEl, it) {
  const p = parseScore(inputEl.value);
  if (p.kind === 'invalid') {
    store.showToast('分數格式不對：請輸入數字，或「缺」（x）、「免」（-）', true);
    inputEl.value = scoreText(getScore(store.currentSubject, it.id, inputEl.dataset.student));
    return false;
  }
  store.setScore(it.id, inputEl.dataset.student, p.kind === 'blank' ? undefined : p.value);
  return true;
}

/** 移到下一位（或上一位）：先存目前這格 */
function entryMove(d) {
  const inputs = [...document.querySelectorAll('.entry-input')];
  const i = inputs.indexOf(document.activeElement);
  if (i < 0) return;
  const s = store.currentSubject;
  if (!commitEntry(inputs[i], currentEntryItem(s))) return;
  const next = inputs[i + d];
  if (next) { next.focus(); next.scrollIntoView({ block: 'center', behavior: 'smooth' }); } else inputs[i].blur();
}

function afterEntry() { placeAccessory(); }

// MARK: 新增、編輯成績項目

function openItemEditor(item) {
  const s0 = store.currentSubject;
  openSheet((sheet) => {
    const st = sheet.state;
    const s = store.currentSubject;
    const valid = trimmed(st.name) && Number(st.fullScore) > 0 && st.categoryID;
    const save = (startEntry) => {
      const date = parseFileDate(st.date) ?? new Date();
      const data = { name: trimmed(st.name), categoryID: st.categoryID, date: date.toISOString(), fullScore: Number(st.fullScore) };
      let id = item?.id;
      if (item) store.updateItem({ ...item, ...data });
      else { id = uuid(); store.addItem({ id, ...data, createdAt: nowISO() }); }
      closeSheet(sheet);
      if (startEntry) { view.mode = 'entry'; prefs.set('gradeMode', 'entry'); view.entryItem = id; rerender(); }
    };
    const n = item ? Object.keys(s.scores[item.id] ?? {}).length : 0;
    return sheetView({
      title: item ? '編輯成績項目' : '新增成績項目', onCancel: () => closeSheet(sheet),
      confirm: { label: '儲存', disabled: !valid, action: () => save(false) },
      body: [
        section({},
          fieldRow('名稱', input({ value: st.name, placeholder: '例如：實驗三 報告', align: 'right', oninput: (v) => { st.name = v; rerender(); }, id: 'item-name', autofocus: !item })),
          fieldRow('類別', select([...s.categories.map((c) => ({ value: c.id, label: `${c.name}（${score(c.weight)}%）` })), { value: '__new', label: '新增類別…' }], st.categoryID,
            async (v) => {
              if (v !== '__new') { st.categoryID = v; rerender(); return; }
              const name = await promptDialog({ title: '新增類別', message: '配分可以之後在「配分與類別」設定。', placeholder: '例如：平時表現', confirm: '新增' });
              if (name !== null && trimmed(name)) st.categoryID = store.addCategory(name, 0);
              rerender();
            }, { id: 'item-category', label: '類別' })),
          fieldRow('日期', h('input', { type: 'date', class: 'text-input right', value: st.date, onchange: (e) => { st.date = e.target.value; }, id: 'item-date' })),
          fieldRow('滿分', input({ value: st.fullScore, inputmode: 'decimal', align: 'right', oninput: (v) => { st.fullScore = v; rerender(); }, id: 'item-full' }))),
        item ? null : section({}, row({ label: '儲存並開始登錄', tint: true, disabled: !valid, leading: icon('listNumber', 'tint'), onclick: () => save(true), id: 'save-and-enter' })),
        item ? section({ footer: n ? `已登錄 ${n} 筆分數。` : null }, row({ label: '刪除這個項目', destructive: true, onclick: async () => { closeSheet(sheet); await deleteItem(item); } })) : null,
      ],
    });
  }, {
    state: item
      ? { name: item.name, categoryID: item.categoryID, date: fileDate(item.date), fullScore: String(item.fullScore) }
      : { name: '', categoryID: s0.categories[0]?.id ?? null, date: fileDate(new Date()), fullScore: '100' },
  });
}

// MARK: 配分與類別

function openWeightsEditor() {
  const s0 = store.currentSubject;
  openSheet((sheet) => {
    const st = sheet.state;
    const s = store.currentSubject;
    const total = st.cats.reduce((t, c) => t + (Number(c.weight) || 0), 0);
    const ok = Math.abs(total - 100) < 0.001;
    return sheetView({
      title: '配分與類別', onCancel: () => closeSheet(sheet),
      confirm: {
        label: '儲存', disabled: st.cats.some((c) => !trimmed(c.name)),
        action: async () => {
          const keep = new Set(st.cats.map((c) => c.id));
          const removed = s.categories.filter((c) => !keep.has(c.id));
          const lostItems = s.items.filter((it) => !keep.has(it.categoryID));
          if (lostItems.length) {
            const yes = await confirmDialog({ title: '刪除類別？', confirm: '刪除', message: `「${removed.map((c) => c.name).join('、')}」的 ${lostItems.length} 個成績項目和分數會一起刪除。` });
            if (!yes) return;
          }
          store.applyCategories(st.cats.map((c) => ({ ...c, name: trimmed(c.name), weight: Number(c.weight) || 0 })));
          closeSheet(sheet);
        },
      },
      body: [
        section({ header: '類別和配分（%）', footer: ok ? '合計 100%。' : h('span', { class: 'warn' }, `合計 ${score(total)}%，不等於 100%。總成績會依現有比例換算。`) },
          st.cats.map((c, i) => h('div', { class: 'row', key: c.id },
            h('input', { class: 'text-input', value: c.name, placeholder: '類別名稱', oninput: (e) => { c.name = e.target.value; rerender(); }, 'aria-label': '類別名稱', id: `cat-name-${i}` }),
            h('input', { class: 'text-input right', style: 'width:70px;flex:none', value: String(c.weight), inputmode: 'decimal', oninput: (e) => { c.weight = e.target.value; rerender(); }, 'aria-label': `${c.name} 配分`, id: `cat-weight-${i}` }),
            h('span', { class: 'muted' }, '%'),
            h('button', { type: 'button', class: 'icon-btn remove', 'aria-label': `刪除${c.name}`, onclick: () => { st.cats.splice(i, 1); rerender(); } }, icon('minusCircleFill', 'small')))),
          row({ label: '新增類別', tint: true, leading: icon('plusCircle', 'tint'), onclick: () => { st.cats.push({ id: uuid(), name: '', weight: 0, colorIndex: st.cats.length }); rerender(); } })),
      ],
    });
  }, { state: { cats: s0.categories.map((c) => ({ ...c })) } });
}

// MARK: 成績計算設定

function openSettings() {
  const s0 = store.currentSubject;
  openSheet((sheet) => {
    const st = sheet.state.settings;
    return sheetView({
      title: '成績計算設定', onCancel: () => closeSheet(sheet),
      confirm: { label: '儲存', action: () => { store.updateGradeSettings({ ...st, passLine: Number(st.passLine) || 60 }); closeSheet(sheet); } },
      body: [
        section({ header: '類別成績的算法', footer: CATEGORY_MODES[st.categoryMode].detail },
          choiceRows(Object.entries(CATEGORY_MODES).map(([value, m]) => ({ value, label: m.title })), st.categoryMode, (v) => { st.categoryMode = v; rerender(); })),
        section({ footer: '關掉時，未輸入的分數不列入計算（畫面上標黃色）。學期末可以打開，把沒交的都算 0 分。' },
          toggleRow('未輸入以 0 分計算', st.blankAsZero, (v) => { st.blankAsZero = v; rerender(); })),
        section({},
          stepperRow(`總成績小數 ${st.totalDecimals} 位`, st.totalDecimals, (v) => { st.totalDecimals = v; rerender(); }, { min: 0, max: 2, label: '小數位數' }),
          fieldRow('及格分數', input({ value: String(st.passLine), inputmode: 'decimal', align: 'right', oninput: (v) => { st.passLine = v; }, id: 'pass-line' }))),
      ],
    });
  }, { state: { settings: { ...s0.gradeSettings } } });
}

export { round };
