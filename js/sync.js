// 雲端同步：資料另存一份在老師自己的 Google 雲端硬碟（App 專用的隱藏資料夾，不會和其他檔案混在一起）。
// 修改後幾秒自動上傳；打開 App、切回 App 時自動拿最新的。兩台都改過時請老師選一份，另一份存成「同步前」備份。
//
// 登入用 Google 的 OAuth（網頁直接轉到 Google 登入再轉回來，iPhone 加到主畫面後也能用）。
// 拿到的通行證一小時後失效：打開 App 時會自動轉到 Google 一下再回來（已經同意過就不用再按）。
import { GOOGLE_CLIENT_ID } from './config.js';
import { store } from './store.js';
import * as db from './db.js';
import { ui, rerender, actionDialog, alertDialog, closeSheet } from './ui/kit.js';
import { dataSummary, uuid } from './model.js';
import { dateTime, isSameDay } from './format.js';
import { syncOnce, SYNC_FILE } from './logic/syncEngine.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,version,modifiedTime,md5Checksum';
const TOKEN_KEY = 'lcm.gtoken';
const AUTH_KEY = 'lcm.oauth';
const SILENT_KEY = 'lcm.silentAt';
const SILENT_GAP = 10 * 60 * 1000; // 自動轉到 Google 登入，10 分鐘內最多一次（避免一直跳來跳去）
const AWAY_LONG = 5 * 60 * 1000;

const DEMO = globalThis.LCM_DEMO === true;

export const sync = {
  /** 這個網站有設定 Google 登入，而且是 https（或本機測試） */
  available: !!GOOGLE_CLIENT_ID && !DEMO && globalThis.isSecureContext === true,
  /** { enabled, fileId, baseVersion, baseHash, email, lastSyncAt } */
  state: { enabled: false },
  /** off、needAuth、syncing、ok、offline、error、conflict、pending */
  status: 'off',
  message: '',
};

let redirectResult = null;
let memToken = null;
let timer = null;
let running = null;
let runAgain = false;
let conflictSnoozed = false;
let needAuthShown = false;
let hiddenAt = null;

// MARK: 通行證（access token）

function readToken() {
  let t = memToken;
  try { t = JSON.parse(localStorage.getItem(TOKEN_KEY)) ?? t; } catch { /* 私密瀏覽 */ }
  return t && t.exp > Date.now() + 60_000 ? t.token : null;
}

function saveToken(token, expiresIn) {
  memToken = { token, exp: Date.now() + expiresIn * 1000 };
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify(memToken)); } catch { /* 私密瀏覽 */ }
}

function clearToken() {
  memToken = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* 私密瀏覽 */ }
}

/** Google 登入完會轉回這個網址（要和 Google Cloud 裡設定的「已授權的重新導向 URI」一模一樣） */
export function redirectURI() {
  return new URL('./', location.href).href;
}

/** 轉到 Google 登入。mode：connect（第一次連結）、reauth（老師按「重新連線」）、silent（自動，不顯示畫面） */
async function goToGoogle(mode) {
  const state = globalThis.crypto?.randomUUID?.() ?? uuid();
  try { localStorage.setItem(AUTH_KEY, JSON.stringify({ state, mode })); } catch { /* 私密瀏覽：回來時會比對失敗 */ }
  if (mode === 'silent') {
    try { localStorage.setItem(SILENT_KEY, String(Date.now())); } catch { /* 私密瀏覽 */ }
  }
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectURI(), response_type: 'token', scope: SCOPE,
    include_granted_scopes: 'true', state,
  });
  if (sync.state.email && mode !== 'connect') p.set('login_hint', sync.state.email);
  if (mode === 'silent') p.set('prompt', 'none');
  if (mode === 'connect') p.set('prompt', 'select_account');
  await store.saveNow();
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
}

