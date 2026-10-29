// 設定與備份：匯出完整備份、從備份檔還原（iOS 版 App 的備份也可以）、自動備份
import { h, icon } from '../ui/dom.js';
import { section, row, sheetView, openSheet, closeSheet, rerender, confirmDialog, choiceRows, alertDialog, ui } from '../ui/kit.js';
import { store } from '../store.js';
import { decodeData, dataSummary } from '../model.js';
import { daysAgo, fileSize } from '../format.js';
import { exportBackup, pickFile } from '../io/exporter.js';
import { autoBackups } from '../db.js';
import { sync, connect, reconnect, syncNow, disconnect, syncStatusText, syncNeedsAttention } from '../sync.js';
import { DEMO } from '../io/exporter.js';

export const APP_VERSION = '2026.10.4';

export function openBackup() {
  const sheet = openSheet((s) => {
    const st = s.state;
    const sum = dataSummary(store.data);
    const last = store.data.lastBackupExportAt;
    return sheetView({
      title: '設定與備份', cancel: null,
      trailing: h('button', { type: 'button', class: 'bar-text bold', onclick: () => closeSheet(s), id: 'sheet-done' }, '完成'),
      body: [
        section({ header: '資料', footer: sync.state.enabled ? '資料存在這台裝置的瀏覽器裡，也同步一份到你的 Google 雲端硬碟。' : '資料存在這台裝置的這個瀏覽器裡，不會上傳。換裝置、換瀏覽器，或清除瀏覽器資料之前，請先匯出備份。' },
          row({ label: '學期', detail: `${sum.semesters} 個` }),
          row({ label: '科目', detail: `${sum.subjects} 個` }),
          row({ label: '學生（學生名冊）', detail: `${sum.students} 人` })),
        DEMO ? null : syncSection(),
        section({ header: '備份', footer: last ? `上次匯出備份：${daysAgo(last)}。建議每隔幾週匯出一次，存到雲端硬碟或電腦。` : '還沒有匯出過備份。建議每隔幾週匯出一次，存到雲端硬碟或電腦。' },
          row({ label: '匯出完整備份', tint: true, leading: icon('share', 'tint'), id: 'export-backup', onclick: async () => {
            if (await exportBackup()) store.showToast('已匯出備份檔');
          } }),
          row({ label: '從備份檔還原…', tint: true, leading: icon('upload', 'tint'), id: 'restore-file', onclick: openRestoreFromFile })),
        section({ header: '自動備份', footer: '每天第一次使用時會自動備份一份，保留最近 14 天；還原前也會先備份目前的資料。' },
          st.backups === null
            ? row({ label: h('span', { class: 'muted' }, '讀取中…') })
            : st.backups.length
              ? st.backups.map((b) => row({
                key: b.name, label: b.displayName, sub: fileSize(b.size), chevron: true,
                onclick: () => { try { openRestorePreview(decodeData(b.json), `自動備份 ${b.displayName}`); } catch { alertDialog({ title: '這份備份無法讀取' }); } },
              }))
              : row({ label: h('span', { class: 'muted' }, '還沒有自動備份') })),
        section({ header: '加到主畫面', footer: '加到主畫面後，網頁會像 App 一樣全螢幕開啟，也比較不會被瀏覽器清掉資料。' },
          row({ label: 'iPhone、iPad', sub: '用 Safari 打開這個網頁 → 點「分享」→「加入主畫面」。' }),
          row({ label: '電腦（Chrome、Edge）', sub: '網址列右邊的「安裝」圖示 →「安裝」。' })),
        h('p', { class: 'note', style: 'text-align:center' }, `實習課管理 網頁版 ${APP_VERSION}`),
      ],
    });
  }, { state: { backups: null } });
  autoBackups().then((list) => { sheet.state.backups = list; rerender(); }).catch(() => { sheet.state.backups = []; rerender(); });
}

