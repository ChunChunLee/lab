// 匯出檔案（Excel、CSV、備份）、列印、選檔案
import { store } from '../store.js';
import { safeFileName, fileDate } from '../format.js';
import { activeGroupSet, encodeData } from '../model.js';
import { makeXLSX } from './xlsx.js';
import { encodeCSV } from '../logic/rosterParser.js';
import * as R from './reports.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const isTouchDevice = () => matchMedia('(pointer: coarse)').matches;

/** 放在 Claude 上的試用版：檢視器不允許下載檔案和列印 */
export const DEMO = globalThis.LCM_DEMO === true;
const DEMO_MESSAGE = '試用版不能匯出、列印或備份；正式網址就可以。';

/** 把檔案交給使用者：iPhone／iPad 用分享選單（存到「檔案」、AirDrop），電腦直接下載 */
export async function saveFile(data, filename, type) {
  if (DEMO) { store.showToast(DEMO_MESSAGE); return false; }
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const file = new File([blob], filename, { type });
  if (isTouchDevice() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') return false;
      // 分享失敗就改用下載
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

/** 列印：把報表放進只在列印時出現的區塊，叫出瀏覽器的列印（可以另存 PDF） */
export function printHTML(bodyHTML, landscape) {
  if (DEMO) { store.showToast(DEMO_MESSAGE); return; }
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.append(root);
  }
  root.innerHTML = `<style>${R.PRINT_CSS} @page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }</style>${bodyHTML}`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
  setTimeout(done, 60000);
}

function header(title, subjectName) {
  return `<header><h1>${title.replace(/</g, '&lt;')}</h1><div class="meta">${subjectName.replace(/</g, '&lt;')}　列印日期 ${new Date().toLocaleDateString('zh-TW')}</div></header>`;
}

/** 各種匯出的內容 */
function job(kind, subject) {
  const name = safeFileName(subject.name);
  const date = fileDate(new Date());
  switch (kind.type) {
    case 'roster': {
      const t = R.rosterReport(subject);
      return { sheets: [t], csv: t, html: R.tableHTML(t), title: t.title, landscape: false, base: `${name}_名冊_${date}` };
    }
    case 'grades': {
      const all = R.gradeReports(subject);
      const printed = kind.filter ? R.gradeReports(subject, kind.filter) : all;
      return { sheets: all, csv: all[0], html: R.tableHTML(printed[0]), title: printed[0].title, landscape: true, base: `${name}_成績表_${date}` };
    }
    case 'groups': {
      const set = subject.groupSets.find((g) => g.id === kind.setID);
      if (!set) return null;
      const t = R.groupsReport(subject, set);
      return { sheets: [t], csv: t, html: R.groupCardsHTML(subject, set), title: t.title, landscape: false, base: `${name}_分組名單_${safeFileName(set.name)}_${date}` };
    }
    case 'groupTemplate': {
      const set = subject.groupSets.find((g) => g.id === kind.setID) ?? null;
      const t = R.groupTemplateReport(subject, set);
      return { sheets: [t], csv: t, html: R.tableHTML(t), title: t.title, landscape: false, base: `${name}_分組匯入範本` };
    }
    case 'duties': {
      const t = R.dutiesReport(subject);
      return { sheets: [t], csv: t, html: R.tableHTML(t), title: t.title, landscape: false, base: `${name}_打掃工作_${date}` };
    }
    case 'dutyTemplate': {
      const tables = R.dutyTemplateReports(subject);
      return { sheets: tables, csv: tables[0], html: R.tableHTML(tables[0]), title: tables[0].title, landscape: false, base: `${name}_打掃工作填寫表` };
    }
    case 'dutyChecklist': {
      const t = R.dutyChecklistReport(subject, kind.section);
      const suffix = kind.section ? `_${safeFileName(kind.section)}` : '';
      return { sheets: [t], csv: t, html: R.tableHTML(t), title: t.title, landscape: true, base: `${name}_打掃檢查表${suffix}_${date}` };
    }
    default: return null;
  }
}

/** format：'xlsx'、'csv'、'print' */
export async function exportReport(kind, format) {
  const subject = store.currentSubject;
  if (!subject) return;
  try {
    const j = job(kind, subject);
    if (!j) return;
    if (format === 'xlsx') {
      const bytes = await makeXLSX(j.sheets.map(R.toXLSXSheet));
      await saveFile(bytes, `${j.base}.xlsx`, XLSX_TYPE);
    } else if (format === 'csv') {
      await saveFile(encodeCSV(R.toCSVRows(j.csv)), `${j.base}.csv`, 'text/csv;charset=utf-8');
    } else {
      printHTML(header(j.title, subject.name) + j.html, j.landscape);
    }
  } catch (e) {
    store.showToast(`匯出失敗：${e?.message ?? e}`, true);
  }
}

/** 「⋯」選單裡的匯出、列印項目 */
export function exportMenuItems(kind, printNote = '列印／存成 PDF…') {
  return [
    { header: '匯出' },
    { label: '匯出 Excel（.xlsx）', icon: 'table', action: () => exportReport(kind, 'xlsx'), id: 'export-xlsx' },
    { label: '匯出 CSV', icon: 'doc', action: () => exportReport(kind, 'csv') },
    { label: printNote, icon: 'printer', action: () => exportReport(kind, 'print'), id: 'export-print' },
  ];
}

export async function exportBackup() {
  const name = `實習課管理備份_${fileDate(new Date())}.json`;
  const ok = await saveFile(encodeData(store.data), name, 'application/json');
  if (ok) store.markBackupExported();
  return ok;
}

/** 選檔案（要在點按的處理函式裡呼叫）。回傳 Promise<File|null> */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => { resolve(input.files?.[0] ?? null); input.remove(); };
    input.oncancel = () => { resolve(null); input.remove(); };
    document.body.append(input);
    input.click();
  });
}

export const SPREADSHEET_ACCEPT = '.xlsx,.xls,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export { activeGroupSet };

/** 讀 Excel 或 CSV 檔：回傳 { sheets: [{ name, rows }] } 或 { error } */
export async function readSpreadsheet(file, { fillMergedCells = false } = {}) {
  const { readSheets } = await import('./xlsx.js');
  const { decodeText, parseCSV } = await import('../logic/rosterParser.js');
  const ext = file.name.split('.').pop().toLowerCase();
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (ext === 'xls') return { error: '不支援舊版 .xls 格式，請在 Excel 另存為 .xlsx 或 CSV 再匯入。' };
    if (ext === 'xlsx') return { sheets: await readSheets(bytes, { fillMergedCells }) };
    const text = decodeText(bytes);
    if (text === null) return { error: '無法辨識檔案的文字編碼，請另存為 UTF-8 的 CSV。' };
    const delimiter = text.includes('\t') ? '\t' : ',';
    return { sheets: [{ name: '', rows: parseCSV(text.replace(/\r\n?/g, '\n'), delimiter) }] };
  } catch (e) {
    return { error: `讀取失敗：${e?.message ?? e}` };
  }
}