/** 從 Google 轉回來時，網址後面會帶著通行證或錯誤；讀完馬上從網址拿掉 */
export function takeRedirectResult() {
  if (!/[#&]state=/.test(location.hash)) return;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(AUTH_KEY)); localStorage.removeItem(AUTH_KEY); } catch { /* 私密瀏覽 */ }
  if (!saved || saved.state !== p.get('state')) {
    redirectResult = { mode: saved?.mode ?? null, error: 'state' };
    return;
  }
  const token = p.get('access_token');
  if (token) {
    const scopes = (p.get('scope') ?? '').split(' ');
    if (!scopes.includes(SCOPE)) {
      redirectResult = { mode: saved.mode, error: 'scope' };
      return;
    }
    saveToken(token, Number(p.get('expires_in')) || 3600);
    redirectResult = { mode: saved.mode };
  } else {
    redirectResult = { mode: saved.mode, error: p.get('error') ?? 'unknown' };
  }
}

/** 網路通不通（沒網路時不要轉到 Google，不然會停在錯誤頁） */
async function reachable() {
  if (navigator.onLine === false) return false;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 2500);
  try {
    await fetch('https://accounts.google.com/', { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: c.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function maySilentlyReconnect() {
  let last = 0;
  try { last = Number(localStorage.getItem(SILENT_KEY)) || 0; } catch { return false; }
  return Date.now() - last > SILENT_GAP && canApply() && await reachable();
}

// MARK: Google 雲端硬碟

class DriveError extends Error {
  constructor(status, message, reason) { super(message); this.status = status; this.reason = reason; }
}

function googleDrive(token) {
  async function call(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } });
    if (!res.ok) {
      let message = `HTTP ${res.status}`, reason = '';
      try { const e = (await res.json()).error; message = e?.message ?? message; reason = e?.errors?.[0]?.reason ?? ''; } catch { /* 不是 JSON */ }
      throw new DriveError(res.status, message, reason);
    }
    return res;
  }
  return {
    async find() {
      const q = encodeURIComponent(`name='${SYNC_FILE}' and trashed=false`);
      const r = await (await call(`${API}/files?spaces=appDataFolder&q=${q}&orderBy=modifiedTime%20desc&pageSize=1&fields=files(${FIELDS})`)).json();
      return r.files?.[0] ?? null;
    },
    async meta(id) {
      try {
        return await (await call(`${API}/files/${id}?fields=${FIELDS}`)).json();
      } catch (e) {
        if (e.status === 404) return null;
        throw e;
      }
    },
    async download(id) {
      return (await call(`${API}/files/${id}?alt=media`, { cache: 'no-store' })).text();
    },
    async create(json) {
      const b = `lcm${Math.random().toString(36).slice(2)}`;
      const meta = JSON.stringify({ name: SYNC_FILE, parents: ['appDataFolder'], mimeType: 'application/json' });
      const body = new Blob([
        `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
        `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, json, `\r\n--${b}--`,
      ]);
      return (await call(`${UPLOAD}?uploadType=multipart&fields=${FIELDS}`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body,
      })).json();
    },
    async update(id, json) {
      return (await call(`${UPLOAD}/${id}?uploadType=media&fields=${FIELDS}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: json,
      })).json();
    },
    async email() {
      const r = await (await call(`${API}/about?fields=user(emailAddress)`)).json();
      return r.user?.emailAddress ?? null;
    },
  };
}

// MARK: 同步

const persist = () => db.setKV('sync', { ...sync.state }).catch(() => {});

function setStatus(status, message = '') {
  sync.status = status;
  sync.message = message;
  if (status === 'needAuth' && !needAuthShown) {
    needAuthShown = true;
    store.showToast('雲端同步需要重新連線：左側選單 →「設定與備份」');
  }
  rerender();
}

/** 正在編輯（開著視窗、對話框或正在輸入）時，先不要把畫面上的資料換掉 */
function canApply() {
  const el = document.activeElement;
  const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  return !ui.sheets.length && !ui.dialog && !ui.popover && !typing;
}

const describe = (d) => {
  const s = dataSummary(d);
  return `${s.semesters} 個學期、${s.subjects} 個科目、${s.students} 位學生、${s.scores} 筆成績`;
};

async function askConflict({ local, remote, modifiedTime, first }) {
  if (ui.dialog) return 'busy';
  return actionDialog({
    title: first ? 'Google 雲端硬碟裡已經有資料' : '雲端和這台裝置都改過資料',
    message: `雲端（${dateTime(modifiedTime)} 存的）：\n${describe(remote)}\n\n這台裝置：\n${describe(local)}\n\n請選一份留下來。另一份會存成「同步前」備份，可以在「設定與備份」→「自動備份」找回。`,
    actions: [{ label: '用雲端的資料', value: 'cloud' }, { label: '用這台裝置的資料', value: 'local' }],
    cancel: '稍後再決定',
  });
}

async function apply(remote) {
  for (const s of [...ui.sheets]) closeSheet(s);
  store.applySynced(remote);
}

function schedule(delay = 2500) {
  clearTimeout(timer);
  timer = setTimeout(() => { run(); }, delay);
}

/** 同步一次（同時只跑一個；跑的時候又有修改，跑完再跑一次） */
export function run(opts = {}) {
  if (running) { runAgain = true; return running; }
  running = (async () => {
    try {
      await runOnce(opts);
    } finally {
      running = null;
      if (runAgain) { runAgain = false; schedule(500); }
    }
  })();
  return running;
}

async function runOnce({ manual = false } = {}) {
  if (!sync.state.enabled) return;
  const token = readToken();
  if (!token) { setStatus('needAuth'); return; }
  if (navigator.onLine === false) { setStatus('offline'); return; }
  if (conflictSnoozed && !manual) return;
  conflictSnoozed = false;
  await store.saveNow();
  const slow = setTimeout(() => setStatus('syncing'), 600);
  try {
    const result = await syncOnce({
      drive: googleDrive(token), state: sync.state,
      local: () => store.data, canApply, apply,
      conflict: (info) => { clearTimeout(slow); if (!ui.dialog) setStatus('conflict'); return askConflict(info); },
      saveCopy: (d) => db.saveCopy(d, 'beforeSync'),
    });
    clearTimeout(slow);
    if (result === 'deferred') { setStatus('pending'); schedule(4000); return; }
    if (result === 'conflict-busy') { setStatus('conflict'); schedule(4000); return; }
    if (result === 'conflict-later') { conflictSnoozed = true; setStatus('conflict'); return; }
    sync.state.lastSyncAt = new Date().toISOString();
    await persist();
    if (result === 'downloaded') store.showToast('已從雲端更新資料');
    if (result === 'conflict-cloud') store.showToast('已換成雲端的資料');
    if (result === 'conflict-local') store.showToast('已把這台裝置的資料存到雲端');
    if (manual && ['none', 'uploaded', 'created'].includes(result)) store.showToast('已同步');
    setStatus('ok');
  } catch (e) {
    clearTimeout(slow);
    await persist();
    if (e instanceof DriveError && (e.status === 401 || e.reason === 'insufficientPermissions')) {
      clearToken();
      setStatus('needAuth');
    } else if (e instanceof DriveError) {
      setStatus('error', e.reason === 'storageQuotaExceeded' ? 'Google 雲端硬碟空間已滿' : e.message);
    } else if (e instanceof TypeError) {
      setStatus('offline'); // fetch 連不上
    } else {
      setStatus('error', e?.message ?? String(e));
    }
  }
}

// MARK: 開始、連結、取消連結

let hooked = false;
function hookEvents() {
  if (hooked) return;
  hooked = true;
  store.afterSave.add(() => { if (sync.state.enabled) schedule(); });
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (!sync.state.enabled) return;
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    conflictSnoozed = false;
    if (!readToken() && away > AWAY_LONG && await maySilentlyReconnect()) { goToGoogle('silent'); return; }
    schedule(300);
  });
  window.addEventListener('online', () => { if (sync.state.enabled) schedule(500); });
  // 開著的時候每分鐘看一下雲端有沒有新的（另一台裝置剛改過）
  setInterval(() => {
    if (sync.state.enabled && document.visibilityState === 'visible' && readToken() && !running) run();
  }, 60_000);
}

/**
 * 打開 App 時呼叫（資料讀進來之後）。回傳 true 代表正在轉到 Google 登入，不用畫畫面。
 */
export async function startSync() {
  if (!sync.available) return false;
  const result = redirectResult;
  redirectResult = null;
  sync.state = { enabled: false, ...(await db.getKV('sync')) };

  if (result?.mode === 'connect') {
    if (result.error) {
      const msg = {
        access_denied: '你在 Google 的畫面按了取消，沒有連結。',
        scope: '要勾選「查看、建立和刪除自己在 Google 雲端硬碟中的設定資料」才能同步，請再連結一次。',
        state: '登入的過程被打斷了，請再試一次。',
      }[result.error] ?? `Google 回傳的錯誤：${result.error}`;
      queueMicrotask(() => alertDialog({ title: '沒有連結 Google 雲端硬碟', message: msg }));
    } else {
      sync.state = { enabled: true, fileId: null, baseVersion: null, baseMd5: null, baseHash: null, email: null, lastSyncAt: null };
      await persist();
      googleDrive(readToken()).email().then((email) => { sync.state.email = email; persist(); rerender(); }).catch(() => {});
    }
  }
  if (!sync.state.enabled) { sync.status = 'off'; return false; }
  hookEvents();
  if (readToken()) { schedule(0); return false; }
  if (result?.mode !== 'silent' && await maySilentlyReconnect()) { goToGoogle('silent'); return true; }
  if (result?.error === 'scope') needAuthShown = false;
  setStatus('needAuth');
  return false;
}

/** 「設定與備份」→「連結 Google 雲端硬碟」 */
export function connect() { goToGoogle('connect'); }

/** 「重新連線」 */
export function reconnect() { goToGoogle('reauth'); }

/** 「立即同步」 */
export function syncNow() {
  if (!readToken()) { reconnect(); return; }
  run({ manual: true });
}

/** 取消連結：這台裝置不再同步（雲端上的資料留著，其他裝置照常同步） */
export async function disconnect() {
  const token = readToken();
  clearToken();
  clearTimeout(timer);
  sync.state = { enabled: false };
  await persist();
  if (token) {
    fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', mode: 'no-cors', body: new URLSearchParams({ token }) }).catch(() => {});
  }
  setStatus('off');
}

// MARK: 顯示

function since(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d) / 60000);
  if (min < 1) return '剛剛';
  if (min < 60) return `${min} 分鐘前`;
  if (isSameDay(d, new Date())) return `今天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return dateTime(d);
}

/** 狀態的文字（左側選單、設定與備份） */
export function syncStatusText() {
  switch (sync.status) {
    case 'needAuth': return '需要重新連線';
    case 'syncing': return '同步中…';
    case 'ok': return `已同步·${since(sync.state.lastSyncAt)}`;
    case 'offline': return '沒有網路，連上後自動同步';
    case 'error': return `同步失敗：${sync.message}`;
    case 'conflict': return '兩邊的資料不一樣，等你選擇';
    case 'pending': return '雲端有新資料，編輯完會更新';
    default: return sync.state.lastSyncAt ? `上次同步·${since(sync.state.lastSyncAt)}` : '';
  }
}

export const syncNeedsAttention = () => ['needAuth', 'error', 'conflict'].includes(sync.status);
