// 雲端同步的判斷（不碰畫面，方便測試）：比較這台裝置和雲端的資料，決定上傳、下載，還是請老師選一份
import { encodeData, decodeData, allSubjects } from '../model.js';

/** 雲端硬碟裡的檔名（放在 App 專用的隱藏資料夾） */
export const SYNC_FILE = 'lab-class-manager-data.json';

export const hasContent = (data) => allSubjects(data).length > 0 || data.semesters.some((s) => s.roster.length > 0);

/** 比對用的指紋：不含各裝置自己的狀態（目前選的學期、科目，上次匯出備份的時間） */
export function fingerprint(data) {
  const d = {
    ...data, currentSemesterID: null, lastBackupExportAt: null,
    semesters: data.semesters.map((s) => ({ ...s, currentSubjectID: null })),
  };
  return hash(encodeData(d));
}

/** 53 位元的字串雜湊（cyrb53），只用來判斷資料有沒有變 */
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${str.length}-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

function setBase(state, file, h) {
  state.fileId = file.id;
  state.baseVersion = String(file.version);
  state.baseMd5 = file.md5Checksum ?? null;
  state.baseHash = h;
}

/** 雲端的檔案和上次同步時一樣嗎（Google 雲端硬碟上傳後還會在背景把版本號往上加，所以優先比對內容的 md5） */
function sameAsBase(state, meta) {
  if (meta.md5Checksum && state.baseMd5) return meta.md5Checksum === state.baseMd5;
  return String(meta.version) === state.baseVersion;
}

/**
 * 同步一次。env：
 * - drive：{ find(), meta(id), download(id), create(json), update(id, json) }；find、meta、create、update 回傳 { id, version, modifiedTime, md5Checksum }，
 *   meta 找不到檔案時回傳 null
 * - state：{ fileId, baseVersion, baseMd5, baseHash }，上次同步時雲端檔案的版本和資料指紋（會直接修改，呼叫的人負責存起來）
 * - local()：這台裝置目前的資料
 * - canApply()：現在可以換掉畫面上的資料嗎（正在編輯時先不要）
 * - apply(data)：換成雲端的資料
 * - conflict({ local, remote, modifiedTime, first })：兩邊都改過時請老師選，回傳 'cloud'、'local'、'busy'（現在不能問）或 null（稍後再決定）
 * - saveCopy(data)：沒選的那一份另存備份
 *
 * 回傳 'none'、'created'、'uploaded'、'downloaded'、'deferred'、'conflict-cloud'、'conflict-local'、'conflict-busy'、'conflict-later'
 */
export async function syncOnce(env) {
  const { drive, state } = env;
  let local = env.local();
  let localHash = fingerprint(local);

  let meta = null;
  let first = false;
  if (state.fileId) {
    meta = await drive.meta(state.fileId);
    if (!meta) state.fileId = null; // 雲端的檔案被刪掉了
  }
  if (!state.fileId) {
    meta = await drive.find();
    if (!meta) {
      setBase(state, await drive.create(encodeData(local)), localHash);
      return 'created';
    }
    // 第一次連結，或雲端換了一個檔案：不知道兩邊的關係，要比對內容
    first = true;
  }

  if (!first && sameAsBase(state, meta)) {
    if (localHash === state.baseHash) return 'none';
    setBase(state, await drive.update(state.fileId ?? meta.id, encodeData(local)), localHash);
    return 'uploaded';
  }

  // 雲端可能有別台裝置存的新資料：下載下來比對內容
  const remote = decodeData(await drive.download(meta.id));
  const remoteHash = fingerprint(remote);
  if (!first && remoteHash === state.baseHash) {
    // 內容其實沒變（只是版本號變了）
    if (localHash === state.baseHash) { setBase(state, meta, localHash); return 'none'; }
    setBase(state, await drive.update(meta.id, encodeData(local)), localHash);
    return 'uploaded';
  }
  if (remoteHash === localHash) {
    setBase(state, meta, localHash);
    return 'none';
  }
  const localChanged = first ? hasContent(local) : localHash !== state.baseHash;
  if (!localChanged) {
    if (env.canApply && !env.canApply()) return 'deferred';
    await env.apply(remote);
    setBase(state, meta, remoteHash);
    return 'downloaded';
  }

  const choice = await env.conflict({ local, remote, modifiedTime: meta.modifiedTime, first });
  if (choice === 'cloud') {
    await env.saveCopy(env.local());
    await env.apply(remote);
    setBase(state, meta, remoteHash);
    return 'conflict-cloud';
  }
  if (choice === 'local') {
    await env.saveCopy(remote);
    local = env.local(); // 問的時候資料可能又改了，上傳最新的
    localHash = fingerprint(local);
    setBase(state, await drive.update(meta.id, encodeData(local)), localHash);
    return 'conflict-local';
  }
  return choice === 'busy' ? 'conflict-busy' : 'conflict-later';
}
