// 外框：導覽列、分頁、左側選單、視窗；依螢幕寬度切換手機、平板、電腦的排版
import { h, icon, patch } from './ui/dom.js';
import { ui, setRenderer, rerender, prefs, layout, renderDialog, renderPopover, renderToast, closeTopSheet, closeMenu, alertDialog } from './ui/kit.js';
import { store } from './store.js';
import { currentSubject } from './model.js';
import { requestPersistentStorage } from './db.js';
import { takeRedirectResult, startSync } from './sync.js';
import { sideMenu } from './views/sideMenu.js';
import { startView } from './views/start.js';
import * as rosterView from './views/roster.js';
import * as gradesView from './views/grades.js';
import * as groupsView from './views/groups.js';
import * as dutiesView from './views/duties.js';

const TABS = [
  { id: 'roster', label: '名冊', icon: 'roster', view: rosterView },
  { id: 'grades', label: '成績', icon: 'grades', view: gradesView },
  { id: 'groups', label: '分組', icon: 'group', view: groupsView },
  { id: 'cleaning', label: '打掃', icon: 'broom', view: dutiesView },
];

export const appState = {
  tab: prefs.get('tab', 'roster'),
  menuOpen: false,
};

export function selectTab(id) {
  appState.tab = id;
  prefs.set('tab', id);
  appState.menuOpen = false;
  ui.popover = null;
  rerender();
  document.querySelector('.content')?.scrollTo(0, 0);
}

export function openMenuDrawer() { appState.menuOpen = true; rerender(); }
export function closeMenuDrawer() { if (appState.menuOpen) { appState.menuOpen = false; rerender(); } }

const root = document.getElementById('app');

/** 左上角的選單按鈕；平板以上旁邊顯示目前的科目 */
function menuTrigger(mode, title) {
  if (mode === 'desktop') return null;
  return h('button', { type: 'button', class: 'menu-trigger', id: 'menu-open', 'aria-label': '選單', onclick: openMenuDrawer },
    icon('menu'), mode === 'tablet' && title ? h('span', { class: 'label' }, title) : null);
}

function render() {
  const mode = layout();
  document.documentElement.dataset.layout = mode;
  const subject = currentSubject(store.currentSemester);
  const semester = store.currentSemester;
  const hasSubjects = !!subject;
  const tab = TABS.find((t) => t.id === appState.tab) ?? TABS[0];
  const page = hasSubjects ? tab.view.render() : startView();
  const title = hasSubjects ? subject.name : (semester?.name ?? '實習課管理');

  const tabsTop = hasSubjects && mode !== 'phone'
    ? h('div', { class: 'tabs-top', role: 'tablist' }, TABS.map((t) => h('button', {
      type: 'button', role: 'tab', class: { on: t.id === tab.id }, key: t.id, id: `tab-${t.id}`, 'aria-selected': t.id === tab.id ? 'true' : 'false', onclick: () => selectTab(t.id),
    }, t.label)))
    : null;

  const navbar = h('header', { class: 'navbar' },
    h('div', { class: 'bar-side left' }, menuTrigger(mode, title), mode === 'desktop' ? h('div', { class: 'nav-title', style: 'text-align:left' }, title) : null),
    mode === 'phone' || !hasSubjects ? h('div', { class: 'nav-title' }, mode === 'phone' ? title : '') : tabsTop,
    h('div', { class: 'bar-side right' }, page.actions ?? null));

  const tabbar = hasSubjects && mode === 'phone'
    ? h('nav', { class: 'tabbar', role: 'tablist' }, TABS.map((t) => h('button', {
      type: 'button', role: 'tab', class: { on: t.id === tab.id }, key: t.id, id: `tabbar-${t.id}`, 'aria-selected': t.id === tab.id ? 'true' : 'false', onclick: () => selectTab(t.id),
    }, icon(t.icon), h('span', null, t.label))))
    : null;

  const main = h('div', { class: 'main', key: 'main' },
    navbar,
    page.topbar ? h('div', { class: 'topbar', key: `topbar-${tab.id}` }, page.topbar) : null,
    h('div', { class: 'content', key: `content-${hasSubjects ? tab.id : 'start'}`, id: 'content' },
      page.raw ? page.body : h('div', { class: ['content-inner', page.wide && 'wide'] }, page.body)),
    tabbar);

  const drawer = mode !== 'desktop' && appState.menuOpen
    ? [h('div', { class: 'drawer-backdrop', key: 'drawer-bg', onclick: closeMenuDrawer }),
      h('aside', { class: 'drawer', key: 'drawer', role: 'navigation', 'aria-label': '選單' }, sideMenu())]
    : null;

  root.className = `layout-${mode}`;
  patch(root,
    mode === 'desktop' ? h('aside', { class: 'sidebar', key: 'sidebar', role: 'navigation', 'aria-label': '選單' }, sideMenu()) : null,
    main,
    drawer,
    ui.sheets.map((s) => h('div', {
      class: ['overlay', s.kind], key: `sheet-${s.id}`,
      onclick: (e) => { if (e.target === e.currentTarget && s.kind !== 'cover') closeTopSheet(); },
    }, h('div', { class: ['sheet', s.state.wide && 'wide'], role: 'dialog', 'aria-modal': 'true' }, s.render(s)))),
    renderDialog(),
    renderPopover(),
    renderToast(store.toast));
  page.after?.(root);
}

