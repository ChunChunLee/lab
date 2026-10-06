// iOS 風格的元件：清單、按鈕、切換、彈出選單、底部視窗（sheet）、確認對話框、提示
import { h, icon, frag } from './dom.js';

// MARK: 畫面狀態與重畫

export const ui = {
  sheets: [], // 開著的視窗（由下往上疊）
  dialog: null,
  popover: null,
};

let renderFn = () => {};
let scheduled = false;
export function setRenderer(fn) { renderFn = fn; }
/** 下一個畫面更新時重畫 */
export function rerender() {
  if (scheduled) return;
  scheduled = true;
  // 這個動作處理完就重畫（同一個動作裡改好幾次只畫一次）
  queueMicrotask(() => { if (scheduled) { scheduled = false; renderFn(); } });
}
/** 馬上重畫（需要立刻量位置時用） */
export function renderNow() { scheduled = false; renderFn(); }

export const prefs = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`lcm.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`lcm.${key}`, JSON.stringify(value)); } catch { /* 私密瀏覽 */ }
  },
};

/** 'phone'（iPhone）、'tablet'（iPad）、'desktop'（電腦） */
export function layout() {
  const w = window.innerWidth;
  if (w < 700) return 'phone';
  if (w < 1100) return 'tablet';
  return 'desktop';
}
export const isCompact = () => layout() === 'phone';

// MARK: 基本元件

/** 清單的一段（iOS 的 inset grouped list） */
export function section({ header, footer, key, class: cls } = {}, ...rows) {
  const items = rows.flat(Infinity).filter(Boolean);
  return h('section', { class: ['group', cls], key },
    header ? h('div', { class: 'group-header' }, header) : null,
    items.length ? h('div', { class: 'group-body' }, items) : null,
    footer ? h('div', { class: 'group-footer' }, footer) : null);
}

/** 清單的一列 */
export function row({ label, detail, sub, leading, trailing, onclick, chevron, destructive, tint, key, class: cls, id, disabled, title } = {}) {
  const content = frag(
    leading ? h('span', { class: 'row-leading' }, leading) : null,
    h('span', { class: 'row-main' },
      h('span', { class: ['row-label', { destructive, tint }] }, label),
      sub ? h('span', { class: 'row-sub' }, sub) : null),
    detail !== undefined && detail !== null && detail !== '' ? h('span', { class: 'row-detail' }, detail) : null,
    trailing ?? null,
    chevron ? icon('chevronRight', 'row-chevron') : null,
  );
  if (onclick) {
    return h('button', { type: 'button', class: ['row', 'row-button', cls], onclick, key, id, disabled, title }, content);
  }
  return h('div', { class: ['row', cls], key, id }, content);
}

export function button(label, { kind = 'tinted', iconName, onclick, disabled, key, id, small, title, class: cls, destructive } = {}) {
  return h('button', {
    type: 'button', class: ['btn', `btn-${kind}`, { 'btn-small': small, 'btn-destructive': destructive }, cls], onclick, disabled, key, id, title,
    'aria-label': title,
  }, iconName ? icon(iconName) : null, label ? h('span', null, label) : null);
}

/** 導覽列上的圖示按鈕 */
export function barButton(iconName, { onclick, label, id, disabled, key } = {}) {
  return h('button', { type: 'button', class: 'bar-btn', onclick, 'aria-label': label, title: label, id, disabled, key }, icon(iconName));
}

export function textButton(label, { onclick, bold, disabled, id, destructive, key } = {}) {
  return h('button', { type: 'button', class: ['bar-text', { bold, destructive }], onclick, disabled, id, key }, label);
}

export function toggle(checked, onchange, { label, id } = {}) {
  return h('label', { class: 'switch', title: label },
    h('input', { type: 'checkbox', checked: !!checked, id, 'aria-label': label, onchange: (e) => onchange(e.target.checked) }),
    h('span', { class: 'switch-track' }));
}

export function toggleRow(label, checked, onchange, opts = {}) {
  return row({ label, sub: opts.sub, trailing: toggle(checked, onchange, { label, id: opts.id }), key: opts.key });
}

export function stepper(value, onchange, { min = 0, max = 99, step = 1, label = '' } = {}) {
  return h('span', { class: 'stepper', role: 'group', 'aria-label': label },
    h('button', { type: 'button', disabled: value <= min, 'aria-label': `${label}減少`, onclick: () => onchange(Math.max(min, value - step)) }, '−'),
    h('button', { type: 'button', disabled: value >= max, 'aria-label': `${label}增加`, onclick: () => onchange(Math.min(max, value + step)) }, '+'));
}

export function stepperRow(text, value, onchange, opts = {}) {
  return row({ label: text, trailing: stepper(value, onchange, opts), key: opts.key });
}

/** 分段控制（像 iOS 的 Segmented Control） */
export function segmented(options, value, onchange, { label, id, key } = {}) {
  return h('div', { class: 'segmented', role: 'tablist', 'aria-label': label, id, key },
    options.map((o) => h('button', {
      type: 'button', role: 'tab', class: { on: o.value === value }, 'aria-selected': o.value === value ? 'true' : 'false',
      onclick: () => onchange(o.value), key: String(o.value), id: o.id,
    }, o.label)));
}

/** 一列文字輸入（標題在左，輸入框在右） */
export function fieldRow(label, input) {
  return h('label', { class: 'row field-row' }, h('span', { class: 'row-label' }, label), input);
}

export function input({ value = '', placeholder = '', oninput, onchange, type = 'text', id, key, autofocus, inputmode, enterkeyhint, class: cls, onkeydown, maxlength, align } = {}) {
  return h('input', {
    type, value, placeholder, id, key, inputmode, enterkeyhint, maxlength, class: ['text-input', cls, { right: align === 'right' }],
    oninput: oninput && ((e) => oninput(e.target.value)), onchange: onchange && ((e) => onchange(e.target.value)), onkeydown,
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    ref: autofocus ? (el) => setTimeout(() => el.focus(), 30) : undefined,
  });
}

export function textarea({ value = '', placeholder = '', oninput, rows = 4, id, key, autofocus } = {}) {
  return h('textarea', {
    class: 'text-area', placeholder, rows, id, key, value,
    oninput: oninput && ((e) => oninput(e.target.value)),
    ref: (el) => { if (el.value !== value) el.value = value; if (autofocus) setTimeout(() => el.focus(), 30); },
  });
}

/** 下拉選單（手機上是系統的轉輪） */
export function select(options, value, onchange, { id, label, key } = {}) {
  return h('select', { class: 'select', id, key, 'aria-label': label, onchange: (e) => onchange(e.target.value) },
    options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
}

/** 單選清單（像 iOS 的 inline Picker：選到的打勾） */
export function choiceRows(options, value, onchange) {
  return options.map((o) => row({
    label: o.label, sub: o.sub, key: `choice-${o.value}`, id: o.id,
    trailing: o.value === value ? icon('check', 'tint') : h('span', { class: 'icon' }),
    onclick: () => onchange(o.value),
  }));
}

export function empty(title, message, ...actions) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon('flask')),
    h('h2', null, title),
    message ? h('p', null, message) : null,
    actions.length ? h('div', { class: 'empty-actions' }, actions) : null);
}

export function chip(label, { on, count, onclick, id, key, dashed, iconName } = {}) {
  return h('button', { type: 'button', class: ['chip', { on, dashed }], onclick, id, key, 'aria-pressed': on ? 'true' : 'false' },
    iconName ? icon(iconName) : null, h('span', null, label),
    count !== undefined ? h('span', { class: 'chip-count' }, String(count)) : null);
}

// MARK: 底部視窗（sheet）

let sheetSeq = 0;

/**
 * 打開一個視窗。render() 回傳視窗內容（用 sheetView 做）。
 * kind：'sheet'（手機從下面出來、iPad 和電腦在中間）、'cover'（整頁）
 */
export function openSheet(render, { kind = 'sheet', onClose, state = {} } = {}) {
  const sheet = { id: ++sheetSeq, render, kind, onClose, state };
  ui.sheets.push(sheet);
  ui.popover = null;
  rerender();
  return sheet;
}

export function closeSheet(sheet) {
  const i = ui.sheets.indexOf(sheet);
  if (i < 0) return;
  ui.sheets.splice(i, 1);
  sheet.onClose?.();
  rerender();
}

export function closeTopSheet() {
  const s = ui.sheets.at(-1);
  if (s) closeSheet(s);
}

/** 視窗的外框：上方有取消、標題、確認，下面是可以捲動的內容 */
export function sheetView({ title, cancel = '取消', onCancel, confirm, leading, trailing, body, bottom, wide } = {}) {
  return h('div', { class: ['sheet-inner', { wide }] },
    h('header', { class: 'sheet-bar' },
      h('div', { class: 'bar-side left' }, leading ?? (cancel ? textButton(cancel, { onclick: onCancel ?? closeTopSheet, id: 'sheet-cancel' }) : null)),
      h('div', { class: 'bar-title' }, title),
      h('div', { class: 'bar-side right' }, trailing ?? (confirm
        ? textButton(confirm.label, { onclick: confirm.action, bold: true, disabled: confirm.disabled, id: 'sheet-confirm' })
        : null))),
    h('div', { class: 'sheet-body' }, body),
    bottom ? h('div', { class: 'sheet-bottom' }, bottom) : null);
}

// MARK: 對話框

/** 確認對話框。回傳 Promise<boolean> */
export function confirmDialog({ title, message, confirm = '確定', destructive = true, cancel = '取消' }) {
  return new Promise((resolve) => {
    ui.dialog = {
      title, message,
      buttons: [
        { label: confirm, role: destructive ? 'destructive' : 'default', action: () => resolve(true) },
        { label: cancel, role: 'cancel', action: () => resolve(false) },
      ],
    };
    ui.popover = null;
    rerender();
  });
}

/** 有好幾個選項的對話框（像 iOS 的 action sheet）。回傳選到的 value 或 null */
export function actionDialog({ title, message, actions, cancel = '取消' }) {
  return new Promise((resolve) => {
    ui.dialog = {
      title, message,
      buttons: [...actions.map((a) => ({ label: a.label, role: a.destructive ? 'destructive' : 'default', action: () => resolve(a.value) })),
        { label: cancel, role: 'cancel', action: () => resolve(null) }],
    };
    ui.popover = null;
    rerender();
  });
}

/** 輸入文字的對話框。回傳 Promise<string|null> */
export function promptDialog({ title, message, value = '', placeholder = '', confirm = '儲存' }) {
  return new Promise((resolve) => {
    const state = { value };
    ui.dialog = {
      title, message, input: state, placeholder,
      buttons: [
        { label: '取消', role: 'cancel', action: () => resolve(null) },
        { label: confirm, role: 'default', bold: true, action: () => resolve(state.value) },
      ],
    };
    ui.popover = null;
    rerender();
  });
}

export function alertDialog({ title, message }) {
  return new Promise((resolve) => {
    ui.dialog = { title, message, buttons: [{ label: '知道了', role: 'default', bold: true, action: () => resolve() }] };
    rerender();
  });
}

function closeDialog(btn) {
  ui.dialog = null;
  rerender();
  btn?.action();
}

export function renderDialog() {
  const d = ui.dialog;
  if (!d) return null;
  const cancelBtn = d.buttons.find((b) => b.role === 'cancel');
  return h('div', { class: 'dialog-backdrop', key: 'dialog', onclick: (e) => { if (e.target === e.currentTarget) closeDialog(cancelBtn); } },
    h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': d.title },
      h('div', { class: 'dialog-text' },
        h('div', { class: 'dialog-title' }, d.title),
        d.message ? h('div', { class: 'dialog-message' }, d.message) : null,
        d.input ? h('input', {
          class: 'dialog-input', value: d.input.value, placeholder: d.placeholder, id: 'dialog-input',
          oninput: (e) => { d.input.value = e.target.value; },
          onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) closeDialog(d.buttons.find((b) => b.bold)); },
          ref: (el) => setTimeout(() => { el.focus(); el.select(); }, 30),
        }) : null),
      h('div', { class: ['dialog-buttons', { stacked: d.buttons.length > 2 }] },
        d.buttons.map((b, i) => h('button', {
          type: 'button', key: `b${i}`, class: ['dialog-btn', b.role, { bold: b.bold || b.role === 'cancel' && d.buttons.length > 2 }],
          onclick: () => closeDialog(b),
        }, b.label)))));
}

// MARK: 彈出選單

/**
 * 在按鈕旁邊打開選單。items：[{ label, icon, action, destructive, disabled, checked, submenu: [...] } | { divider: true } | { header: '標題' }]
 */
export function showMenu(anchor, items, { align = 'auto' } = {}) {
  const r = anchor.getBoundingClientRect();
  ui.popover = { rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, items, align, expanded: null };
  rerender();
}

export function menuButton(iconName, label, itemsFn, { id, text, kind } = {}) {
  const open = (e) => { e.stopPropagation(); showMenu(e.currentTarget, itemsFn()); };
  if (text) return button(text, { kind: kind ?? 'tinted', iconName, onclick: open, id, small: true });
  return barButton(iconName, { label, onclick: open, id });
}

export function closeMenu() { if (ui.popover) { ui.popover = null; rerender(); } }

export function renderPopover() {
  const p = ui.popover;
  if (!p) return null;
  const width = 270;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = p.align === 'left' || (p.align === 'auto' && p.rect.left < vw / 2) ? p.rect.left : p.rect.right - width;
  left = Math.max(8, Math.min(left, vw - width - 8));
  const below = p.rect.bottom + 6;
  const spaceBelow = vh - below - 12;
  const style = { left: `${left}px`, width: `${width}px` };
  if (spaceBelow > 220 || p.rect.top < vh / 2) { style.top = `${below}px`; style['max-height'] = `${Math.max(160, spaceBelow)}px`; }
  else { style.bottom = `${vh - p.rect.top + 6}px`; style['max-height'] = `${p.rect.top - 18}px`; }
  const renderItems = (items, depth = 0) => items.map((it, i) => {
    if (!it) return null;
    if (it.divider) return h('div', { class: 'menu-divider', key: `d${depth}-${i}` });
    if (it.header) return h('div', { class: 'menu-header', key: `h${depth}-${i}` }, it.header);
    const isOpen = p.expanded === it.label;
    const btn = h('button', {
      type: 'button', key: `i${depth}-${i}-${it.label}`, class: ['menu-item', { destructive: it.destructive, sub: depth > 0 }], disabled: it.disabled, id: it.id,
      role: 'menuitem',
      onclick: (e) => {
        e.stopPropagation();
        if (it.submenu) { p.expanded = isOpen ? null : it.label; rerender(); return; }
        ui.popover = null;
        rerender();
        it.action?.();
      },
    },
    h('span', { class: 'menu-check' }, it.checked ? icon('check') : null),
    h('span', { class: 'menu-label' }, it.label),
    it.submenu ? icon(isOpen ? 'chevronDown' : 'chevronRight', 'menu-icon') : it.icon ? icon(it.icon, 'menu-icon') : null);
    return it.submenu && isOpen ? frag(btn, renderItems(it.submenu, depth + 1)) : btn;
  });
  return h('div', { class: 'popover-backdrop', key: 'popover', onclick: () => closeMenu(), oncontextmenu: (e) => { e.preventDefault(); closeMenu(); } },
    h('div', { class: 'popover', role: 'menu', style, onclick: (e) => e.stopPropagation() }, renderItems(p.items)));
}

// MARK: 提示

export function renderToast(toast) {
  if (!toast) return null;
  return h('div', { class: ['toast', { error: toast.isError }], key: `toast-${toast.id}`, role: 'status' }, toast.text);
}