/** 雲端同步（Google 雲端硬碟） */
function syncSection() {
  const header = '雲端同步（Google 雲端硬碟）';
  if (!sync.available) {
    return section({ header, footer: location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname)
      ? '這個網站還沒有設定 Google 登入用的 ID（js/config.js 的 GOOGLE_CLIENT_ID），設定後就能同步。'
      : '要用 https 網址打開才能同步。' },
    row({ label: h('span', { class: 'muted' }, '連結 Google 雲端硬碟'), disabled: true }));
  }
  if (!sync.state.enabled) {
    return section({ header, footer: '連結後，資料會另存一份在你自己的 Google 雲端硬碟（App 專用的隱藏資料夾，不會和其他檔案混在一起）。iPhone、iPad、電腦都連結同一個 Google 帳號，打開時就會拿到最新的資料。' },
      row({ label: '連結 Google 雲端硬碟…', tint: true, leading: icon('upload', 'tint'), id: 'sync-connect', onclick: connect }));
  }
  const warn = syncNeedsAttention();
  return section({ header, footer: '修改後幾秒會自動上傳；打開 App 或切回 App 時會自動拿最新的資料。兩台裝置都改過時會請你選一份，另一份存成「同步前」備份（在下面的「自動備份」）。' },
    row({ label: 'Google 帳號', detail: sync.state.email ?? '已連結' }),
    row({ label: '狀態', detail: h('span', { class: { 'warn-text': warn } }, syncStatusText() || '—'), id: 'sync-status' }),
    sync.status === 'needAuth'
      ? row({ label: '重新連線…', tint: true, id: 'sync-reconnect', onclick: reconnect })
      : row({ label: '立即同步', tint: true, id: 'sync-now', onclick: () => syncNow() }),
    row({ label: '取消連結', destructive: true, id: 'sync-disconnect', onclick: async () => {
      const ok = await confirmDialog({
        title: '取消連結 Google 雲端硬碟？', confirm: '取消連結', cancel: '保持連結',
        message: '這台裝置以後不會再同步，資料仍然留在這台裝置。雲端上的資料不會刪掉，其他裝置照常同步。',
      });
      if (ok) { await disconnect(); store.showToast('已取消連結'); }
    } }));
}

export async function openRestoreFromFile() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    const data = decodeData(await file.text());
    openRestorePreview(data, file.name);
  } catch (e) {
    alertDialog({ title: '無法讀取備份檔', message: `請確認選的是「實習課管理」匯出的備份檔（.json）。\n${e?.message ?? ''}` });
  }
}

/** 還原前先看內容，選「取代全部」或「加入為新學期」 */
function openRestorePreview(data, sourceName) {
  openSheet((sheet) => {
    const st = sheet.state;
    const sum = dataSummary(data);
    const hasCurrent = store.allSubjects.length > 0 || store.roster.length > 0;
    return sheetView({
      title: '從備份還原', onCancel: () => closeSheet(sheet),
      confirm: {
        label: '還原', action: async () => {
          const ok = !hasCurrent || st.mode === 'appendSemesters' || await confirmDialog({
            title: '取代全部資料？', confirm: '取代',
            message: '目前所有學期、學生、成績都會換成備份裡的內容。目前的資料會先另存一份自動備份。',
          });
          if (!ok) return;
          await store.restore(data, st.mode);
          store.showToast('已還原備份');
          closeSheet(sheet);
          for (const s of [...ui.sheets]) closeSheet(s);
        },
      },
      body: [
        section({ header: '備份內容', footer: sourceName },
          row({ label: '學期', detail: `${sum.semesters} 個`, sub: data.semesters.map((s) => s.name).join('、') }),
          row({ label: '科目', detail: `${sum.subjects} 個` }),
          row({ label: '學生（學生名冊）', detail: `${sum.students} 人` }),
          row({ label: '成績', detail: `${sum.scores} 筆` })),
        section({ header: '還原方式', footer: st.mode === 'replaceAll' ? '目前的資料會被備份的內容取代（會先另存一份自動備份）。' : '備份裡的學期會加在目前的學期後面，原本的資料都保留。' },
          choiceRows([
            { value: 'replaceAll', label: '取代全部資料', id: 'mode-replace' },
            { value: 'appendSemesters', label: '加入為新學期', id: 'mode-append' },
          ], st.mode, (v) => { st.mode = v; rerender(); })),
      ],
    });
  }, { state: { mode: store.allSubjects.length ? 'appendSemesters' : 'replaceAll' } });
}
