// Excel（.xlsx）讀寫：讀每張工作表變成文字表格；寫的時候有標題列樣式、凍結窗格、欄寬和列印設定。
import { readZip, writeZip } from './zip.js';
import { normalizeNumber } from '../format.js';

const parseXML = (text) => new DOMParser().parseFromString(text, 'application/xml');
const byTag = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];

/** 依儲存格位置（例如 "C12"）算出 { row, column }，都從 0 開始 */
export function cellPosition(ref) {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref ?? '');
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, column: col - 1 };
}

/** 0 → A、25 → Z、26 → AA */
export function columnName(index) {
  let n = index;
  let name = '';
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

/**
 * 讀所有工作表：[{ name, rows: [[文字]] }]，依活頁簿裡的順序。
 * fillMergedCells：合併儲存格的值填到整個範圍（例如整欄合併的「A大組」）。
 */
export async function readSheets(bytes, { fillMergedCells = false } = {}) {
  const zip = await readZip(bytes);
  let shared = [];
  const sst = await zip.readText('xl/sharedStrings.xml');
  if (sst) {
    shared = byTag(parseXML(sst), 'si').map((si) =>
      // 不要拼音（rPh）裡的字
      byTag(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join(''));
  }
  const sheets = [];
  for (const { name, path } of await sheetPaths(zip)) {
    const xml = await zip.readText(path);
    if (xml) sheets.push({ name, rows: sheetRows(parseXML(xml), shared, fillMergedCells) });
  }
  return sheets;
}

/** 只讀第一張工作表 */
export async function readFirstSheet(bytes) {
  return (await readSheets(bytes))[0]?.rows ?? [];
}

async function sheetPaths(zip) {
  const fallback = 'xl/worksheets/sheet1.xml';
  const wbText = await zip.readText('xl/workbook.xml');
  if (!wbText) {
    if (zip.has(fallback)) return [{ name: '工作表1', path: fallback }];
    throw new Error('不是正確的 Excel（.xlsx）檔案');
  }
  const targets = new Map();
  const relsText = await zip.readText('xl/_rels/workbook.xml.rels');
  if (relsText) for (const r of byTag(parseXML(relsText), 'Relationship')) targets.set(r.getAttribute('Id'), r.getAttribute('Target'));
  const paths = [];
  for (const [i, s] of byTag(parseXML(wbText), 'sheet').entries()) {
    const rid = [...s.attributes].find((a) => a.name === 'r:id' || a.name.endsWith(':id'))?.value;
    const target = targets.get(rid);
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    if (zip.has(path)) paths.push({ name: s.getAttribute('name') ?? `工作表${i + 1}`, path });
  }
  if (!paths.length) {
    if (zip.has(fallback)) return [{ name: '工作表1', path: fallback }];
    throw new Error('不是正確的 Excel（.xlsx）檔案');
  }
  return paths;
}

function sheetRows(doc, shared, fillMergedCells) {
  const cells = new Map(); // row → Map(col → text)
  let rowIndex = -1;
  for (const rowEl of byTag(doc, 'row')) {
    const r = Number(rowEl.getAttribute('r'));
    rowIndex = Number.isInteger(r) && r > 0 ? r - 1 : rowIndex + 1;
    let nextCol = 0;
    for (const c of byTag(rowEl, 'c')) {
      const pos = cellPosition(c.getAttribute('r'));
      const col = pos ? pos.column : nextCol;
      nextCol = col + 1;
      const type = c.getAttribute('t') ?? '';
      const v = byTag(c, 'v')[0]?.textContent ?? '';
      let value;
      if (type === 's') value = shared[Number(v.trim())] ?? '';
      else if (type === 'inlineStr') value = byTag(c, 't').map((t) => t.textContent).join('');
      else if (type === 'str') value = v;
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'e') value = '';
      else value = normalizeNumber(v);
      if (value !== '') {
        if (!cells.has(rowIndex)) cells.set(rowIndex, new Map());
        cells.get(rowIndex).set(col, value);
      }
    }
  }
  if (fillMergedCells) {
    for (const m of byTag(doc, 'mergeCell')) {
      const [a, b] = (m.getAttribute('ref') ?? '').split(':').map(cellPosition);
      if (!a || !b) continue;
      const top = Math.min(a.row, b.row), bottom = Math.max(a.row, b.row);
      const left = Math.min(a.column, b.column), right = Math.max(a.column, b.column);
      if ((bottom - top + 1) * (right - left + 1) > 20000) continue; // 太大的範圍（整張表合併當背景）不處理
      const value = cells.get(top)?.get(left);
      if (value === undefined) continue;
      for (let r = top; r <= bottom; r++) {
        for (let c = left; c <= right; c++) {
          if (!cells.has(r)) cells.set(r, new Map());
          if (!cells.get(r).has(c)) cells.get(r).set(c, value);
        }
      }
    }
  }
  if (!cells.size) return [];
  const maxRow = Math.max(...cells.keys());
  const rows = [];
  for (let r = 0; r <= maxRow; r++) {
    const row = cells.get(r);
    if (!row) { rows.push([]); continue; }
    const maxCol = Math.max(...row.keys());
    rows.push(Array.from({ length: maxCol + 1 }, (_, c) => row.get(c) ?? ''));
  }
  return rows;
}

// MARK: 寫入

/** 樣式（對應 styles.xml 的 cellXfs 順序）：0 一般、1 標題、2 粗體、3 紅字、4 黃底、5 紅字置中、6 灰字置中 */
export const STYLE = { normal: 0, header: 1, bold: 2, fail: 3, blank: 4, missing: 5, excused: 6 };

function xmlEscape(s) {
  let out = '';
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (ch === '&') out += '&amp;';
    else if (ch === '<') out += '&lt;';
    else if (ch === '>') out += '&gt;';
    else if (ch === '"') out += '&quot;';
    else if (ch === '\t' || ch === '\n' || ch === '\r' || (code >= 0x20 && code !== 0xfffe && code !== 0xffff)) out += ch;
  }
  return out;
}

