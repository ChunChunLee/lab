// 資料存在瀏覽器的 IndexedDB：主資料一份，加上每日自動備份（保留 14 天），以及還原前、同步前的備份（各保留 5 份）
import { decodeData, encodeData, emptyData, allSubjects } from './model.js';
import { fileDate, stamp, fullDate, dateTime } from './format.js';

const DB_NAME = 'lab-class-manager';
const KEEP_DAILY = 14;
const KEEP_RESTORE = 5;

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('backups')) db.createObjectStore('backups', { keyPath: 'name' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

const hasContent = (data) => allSubjects(data).length > 0 || data.semesters.some((s) => s.roster.length > 0);

/** 其他設定（例如雲端同步的狀態），存在這台裝置 */
export async function getKV(key) {
  try { return await tx('kv', 'readonly', (s) => reqP(s.get(key))); } catch { return undefined; }
}
export function setKV(key, value) {
  return tx('kv', 'readwrite', (s) => s.put(value, key));
}

/** 讀資料：主資料壞掉或不見時改用最近一份可以讀的自動備份。回傳 { data, notice } */
export async function loadData() {
  let raw;
  try {
    raw = await tx('kv', 'readonly', (s) => reqP(s.get('data')));
  } catch (e) {
    return { data: emptyData(), notice: `瀏覽器不能存資料（${e?.message ?? e}）。請不要用私密瀏覽模式。` };
  }
  if (raw) {
    try {
      return { data: decodeData(raw), notice: null };
    } catch {
      await tx('kv', 'readwrite', (s) => s.put(raw, `無法讀取_${stamp(new Date())}`));
      const b = await latestReadableBackup();
      if (b) return { data: b.data, notice: `資料無法讀取，已改用 ${b.file.displayName} 的自動備份。` };
      return { data: emptyData(), notice: '資料無法讀取，也找不到可以用的自動備份。' };
    }
  }
  const b = await latestReadableBackup();
  if (b) return { data: b.data, notice: `找不到資料，已從 ${b.file.displayName} 的自動備份還原。` };
  return { data: emptyData(), notice: null };
}

export async function saveData(data) {
  const json = encodeData(data);
  await tx('kv', 'readwrite', (s) => s.put(json, 'data'));
  await makeDailyBackupIfNeeded(data, json);
}

/** 每天第一次存檔（或打開）時，留一份當天的備份 */
export async function makeDailyBackupIfNeeded(data, json = null, now = new Date()) {
  if (!hasContent(data)) return;
  const name = `實習課管理_${fileDate(now)}`;
  try {
    const exists = await tx('backups', 'readonly', (s) => reqP(s.getKey(name)));
    if (exists) return;
    await tx('backups', 'readwrite', (s) => s.put({ name, kind: 'daily', date: now.toISOString(), json: json ?? encodeData(data) }));
    await pruneBackups();
  } catch { /* 備份失敗不影響主資料 */ }
}

const COPY_PREFIX = { beforeRestore: '還原前', beforeSync: '同步前' };

/** 還原前（beforeRestore）或同步換資料前（beforeSync），把要被換掉的資料另存一份 */
export async function saveCopy(data, kind = 'beforeRestore') {
  if (!hasContent(data)) return;
  const now = new Date();
  await tx('backups', 'readwrite', (s) => s.put({ name: `${COPY_PREFIX[kind]}_${stamp(now)}`, kind, date: now.toISOString(), json: encodeData(data) }));
  await pruneBackups();
}
export const saveBeforeRestoreCopy = (data) => saveCopy(data, 'beforeRestore');

function describe(b) {
  return {
    ...b,
    size: new Blob([b.json]).size,
    displayName: b.kind === 'daily' ? fullDate(b.date) : `${COPY_PREFIX[b.kind] ?? '備份'} ${dateTime(b.date)}`,
  };
}

/** 自動備份清單，新的在前 */
export async function autoBackups() {
  const all = await tx('backups', 'readonly', (s) => reqP(s.getAll()));
  return all.map(describe).sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function pruneBackups() {
  const all = await autoBackups();
  const remove = [
    ...all.filter((b) => b.kind === 'daily').slice(KEEP_DAILY),
    ...all.filter((b) => b.kind === 'beforeRestore').slice(KEEP_RESTORE),
    ...all.filter((b) => b.kind === 'beforeSync').slice(KEEP_RESTORE),
  ];
  if (remove.length) await tx('backups', 'readwrite', (s) => { for (const b of remove) s.delete(b.name); });
}

async function latestReadableBackup() {
  try {
    for (const file of await autoBackups()) {
      try { return { data: decodeData(file.json), file }; } catch { /* 試下一份 */ }
    }
  } catch { /* 沒有備份 */ }
  return null;
}

/** 請瀏覽器不要自動清掉資料（加到主畫面的網頁 App 通常會允許） */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** 測試用：清空全部資料 */
export async function resetAll() {
  await tx('kv', 'readwrite', (s) => s.clear());
  await tx('backups', 'readwrite', (s) => s.clear());
}