// 畫面出錯時不要整個卡住：顯示錯誤，方便回報
let lastError = null;
setRenderer(() => {
  try {
    render();
  } catch (e) {
    console.error(e);
    if (String(e) !== lastError) {
      lastError = String(e);
      store.showToast(`畫面發生錯誤：${e?.message ?? e}`, true);
    }
  }
});
store.subscribe(rerender);
window.addEventListener('resize', rerender);

// Esc 關掉最上層的選單、對話框或視窗
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.isComposing) return;
  if (ui.popover) { closeMenu(); e.preventDefault(); return; }
  if (ui.dialog) { const c = ui.dialog.buttons.find((b) => b.role === 'cancel'); ui.dialog = null; rerender(); c?.action(); return; }
  if (ui.sheets.length && !e.target.closest?.('.grid-editor')) { closeTopSheet(); return; }
  if (appState.menuOpen) closeMenuDrawer();
});

// 從螢幕左邊緣往右滑打開選單
let edge = null;
window.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  edge = layout() !== 'desktop' && !ui.sheets.length && !appState.menuOpen && t.clientX < 24 ? { x: t.clientX, y: t.clientY } : null;
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (!edge) return;
  const t = e.touches[0];
  const dx = t.clientX - edge.x, dy = Math.abs(t.clientY - edge.y);
  if (dx > 50 && dx > dy * 1.5) { edge = null; openMenuDrawer(); }
}, { passive: true });

// 切到背景時馬上存檔
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.saveNow(); });
window.addEventListener('pagehide', () => store.saveNow());

async function start() {
  takeRedirectResult(); // 從 Google 登入轉回來：先把網址後面的通行證拿掉
  const params = new URLSearchParams(location.search);
  // ?reset 清空資料：只在這台電腦的測試伺服器上有用，正式網址不會清掉老師的資料
  const isLocal = ['127.0.0.1', 'localhost'].includes(location.hostname);
  if (params.has('reset') && isLocal) {
    const { resetAll } = await import('./db.js');
    await resetAll();
  }
  const notice = await store.load();
  const demo = globalThis.LCM_DEMO === true;
  if ((params.has('sample') || demo) && !store.allSubjects.length) store.loadSample();
  if (params.get('tab')) appState.tab = params.get('tab');
  // 測試用的參數用過就拿掉，重新整理才不會又清空資料
  if (params.has('reset') || params.has('sample') || params.has('tab')) history.replaceState(null, '', location.pathname);
  if (!demo && await startSync()) return; // 正在轉到 Google 更新雲端同步的通行證，馬上就會回來
  document.getElementById('loading')?.remove();
  render();
  if (notice && !demo) alertDialog({ title: '資料提醒', message: notice });
  else if (demo && !prefs.get('demoIntroShown', false)) {
    prefs.set('demoIntroShown', true);
    alertDialog({
      title: '實習課管理 試用版',
      message: '裡面是虛構的範例資料，可以隨意試用名冊、成績、分組、打掃和檢查表。\n\n試用版不能匯出、列印或備份，資料也只暫存在這個瀏覽器，請不要輸入真實的學生資料。',
    });
  }
  requestPersistentStorage();
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !demo) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