const numberString = (v) => (Number.isInteger(v) ? String(v) : String(v));

/**
 * sheet: { name, rows: [[{ value: 文字|數字|null, style }]], columnWidths, freezeRows, freezeColumns,
 *          landscape, printTitleRows, pageHeader, fitToWidth }
 */
function sheetXML(s) {
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  x += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
  if (s.fitToWidth) x += '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';
  x += '<sheetViews><sheetView workbookViewId="0">';
  const fr = s.freezeRows ?? 0, fc = s.freezeColumns ?? 0;
  if (fr > 0 || fc > 0) {
    const topLeft = columnName(fc) + (fr + 1);
    const pane = fr > 0 && fc > 0 ? 'bottomRight' : fr > 0 ? 'bottomLeft' : 'topRight';
    x += '<pane' + (fc > 0 ? ` xSplit="${fc}"` : '') + (fr > 0 ? ` ySplit="${fr}"` : '');
    x += ` topLeftCell="${topLeft}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${topLeft}" sqref="${topLeft}"/>`;
  }
  x += '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>';
  if (s.columnWidths?.length) {
    x += '<cols>' + s.columnWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${numberString(w)}" customWidth="1"/>`).join('') + '</cols>';
  }
  x += '<sheetData>';
  s.rows.forEach((row, r) => {
    const multiline = row.some((c) => typeof c.value === 'string' && c.value.includes('\n'));
    x += multiline ? `<row r="${r + 1}" ht="48" customHeight="1">` : `<row r="${r + 1}">`;
    row.forEach((cell, c) => {
      const ref = columnName(c) + (r + 1);
      const style = cell.style ?? 0;
      if (typeof cell.value === 'number') x += `<c r="${ref}" s="${style}"><v>${numberString(cell.value)}</v></c>`;
      else if (cell.value) x += `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cell.value)}</t></is></c>`;
      else x += `<c r="${ref}" s="${style}"/>`;
    });
    x += '</row>';
  });
  x += '</sheetData><pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>';
  x += `<pageSetup paperSize="9" orientation="${s.landscape ? 'landscape' : 'portrait'}"${s.fitToWidth ? ' fitToWidth="1" fitToHeight="0"' : ''}/>`;
  if (s.pageHeader) {
    const h = xmlEscape(s.pageHeader.replace(/&/g, '&&'));
    x += `<headerFooter><oddHeader>&amp;L${h}&amp;R&amp;D</oddHeader><oddFooter>&amp;C第 &amp;P 頁，共 &amp;N 頁</oddFooter></headerFooter>`;
  }
  return x + '</worksheet>';
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="4"><font><sz val="12"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="12"/><name val="Calibri"/><family val="2"/></font>'
  + '<font><sz val="12"/><color rgb="FFC62828"/><name val="Calibri"/><family val="2"/></font><font><sz val="12"/><color rgb="FF6B7480"/><name val="Calibri"/><family val="2"/></font></fonts>'
  + '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF4D6"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left style="thin"><color rgb="FFB0B8C0"/></left><right style="thin"><color rgb="FFB0B8C0"/></right><top style="thin"><color rgb="FFB0B8C0"/></top><bottom style="thin"><color rgb="FFB0B8C0"/></bottom><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** 工作表名稱：最多 31 字、不能有 []:*?/\ 和單引號，也不能重複 */
function uniqueSheetNames(sheets) {
  const used = new Set();
  return sheets.map((s) => {
    let base = s.name.replace(/[[\]:*?/\\']/g, '').trim() || '工作表';
    base = [...base].slice(0, 28).join('');
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}${n}`;
    used.add(name.toLowerCase());
    return { ...s, name };
  });
}

/** 產生 .xlsx，回傳 Uint8Array */
export async function makeXLSX(sheetsIn) {
  const sheets = uniqueSheetNames(sheetsIn);
  const n = Math.max(1, sheets.length);
  let ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
  for (let i = 1; i <= n; i++) ct += `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  ct += '</Types>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  let wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>';
  sheets.forEach((s, i) => { wb += `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`; });
  wb += '</sheets>';
  const titled = sheets.map((s, i) => [s, i]).filter(([s]) => s.printTitleRows > 0);
  if (titled.length) {
    wb += '<definedNames>' + titled.map(([s, i]) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${xmlEscape(s.name)}'!$1:$${s.printTitleRows}</definedName>`).join('') + '</definedNames>';
  }
  wb += '</workbook>';
  let wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  for (let i = 1; i <= n; i++) wbRels += `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`;
  wbRels += `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const files = [['[Content_Types].xml', ct], ['_rels/.rels', rootRels], ['xl/workbook.xml', wb], ['xl/_rels/workbook.xml.rels', wbRels], ['xl/styles.xml', STYLES]];
  sheets.forEach((s, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXML(s)]));
  return writeZip(files);
}
